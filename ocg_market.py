#!/usr/bin/env python3
"""Japanese and Korean sets for the Card Vault website's Market tab: ocg-market.js.

The daily GitHub workflow runs this after update_tcgplayer_data.py. TCGplayer only lists English cards, so for the
Japanese (OCG) and Korean sets this puts together:
  - the sets: Yugipedia (English names, set codes, release dates, set types);
  - each set's cards with their English names and rarities: Yugipedia;
  - Japanese card prices: BIGWEB, a large Japanese card shop (yen, with how many copies it has);
  - Korean card prices and sealed boxes: Bunjang, a Korean marketplace (in won: what cards sold for once they've sold
    a couple of times lately, else what sellers ask).
Sealed prices for Japanese sets come from Yugi-Market, which the website reads itself: that shop turns away GitHub's
computers.

It's polite to these sites: a time budget per run, pauses between requests (the three sites are read side by side,
each at its own gentle pace), and everything is kept between runs in ocg-cache/ (the workflow saves it), so each set
is looked up again only now and then. New sets are checked every day, recent ones every few days, older ones every
week. The first runs fill things in, newest sets first.

Besides ocg-market.js (the sets and their most valuable cards), it writes ocg-cards.js: every card of every set, with
its price, photo and how the price changed over the last day, week and month, for Card Vault to price your Japanese
and Korean cards, finish sets and search by name; and ocg-history/, a file per set with each day's prices, for the
price charts.
"""

import html
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARDVAULT_OCG_CACHE", os.path.join(HERE, "ocg-cache"))
OUT_FILE = os.environ.get("CARDVAULT_OCG_OUT", os.path.join(HERE, "ocg-market.js"))
CARDS_FILE = os.environ.get("CARDVAULT_OCG_CARDS", os.path.join(HERE, "ocg-cards.js"))
HISTORY_DIR = os.environ.get("CARDVAULT_OCG_HISTORY", os.path.join(HERE, "ocg-history"))
YUGIPEDIA = os.environ.get("YUGIPEDIA_API", "https://yugipedia.com/api.php")
BIGWEB = os.environ.get("BIGWEB_API", "https://api.bigweb.co.jp").rstrip("/")
BUNJANG = os.environ.get("BUNJANG_API", "https://api.bunjang.co.kr/api/search/v8/web/search")   # (the site's own search, since October 2026)
FULLAHEAD = os.environ.get("FULLAHEAD_URL", "https://fullahead-yugi.com").rstrip("/")   # (Japanese Rush Duel singles)
FX_API = os.environ.get("FX_API", "https://api.frankfurter.dev/v1/latest?from=USD&to=JPY,KRW")
BUDGET = float(os.environ.get("CARDVAULT_OCG_BUDGET", "360"))   # seconds of looking things up per run
SLOW = float(os.environ.get("CARDVAULT_OCG_PAUSE", "1"))         # pauses are multiplied by this (0 in tests)
USER_AGENT = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; daily, a few requests a minute)"
DATA_FORMAT = 1
CARDS_FORMAT = 1
CHASE = 25                 # most valuable cards kept per set
UPCOMING_DAYS = 45         # sets this close to release are listed (shops take pre-orders)
INDEX_DAYS = 3             # the set lists from Yugipedia are read again after this long
BUNJANG_PAGES = 6          # listings read per Korean set (60 a page, for sale and sold): more pages, more of its cards priced
HISTORY_DAYS = 400         # days of prices kept per set
CHANGE_DAYS = (1, 7, 30)   # the price changes in ocg-cards.js: since a day, a week, a month ago
BIGWEB_IMG = re.compile(r"^https://image\.bigweb\.co\.jp/new/imgc/(\d{3})/(\d{3})/(\d+)\.jpg$")
FULLAHEAD_PAUSE = 2.5      # seconds between Fullahead pages (its whole Rush Duel list, about 130 pages, once a day)
FULLAHEAD_DAYS = 0.8       # its list is read again after this long
FULLAHEAD_PAGES = 260      # (at most: it has about 6,500 Rush Duel singles, 50 a page)


def say(text):
    print(text, flush=True)


def today():
    t = os.environ.get("CARDVAULT_TODAY")
    return date.fromisoformat(t) if t else datetime.now(timezone.utc).date()


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def days_since(iso):
    try:
        then = datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - then).total_seconds() / 86400


# ------------------------------------------------------------------ the cache folder
def cache_path(*parts):
    return os.path.join(CACHE, *parts)


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def safe_name(prefix):
    return re.sub(r"[^A-Za-z0-9_-]", "_", prefix)


# ------------------------------------------------------------------ the internet, politely
BLOCKED_AFTER = 6          # failures in a row from a site: it isn't asked again this run


class HostBlocked(Exception):
    pass


class Web:
    def __init__(self, budget):
        self.started = time.time()
        self.budget = budget
        self.last = {}
        self.count = 0
        self.failed = 0
        self.by_host = {}
        self.errors = {}       # host -> {"403": n, "network": n, ...}
        self.streak = {}       # host -> failures in a row
        self.missed = {}       # host -> requests that didn't get an answer (each try, retries too)
        self.lock = threading.Lock()

    def left(self):
        return self.budget - (time.time() - self.started)

    def note_error(self, host, what):
        with self.lock:
            self.failed += 1
            self.errors.setdefault(host, {})
            self.errors[host][what] = self.errors[host].get(what, 0) + 1
            self.streak[host] = self.streak.get(host, 0) + 1

    def errors_text(self):
        return "; ".join("%s: %s" % (re.sub(r"^(api|www)\.|:\d+$", "", h), ", ".join("%s ×%d" % (k, n) for k, n in sorted(e.items())))
                         for h, e in sorted(self.errors.items()))

    def get_json(self, url, pause, headers=None):
        return self.get(url, pause, headers)

    def get_text(self, url, pause, encoding="utf-8"):
        """A web page's text (Fullahead's pages are in EUC-JP)."""
        return self.get(url, pause, {"Accept": "text/html,*/*", "Accept-Language": "ja,en"}, text=encoding)

    def get(self, url, pause, headers=None, text=None):
        host = urllib.parse.urlsplit(url).netloc
        if self.streak.get(host, 0) >= BLOCKED_AFTER:
            raise HostBlocked("%s: %d failures in a row; not asked again this run" % (host, self.streak[host]))
        for attempt in range(3):
            with self.lock:   # (each site: one request at a time with a pause between, whichever thread asks)
                slot = max(time.time(), self.last.get(host, 0) + pause * SLOW)
                self.last[host] = slot
                self.count += 1
                self.by_host[host] = self.by_host.get(host, 0) + 1
            wait = slot - time.time()
            if wait > 0:
                time.sleep(wait)
            req = urllib.request.Request(url, headers=dict({"User-Agent": USER_AGENT, "Accept": "application/json"}, **(headers or {})))
            try:
                with urllib.request.urlopen(req, timeout=40) as res:
                    raw = res.read()
                    out = raw.decode(text, "replace") if text else json.loads(raw.decode("utf-8", "replace"))
                with self.lock:
                    self.streak[host] = 0
                return out
            except urllib.error.HTTPError as err:
                with self.lock:
                    self.missed[host] = self.missed.get(host, 0) + 1
                # busy, or a hiccup on their side: a little later; anything else isn't going to change
                if err.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep((10 if err.code == 429 else 4) * SLOW)
                    continue
                self.note_error(host, "HTTP %d" % err.code)
                raise
            except (urllib.error.URLError, OSError, ValueError) as err:
                with self.lock:
                    self.missed[host] = self.missed.get(host, 0) + 1
                if attempt < 2:
                    time.sleep(3 * SLOW)
                    continue
                self.note_error(host, "bad answer" if isinstance(err, ValueError) else "network")
                raise


# ------------------------------------------------------------------ text
def plain_text(value):
    """Yugipedia's Japanese and Korean names come with reading aids (<ruby>); keep the plain text."""
    s = re.sub(r"<rt[^>]*>.*?</rt>|<rp[^>]*>.*?</rp>", "", str(value or ""), flags=re.S)
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def squash(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text or "")).lower()


def yp_date(raw):
    """Yugipedia dates come as "1/2026/10/31" (or just "1/2027/3"): "2026-10-31", "2027-03"."""
    parts = [p for p in str(raw or "").split("/") if p][1:]
    try:
        nums = [int(p) for p in parts[:3]]
    except ValueError:
        return ""
    if not nums or not 1990 <= nums[0] <= 2100:
        return ""
    return "-".join(["%04d" % nums[0]] + ["%02d" % n for n in nums[1:]])


def as_date(text):
    bits = (text or "").split("-") + ["01", "01"]
    try:
        return date(int(bits[0]), int(bits[1]), int(bits[2]))
    except (ValueError, IndexError):
        return None


