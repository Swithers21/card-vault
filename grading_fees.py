#!/usr/bin/env python3
"""Grading companies' price lists for Card Vault: grading-fees.json (and grading-fees.js, for the PC copy).

The daily GitHub workflow runs this. Card Vault has each company's price list built in (as of the day it was last
checked by hand); this reads their own pages every day so the website can use today's fees, notice when a level
pauses or reopens, and say when a fee changes:
  - PSA: its trading-card grading page (the levels, fee per card, max insured value, wait; paused ones say so);
  - Beckett: the submission form it uses while Beckett.com is offline (only the open levels are offered there);
  - CGC: its Services & Fees page (card grading);
  - SGC: its price table, which is part of its website's program (the page itself is filled in by it);
  - TAG: the pricing table on its page (a widget, read from the widget's own data).
One request per page (SGC: a few, to find the part with the table), once a day.

A page that can't be read, or doesn't look as expected, is reported (the update status shows it) and that company
keeps its last good list.
"""

import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARDVAULT_FEES_CACHE", os.path.join(HERE, "ocg-cache"))
OUT = os.environ.get("CARDVAULT_FEES_OUT", os.path.join(HERE, "grading-fees.json"))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 CardVault/1.0 (personal collection tracker, once a day)"
URLS = {
    "PSA": "https://www.psacard.com/services/tradingcardgrading",
    "BGS": "https://beckett.jotform.com/form/beckett-card-grading-submission",
    "CGC": "https://www.cgcgrading.com/submit/services/",
    "SGC": "https://gosgc.com/card-grading/services-pricing",
    "TAG": "https://taggrading.com/pages/pricing",
    "TAG_BOOT": "https://core.service.elfsight.com/p/boot/",
    "WAYBACK": "https://archive.org/wayback/available",
    "WAYBACK_WEB": "https://web.archive.org/web/",
    "WAYBACK_SAVE": "https://web.archive.org/save/",
}
ASK_ARCHIVE_DAYS = 7       # with no recent copy, the Internet Archive is asked to save one this often
ARCHIVE_DAYS = 30          # an Internet Archive copy this recent stands in for a page that turns GitHub away (PSA's)
URLS.update(json.loads(os.environ.get("CARDVAULT_FEES_URLS", "{}")))   # (stand-ins, for the tests)
KEEP_CHANGES_DAYS = 45


def say(text):
    print(text, flush=True)


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today():
    t = os.environ.get("CARDVAULT_TODAY")
    return t if t else datetime.now(timezone.utc).date().isoformat()


def _brotli(data):
    try:
        import brotli
    except ImportError:
        raise ValueError("the page is compressed with brotli, which isn't installed here (pip install brotli)")
    return brotli.decompress(data)


def _zstd(data):
    try:
        from compression import zstd      # (Python 3.14 and later)
        return zstd.decompress(data)
    except ImportError:
        pass
    try:
        import zstandard
    except ImportError:
        raise ValueError("the page is compressed with zstd, which isn't installed here (pip install zstandard)")
    return zstandard.ZstdDecompressor().decompressobj().decompress(data)


def _deflate(data, wbits):
    return zlib.decompressobj(wbits).decompress(data)      # (a page cut short at the size limit still gives what it has)


def accepted_encodings():
    """What this program asks pages to be sent as: the ones it can unpack here."""
    names = ["gzip", "deflate"]
    for name, probe in (("br", _brotli), ("zstd", _zstd)):
        try:
            probe(b"")
        except ValueError:
            continue
        except Exception:
            pass
        names.append(name)
    return ", ".join(names)


