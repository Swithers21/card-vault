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
}
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


def fetch(url, limit=8 * 1048576):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json,*/*", "Accept-Language": "en-US,en"})
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            return res.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        # (a site that turns this program away may still answer curl, which asks the way browsers' tools do)
        if err.code != 403 or not shutil.which("curl"):
            raise
        done = subprocess.run(["curl", "-sS", "-L", "--compressed", "--max-time", "25", "-A", USER_AGENT, "-H", "Accept: text/html,application/json,*/*",
                               "-H", "Accept-Language: en-US,en", "-w", "\n%{http_code}", url], capture_output=True, timeout=40)
        body, _, code = done.stdout.decode("utf-8", "replace").rpartition("\n")
        if done.returncode != 0 or code.strip() != "200":
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
def parse_psa(page):
    """PSA's levels: open ones with a fee per card ("Standard $59.99/Card Max Insured Value: $1,000 Estimated
    Turnaround Time: 90 - 100 Business Days"), paused ones without ("Currently Unavailable Value Bulk Max Insured
    Value: $500")."""
    t = text_of(page)
    out = []
    for m in re.finditer(r"Currently Unavailable\s+([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2})\s+Max Insured Value:\s*(\$[\d,]+)", t):
        out.append(level(m.group(1).strip(), None, money(m.group(2)), "", True))
    for m in re.finditer(r"([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,2})\s+(\$[\d,]+(?:\.\d\d)?)\s*/\s*Card\s+Max Insured Value:\s*(\$[\d,]+)"
                         r"(?:\s+Estimated Turnaround Time:\s*([\d+ \-–]+?)\s*Business Days)?", t):
        name = re.sub(r"^(?:Pricing|Details|Started|Get Started)\s+", "", m.group(1)).strip()
        out.append(level(name, money(m.group(2)), money(m.group(3)), days_text(m.group(4) or "")))
    return {"levels": out, "complete": False}   # (PSA doesn't list every paused level: the others keep the built-in list)


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


def read_company(co):
    if co == "PSA":
        try:
            return parse_psa(fetch(URLS["PSA"]))
        except urllib.error.HTTPError as err:
            # PSA turns GitHub's computers away: its page as the Internet Archive last saw it, if that's recent
            if err.code != 403:
                raise
            snap = archived_copy(URLS["PSA"])
            if not snap:
                raise
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
                raise ValueError("no fees found on the page (it may have changed)")
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