# ------------------------------------------------------------------ rarities (the website's tables, in Python)
JA_RARITY = [(r"グランドマスター", "Grand Master Rare"), (r"クォーターセンチュリー", "Quarter Century Secret Rare"), (r"プリズマティック", "Prismatic Secret Rare"),
             (r"エクストラシークレット", "Extra Secret Rare"), (r"20th", "20th Secret Rare"), (r"ホログラフィック|ホロ", "Holographic Rare"),
             (r"アルティメット|レリーフ", "Ultimate Rare"), (r"コレクターズ", "Collector's Rare"), (r"ゴールドシークレット", "Gold Secret Rare"),
             (r"プレミアムゴールド", "Premium Gold Rare"), (r"ゴールド", "Gold Rare"), (r"ミレニアム", "Millennium Rare"),
             (r"シークレットパラレル", "Secret Parallel Rare"), (r"ウルトラパラレル", "Ultra Parallel Rare"), (r"スーパーパラレル", "Super Parallel Rare"),
             (r"ノーマルパラレル", "Normal Parallel Rare"), (r"ノーマルレア", "Normal Rare"), (r"シークレット", "Secret Rare"), (r"ウルトラ", "Ultra Rare"),
             (r"スーパー", "Super Rare"), (r"ノーマル", "Common"), (r"レア", "Rare")]
KO_RARITY = [(r"오버\s*러시|(^|[^A-Z])ORR(?![A-Z])", "Over Rush Rare"), (r"골드\s*러시|(^|[^A-Z])GRR(?![A-Z])", "Gold Rush Rare"),
             (r"러시\s*레어|(^|[^A-Z])RR(?![A-Z])", "Rush Rare"),   # (Rush Duel's own; "러시듀얼" itself is the game's name)
             (r"그랜드\s*마스터|그마레|(^|[^A-Z])GMR(?![A-Z])", "Grand Master Rare"),
             (r"쿼터\s*센[츄추]리|쿼센|QCSE|QCSR|QC\s*시크|QC\s*SE|25th", "Quarter Century Secret Rare"),
             (r"프리즈?[매마]틱|프시크|프싴|(^|[^A-Z])PSE(?![A-Z])", "Prismatic Secret Rare"), (r"엑스트라\s*시크|엑시크|(^|[^A-Z])EXSE(?![A-Z])", "Extra Secret Rare"),
             (r"20th|20\s*시크", "20th Secret Rare"), (r"홀로그래픽|홀로", "Holographic Rare"), (r"얼티(밋|메이트)?|얼레|(^|[^A-Z])UL(?![A-Z])", "Ultimate Rare"),
             (r"컬렉터즈|콜렉터즈|컬렉|컬레|(^|[^A-Z])CR(?![A-Z])", "Collector's Rare"), (r"골드\s*시크", "Gold Secret Rare"), (r"골드", "Gold Rare"),
             (r"밀레니엄", "Millennium Rare"), (r"노[멀말]\s*패러렐|노패", "Normal Parallel Rare"), (r"울트라\s*패러렐|울패", "Ultra Parallel Rare"),
             (r"시크릿|시크|(^|[^A-Z])(SE|SCR)(?![A-Z])", "Secret Rare"), (r"울트라|울레|(^|[^A-Z])UR(?![A-Z])", "Ultra Rare"),
             (r"슈퍼|슈레|(^|[^A-Z])SR(?![A-Z])", "Super Rare"), (r"노[멀말]", "Common"), (r"레어|(^|[^A-Z])R(?![A-Z0-9])", "Rare")]


# Rush Duel's own rarities (Japanese shop names): checked before the usual ones, since "オーバーラッシュレア" also says "レア"
RD_RARITY = [(r"オーバーラッシュ.*パラレル", "Over Rush Parallel Rare"), (r"オーバーラッシュ|ORR", "Over Rush Rare"),
             (r"ゴールドラッシュ|GRR", "Gold Rush Rare"), (r"ラッシュレア.*パラレル", "Rush Parallel Rare"), (r"ラッシュレア|\bRR\b", "Rush Rare"),
             (r"シークレット.*パラレル", "Secret Parallel Rare"), (r"ウルトラ.*パラレル", "Ultra Parallel Rare"), (r"スーパー.*パラレル", "Super Parallel Rare"),
             (r"ノーマル.*パラレル", "Normal Parallel Rare"), (r"シークレット", "Secret Rare"), (r"ウルトラ", "Ultra Rare"), (r"スーパー", "Super Rare"),
             (r"ノーマル", "Common"), (r"レア", "Rare")]


def rd_rarity(text):
    for pattern, name in RD_RARITY:
        if re.search(pattern, text or "", re.I):
            return name
    return text or ""


def is_rush(prefix):
    return str(prefix or "").upper().startswith("RD/")


# Overframe ("extended art" on Yugipedia, "Extended Art" on TCGplayer): the artwork breaks out of its frame. It isn't
# a rarity of its own, but an Overframe Ultra Rare is another card to collect (and price) than the usual Ultra Rare of
# the same number, so it's kept as a rarity named "Ultra Rare (Overframe)". Grand Master Rares always are, so they
# keep their name. BIGWEB says "【オーバーフレーム】ウルトラレア"; Korean sellers "오버프레임", "오버울레" (Overframe Ultra).
OVERFRAME = " (Overframe)"
JA_OVERFRAME = re.compile(r"オーバーフレーム|【\s*OF\s*】")
KO_OVERFRAME = re.compile(r"오버\s*프레임|오버\s*(울레|울트라|프시크|프싴|프리즘)")


def overframe(rarity):
    """The Overframe printing's rarity name: "Ultra Rare (Overframe)" (a Grand Master Rare is one already)."""
    if not rarity or rarity.endswith(OVERFRAME) or re.search(r"grand master", rarity, re.I):
        return rarity
    return rarity + OVERFRAME


def resolve_rarity(listed, rarity):
    """The rarity of the list (Yugipedia's names, Overframe ones included) that a shop's rarity is: the same one, else
    the Overframe one when the list has only that (BIGWEB calls Limit Over Collection's Prismatic Secret Rares, which
    are all Overframe, just "プリズマティックシークレットレア"). None when the list doesn't have it."""
    hit = next((x for x in listed if same_rarity(x, rarity)), None)
    if hit is None and rarity and not rarity.endswith(OVERFRAME):
        of = overframe(rarity)
        hit = next((x for x in listed if same_rarity(x, of)), None)
    return hit


def unmarked_overframe(rows, rarity, number, keys):
    """A shop's Overframe copy of a rarity the list has only plain ("Ultra Rare"), with no plain copy at the shop: the
    list's line is that Overframe printing without its mark (a set list with a single line per card doesn't say), so
    the row is renamed "Ultra Rare (Overframe)" and gets it. rows: [[rarity, ...]]; keys: the shop's "NUMBER|Rarity"s."""
    if not rarity.endswith(OVERFRAME):
        return None
    plain = rarity[:-len(OVERFRAME)]
    row = next((x for x in rows if same_rarity(x[0], plain)), None)
    if row is None or any(k.split("|", 1)[0] == number and same_rarity(k.split("|", 1)[1], plain) for k in keys):
        return None
    row[0] = rarity
    return rarity


def ja_rarity(web):
    for pattern, name in JA_RARITY:
        if re.search(pattern, web or "", re.I):
            return overframe(name) if JA_OVERFRAME.search(web or "") else name
    return web or ""


def ko_rarity(title):
    # (the card code itself is taken out first: "SR01-KR001" isn't a Super Rare)
    t = re.sub(r"(RD\s*/\s*)?[A-Z0-9]{2,5}\s*-?\s*(KR|JP)\s*[A-Z]?\d{3}", " ", title or "", flags=re.I)
    for pattern, name in KO_RARITY:
        if re.search(pattern, t, re.I):
            return overframe(name) if KO_OVERFRAME.search(t) and not name.startswith(("Over Rush", "Gold Rush", "Rush")) else name
    return ""


def same_rarity(a, b):
    return re.sub(r"[^a-z0-9]", "", (a or "").lower()) == re.sub(r"[^a-z0-9]", "", (b or "").lower())


def median(values):
    v = sorted(values)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else int(round((v[m - 1] + v[m]) / 2))


# ------------------------------------------------------------------ Yugipedia: the sets
SKIP_TYPE = re.compile(r"promotional|prize card|video game", re.I)
# Single promotional cards (magazines, campaigns, prizes, events) aren't sets to browse.
PROMO_CARD = re.compile(r"promotional cards?|promotion cards?|promo cards?|prize cards?|participation cards?|distribution cards?|attendance cards?|"
                        r"campaign|giveaway|collaboration cards?|subscription bonus|bonus cards?|purchase bonus|blu-ray|dvd|"
                        r"duelist cup|king cup|stella cup|galaxy cup|attendance|lottery", re.I)