def unpack(data, encoding=""):
    """A page's bytes with the compression it came in undone (gzip, deflate, and brotli or zstd when installed).

    Some sites, and the Internet Archive's copies of them, send compressed bytes whatever was asked for or said, so
    gzip and zstd are also recognised by how they begin."""
    names = [e.strip().lower() for e in str(encoding or "").split(",") if e.strip()]
    if data[:2] == b"\x1f\x8b" and "gzip" not in names and "x-gzip" not in names:
        names = ["gzip"]
    elif data[:4] == b"\x28\xb5\x2f\xfd" and "zstd" not in names:
        names = ["zstd"]
    for name in reversed(names):             # (undone in the opposite order to how they were applied)
        try:
            if name in ("gzip", "x-gzip"):
                data = _deflate(data, 16 + zlib.MAX_WBITS)
            elif name == "deflate":
                try:
                    data = _deflate(data, zlib.MAX_WBITS)
                except zlib.error:
                    data = _deflate(data, -zlib.MAX_WBITS)
            elif name == "br":
                data = _brotli(data)
            elif name == "zstd":
                data = _zstd(data)
        except ValueError:
            raise
        except Exception:
            pass                             # (said it was compressed but isn't: used as it is, and checked below)
    return data


def looks_binary(text):
    """True when text (a page's start) is mostly not words: compressed or other data that wasn't unpacked."""
    head = text[:400]
    odd = sum(1 for c in head if c == "�" or (c < " " and c not in "\t\n\r"))
    return bool(head) and odd * 10 > len(head)


def decode_page(raw, encoding=""):
    """A page's text from the bytes the site sent."""
    data = unpack(raw, encoding)
    text = data.decode("utf-8", "replace")
    if not looks_binary(text):
        return text
    # (compressed without saying so, and not by gzip: try each of the others)
    for attempt in (_brotli, _zstd, lambda d: _deflate(d, -zlib.MAX_WBITS), lambda d: _deflate(d, zlib.MAX_WBITS)):
        try:
            again = attempt(data).decode("utf-8", "replace")
        except Exception:
            continue
        if again.strip() and not looks_binary(again):
            return again
    raise ValueError("the page came back as compressed data this program couldn't unpack (it starts %s)" % " ".join("%02x" % b for b in raw[:6]))


def fetch(url, limit=8 * 1048576):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json,*/*", "Accept-Language": "en-US,en",
                                               "Accept-Encoding": accepted_encodings()})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return decode_page(res.read(limit), res.headers.get("Content-Encoding", ""))
    except urllib.error.HTTPError as err:
        # (a site that turns this program away may still answer curl, which asks the way browsers' tools do)
        if err.code != 403 or not shutil.which("curl"):
            raise
        done = subprocess.run(["curl", "-sS", "-L", "--compressed", "--max-time", "25", "-A", USER_AGENT, "-H", "Accept: text/html,application/json,*/*",
                               "-H", "Accept-Language: en-US,en", "-w", "\n%{http_code}", url], capture_output=True, timeout=40)
        body, _, code = done.stdout.decode("utf-8", "replace").rpartition("\n")
        if done.returncode != 0 or code.strip() != "200" or looks_binary(body):
            raise
        return body[:limit]


def text_of(page):
    """The page's words: scripts, styles and tags out, entities decoded, spaces squeezed."""
    page = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", page)
    page = re.sub(r"(?s)<!--.*?-->", " ", page)
    page = re.sub(r"<[^>]+>", " ", page)
    return re.sub(r"\s+", " ", html.unescape(page)).strip()


def money(text):
    """'$1,500' -> 1500, '$59.99' -> 59.99; None when it isn't an amount."""
    m = re.search(r"\$\s*([\d,]+(?:\.\d+)?)", text or "")
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    return int(v) if v == int(v) else round(v, 2)


def days_text(text):
    """'90 - 100' -> '90–100', '75+' -> '75+', '2 - 3' -> '2–3'."""
    t = re.sub(r"\s*[-–]\s*", "–", (text or "").strip())
    return re.sub(r"\s+", "", t)


def level(name, fee, max_value=None, days="", paused=False, **extra):
    out = {"name": name, "fee": fee, "max": max_value, "days": days, "paused": bool(paused)}
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


# ------------------------------------------------------------------ each company's page
PSA_FILLER = {"pricing", "details", "started", "get", "imaging", "front", "back", "and", "only", "unavailable", "currently",
              "business", "days", "time", "turnaround", "estimated", "value:", "insured", "max", "card", "per", "from"}
PSA_NAME = r"([A-Z][A-Za-z]+(?: (?:[A-Z][A-Za-z]+|\d+)){0,2})"


