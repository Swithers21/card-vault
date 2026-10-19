#!/usr/bin/env python3
"""Real deck lists for every Yu-Gi-Oh! format, for Card Vault's "Decks I can build" (which ones your cards are closest to).

The daily GitHub workflow runs this. It reads:
  - Format Library (formatlibrary.com, its public API): its formats (Goat, Edison, Tengu, HAT, Wind-Up and about 120
    more, TCG and OCG, with the current Advanced and Genesys) and their tournament decks, each with its deck type,
    event and placing. For each format it keeps a spread of the best-placed recent decks of its most played deck types.
  - YGOPRODeck (the deck lists its own deck search reads): today's tournament decks (Advanced, Genesys, OCG), Speed
    Duel decks, and community formats (Common Charity, Domain, Trinity). Their cards come as ids, named with
    card-ids.json (card_themes.py keeps it).
Rush Duel isn't here: nobody publishes Rush Duel deck lists in a form Card Vault can read (and YGOPRODeck has no Rush
Duel cards), so the website makes Rush Duel's from its Japanese list's Starter and Structure Decks.
It is gentle with both sites: about a request a second, a few hundred a night at most, every list read again once a
week, and each deck downloaded once and kept (the workflow keeps format-decks-cache.json between runs). The first nights
fill it in a little at a time, popular formats first. It writes format-decks.js for the website. Anything it can't
reach keeps what it had.

    python format_decks.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.environ.get("CARDVAULT_FORMATS_OUT", os.path.join(HERE, "format-decks.js"))
CACHE_FILE = os.environ.get("CARDVAULT_FORMATS_CACHE", os.path.join(HERE, "format-decks-cache.json"))
IDS_FILE = os.environ.get("CARDVAULT_CARD_IDS", os.path.join(HERE, "card-ids.json"))
FL_API = os.environ.get("FORMATLIBRARY_API", "https://formatlibrary.com/api").rstrip("/")
YPD_DECKS = os.environ.get("YGOPRODECK_DECKS", "https://ygoprodeck.com/api/decks/getDecks.php")
MAX_REQUESTS = int(os.environ.get("CARDVAULT_FORMATS_MAX", "450"))
MAX_MINUTES = float(os.environ.get("CARDVAULT_FORMATS_MINUTES", "9"))
PAUSE = float(os.environ.get("CARDVAULT_FORMATS_PAUSE", "1.1"))
LIST_DAYS = 7
BLOCKED_AFTER = 6
FORMAT = 1
USER_AGENT = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; reads deck lists weekly, about one request a second)"
# A format's decks: a spread of deck types (the most played first), the best placings of each, up to a number
POPULAR_DECKS, OTHER_DECKS = 36, 16
POPULAR_PER_TYPE, OTHER_PER_TYPE = 3, 2
CURRENT = ("Advanced", "Genesys", "Traditional")
# YGOPRODeck's deck categories: (its name, the format in Card Vault, whose cards count: TCG English, OCG, Speed, pages of 20)
YPD_CATEGORIES = [
    ("Tournament Meta Decks", "Advanced", "TCG", 5),
    ("Tournament Meta Decks (Genesys)", "Genesys", "TCG", 3),
    ("Tournament Meta Decks OCG", "OCG", "OCG", 3),
    ("Speed Duel Decks", "Speed Duel", "Speed", 3),
    ("Common Charity Decks", "Common Charity", "TCG", 1),
    ("Domain Format Decks", "Domain", "TCG", 1),
    ("Trinity Format Decks", "Trinity", "TCG", 1),
]


def say(text):
    print(text, flush=True)


def now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(d=None):
    return (d or now()).isoformat()


def age_days(stamp):
    try:
        return (now() - datetime.fromisoformat(str(stamp))).total_seconds() / 86400
    except (TypeError, ValueError):
        return 9999


class Blocked(Exception):
    pass


class Web:
    def __init__(self, deadline, budget):
        self.deadline, self.budget = deadline, budget
        self.last, self.streak, self.requests, self.failed = {}, {}, 0, 0

    def can(self):
        return self.requests < self.budget and time.time() < self.deadline

    def json(self, url):
        host = urllib.parse.urlsplit(url).netloc
        if self.streak.get(host, 0) >= BLOCKED_AFTER:
            raise Blocked(host)
        wait = self.last.get(host, 0) + PAUSE - time.time()
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.time()
        self.requests += 1
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                body = res.read(40_000_000)
            data = json.loads(body.decode("utf-8", "replace"))
        except (urllib.error.URLError, OSError, ValueError) as err:
            self.streak[host] = self.streak.get(host, 0) + 1
            self.failed += 1
            raise IOError(str(err)[:120])
        self.streak[host] = 0
        return data


def read_json(path, empty):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, type(empty)) else empty
    except (OSError, ValueError):
        return empty


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def counted(names):
    """["A", "A", "B"] -> [["A", 2], ["B", 1]] (in first-seen order)"""
    out = {}
    for n in names:
        n = str(n or "").strip()
        if n:
            out[n] = out.get(n, 0) + 1
    return [[n, c] for n, c in out.items()]


# ----- Format Library
def place_num(p):
    m = re.search(r"\d+", str(p or ""))
    return int(m.group()) if m else 999


def choose(listing, popular):
    """The decks to keep for a format, from its event decks (newest first): its deck types in order of how often
    they're played, the best placing of each first, round and round, up to the format's number."""
    per_type, cap = (POPULAR_PER_TYPE, POPULAR_DECKS) if popular else (OTHER_PER_TYPE, OTHER_DECKS)
    by_type = {}
    for d in listing:
        t = str(d.get("deckTypeName") or "").strip()
        if not t or t.lower() == "other" or not d.get("id"):
            continue
        by_type.setdefault(t, []).append(d)
    order = sorted(by_type, key=lambda t: (-len(by_type[t]), t.lower()))
    newest = lambda d: -int(re.sub(r"\D", "", str(d.get("publishDate") or ""))[:8] or 0)
    ranked = {t: sorted(by_type[t], key=lambda d: (place_num(d.get("placement")), newest(d)))[:per_type] for t in order}
    picks = []
    for rnd in range(per_type):
        for t in order:
            if rnd < len(ranked[t]) and len(picks) < cap:
                picks.append(ranked[t][rnd])
    return picks


def fl_formats(web, cache):
    hit = cache.get("formats") or {}
    if hit.get("list") and age_days(hit.get("t")) < LIST_DAYS:
        return hit["list"]
    data = web.json(FL_API + "/formats")
    out = []
    for f in data if isinstance(data, list) else []:
        cat = str(f.get("category") or "").upper()
        if not f.get("name") or cat not in ("TCG", "OCG"):
            continue
        out.append({"name": str(f["name"]), "date": str(f.get("date") or "")[:10], "category": cat, "era": str(f.get("era") or ""),
                    "popular": bool(f.get("isPopular")), "banlist": str(f.get("banlist") or "")})
    if out:
        cache["formats"] = {"t": iso(), "list": out}
    return out or hit.get("list") or []


def fl_priority(formats):
    """Popular and current formats first, then the rest newest first (TCG before OCG)."""
    def key(f):
        return (0 if f["popular"] else 1 if f["name"] in CURRENT else 2, f["category"] != "TCG", -int((f["date"] or "0000").replace("-", "")[:8] or 0))
    return sorted(formats, key=key)


def fl_list(web, name, pages):
    listing = []
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode({"limit": 100, "page": page, "filter": "formatName:eq:%s,origin:eq:event" % name})
        got = web.json(FL_API + "/decks/?" + q)
        got = got if isinstance(got, list) else []
        listing += got
        if len(got) < 100:
            break
    return listing


def fl_deck(web, deck_id):
    d = web.json(FL_API + "/decks/%s" % int(deck_id))
    if not isinstance(d, dict):
        return None
    main = counted(c.get("name") for c in d.get("main") or [] if isinstance(c, dict))
    extra = counted(c.get("name") for c in d.get("extra") or [] if isinstance(c, dict))
    return {"main": main, "extra": extra} if main else None


def fl_run(web, cache, stats):
    formats = fl_formats(web, cache)
    lists = cache.setdefault("fl", {})
    decks = cache.setdefault("decks", {})
    for f in fl_priority(formats):
        if not web.can():
            break
        name = f["name"]
        entry = lists.get(name) or {}
        if not entry.get("t") or age_days(entry.get("t")) >= LIST_DAYS:
            try:
                listing = fl_list(web, name, 2 if f["popular"] else 1)
            except IOError:
                continue
            meta = {}
            for d in choose(listing, f["popular"]):
                ev = d.get("event") if isinstance(d.get("event"), dict) else {}
                meta[str(d["id"])] = {"type": str(d.get("deckTypeName") or "").strip(), "event": str(ev.get("name") or d.get("eventAbbreviation") or ""),
                                      "place": place_num(d.get("placement")) if d.get("placement") is not None else None,
                                      "date": str(d.get("publishDate") or "")[:10]}
            entry = lists[name] = {"t": iso(), "meta": meta}
            stats["lists"] += 1
        for deck_id in entry.get("meta") or {}:
            if deck_id in decks:
                continue
            if not web.can():
                break
            try:
                got = fl_deck(web, deck_id)
            except IOError:
                continue
            decks[deck_id] = got or {"main": [], "extra": []}
            stats["decks"] += 1
    # (decks no format keeps any more are let go)
    keep = {i for e in lists.values() for i in (e.get("meta") or {})}
    for i in [i for i in decks if i not in keep]:
        del decks[i]


# ----- YGOPRODeck
def ago(text, today):
    m = re.match(r"\s*(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago", str(text or ""), re.I)
    if not m:
        return ""
    n, unit = int(m.group(1)), m.group(2).lower()
    days = {"second": 0, "minute": 0, "hour": 0, "day": 1, "week": 7, "month": 30, "year": 365}[unit] * n
    return (today - timedelta(days=days)).date().isoformat()


def id_list(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [str(int(v)) for v in value or [] if str(v).strip().isdigit()]


def ypd_run(web, cache, stats):
    store = cache.setdefault("ypd", {})
    for cat, _, _, pages in YPD_CATEGORIES:
        hit = store.get(cat) or {}
        if hit.get("t") and age_days(hit.get("t")) < LIST_DAYS:
            continue
        if not web.can():
            break
        got, today, whole = [], now(), True
        try:
            for page in range(pages):
                rows = web.json(YPD_DECKS + "?" + urllib.parse.urlencode({"format": cat, "offset": page * 20}))
                rows = rows if isinstance(rows, list) else []
                for r in rows:
                    main = id_list(r.get("main_deck"))
                    if not main:
                        continue
                    got.append({"id": str(r.get("deckNum") or ""), "type": str(r.get("deck_name") or "").strip()[:80],
                                "event": str(r.get("tournamentName") or "").strip()[:80], "place": str(r.get("tournamentPlacement") or "").strip()[:20],
                                "date": ago(r.get("submit_date"), today), "url": str(r.get("pretty_url") or "")[:120],
                                "main": counted(main), "extra": counted(id_list(r.get("extra_deck")))})
                if len(rows) < 20:
                    break
        except IOError:
            whole = False
        if got or whole:      # (a category with no decks is asked again next week too, not every night)
            store[cat] = {"t": iso(), "decks": got}
            stats["ypd"] += len(got)


# ----- the website's file
def build(cache, ids):
    """{v, generated, names, formats: [[name, kind (TCG/OCG/Speed/Rush), date, popular, era, source]], decks: [[format,
    type, event, place, date, source (fl/ypd/rush), ref, main (name index, count, ...), extra (same)]]}"""
    names, index = [], {}

    def ni(n):
        if n not in index:
            index[n] = len(names)
            names.append(n)
        return index[n]

    def flat(pairs):
        out = []
        for n, c in pairs:
            out += [ni(n), int(c)]
        return out

    formats, fidx, decks = [], {}, []

    def fmt(name, kind, date="", popular=False, era="", src=""):
        if name not in fidx:
            fidx[name] = len(formats)
            formats.append([name, kind, date, 1 if popular else 0, era, src])
        elif src and src not in formats[fidx[name]][5]:
            formats[fidx[name]][5] += " and " + src
        return fidx[name]

    lists, kept = cache.get("fl") or {}, cache.get("decks") or {}
    for f in fl_priority((cache.get("formats") or {}).get("list") or []):
        meta = (lists.get(f["name"]) or {}).get("meta") or {}
        rows = [(i, m, kept[i]) for i, m in meta.items() if i in kept and kept[i].get("main")]
        if not rows:
            continue
        fi = fmt(f["name"], f["category"], f["date"], f["popular"], f["era"], "Format Library")
        for i, m, d in rows:
            decks.append([fi, m.get("type") or "Deck", m.get("event") or "", m.get("place") if m.get("place") is not None else "", m.get("date") or "", "fl", i,
                          flat(d["main"]), flat(d.get("extra") or [])])
    unknown = 0
    for cat, name, kind, _ in YPD_CATEGORIES:
        rows = ((cache.get("ypd") or {}).get(cat) or {}).get("decks") or []
        good = []
        for r in rows:
            main = [[ids.get(i), c] for i, c in r["main"]]
            extra = [[ids.get(i), c] for i, c in r.get("extra") or []]
            missing = sum(1 for n, _ in main + extra if not n)
            unknown += missing
            if missing > 3 or not main:
                continue
            good.append((r, [p for p in main if p[0]], [p for p in extra if p[0]]))
        if not good:
            continue
        fi = fmt(name, kind, "", name in ("Advanced", "Genesys"), "", "YGOPRODeck")
        for r, main, extra in good:
            decks.append([fi, r["type"] or "Deck", r["event"], r["place"], r["date"], "ypd", r["url"], flat(main), flat(extra)])
    return {"v": FORMAT, "generated": iso(), "names": names, "formats": formats, "decks": decks}, unknown


def write_site_file(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: deck lists for every format (Format Library, YGOPRODeck), for Decks I can build. Made by format_decks.py */\n")
        handle.write("window.FORMAT_DECKS = ")
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp, path)


def run(out_file=OUT_FILE, cache_file=CACHE_FILE, ids_file=IDS_FILE, budget=MAX_REQUESTS, minutes=MAX_MINUTES):
    cache = read_json(cache_file, {})
    if cache.get("v") != FORMAT:
        cache = {"v": FORMAT}
    ids = (read_json(ids_file, {}).get("ids") or {})
    web = Web(time.time() + minutes * 60, budget)
    stats = {"lists": 0, "decks": 0, "ypd": 0}
    notes = []
    for label, job, needs_ids in (("YGOPRODeck decks", ypd_run, True), ("Format Library", fl_run, False)):
        if needs_ids and not ids:
            notes.append("no card-ids.json yet, so YGOPRODeck's decks wait")
            continue
        try:
            job(web, cache, stats)
        except (Blocked, IOError) as err:
            notes.append("%s couldn't be read (%s)" % (label, str(err)[:80]))
    write_json(cache_file, cache)
    data, unknown = build(cache, ids)
    if data["decks"]:
        write_site_file(out_file, data)
    fl_total = sum(len((e or {}).get("meta") or {}) for e in (cache.get("fl") or {}).values())
    fl_have = sum(1 for d in (cache.get("decks") or {}).values() if d.get("main"))
    fl_formats_left = sum(1 for f in (cache.get("formats") or {}).get("list") or [] if f["name"] not in (cache.get("fl") or {}))
    say("Format decks: %d formats, %d decks on the website (Format Library %d of %d downloaded, %d new tonight, %d formats still to read; YGOPRODeck %d read%s). %d requests%s."
        % (len(data["formats"]), len(data["decks"]), fl_have, fl_total, stats["decks"], fl_formats_left, stats["ypd"],
           ", %d cards it named that Card Vault doesn't know" % unknown if unknown else "", web.requests, ("; " + "; ".join(notes)) if notes else ""))
    return 0


if __name__ == "__main__":
    sys.exit(run())