def yp_ask(web, query):
    url = YUGIPEDIA + "?" + urllib.parse.urlencode({"action": "ask", "format": "json", "formatversion": "2", "query": query})
    j = web.get_json(url, 1.1, {"Api-User-Agent": USER_AGENT})
    results = (j.get("query") or {}).get("results") or {}
    rows = []
    for key, row in (results.items() if isinstance(results, dict) else enumerate(results)):
        row = dict(row or {})
        row.setdefault("fulltext", key if isinstance(key, str) else "")
        rows.append(row)
    return rows, j.get("query-continue-offset")


def printout(row, name):
    out = []
    for v in (row.get("printouts") or {}).get(name) or []:
        out.append(v.get("raw") or v.get("fulltext") or "" if isinstance(v, dict) else str(v))
    return [x for x in out if x]


def read_index(web, region):
    """Every set with a Japanese (or Korean) set code, newest first."""
    word = "Japanese" if region == "jp" else "Korean"
    rows, offset = [], 0
    for _ in range(12):
        page, nxt = yp_ask(web, "[[%s set prefix::+]]|?%s set prefix|?%s release date|?Set type|?Series|?%s name"
                                "|sort=%s release date|order=desc|limit=500|offset=%d" % (word, word, word, word, word, offset))
        for r in page:
            rows.append({"name": plain_text(r.get("fulltext")), "prefixes": printout(r, word + " set prefix"),
                         "date": yp_date((printout(r, word + " release date") or [""])[0]),
                         "type": printout(r, "Set type"), "series": printout(r, "Series"),
                         "local": plain_text((printout(r, word + " name") or [""])[0])})
        if not nxt or not page:
            break
        offset = int(nxt)
    return rows


def set_line(name, types, series):
    """The website's set types. Yugipedia's set type and series first; older pages often have neither, so the name too."""
    n, t, s = name.lower(), " ".join(types).lower(), " ".join(series).lower()
    if "core booster" in s:
        return "core"
    if "deck-build pack" in s or re.search(r"deck[- ]build pack", n):
        return "dbp"
    if re.search(r"structure deck|starter deck|preconstructed|tactical-try|chronicles deck|deck mod|deck set|duelist set|\bdeck\b", t + " " + s + " " + n):
        return "structure"
    if re.search(r"tournament pack|event pack|token pack|victory pack|winner'?s pack|jump festa|v ?jump", n):
        return "promo"
    if re.search(r"collector's set|binder|duel set|\bbox\b|complete file|\btin\b|anniversary (set|pack)|special set|bundle|\bset$", t + " " + n):
        return "boxed"
    if re.search(r"booster|enhancement|\bpack\b|selection|collection|chronicle|rarity|archive|premium|terminal|revolution|limit over|legend|edition", t + " " + n):
        return "side"
    return "other"


def rush_line(name, types, series):
    """Rush Duel's set types: Deck Mod Packs are its core boosters; starter and battle decks; the other packs."""
    n, t, s = name.lower(), " ".join(types).lower(), " ".join(series).lower()
    if "deck mod pack" in s or re.search(r"deck mod pack|deck modification pack", n):
        return "core"
    if re.search(r"starter deck|structure deck|battle deck|\bdeck\b|duel set", t + " " + s + " " + n):
        return "structure"
    if re.search(r"tournament|event pack|victory pack|battle pack|promotion pack|jump|v ?jump", n):
        return "promo"
    if re.search(r"booster|\bpack\b|collection", t + " " + n):
        return "side"
    return "other"


def build_sets(rows, region, rush=False):
    """One set per set code: when several pages share a code (a booster and its +1 bonus pack), the main one names it.
    rush: Rush Duel's sets instead (their codes start with RD/, like RD/KP01)."""
    horizon = (today() + timedelta(days=UPCOMING_DAYS)).isoformat()
    groups = {}
    for r in rows:
        prefixes = [p.strip().upper() for p in r["prefixes"] if p and p.strip()]
        if not prefixes or is_rush(prefixes[0]) != rush or not re.match(r"^(RD/)?[A-Z0-9]{2,6}$" if rush else r"^[A-Z0-9]{2,6}$", prefixes[0]):
            continue   # (Rush Duel or not, as asked; and anything without a plain set code)
        if any(SKIP_TYPE.search(t) for t in r["type"]) or PROMO_CARD.search(r["name"]) or not r["date"] or r["date"] > horizon:
            continue
        groups.setdefault(prefixes[0], []).append(r)
    sets = []
    for prefix, pages in groups.items():
        def rank(p):
            extra = re.search(r"\+1|bonus|expansion pack|assist pack|special pack|promotion", p["name"], re.I)
            return (0 if any("core booster" in x.lower() for x in p["series"]) else 1, 1 if extra else 0, len(p["name"]))
        main = sorted(pages, key=rank)[0]
        line = (rush_line if rush else set_line)(main["name"], main["type"], main["series"])
        if line in ("other", "side") and any(re.search(r"\+1 (bonus|expansion|assist)", p["name"], re.I) for p in pages):
            line = "core"   # (core boosters come with a "+1" bonus pack)
        sets.append({"prefix": prefix, "name": main["name"], "date": min(p["date"] for p in pages), "line": line, "local": main["local"], "rush": rush})
    sets.sort(key=lambda s: (s["date"], s["prefix"]), reverse=True)
    return sets


# ------------------------------------------------------------------ Yugipedia: a set's cards, in English
def read_card_list(web, prefix, region):
    """A set's cards from Yugipedia's list page for the region ("Set Card Lists:Phantom Nightmare (OCG-KR)"). Numbers are
    PREFIX-JP001 and PREFIX-KR001; Korean sets up to the late 2000s used PREFIX-K001 (LOB-K025), and the oldest
    Japanese sets their own forms (LB-35, 302-001), so those are read with a wider search when the usual one finds
    nothing."""
    tag = "(OCG-%s)" % ("JP" if region == "jp" else "KR")
    searches = [prefix + "-JP", prefix + "-"] if region == "jp" else [prefix + "-K"]   # (~LOB-K* finds LOB-K001 and LOB-KR001)
    for search in searches:
        cards, offset, rows = {}, 0, {}
        for _ in range(4):
            page, nxt = yp_ask(web, "[[Card number::~%s*]]|?Card number|?Rarity|?Set contains|limit=500|offset=%d" % (search, offset))
            for r in page:
                title = str(r.get("fulltext") or "")
                if "Set Card Lists:" in title and tag not in title:
                    continue
                numbers = [n.strip().upper() for n in printout(r, "Card number") if n.strip().upper().startswith(search)]
                # (Rush Duel cards' pages are "Petit Moth (Rush Duel)" when an OCG card has the name: the name itself)
                name = re.sub(r"\s*\(Rush Duel\)$", "", plain_text((printout(r, "Set contains") or [""])[0]))
                if not numbers or not name:
                    continue
                for number in numbers:
                    rows.setdefault(number, []).append(title.split("#", 1)[0].strip())
                    entry = cards.setdefault(number, [name, []])
                    for rar in printout(r, "Rarity"):
                        if not any(same_rarity(rar, x) for x in entry[1]):
                            entry[1].append(rar)
            if not nxt or not page:
                break
            offset = int(nxt)
        if cards:
            # (a number on two lines of the same list: usually an extended art, Overframe, printing on the second one;
            # a bonus pack's list with the same numbers is another page)
            pages = sorted({t for ts in rows.values() for t in ts if ts.count(t) > 1 and t.startswith("Set Card Lists:")})
            # (a page that can't be read fails the list's lookup, so it's read again next time)
            for title in pages[:3]:
                mark_overframe(cards, read_extended_lines(web, title))
            return cards
    return {}


EXTENDED_ART = re.compile(r"extended\s*art|over-?\s*frame", re.I)
# (the short names Yugipedia's set lists also take)
RARITY_ABBR = {"C": "Common", "R": "Rare", "SR": "Super Rare", "UR": "Ultra Rare", "ScR": "Secret Rare", "UtR": "Ultimate Rare",
               "PScR": "Prismatic Secret Rare", "GMR": "Grand Master Rare", "QCScR": "Quarter Century Secret Rare", "CR": "Collector's Rare",
               "StR": "Starlight Rare", "PlScR": "Platinum Secret Rare", "ExScR": "Extra Secret Rare", "HGR": "Holographic Rare",
               "NPR": "Normal Parallel Rare", "SPR": "Super Parallel Rare", "UPR": "Ultra Parallel Rare", "PCR": "Prismatic Collector's Rare",
               "PUR": "Prismatic Ultimate Rare", "RR": "Rush Rare", "ORR": "Over Rush Rare", "GRR": "Gold Rush Rare"}