def psa_name(raw):
    """A level's name from the words just before its price: leftovers of the block before it ("Get Started",
    "Business Days") come off the front."""
    words = raw.split()
    while len(words) > 1 and words[0].lower() in PSA_FILLER:
        words.pop(0)
    while len(words) > 1 and words[-1].lower() == "from":   # ("Premium 10 From $9,999.00")
        words.pop()
    return " ".join(words).strip()


def parse_psa(page):
    """PSA's levels: open ones with a fee per card ("Standard $59.99/Card Max Insured Value: $1,000 Estimated
    Turnaround Time: 90 - 100 Business Days*"), paused ones without a fee ("Value Bulk Max Insured Value: $500
    Currently Unavailable"; the older page put "Currently Unavailable" in front of the name). Numbered levels
    ("Premium 1") and "From $9,999.00" / "$250,001 or higher" count too."""
    t = text_of(page)
    out, seen = [], set()
    for m in re.finditer(PSA_NAME + r"\s+(?:From\s+)?(\$[\d,]+(?:\.\d\d)?)\s*(?:/|per)\s*Card\b.{0,40}?Max Insured Value:\s*(\$[\d,]+)"
                         r"(?:.{0,40}?Estimated Turnaround Time:\s*([\d+ \-–]+?)\s*Business Days)?", t):
        name = psa_name(m.group(1))
        if name.lower() not in seen:
            seen.add(name.lower())
            out.append(level(name, money(m.group(2)), money(m.group(3)), days_text(m.group(4) or "")))
    paused = []
    for m in re.finditer(r"Currently Unavailable\s+" + PSA_NAME + r"\s+Max Insured Value:\s*(\$[\d,]+)", t):   # (older layout)
        paused.append((m.group(1), m.group(2)))
    for m in re.finditer(PSA_NAME + r"\s+Max Insured Value:\s*(\$[\d,]+)\s*Currently Unavailable", t):   # (current layout)
        paused.append((m.group(1), m.group(2)))
    for raw, value in paused:
        name = psa_name(raw)
        if name.lower() not in seen:
            seen.add(name.lower())
            out.append(level(name, None, money(value), "", True))
    # (what the page began with, so a failure can say what came back: a changed page or a "prove you're human" page)
    return {"levels": out, "complete": False, "sample": t[:160]}   # (PSA doesn't list every paused level: the others keep the built-in list)


def parse_bgs(page):
    """Beckett's submission form: a choice per open level ("EXPRESS: $79.95/card (15 Business Days)"). A level that
    isn't offered there is paused."""
    out = []
    for m in re.finditer(r"<option[^>]*>\s*([A-Za-z][A-Za-z ]+?):\s*\$\s*([\d,]+(?:\.\d+)?)\s*/\s*card\s*\(([^)]*?)\s*Business Days\)\s*</option>", page, re.I):
        out.append(level(m.group(1).strip().title(), money("$" + m.group(2)), None, days_text(m.group(3))))
    note = []
    if re.search(r"graded a 10[^.<]*\$\s*3 upgrade", page, re.I):
        note.append("a card that grades a 10 costs $3 more")
    return {"levels": out, "complete": True, "note": "; ".join(note)}


def parse_cgc(page):
    """CGC's card grading levels ("Card Grading Economy $20 Per Item Est. Turnaround: 90 Business Days Max. FMV:
    $500"; Bulk Economy adds "Min. Items: 25"; Unlimited Value is "$300 + 1% of FMV")."""
    t = text_of(page)
    end = t.find("Jumbo Card Grading")
    t = t[:end] if end > 0 else t
    out = []
    for m in re.finditer(r"Card Grading\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2})\s+(\$[\d,]+(?:\.\d+)?)(\s*\+\s*([\d.]+)%\s*of FMV)?\s*Per Item\s+"
                         r"Est\. Turnaround:\s*([\d+ \-–]+?)\s*Business Days\s*(?:Min\. Items:\s*(\d+)\s*)?Max\. FMV:\s*(\$[\d,]+|Unlimited)", t):
        pct = float(m.group(4)) if m.group(4) else None
        out.append(level(m.group(1).strip(), money(m.group(2)), money(m.group(7)), days_text(m.group(5)), False,
                         min=int(m.group(6)) if m.group(6) else None, pct=pct))
    return {"levels": out, "complete": True}