def read_extended_lines(web, title):
    """Which lines of a set list are extended art (Overframe), from the page's own text (Yugipedia's data has a row per
    line but doesn't say which is which): {number: (rarities on its usual lines, rarities on its Overframe lines)}.
    A line looks like "LOCH-JP001; Dark Magician, the Pharaoh's Servant; Ultra Rare, Prismatic Secret Rare, Grand
    Master Rare; New // description::(extended art)"; one without rarities has the list's own ("rarities=...")."""
    url = YUGIPEDIA + "?" + urllib.parse.urlencode({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                                                     "titles": title, "format": "json", "formatversion": "2"})
    j = web.get_json(url, 1.1, {"Api-User-Agent": USER_AGENT})
    pages = (j.get("query") or {}).get("pages") or []
    rev = (((pages[0] if pages else {}) or {}).get("revisions") or [{}])[0] or {}
    text = rev.get("content") or ((rev.get("slots") or {}).get("main") or {}).get("content") or ""
    out = {}
    for block in re.findall(r"\{\{\s*Set list\s*\|(.*?)\n\s*\}\}", text, re.S | re.I):
        head, _, body = block.partition("\n")
        default = (re.search(r"(?:^|\|)\s*rarities\s*=\s*([^|]*)", head) or [None, ""])[1]
        for line in body.splitlines():
            main, _, notes = line.partition("//")
            parts = [x.strip() for x in main.split(";")]
            if len(parts) < 2 or not re.match(r"^[A-Z0-9/]+-[A-Z0-9]+$", parts[0].upper()):
                continue
            rarities = [RARITY_ABBR.get(x.strip(), x.strip()) for x in ((parts[2] if len(parts) > 2 else "") or default).split(",") if x.strip()]
            normal, ext = out.setdefault(parts[0].upper(), ([], []))
            (ext if EXTENDED_ART.search(notes) else normal).extend(rarities)
    return out


def mark_overframe(cards, extended):
    """cards: {number: [name, rarities]} from the list's rows. A rarity an Overframe line has becomes "Ultra Rare
    (Overframe)", next to the plain one when the usual line has it too (two printings to collect)."""
    for number, (normal, ext) in extended.items():
        entry = cards.get(number)
        if not entry or not ext:
            continue
        out = []
        for rar in entry[1]:
            in_normal, in_ext = any(same_rarity(rar, x) for x in normal), any(same_rarity(rar, x) for x in ext)
            for name in ([rar] if in_normal or not in_ext else []) + ([overframe(rar)] if in_ext else []):
                if not any(same_rarity(name, x) for x in out):
                    out.append(name)
        entry[1] = out


# ------------------------------------------------------------------ BIGWEB: Japanese prices
def read_bigweb_sets(web):
    j = web.get_json(BIGWEB + "/cardsets?game_id=9", 1.5)
    out = {}
    for c in j.get("cardsets") or []:
        m = re.match(r"\s*[\[［]\s*([A-Za-z0-9]{2,6})\s*[\]］]", unicodedata.normalize("NFKC", c.get("name") or ""))
        if m and c.get("id"):
            out.setdefault(m.group(1).upper(), []).append(c["id"])
    return out


def read_bigweb_prices(web, prefix, ids, old):
    """Each card and rarity: the cheapest copy in stock for play ("プレイ用"), else any undamaged copy, else any; when it's
    sold out, the last price seen."""
    code = prefix + "-JP"
    found = {}
    for set_id in ids:
        for page in range(1, 9):
            j = web.get_json(BIGWEB + "/products?game_id=9&cardsets=%s&page=%d" % (set_id, page), 1.5)
            for it in j.get("items") or []:
                number = unicodedata.normalize("NFKC", it.get("fname") or "").strip().upper()
                if not number.startswith(code) and not re.match(re.escape(prefix) + r"-\d", number):   # (LB-35: the oldest sets' form)
                    continue
                rarity = ja_rarity(((it.get("rarity") or {}).get("web")) or "")
                cond = ((it.get("condition") or {}).get("web")) or ""
                found.setdefault(number + "|" + rarity, []).append({
                    "price": it.get("price") if isinstance(it.get("price"), (int, float)) else 0,
                    "stock": it.get("stock_count") if isinstance(it.get("stock_count"), int) else 0,
                    "cond": cond, "img": it.get("image") if str(it.get("image") or "").startswith("https://") else "",
                    "ja": plain_text(it.get("name"))})
            if not (j.get("pagenate") or {}).get("nextPage"):
                break
    return pick_items(found, old)


def pick_items(found, old):
    """found: {"NUMBER|Rarity": [copies: {price, stock, cond, img, ja}]} -> each card's entry: the cheapest copy in stock
    for play, else any undamaged copy, else any; when it's sold out, the last price seen (from old) and when."""
    items, stamp = {}, today().isoformat()
    # (until October 2026 an Overframe printing's copies went under the plain rarity: those old prices, without "v",
    # aren't its own)
    mixed = {k[:-len(OVERFRAME)] for k in found if k.endswith(OVERFRAME)}
    old = {k: v for k, v in (old or {}).items() if k not in mixed or (v or {}).get("v")}
    for key, copies in found.items():
        stocked = [c for c in copies if c["price"] > 0 and c["stock"] > 0]
        play = [c for c in stocked if "プレイ用" in c["cond"]]
        clean = [c for c in stocked if not re.search(r"傷|キズ|難", c["cond"])]
        pool = play or clean or stocked
        pick = min(pool, key=lambda c: c["price"]) if pool else None
        img = (pick or {}).get("img") or next((c["img"] for c in copies if c["img"]), "")
        entry = {"img": img, "ja": copies[0]["ja"]}
        if pick:
            entry.update({"p": pick["price"], "s": pick["stock"]})
        else:   # sold out now: the last price seen, and when
            prev = (old or {}).get(key) or {}
            if prev.get("p"):
                entry.update({"last": prev["p"], "lastAt": prev.get("at") or stamp})
            elif prev.get("last"):
                entry.update({"last": prev["last"], "lastAt": prev.get("lastAt") or ""})
        entry["at"] = stamp
        entry["v"] = 2
        items[key] = entry
    return items


# ------------------------------------------------------------------ Fullahead: Japanese Rush Duel prices
# BIGWEB has no Rush Duel singles, and the bigger shops turn GitHub's computers away; Fullahead (a Japanese card shop)
# lists its Rush Duel singles, about 6,500, 50 a page: "RD/KP13-JP019 煌星帝エストローム【オーバーラッシュレア】", the
# price with tax, how many are left, and a photo. Its whole list is read once a day.
FA_ITEM = re.compile(r'<a href="(/shopdetail/\d+/[^"]*)"[^>]*>.*?<img src="(https://[^"]+)"[^>]*>.*?<span class="itemName">(.*?)</span>.*?'
                     r'<span class="itemPrice">(.*?)</div>', re.S)
FA_NAME = re.compile(r"^\s*(RD/[A-Z0-9]{2,6}-(?:JP|KR)[A-Z]?\d{2,3})\s*(.*?)\s*【([^】]+)】\s*(.*)$")


def parse_fullahead_page(page):
    """The singles on one of Fullahead's list pages: [{number, rarity, price, stock, img, ja, cond}]."""
    out = []
    for link, img, name, price_html in FA_ITEM.findall(page):
        name = unicodedata.normalize("NFKC", html.unescape(re.sub(r"<[^>]+>", "", name))).strip()
        m = FA_NAME.match(name)
        price = re.search(r"([\d,]+)\s*円", price_html)
        if not m or not price:
            continue
        number, ja, rarity_ja, rest = m.groups()
        left = re.search(r"残りあと\s*(\d+)", price_html)
        sold_out = re.search(r"SOLD\s*OUT|売り?切れ|在庫切れ|品切れ", price_html, re.I)
        stock = 0 if sold_out else int(left.group(1)) if left else 10   # (no count shown: plenty)
        out.append({"number": number, "rarity": rd_rarity(rarity_ja), "price": int(price.group(1).replace(",", "")), "stock": stock,
                    "img": img if img.startswith("https://") else "", "ja": ja.strip(), "cond": rest + (" 傷" if re.search(r"傷|キズ|難", ja + rest) else "")})
    return out


def read_fullahead(web, old):
    """Fullahead's whole Rush Duel list: {"at", "complete", "pages", "copies": {"NUMBER|Rarity": [copies]}}. A read cut short
    (the time budget, a bad page) keeps the earlier copies of the cards it didn't reach."""
    copies, seen_pages, complete = {}, 0, False
    first_keys = None
    for page in range(1, FULLAHEAD_PAGES + 1):
        if web.left() <= 0:
            break
        url = FULLAHEAD + "/shopbrand/yugi-rd/" + ("page%d/order/" % page if page > 1 else "")
        try:
            rows = parse_fullahead_page(web.get_text(url, FULLAHEAD_PAUSE, "euc_jp"))
        except urllib.error.HTTPError as err:
            complete = err.code == 404 and page > 1   # (past the last page; anything else: stop, keep what was read)
            break
        except Exception:   # (a site that stopped answering, the network: what was read is kept, with the rest from before)
            break
        keys = tuple(r["number"] + r["rarity"] + str(r["price"]) for r in rows)
        if not rows or keys == first_keys:   # (past the last page: nothing, or the last page again)
            complete = True
            break
        first_keys = keys
        seen_pages = page
        for r in rows:
            copies.setdefault(r["number"] + "|" + r["rarity"], []).append({k: r[k] for k in ("price", "stock", "cond", "img", "ja")})
    else:
        complete = True
    # (a list that ends far sooner than last time is more likely a page the shop showed by mistake, like a maintenance
    # notice, than half its cards gone: it isn't taken as the whole list)
    before = (old or {}).get("pages") if (old or {}).get("complete") else 0
    if complete and before and seen_pages < 0.85 * before:
        complete = False
    if not complete:
        for key, was in ((old or {}).get("copies") or {}).items():
            copies.setdefault(key, was)
    return {"at": now_iso() if complete else (old or {}).get("at", ""), "complete": complete, "pages": seen_pages, "copies": copies}


def fullahead_prices(catalog, prefix, old):
    """One Rush Duel set's entries from Fullahead's list, like BIGWEB's for the other Japanese sets."""
    code = prefix + "-JP"
    found = {k: v for k, v in ((catalog or {}).get("copies") or {}).items() if k.startswith(code)}
    items = pick_items(found, old)
    # (a card no longer on the list, sold out there: its last price and photo stay, like BIGWEB's sold-out copies)
    for key, prev in (old or {}).items():
        if key not in items and key.startswith(code) and (prev.get("p") or prev.get("last")):
            items[key] = {"img": prev.get("img") or "", "ja": prev.get("ja") or "", "last": prev.get("p") or prev.get("last"),
                          "lastAt": prev.get("at") if prev.get("p") else prev.get("lastAt") or "", "at": today().isoformat()}
    return items


# ------------------------------------------------------------------ Bunjang: Korean asking prices
NOT_FOR_SALE = re.compile(r"삽니다|구매합니다|구합니다|구해요|매입|교환")
BUNDLE = re.compile(r"일괄|묶음|세트|(?<![0-9])([2-9]|[1-9][0-9])\s*장|PSA|BRG|BGS|CGC|등급|그레이딩|감정", re.I)


BUNJANG_PAUSE = 3          # seconds between Bunjang requests (it's read on its own for a long stretch)
BUNJANG_SEEN = {"answers": 0, "empty": 0, "note": ""}   # (what Bunjang answered this run, for the summary)


def bunjang_rows(web, q, pages, sold=False):
    """The listings a Bunjang search finds (its website's own search: 60 a page, the next page by a cursor), ads left
    out. sold: listings that have sold come too (status "SOLD_OUT"; Bunjang's "status=SOLD_OUT" adds them to the ones
    for sale). An answer that isn't a search result (blocked, an error, a changed API) raises, so the set keeps its last
    prices and is tried again next time."""
    seen, out, cursor = set(), [], None
    for _ in range(pages):
        params = {"policyKey": "mw.product.keyword", "q": q, "size": 60, "sort": "score"}
        if sold:
            params["status"] = "SOLD_OUT"
        if cursor:
            params["cursor"] = cursor
        j = web.get_json(BUNJANG + "?" + urllib.parse.urlencode(params), BUNJANG_PAUSE)
        sr = ((((j.get("data") or {}).get("responses") or {}).get("mainGrid") or {}).get("searchResponse")) if isinstance(j, dict) else None
        if not isinstance(sr, dict) or not isinstance(sr.get("data"), list):
            keys = list(j.keys())[:6] if isinstance(j, dict) else type(j).__name__
            BUNJANG_SEEN["note"] = "Bunjang answered %s %r" % (keys, ((j.get("errorCode") or j.get("reason") or j.get("message")) if isinstance(j, dict) else None))
            raise ValueError("not a Bunjang search result (%s)" % BUNJANG_SEEN["note"])
        rows = sr["data"]
        BUNJANG_SEEN["answers"] += 1
        if not rows:
            BUNJANG_SEEN["empty"] += 1
        for x in rows:
            if not isinstance(x, dict) or x.get("type") != "PRODUCT" or x.get("ad") or x.get("pid") in seen:
                continue
            seen.add(x.get("pid"))
            out.append(x)
        cursor = sr.get("cursor")
        if not cursor or len(rows) < 60:
            break
    return out


SOLD_DAYS = 120            # sales this recent count toward a Korean card's sold price
SOLD_MIN = 2               # sales needed before the sold price is used instead of the asking price


def sold_day(x):
    """The day a sold listing last changed (when it sold, near enough), or None when it's too old or unknown."""
    try:
        when = date.fromisoformat(str(x.get("updatedAt") or "")[:10])
    except ValueError:
        return None
    return when if -1 <= (today() - when).days <= SOLD_DAYS else None   # (-1: Korea is a day ahead of the evening run)


def read_bunjang_cards(web, prefix, listed=None):
    """Each card's price from Bunjang: {"NUMBER|Rarity": [price, listings, asking, sold price, sales, last sale]}.
    The price is what it sold for (the middle of its sales in the last SOLD_DAYS) once it sold SOLD_MIN times or more,
    else what sellers are asking (the middle of the listings for sale). listed: the set's card numbers from Yugipedia,
    so a listing's number takes their form (LOB-K025 or LOB-KR025)."""
    # (a Rush Duel card, RD/KP01-KR036, is sometimes written without the RD/)
    head = r"(?:RD\s*/\s*)?" + re.escape(prefix[3:]) if is_rush(prefix) else re.escape(prefix)
    code_re = re.compile(head + r"\s*-?\s*K(R?)\s*-?\s*([A-Z]?\d{2,3})", re.I)
    asking, sold = {}, {}
    # (searched without a Rush Duel set's RD/: sellers often leave it out, and the search wants the words as written)
    for x in bunjang_rows(web, (prefix[3:] if is_rush(prefix) else prefix) + "-KR", BUNJANG_PAGES, sold=True):
        title = str(x.get("name") or "")
        try:
            price = int(float(x.get("price")))
        except (TypeError, ValueError):
            continue
        m = code_re.search(unicodedata.normalize("NFKC", title))
        if not m or not 100 <= price <= 50000000 or NOT_FOR_SALE.search(title) or BUNDLE.search(title):
            continue
        number = prefix + "-K" + m.group(1).upper() + m.group(2).upper()
        if listed and number not in listed:
            other = number.replace("-KR", "-K", 1) if "-KR" in number else number.replace("-K", "-KR", 1)
            if other in listed:
                number = other
        key = number + "|" + (ko_rarity(title) or "?")
        if str(x.get("status") or "").upper() == "SOLD_OUT":
            day = sold_day(x)
            if day:
                sold.setdefault(key, []).append((price, day))
        else:
            asking.setdefault(key, []).append(price)
    out = {}
    for key in set(asking) | set(sold):
        ask = asking.get(key) or []
        sales = sold.get(key) or []
        ask_mid = median(ask) if ask else None
        sold_mid = median([p for p, _ in sales]) if sales else None
        value = sold_mid if len(sales) >= SOLD_MIN else ask_mid if ask_mid is not None else sold_mid
        out[key] = [value, len(ask), ask_mid, sold_mid, len(sales), max(d for _, d in sales).isoformat() if sales else None]
    return out


EMPTY_BOX = re.compile(r"빈\s*박스|공\s*박스|박스\s*만|(?<!미)개봉|오픈|낱장|낱개|팩\s*만|카드\s*\d")
SEALED = re.compile(r"미개봉|새\s*상품|밀봉|실링|씰링|신품")


def read_bunjang_box(web, local_name):
    """Unopened booster boxes of the set (by its Korean name), as asking prices."""
    key = squash(local_name)
    if len(key) < 3:
        return None
    prices = []
    for x in bunjang_rows(web, local_name + " 박스", 1):
        title = str(x.get("name") or "")
        try:
            price = int(float(x.get("price")))
        except (TypeError, ValueError):
            continue
        if key not in squash(title) or "박스" not in title or not SEALED.search(title) or EMPTY_BOX.search(title) or NOT_FOR_SALE.search(title):
            continue
        if 5000 <= price <= 5000000:
            prices.append(price)
    return [median(prices), len(prices)] if prices else None