def sgc_table(js):
    """SGC's standard-size price table, from its program: [{DECVALUE:"$1,500",TotalCards:"1-9",5:"$50",2:"-"}, ...]
    (5: Standard, 40+ business days; 2: Expedited, 2-3 business days)."""
    m = re.search(r'=\[(\{DECVALUE:"\$1,500",TotalCards:[^\]]*)\]', js)
    if not m:
        return None
    rows = []
    for r in re.finditer(r'\{DECVALUE:"([^"]*)",TotalCards:"[^"]*",5:"([^"]*)",2:"([^"]*)"\}', m.group(1)):
        rows.append((r.group(1), r.group(2), r.group(3)))
    return rows or None


def parse_sgc(rows):
    out = []
    for value, standard, expedited in rows:
        cap = money(value)
        over = "+" in value
        for kind, fee, days in (("Standard", standard, "40+"), ("Expedited", expedited, "2–3")):
            amount = money(fee)
            if amount is None:
                continue
            name = "%s (%s $%s)" % (kind, "over" if over else "to", format(cap, ","))
            extra = {"note": "plus $375 for each $10,000 over $100,000"} if over else {}
            out.append(level(name, amount, None if over else cap, days, False, **extra))
    return {"levels": out, "complete": False}


def tag_columns(boot):
    """TAG's pricing table columns, from the widget's data (its settings are JSON inside JSON)."""
    cols = []

    def walk(o):
        if isinstance(o, str) and len(o) > 100 and o.lstrip()[:1] in "{[":
            try:
                walk(json.loads(o))
            except ValueError:
                pass
            return
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            if o.get("title") and isinstance(o.get("price"), dict) and "customPrice" in o["price"]:
                cols.append(o)
                return
            for v in o.values():
                walk(v)
    walk(boot)
    return cols


def parse_tag(boot):
    out = []
    for c in tag_columns(boot):
        if c.get("visible") is False:
            continue
        feats = text_of(" ".join(str((f or {}).get("text") or "") for f in (c.get("features") or [])))
        cap = re.search(r"Max Coverage\s*(\$[\d,]+)", feats)
        days = re.search(r"Estimated\s*([\d+ \-–]+?)\s*Business Days", feats)
        caption = text_of(str(c.get("priceCaption") or "")).upper()
        fee = money(str((c.get("price") or {}).get("customPrice") or ""))
        paused = "CAPACITY" in caption or fee is None
        out.append(level(str(c["title"]).strip().title(), fee, money(cap.group(1)) if cap else None, days_text(days.group(1)) if days else "", paused,
                         limited=True if "LIMITED" in caption else None))
    return {"levels": out, "complete": False}


# ------------------------------------------------------------------ reading them
def archived_copy(url):
    """The Internet Archive's latest copy of a page (its own HTML), when it's from the last ARCHIVE_DAYS days."""
    j = json.loads(fetch(URLS["WAYBACK"] + "?" + urllib.parse.urlencode({"url": re.sub(r"^https?://", "", url)})))
    snap = ((j or {}).get("archived_snapshots") or {}).get("closest") or {}
    stamp = str(snap.get("timestamp") or "")
    if not snap.get("available") or str(snap.get("status")) != "200" or not re.match(r"^\d{14}$", stamp):
        return None
    day = "%s-%s-%s" % (stamp[:4], stamp[4:6], stamp[6:8])
    from datetime import date
    if (date.fromisoformat(today()) - date.fromisoformat(day)).days > ARCHIVE_DAYS:
        return None
    return {"html": fetch(URLS["WAYBACK_WEB"] + stamp + "id_/" + url), "day": day}