# ------------------------------------------------------------------ what to look up this time
def interval(kind, released):
    """Days between lookups: new sets often (prices move), old sets now and then."""
    age = (today() - (as_date(released) or today())).days
    if kind == "list":
        return 2 if age < 45 else 30 if age < 365 else 120
    return 0.8 if age < 120 else 3 if age < 730 else 7


def plan(sets_by_region, meta):
    """(region, prefix, kind) to look up, never-looked-up first, then the most overdue; newest sets first."""
    todo = []
    for region, sets in sets_by_region.items():
        kinds = ["list", "price"] + (["box"] if region == "kr" else [])
        for s in sets:
            for kind in kinds:
                if kind == "box" and not s["local"]:
                    continue
                if kind == "price" and region == "jp" and not s.get("bigweb"):
                    continue
                age = days_since(meta.get("%s|%s|%s" % (region, s["prefix"], kind)))
                newest = -(as_date(s["date"]) or date(1999, 1, 1)).toordinal()
                if age is None:
                    todo.append((0, newest, 0, region, s, kind))
                elif age >= interval(kind, s["date"]):
                    todo.append((1, newest, -age, region, s, kind))
    todo.sort(key=lambda t: t[:3])
    return [(region, s, kind) for _, _, _, region, s, kind in todo]


def write_js(path, name, comment, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: " + comment + " Rebuilt by ocg_market.py */\n")
        handle.write("window." + name + " = ")
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp, path)


def write_site_file(data):
    write_js(OUT_FILE, "OCG_MARKET", "Japanese and Korean sets for the Market tab.", data)


# ------------------------------------------------------------------ each day's prices, per set (for the changes and the charts)
def history_path(region, prefix):
    return cache_path("history", "%s-%s.json" % (region, safe_name(prefix)))


def record_history(region, prefix, todays):
    """todays: {"NUMBER|Rarity": price or None} as read today. One column per day; a set read twice in a day keeps the
    later reading."""
    h = read_json(history_path(region, prefix), {})
    if not isinstance(h, dict):
        h = {}
    days = list(h.get("days") or [])
    p = {k: list(v) for k, v in (h.get("p") or {}).items() if isinstance(v, list)}
    # (until October 2026 an Overframe printing's price went under the plain rarity ("Ultra Rare"): in a file from
    # then, without "v", that series mixed the two, so it starts again; files written since keep theirs)
    if not h.get("v"):
        for k in todays:
            base = k[:-len(OVERFRAME)] if k.endswith(OVERFRAME) else None
            if base and base in p:
                p[base] = [None] * len(p[base])
    day = today().isoformat()
    if days and days[-1] == day:
        days.pop()
        for v in p.values():
            v.pop()
    elif days and days[-1] > day:
        return   # (a day from the future: the clock is off; leave the history alone)
    days.append(day)
    n = len(days)
    for k, v in p.items():
        v.extend([None] * (n - 1 - len(v)))
        v.append(todays.get(k))
    for k, price in todays.items():
        if k not in p:
            p[k] = [None] * (n - 1) + [price]
    if n > HISTORY_DAYS:
        cut = n - HISTORY_DAYS
        days = days[cut:]
        p = {k: v[cut:] for k, v in p.items()}
    p = {k: v for k, v in p.items() if any(x is not None for x in v)}
    write_json(history_path(region, prefix), {"v": 2, "days": days, "p": p})


def changes(h):
    """For a set's history: the day to compare with for each of CHANGE_DAYS (the latest reading at least that long
    ago), and a function giving a card's prices on those days."""
    if not isinstance(h, dict):
        h = {}
    days = h.get("days") or []
    idx = []
    for n in CHANGE_DAYS:
        limit = (today() - timedelta(days=n)).isoformat()
        at = None
        for i, d in enumerate(days):
            if d <= limit:
                at = i
        idx.append(at)
    refs = [days[i] if i is not None else "" for i in idx]
    series = h.get("p") or {}

    def then(key):
        v = series.get(key) or []
        return [(v[i] or 0) if i is not None and i < len(v) else 0 for i in idx]
    return refs, then


# ------------------------------------------------------------------ the website's files
def img_ref(url):
    """BIGWEB's photos all live at one address pattern: just the number, else the whole address."""
    m = BIGWEB_IMG.match(url or "")
    if m and ("%08d" % int(m.group(3)))[:6] == m.group(1) + m.group(2):
        return int(m.group(3))
    return url or 0


def chase_jp(s, lists, prices):
    names = (lists.get("jp|" + s["prefix"]) or {}).get("cards") or {}
    out = []
    for key, e in ((prices.get("jp|" + s["prefix"]) or {}).get("items") or {}).items():
        number, rarity = key.split("|", 1)
        price = e.get("p") or e.get("last")
        if not price:
            continue
        name, rarities = names.get(number) or [e.get("ja") or number, []]
        out.append([number, name, resolve_rarity(rarities, rarity) or rarity, price, 1 if e.get("p") else 0, e.get("img") or ""])
    out.sort(key=lambda c: (-c[3], c[0]))
    return out[:CHASE]


def twin_image(jp_items, number, rarity):
    """A Korean print has the Japanese print's artwork: its photo, same number (same rarity when BIGWEB has it)."""
    twin = number.replace("-KR", "-JP", 1) + "|"
    mine = [(k.split("|", 1)[1], e.get("img")) for k, e in jp_items.items() if k.startswith(twin) and e.get("img")]
    # (the same rarity; else BIGWEB's plain name for a rarity the card has only as Overframe)
    return next((img for r, img in mine if same_rarity(r, rarity)), "") or next((img for r, img in mine if same_rarity(overframe(r), rarity)), "") or \
        next((e.get("img") for k, e in jp_items.items() if k.startswith(twin) and e.get("img")), "")


def chase_kr(s, lists, prices):
    names = (lists.get("kr|" + s["prefix"]) or {}).get("cards") or {}
    jp_items = (prices.get("jp|" + s["prefix"]) or {}).get("items") or {}
    out = []
    for key, v in ((prices.get("kr|" + s["prefix"]) or {}).get("cards") or {}).items():
        price, n = v[0], v[1]   # (then, since October 2026: asking price, sold price, sales, last sale)
        number, rarity = key.split("|", 1)
        if price is None:
            continue
        name, rarities = names.get(number) or [number, []]
        if rarity == "?":
            rarity = rarities[0] if len(rarities) == 1 else ""
        rarity = resolve_rarity(rarities, rarity) or rarity
        # (then, when it has sold: sales, the middle of them, the last sale's day)
        out.append([number, name, rarity, price, n, twin_image(jp_items, number, rarity)] + ([v[4], v[3], v[5]] if len(v) >= 6 and v[4] else []))
    out.sort(key=lambda c: (-c[3], c[0]))
    return out[:CHASE]


def assemble(sets_by_region, lists, prices, fx):
    data = {"format": DATA_FORMAT, "generated": now_iso(), "fx": fx, "jp": [], "kr": []}
    for s in sets_by_region["jp"]:
        cards = len((lists.get("jp|" + s["prefix"]) or {}).get("cards") or {})
        data["jp"].append([s["prefix"], s["name"], s["date"], s["line"], cards, chase_jp(s, lists, prices), s["local"]])
    for s in sets_by_region["kr"]:
        cards = len((lists.get("kr|" + s["prefix"]) or {}).get("cards") or {})
        box = (prices.get("kr|" + s["prefix"]) or {}).get("box")
        data["kr"].append([s["prefix"], s["name"], s["date"], s["line"], cards, chase_kr(s, lists, prices), s["local"], box])
    return data


class Table:
    """Strings used over and over (names, rarities) go in a table once; the rows carry their index."""
    def __init__(self):
        self.items, self.index = [], {}

    def __call__(self, text):
        text = text or ""
        if text not in self.index:
            self.index[text] = len(self.items)
            self.items.append(text)
        return self.index[text]


def number_tail(number, code):
    """The part after PREFIX-KR (or -JP); for another form (LOB-K025), "*" and the whole part after the dash."""
    if number.startswith(code):
        return number[len(code):]
    prefix = code.split("-", 1)[0] + "-"
    return "*" + (number[len(prefix):] if number.startswith(prefix) else number)


def cards_jp(s, lists, prices, names, ja, rar):
    """Every card and rarity of a Japanese set: [tail, name, [[rarity, yen, in stock, photo, a day ago, a week ago, a month
    ago, Japanese name, (the rarity name the history is kept under, when it differs)], ...]]. Yugipedia's list gives the
    cards and rarities; BIGWEB the prices, photos and Japanese names, and any rarity it sells that Yugipedia doesn't
    list yet."""
    code = s["prefix"] + "-JP"
    listed = (lists.get("jp|" + s["prefix"]) or {}).get("cards") or {}
    items = (prices.get("jp|" + s["prefix"]) or {}).get("items") or {}
    refs, then = changes(read_json(history_path("jp", s["prefix"]), {}))
    by_number = {}
    for number, (name, rarities) in listed.items():
        by_number[number] = [name, [[r, None, ""] for r in rarities]]
    for key, e in items.items():
        number, rarity = key.split("|", 1)
        card = by_number.setdefault(number, [e.get("ja") or number, []])
        hit = resolve_rarity([x[0] for x in card[1]], rarity)
        if hit is None:
            hit = unmarked_overframe(card[1], rarity, number, items)
        slot = next((x for x in card[1] if x[0] == hit), None) if hit is not None else None
        if slot is None:
            card[1].append([rarity, e, key])
        elif slot[1] is None or (e.get("p") and not slot[1].get("p")):
            slot[1], slot[2] = e, key
    rows = []
    for number in sorted(by_number, key=lambda n: (len(n), n)):
        name, slots = by_number[number]
        out = []
        for rarity, e, key in slots:
            e = e or {}
            m = then(key) if e else [0, 0, 0]
            row = [rar(rarity), e.get("p") or e.get("last") or 0, (e.get("s") or 0) if e.get("p") else 0, img_ref(e.get("img")),
                   m[0], m[1], m[2], ja(e.get("ja"))]
            # (the history is kept under the shop's rarity name; when that isn't the one shown, the row says which)
            if key and key.split("|", 1)[1] != rarity:
                row.append(key.split("|", 1)[1])
            out.append(row)
        rows.append([number_tail(number, code), names(name), out])
    return [s["prefix"], refs, rows]


def cards_kr(s, lists, prices, names, rar):
    """Every card of a Korean set, with Bunjang's price where it has listings or sales: [tail, name, [[rarity, won,
    listings, photo (the Japanese print's), a day ago, a week ago, a month ago, (the history's rarity name, when it
    differs: "?" for listings that don't say; else ""), [asking, sold, sales, last sale] when it has sold], ...]].
    The price is the sold price once a card sold SOLD_MIN times lately, else the asking price."""
    code = s["prefix"] + "-KR"
    listed = (lists.get("kr|" + s["prefix"]) or {}).get("cards") or {}
    found = (prices.get("kr|" + s["prefix"]) or {}).get("cards") or {}
    jp_items = (prices.get("jp|" + s["prefix"]) or {}).get("items") or {}
    refs, then = changes(read_json(history_path("kr", s["prefix"]), {}))
    by_number = {}
    for number, (name, rarities) in listed.items():
        by_number[number] = [name, [[r, None] for r in rarities]]
    for key, v in found.items():
        price, n = v[0], v[1]
        sold = [v[2], v[3], v[4], v[5]] if len(v) >= 6 and v[4] else None
        number, rarity = key.split("|", 1)
        card = by_number.setdefault(number, [number, []])
        if rarity == "?":
            if len(card[1]) == 1:
                rarity = card[1][0][0]
            else:
                rarity = ""
        hit = resolve_rarity([x[0] for x in card[1]], rarity)
        if hit is None:
            hit = unmarked_overframe(card[1], rarity, number, found)
        slot = next((x for x in card[1] if x[0] == hit), None) if hit is not None else None
        if slot is None:
            card[1].append([rarity, (price, n, key, sold)])
        elif slot[1] is None or (price and not slot[1][0]):
            slot[1] = (price, n, key, sold)
    rows = []
    for number in sorted(by_number, key=lambda n: (len(n), n)):
        name, slots = by_number[number]
        out = []
        for rarity, hit in slots:
            price, n, key, sold = hit if hit else (0, 0, "", None)
            m = then(key) if hit else [0, 0, 0]
            row = [rar(rarity), price or 0, n or 0, img_ref(twin_image(jp_items, number, rarity)), m[0], m[1], m[2]]
            if key and key.split("|", 1)[1] != rarity:   # (listings that don't say the rarity: kept under "?")
                row.append(key.split("|", 1)[1])
            if sold:
                if len(row) == 7:
                    row.append("")
                row.append([sold[0] or 0, sold[1] or 0, sold[2] or 0, sold[3] or ""])
            out.append(row)
        rows.append([number_tail(number, code), names(name), out])
    return [s["prefix"], refs, rows]


def assemble_cards(sets_by_region, lists, prices, fx):
    names, ja, rar = Table(), Table(), Table()
    data = {"format": CARDS_FORMAT, "generated": now_iso(), "fx": fx, "jp": [], "kr": []}
    for s in sets_by_region["jp"]:
        data["jp"].append(cards_jp(s, lists, prices, names, ja, rar))
    for s in sets_by_region["kr"]:
        data["kr"].append(cards_kr(s, lists, prices, names, rar))
    data["names"], data["ja"], data["rar"] = names.items, ja.items, rar.items
    return data


def write_history_files(sets_by_region):
    """ocg-history/jp-PHNI.json: each day's prices of the set's cards, for the charts (the cache's file as it is)."""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    n = 0
    for region, sets in sets_by_region.items():
        for s in sets:
            src = history_path(region, s["prefix"])
            if not os.path.exists(src):
                continue
            dst = os.path.join(HISTORY_DIR, "%s-%s.json" % (region, safe_name(s["prefix"])))
            try:
                with open(src, "rb") as a, open(dst + ".tmp", "wb") as b:
                    b.write(a.read())
                os.replace(dst + ".tmp", dst)
                n += 1
            except OSError:
                pass
    return n


# ------------------------------------------------------------------ the run
RUN_REPORT = os.environ.get("CARDVAULT_OCG_REPORT", os.path.join(CACHE, "last-run.json"))
SITE_NAMES = {"yugipedia": "Yugipedia", "bigweb": "BIGWEB", "bunjang": "Bunjang", "fullahead": "Fullahead", "frankfurter": "the exchange rates"}


def site_key(host):
    """Which site a host is: "yugipedia", "bigweb", "bunjang" or "frankfurter" (by the addresses this run uses)."""
    for k, url in (("yugipedia", YUGIPEDIA), ("bigweb", BIGWEB), ("bunjang", BUNJANG), ("fullahead", FULLAHEAD), ("frankfurter", FX_API)):
        if urllib.parse.urlsplit(url).netloc == host:
            return k
    return re.sub(r"^(api|www)\.|:\d+$", "", host or "").lower()


def write_run_report(web, state, data, cards, priced, n_cards):
    """ocg-cache/last-run.json: what this run did, for the update status the website shows (site_status.py)."""
    def cards_priced(region):
        # (each card: [tail, name, [[rarity, price, ...], ...]]; priced when any of its rarities has a price)
        return sum(1 for s in cards[region] for c in s[2] if any((x[1] or 0) > 0 for x in c[2]))
    sites = {}
    for host, n in web.by_host.items():
        k = site_key(host)
        e = web.errors.get(host) or {}
        site = sites.setdefault(k, {"requests": 0, "failed": 0, "errors": {}, "blocked": False})
        site["requests"] += n
        site["failed"] += web.missed.get(host, 0)   # (every request without an answer, retries included)
        site["blocked"] = site["blocked"] or web.streak.get(host, 0) >= BLOCKED_AFTER
        for what, count in e.items():
            site["errors"][what] = site["errors"].get(what, 0) + count
    report = {"ran": now_iso(), "sets": {"jp": len(data["jp"]), "kr": len(data["kr"])}, "setsPriced": {"jp": priced[0], "kr": priced[1]},
              "cards": {"jp": n_cards[0], "kr": n_cards[1]}, "cardsPriced": {"jp": cards_priced("jp"), "kr": cards_priced("kr")},
              "krSold": sum(1 for s in cards["kr"] for c in s[2] if any(len(x) > 8 and (x[8][2] or 0) >= SOLD_MIN for x in c[2])),
              "rush": {region: {"sets": sum(1 for s in cards[region] if is_rush(s[0])), "cards": sum(len(s[2]) for s in cards[region] if is_rush(s[0])),
                                "priced": sum(1 for s in cards[region] if is_rush(s[0]) for c in s[2] if any((x[1] or 0) > 0 for x in c[2]))} for region in ("jp", "kr")},
              "lookups": state["done"], "left": state["skipped"], "blocked": state["blocked"], "sites": sites,
              "bunjang": dict(BUNJANG_SEEN), "budget": BUDGET, "seconds": round(time.time() - web.started)}
    write_json(RUN_REPORT, report)
    return report


def host_of(region, kind):
    return "yugipedia" if kind == "list" else "fullahead" if kind == "fullahead" else "bigweb" if region == "jp" else "bunjang"