def ask_archive(url):
    """Asks the Internet Archive to save a copy of a page (at most once a week), for the next nights to read."""
    path = os.path.join(CACHE, "archive-asked.json")
    asked = read_json(path, {}) or {}
    from datetime import date
    last = asked.get(url, "")
    if last and (date.fromisoformat(today()) - date.fromisoformat(last)).days < ASK_ARCHIVE_DAYS:
        return " (asked it to save one on %s)" % last
    try:
        fetch(URLS["WAYBACK_SAVE"] + url, limit=65536)
        note = "; asked it to save one now"
    except Exception as err:
        note = "; asking it to save one didn't work (%s)" % (("HTTP %d" % err.code) if isinstance(err, urllib.error.HTTPError) else str(err)[:80])
    asked[url] = today()
    write_json(path, asked)
    return note


def read_company(co):
    if co == "PSA":
        try:
            return parse_psa(fetch(URLS["PSA"]))
        except urllib.error.HTTPError as err:
            # PSA turns GitHub's computers away: its page as the Internet Archive last saw it, if that's recent
            if err.code != 403:
                raise
            try:
                snap = archived_copy(URLS["PSA"])
            except Exception as err2:   # (say what happened, for the update status)
                raise ValueError("HTTP 403; the Internet Archive didn't answer (%s)" % (("HTTP %d" % err2.code) if isinstance(err2, urllib.error.HTTPError) else err2))
            if not snap:
                raise ValueError("HTTP 403; the Internet Archive has no copy from the last %d days%s" % (ARCHIVE_DAYS, ask_archive(URLS["PSA"])))
            got = parse_psa(snap["html"])
            got["via"] = snap["day"]
            return got
    if co == "BGS":
        return parse_bgs(fetch(URLS["BGS"]))
    if co == "CGC":
        return parse_cgc(fetch(URLS["CGC"]))
    if co == "SGC":
        page = fetch(URLS["SGC"])
        scripts = re.findall(r'<script[^>]+src="([^"]*chunk-[^"]+\.js)"', page) or re.findall(r'(?:src|href)="([^"]*chunk-[^"]+\.js)"', page)
        # (the parts' addresses are relative to the page's <base href="/">, the site's root, not the page's folder)
        base = re.search(r'<base[^>]+href="([^"]*)"', page)
        root = urllib.parse.urljoin(URLS["SGC"], base.group(1)) if base else URLS["SGC"]
        for src in scripts[:8]:   # (its program comes in a few parts; the table has been in one of the first)
            rows = sgc_table(fetch(urllib.parse.urljoin(root, src)))
            if rows:
                return parse_sgc(rows)
        raise ValueError("the price table wasn't in SGC's page (%d parts looked at)" % len(scripts))
    if co == "TAG":
        page = fetch(URLS["TAG"])
        ids = list(dict.fromkeys(re.findall(r"elfsight-app-([0-9a-f]{8}-[0-9a-f-]{27})", page)))
        if not ids:
            raise ValueError("TAG's page has no pricing table")
        boot = json.loads(fetch(URLS["TAG_BOOT"] + "?" + urllib.parse.urlencode({"page": URLS["TAG"], "w": ",".join(ids)})))
        return parse_tag(boot)
    raise ValueError(co)


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def norm(name):
    return re.sub(r"[^a-z0-9$]+", " ", (name or "").lower()).strip()


def compare(co, before, after, day):
    """What changed at a company since its last good list: fees, and levels pausing or reopening."""
    out = []
    old = {norm(l["name"]): l for l in before or []}
    for l in after:
        o = old.get(norm(l["name"]))
        if not o:
            out.append({"co": co, "level": l["name"], "what": "new", "now": l.get("fee"), "day": day})
            continue
        if o.get("paused") and not l.get("paused"):
            out.append({"co": co, "level": l["name"], "what": "reopened", "now": l.get("fee"), "day": day})
        elif l.get("paused") and not o.get("paused"):
            out.append({"co": co, "level": l["name"], "what": "paused", "day": day})
        if l.get("fee") is not None and o.get("fee") is not None and l["fee"] != o["fee"]:
            out.append({"co": co, "level": l["name"], "what": "fee", "was": o["fee"], "now": l["fee"], "day": day})
    return out


def write_outputs(data):
    write_json(OUT, data)
    js = os.path.splitext(OUT)[0] + ".js"
    with open(js + ".tmp", "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: grading companies' price lists, read from their sites by grading_fees.py */\nwindow.GRADING_FEES = ")
        json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write(";\n")
    os.replace(js + ".tmp", js)


def from_cache():
    """--from-cache: the website's files from the last good read (when tonight's read didn't finish)."""
    data = read_json(os.path.join(CACHE, "grading-fees.json"), None)
    if not isinstance(data, dict) or not data.get("companies"):
        say("  No grading fees kept from earlier runs.")
        return 0
    write_outputs(data)
    say("  Grading fees: the list read %s is used." % str(data.get("checked") or "earlier")[:10])
    return 0


def run():
    prev = read_json(os.path.join(CACHE, "grading-fees.json"), {}) or {}
    pcos = prev.get("companies") or {}
    day = today()
    companies, changes, problems = {}, [], []
    for co in ("PSA", "BGS", "CGC", "SGC", "TAG"):
        last = pcos.get(co) or {}
        try:
            got = read_company(co)
            if not got["levels"] or not any(l.get("fee") for l in got["levels"]):
                sample = got.get("sample") or ""
                blocked = re.search(r"just a moment|captcha|verify you are human|access denied|enable javascript", sample, re.I)
                raise ValueError("no fees found on the page (%s)%s" % (
                    "PSA sent a check-you're-human page" if blocked else "it may have changed",
                    ("; it began: " + sample[:90]) if sample else ""))
            entry = {"ok": True, "checked": now_iso(), "lastOk": now_iso(), "source": URLS[co], "complete": got.get("complete", False),
                     "levels": got["levels"]}
            if got.get("via"):   # (the Internet Archive's copy: as of the day it was saved; not older than what's kept)
                if last.get("lastOk", "")[:10] > got["via"] and last.get("levels"):
                    raise ValueError("HTTP 403; the Internet Archive's copy (%s) is older than the last read" % got["via"])
                entry["lastOk"] = got["via"] + "T00:00:00+00:00"
                entry["via"] = "archive"
            if got.get("note"):
                entry["note"] = got["note"]
            if last.get("levels"):
                changes += compare(co, last["levels"], got["levels"], day)
            say("  %s: %s" % (co, ", ".join("%s %s%s" % (l["name"], ("$%s" % l["fee"]) if l.get("fee") is not None else "-", " (paused)" if l.get("paused") else "")
                                             for l in got["levels"])))
        except Exception as err:   # (keep the last good list)
            reason = (("HTTP %d" % err.code) if isinstance(err, urllib.error.HTTPError) else str(err))[:200]
            entry = dict(last, ok=False, checked=now_iso(), error=reason, source=URLS[co])
            problems.append({"co": co, "error": reason})
            say("  %s: couldn't read the price list (%s)%s" % (co, reason, "; keeping the one from %s" % last.get("lastOk", "")[:10] if last.get("levels") else ""))
        companies[co] = entry
    kept = [c for c in (prev.get("changes") or []) if c.get("day", "") >= _days_ago(day, KEEP_CHANGES_DAYS)]
    seen = {json.dumps(c, sort_keys=True) for c in kept}
    for c in changes:
        if json.dumps(c, sort_keys=True) not in seen:
            kept.append(c)
    data = {"format": 1, "checked": now_iso(), "companies": companies, "changes": kept, "problems": problems}
    write_json(os.path.join(CACHE, "grading-fees.json"), data)
    write_outputs(data)
    ok = sum(1 for c in companies.values() if c.get("ok"))
    say("  Grading fees: %d of 5 price lists read.%s%s" % (ok, " Changes: %s." % "; ".join(change_text(c) for c in changes) if changes else "",
                                                         " Couldn't read: %s." % ", ".join("%s (%s)" % (p["co"], p["error"]) for p in problems) if problems else ""))
    return 0


def _days_ago(day, n):
    from datetime import date, timedelta
    return (date.fromisoformat(day) - timedelta(days=n)).isoformat()


def change_text(c):
    if c["what"] == "fee":
        return "%s %s $%s -> $%s" % (c["co"], c["level"], c.get("was"), c.get("now"))
    return "%s %s %s" % (c["co"], c["level"], c["what"])


if __name__ == "__main__":
    sys.exit(from_cache() if "--from-cache" in sys.argv else run())