def run():
    web = Web(BUDGET)
    meta = read_json(cache_path("meta.json"), {})           # "region|prefix|kind" -> when it was last looked up
    index = read_json(cache_path("index.json"), {})
    sets_by_region = {}

    # The set lists (Yugipedia) and BIGWEB's set numbers
    for region in ("jp", "kr"):
        entry = index.get(region) or {}
        if not entry.get("rows") or (days_since(entry.get("at")) or 99) >= INDEX_DAYS:
            try:
                index[region] = {"at": now_iso(), "rows": read_index(web, region)}
                say("  Yugipedia: %d %s set pages." % (len(index[region]["rows"]), "Japanese" if region == "jp" else "Korean"))
            except Exception as err:   # keep the last list
                say("  Couldn't read Yugipedia's %s set list (%s); using the last one." % (region, err))
        rows = (index.get(region) or {}).get("rows") or []
        # (Rush Duel's sets too: their own codes, RD/KP01, and their own lines)
        sets_by_region[region] = sorted(build_sets(rows, region) + build_sets(rows, region, rush=True), key=lambda s: (s["date"], s["prefix"]), reverse=True)
    write_json(cache_path("index.json"), index)
    bw = read_json(cache_path("bigweb-sets.json"), {})
    if not bw.get("sets") or (days_since(bw.get("at")) or 99) >= INDEX_DAYS:
        try:
            bw = {"at": now_iso(), "sets": read_bigweb_sets(web)}
            write_json(cache_path("bigweb-sets.json"), bw)
        except Exception as err:
            say("  Couldn't read BIGWEB's set list (%s); using the last one." % err)
    for s in sets_by_region["jp"]:
        s["bigweb"] = (bw.get("sets") or {}).get(s["prefix"]) or []
    if not sets_by_region["jp"] and not sets_by_region["kr"]:
        say("  No sets: nothing to do this time.")
        return 0

    # Exchange rates, for the website to show US$ too
    fx = read_json(cache_path("fx.json"), {})
    try:
        j = web.get_json(FX_API, 0.5)
        if (j.get("rates") or {}).get("JPY") and (j.get("rates") or {}).get("KRW"):
            fx = {"JPY": j["rates"]["JPY"], "KRW": j["rates"]["KRW"], "date": j.get("date", "")}
            write_json(cache_path("fx.json"), fx)
    except Exception as err:
        say("  Couldn't get today's exchange rates (%s); using the last ones." % err)

    # Card lists and prices: as many as the time allows, newest sets first. The three sites are read side by side,
    # one thread each, so each one sees the same gentle pace as before and the run gets three times as much done.
    lists, prices = {}, {}
    lock = threading.Lock()
    state = {"done": 0, "skipped": 0, "blocked": ""}

    def load(region, prefix):
        k = region + "|" + prefix
        if k not in lists:
            lists[k] = read_json(cache_path("lists", "%s-%s.json" % (region, safe_name(prefix))), {})
            prices[k] = read_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), {})

    fa_old = read_json(cache_path("fullahead.json"), {}) or {}
    state["fa"] = None

    def lookup(region, s, kind):
        if kind == "fullahead":   # (Fullahead's whole Rush Duel list, once a day)
            fa = read_fullahead(web, fa_old)
            write_json(cache_path("fullahead.json"), fa)
            state["fa"] = fa
            say("  Fullahead: %d pages, %d Rush Duel cards and rarities%s." % (fa["pages"], len(fa["copies"]), "" if fa["complete"] else " (not all of it this time)"))
            return
        prefix = s["prefix"]
        k = region + "|" + prefix
        with lock:
            load(region, prefix)
        if kind == "list":
            cards = read_card_list(web, prefix, region)
            with lock:
                lists[k] = {"cards": cards}
                write_json(cache_path("lists", "%s-%s.json" % (region, safe_name(prefix))), lists[k])
        elif kind == "price" and region == "jp":
            items = read_bigweb_prices(web, prefix, s["bigweb"], prices[k].get("items"))
            with lock:
                prices[k]["items"] = items
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])
            record_history("jp", prefix, {key: e.get("p") or None for key, e in items.items()})
        elif kind == "price":
            cards = read_bunjang_cards(web, prefix, (lists[k].get("cards") or {}))
            if not cards and len(prices[k].get("cards") or {}) >= 3:
                cards = prices[k]["cards"]   # (every listing gone at once: more likely Bunjang holding back than the market; kept)
            with lock:
                prices[k]["cards"] = cards
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])
            record_history("kr", prefix, {key: v[0] for key, v in cards.items()})
        else:
            box = read_bunjang_box(web, s["local"])
            with lock:
                prices[k]["box"] = box
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])

    def worker(todo):
        for i, (region, s, kind) in enumerate(todo):
            if web.left() <= 0:
                with lock:
                    state["skipped"] += 1
                continue
            try:
                lookup(region, s, kind)
                with lock:
                    meta["%s|%s|%s" % (region, s["prefix"] if s else "*", kind)] = now_iso()
                    state["done"] += 1
                    if state["done"] % 25 == 0:
                        write_json(cache_path("meta.json"), meta)
            except HostBlocked as err:   # (the site keeps saying no: the rest of its list waits for another run)
                say("  %s; %d lookups wait." % (err, len(todo) - i))
                with lock:
                    state["skipped"] += len(todo) - i
                    state["blocked"] = str(err)
                break
            except Exception as err:
                say("  %s %s (%s): %s" % (s["prefix"] if s else "-", kind, region, err))

    by_host = {}
    # Fullahead's Rush Duel list first on its own line (once a day), then the sets
    if any(s.get("rush") for s in sets_by_region.get("jp") or []) and \
            ((days_since(fa_old.get("at")) or 99) >= FULLAHEAD_DAYS or not fa_old.get("complete")):
        by_host["fullahead"] = [("jp", None, "fullahead")]
    for region, s, kind in plan(sets_by_region, meta):
        by_host.setdefault(host_of(region, kind), []).append((region, s, kind))
    threads = [threading.Thread(target=worker, args=(todo,), name=host, daemon=True) for host, todo in by_host.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    write_json(cache_path("meta.json"), meta)
    done, skipped = state["done"], state["skipped"]

    # Japanese Rush Duel sets: their prices from Fullahead's list (read today, or the last one kept)
    fa = state["fa"] or fa_old
    if fa.get("copies"):
        for s in sets_by_region.get("jp") or []:
            if not s.get("rush"):
                continue
            k = "jp|" + s["prefix"]
            load("jp", s["prefix"])
            items = fullahead_prices(fa, s["prefix"], prices[k].get("items"))
            if not items and not prices[k].get("items"):
                continue
            prices[k]["items"] = items
            write_json(cache_path("prices", "jp-%s.json" % safe_name(s["prefix"])), prices[k])
            if state["fa"] and state["fa"].get("complete"):
                record_history("jp", s["prefix"], {key: e.get("p") or None for key, e in items.items()})

    for region, sets in sets_by_region.items():
        for s in sets:
            load(region, s["prefix"])
    data = assemble(sets_by_region, lists, prices, fx)
    write_site_file(data)
    cards = assemble_cards(sets_by_region, lists, prices, fx)
    write_js(CARDS_FILE, "OCG_CARDS", "every card of the Japanese and Korean sets, with prices.", cards)
    hist = write_history_files(sets_by_region)
    priced = sum(1 for row in data["jp"] if row[5]), sum(1 for row in data["kr"] if row[5])
    n_cards = sum(len(s[2]) for s in cards["jp"]), sum(len(s[2]) for s in cards["kr"])
    write_run_report(web, state, data, cards, priced, n_cards)
    hosts = ", ".join("%s %d" % (re.sub(r"^(api|www)\.|:\d+$", "", h), n) for h, n in sorted(web.by_host.items()))
    say("  Japanese sets: %d (%d with prices, %d cards). Korean sets: %d (%d with prices, %d cards). %d lookups this time (%d requests: %s; %d failed), %d left for later. %.1f + %.1f MB, %d history files."
        % (len(data["jp"]), priced[0], n_cards[0], len(data["kr"]), priced[1], n_cards[1], done, web.count, hosts, web.failed, skipped,
           os.path.getsize(OUT_FILE) / 1048576, os.path.getsize(CARDS_FILE) / 1048576, hist) +
        (" Errors: %s." % web.errors_text() if web.errors else "") + (" " + state["blocked"] + "." if state["blocked"] else "") +
        (" Bunjang: %d answers, %d with no listings.%s" % (BUNJANG_SEEN["answers"], BUNJANG_SEEN["empty"], " " + BUNJANG_SEEN["note"] if BUNJANG_SEEN["note"] else "") if BUNJANG_SEEN["answers"] or BUNJANG_SEEN["note"] else ""))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except KeyboardInterrupt:
        sys.exit(1)
