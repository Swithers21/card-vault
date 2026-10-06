#!/usr/bin/env python3
"""Japanese and Korean sets for the Card Vault website's Market tab: ocg-market.js.

The daily GitHub workflow runs this after update_tcgplayer_data.py. TCGplayer only lists English cards, so for the
Japanese (OCG) and Korean sets this puts together:
  - the sets: Yugipedia (English names, set codes, release dates, set types);
  - each set's cards with their English names and rarities: Yugipedia;
  - Japanese card prices: BIGWEB, a large Japanese card shop (yen, with how many copies it has);
  - Korean card prices and sealed boxes: Bunjang, a Korean marketplace (asking prices, in won).
Sealed prices for Japanese sets come from Yugi-Market, which the website reads itself: that shop turns away GitHub's
computers.

It's polite to these sites: a time budget per run, pauses between requests, and everything is kept between runs in
ocg-cache/ (the workflow saves it), so each set is looked up again only now and then. New sets are checked every
day, recent ones every few days, older ones every week or two. The first runs fill things in, newest sets first.
"""

import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("CARDVAULT_OCG_CACHE", os.path.join(HERE, "ocg-cache"))
OUT_FILE = os.environ.get("CARDVAULT_OCG_OUT", os.path.join(HERE, "ocg-market.js"))
YUGIPEDIA = os.environ.get("YUGIPEDIA_API", "https://yugipedia.com/api.php")
BIGWEB = os.environ.get("BIGWEB_API", "https://api.bigweb.co.jp").rstrip("/")
BUNJANG = os.environ.get("BUNJANG_API", "https://api.bunjang.co.kr/api/1/find_v2.json")
FX_API = os.environ.get("FX_API", "https://api.frankfurter.dev/v1/latest?from=USD&to=JPY,KRW")
BUDGET = float(os.environ.get("CARDVAULT_OCG_BUDGET", "360"))   # seconds of looking things up per run
SLOW = float(os.environ.get("CARDVAULT_OCG_PAUSE", "1"))         # pauses are multiplied by this (0 in tests)
USER_AGENT = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; daily, a few requests a minute)"
DATA_FORMAT = 1
CHASE = 25                 # most valuable cards kept per set
UPCOMING_DAYS = 45         # sets this close to release are listed (shops take pre-orders)
INDEX_DAYS = 3             # the set lists from Yugipedia are read again after this long


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
class Web:
    def __init__(self, budget):
        self.started = time.time()
        self.budget = budget
        self.last = {}
        self.count = 0
        self.failed = 0

    def left(self):
        return self.budget - (time.time() - self.started)

    def get_json(self, url, pause, headers=None):
        host = urllib.parse.urlsplit(url).netloc
        for attempt in range(3):
            wait = self.last.get(host, 0) + pause * SLOW - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last[host] = time.time()
            self.count += 1
            req = urllib.request.Request(url, headers=dict({"User-Agent": USER_AGENT, "Accept": "application/json"}, **(headers or {})))
            try:
                with urllib.request.urlopen(req, timeout=40) as res:
                    return json.loads(res.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as err:
                # busy, or a hiccup on their side: a little later; anything else isn't going to change
                if err.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep((10 if err.code == 429 else 4) * SLOW)
                    continue
                self.failed += 1
                raise
            except (urllib.error.URLError, OSError, ValueError):
                if attempt < 2:
                    time.sleep(3 * SLOW)
                    continue
                self.failed += 1
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
JA_RARITY = [(r"クォーターセンチュリー", "Quarter Century Secret Rare"), (r"プリズマティック", "Prismatic Secret Rare"),
             (r"エクストラシークレット", "Extra Secret Rare"), (r"20th", "20th Secret Rare"), (r"ホログラフィック|ホロ", "Holographic Rare"),
             (r"アルティメット|レリーフ", "Ultimate Rare"), (r"コレクターズ", "Collector's Rare"), (r"ゴールドシークレット", "Gold Secret Rare"),
             (r"プレミアムゴールド", "Premium Gold Rare"), (r"ゴールド", "Gold Rare"), (r"ミレニアム", "Millennium Rare"),
             (r"シークレットパラレル", "Secret Parallel Rare"), (r"ウルトラパラレル", "Ultra Parallel Rare"), (r"スーパーパラレル", "Super Parallel Rare"),
             (r"ノーマルパラレル", "Normal Parallel Rare"), (r"ノーマルレア", "Normal Rare"), (r"シークレット", "Secret Rare"), (r"ウルトラ", "Ultra Rare"),
             (r"スーパー", "Super Rare"), (r"ノーマル", "Common"), (r"レア", "Rare")]
KO_RARITY = [(r"쿼터\s*센[츄추]리|쿼센|QCSE|QCSR|QC\s*시크|QC\s*SE|25th", "Quarter Century Secret Rare"),
             (r"프리즈?[매마]틱|(^|[^A-Z])PSE(?![A-Z])", "Prismatic Secret Rare"), (r"엑스트라\s*시크|엑시크|(^|[^A-Z])EXSE(?![A-Z])", "Extra Secret Rare"),
             (r"20th|20\s*시크", "20th Secret Rare"), (r"홀로그래픽|홀로", "Holographic Rare"), (r"얼티(밋|메이트)?|얼레|(^|[^A-Z])UL(?![A-Z])", "Ultimate Rare"),
             (r"컬렉터즈|콜렉터즈|컬렉|(^|[^A-Z])CR(?![A-Z])", "Collector's Rare"), (r"골드\s*시크", "Gold Secret Rare"), (r"골드", "Gold Rare"),
             (r"밀레니엄", "Millennium Rare"), (r"노[멀말]\s*패러렐|노패", "Normal Parallel Rare"), (r"울트라\s*패러렐|울패", "Ultra Parallel Rare"),
             (r"시크릿|시크|(^|[^A-Z])(SE|SCR)(?![A-Z])", "Secret Rare"), (r"울트라|울레|(^|[^A-Z])UR(?![A-Z])", "Ultra Rare"),
             (r"슈퍼|슈레|(^|[^A-Z])SR(?![A-Z])", "Super Rare"), (r"노[멀말]", "Common"), (r"레어|(^|[^A-Z])R(?![A-Z0-9])", "Rare")]


def ja_rarity(web):
    for pattern, name in JA_RARITY:
        if re.search(pattern, web or "", re.I):
            return name
    return web or ""


def ko_rarity(title):
    # (the card code itself is taken out first: "SR01-KR001" isn't a Super Rare)
    t = re.sub(r"[A-Z0-9]{2,5}\s*-?\s*(KR|JP)\s*[A-Z]?\d{3}", " ", title or "", flags=re.I)
    for pattern, name in KO_RARITY:
        if re.search(pattern, t, re.I):
            return name
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


def build_sets(rows, region):
    """One set per set code: when several pages share a code (a booster and its +1 bonus pack), the main one names it."""
    horizon = (today() + timedelta(days=UPCOMING_DAYS)).isoformat()
    groups = {}
    for r in rows:
        prefixes = [p.strip().upper() for p in r["prefixes"] if p and p.strip()]
        if not prefixes or prefixes[0].startswith("RD/") or not re.match(r"^[A-Z0-9]{2,6}$", prefixes[0]):
            continue   # (Rush Duel, and anything without a plain set code)
        if any(SKIP_TYPE.search(t) for t in r["type"]) or PROMO_CARD.search(r["name"]) or not r["date"] or r["date"] > horizon:
            continue
        groups.setdefault(prefixes[0], []).append(r)
    sets = []
    for prefix, pages in groups.items():
        def rank(p):
            extra = re.search(r"\+1|bonus|expansion pack|assist pack|special pack|promotion", p["name"], re.I)
            return (0 if any("core booster" in x.lower() for x in p["series"]) else 1, 1 if extra else 0, len(p["name"]))
        main = sorted(pages, key=rank)[0]
        line = set_line(main["name"], main["type"], main["series"])
        if line in ("other", "side") and any(re.search(r"\+1 (bonus|expansion|assist)", p["name"], re.I) for p in pages):
            line = "core"   # (core boosters come with a "+1" bonus pack)
        sets.append({"prefix": prefix, "name": main["name"], "date": min(p["date"] for p in pages), "line": line, "local": main["local"]})
    sets.sort(key=lambda s: (s["date"], s["prefix"]), reverse=True)
    return sets


# ------------------------------------------------------------------ Yugipedia: a set's cards, in English
def read_card_list(web, prefix, region):
    code = prefix + ("-JP" if region == "jp" else "-KR")
    cards, offset = {}, 0
    for _ in range(4):
        page, nxt = yp_ask(web, "[[Card number::~%s*]]|?Card number|?Rarity|?Set contains|limit=500|offset=%d" % (code, offset))
        for r in page:
            numbers = [n.strip().upper() for n in printout(r, "Card number") if n.strip().upper().startswith(code)]
            name = plain_text((printout(r, "Set contains") or [""])[0])
            if not numbers or not name:
                continue
            for number in numbers:
                entry = cards.setdefault(number, [name, []])
                for rar in printout(r, "Rarity"):
                    if not any(same_rarity(rar, x) for x in entry[1]):
                        entry[1].append(rar)
        if not nxt or not page:
            break
        offset = int(nxt)
    return cards


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
                if not number.startswith(code):
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
    items, stamp = {}, today().isoformat()
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
        items[key] = entry
    return items


# ------------------------------------------------------------------ Bunjang: Korean asking prices
NOT_FOR_SALE = re.compile(r"삽니다|구매합니다|구합니다|구해요|매입|교환")
BUNDLE = re.compile(r"일괄|묶음|세트|(?<![0-9])([2-9]|[1-9][0-9])\s*장|PSA|BRG|BGS|CGC|등급|그레이딩|감정", re.I)


def read_bunjang_cards(web, prefix):
    code_re = re.compile(re.escape(prefix) + r"\s*-?\s*KR\s*-?\s*([A-Z]?\d{2,3})", re.I)
    groups = {}
    for page in range(2):
        j = web.get_json(BUNJANG + "?" + urllib.parse.urlencode({"q": prefix + "-KR", "order": "score", "page": page, "n": 100}), 1.5)
        rows = j.get("list") or []
        for x in rows:
            title = str((x or {}).get("name") or "")
            try:
                price = int(float(x.get("price")))
            except (TypeError, ValueError):
                continue
            m = code_re.search(unicodedata.normalize("NFKC", title))
            if not m or not 100 <= price <= 50000000 or NOT_FOR_SALE.search(title) or BUNDLE.search(title):
                continue
            number = prefix + "-KR" + m.group(1).upper()
            groups.setdefault(number + "|" + (ko_rarity(title) or "?"), []).append(price)
        if len(rows) < 100:
            break
    return {k: [median(v), len(v)] for k, v in groups.items()}


EMPTY_BOX = re.compile(r"빈\s*박스|공\s*박스|박스\s*만|(?<!미)개봉|오픈|낱장|낱개|팩\s*만|카드\s*\d")
SEALED = re.compile(r"미개봉|새\s*상품|밀봉|실링|씰링|신품")


def read_bunjang_box(web, local_name):
    """Unopened booster boxes of the set (by its Korean name), as asking prices."""
    key = squash(local_name)
    if len(key) < 3:
        return None
    j = web.get_json(BUNJANG + "?" + urllib.parse.urlencode({"q": local_name + " 박스", "order": "score", "page": 0, "n": 100}), 1.5)
    prices = []
    for x in j.get("list") or []:
        title = str((x or {}).get("name") or "")
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
    return 0.8 if age < 120 else 4 if age < 730 else 10


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


# ------------------------------------------------------------------ the website's file
def chase_jp(s, lists, prices):
    names = (lists.get("jp|" + s["prefix"]) or {}).get("cards") or {}
    out = []
    for key, e in ((prices.get("jp|" + s["prefix"]) or {}).get("items") or {}).items():
        number, rarity = key.split("|", 1)
        price = e.get("p") or e.get("last")
        if not price:
            continue
        name = (names.get(number) or [e.get("ja") or number])[0]
        out.append([number, name, rarity, price, 1 if e.get("p") else 0, e.get("img") or ""])
    out.sort(key=lambda c: (-c[3], c[0]))
    return out[:CHASE]


def chase_kr(s, lists, prices):
    names = (lists.get("kr|" + s["prefix"]) or {}).get("cards") or {}
    jp_items = (prices.get("jp|" + s["prefix"]) or {}).get("items") or {}
    out = []
    for key, (price, n) in ((prices.get("kr|" + s["prefix"]) or {}).get("cards") or {}).items():
        number, rarity = key.split("|", 1)
        if price is None:
            continue
        name, rarities = names.get(number) or [number, []]
        if rarity == "?":
            rarity = rarities[0] if len(rarities) == 1 else ""
        # (a Korean print has the Japanese print's artwork: its photo, same number)
        twin = number.replace("-KR", "-JP", 1)
        img = next((e.get("img") for k, e in jp_items.items() if k.startswith(twin + "|") and same_rarity(k.split("|", 1)[1], rarity) and e.get("img")), "") or \
            next((e.get("img") for k, e in jp_items.items() if k.startswith(twin + "|") and e.get("img")), "")
        out.append([number, name, rarity, price, n, img])
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


def write_site_file(data):
    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: Japanese and Korean sets for the Market tab. Rebuilt by ocg_market.py */\n")
        handle.write("window.OCG_MARKET = ")
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp, OUT_FILE)


# ------------------------------------------------------------------ the run
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
        sets_by_region[region] = build_sets((index.get(region) or {}).get("rows") or [], region)
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

    # Card lists and prices: as many as the time allows, newest sets first
    lists, prices = {}, {}
    def load(region, prefix):
        k = region + "|" + prefix
        if k not in lists:
            lists[k] = read_json(cache_path("lists", "%s-%s.json" % (region, safe_name(prefix))), {})
            prices[k] = read_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), {})
    todo = plan(sets_by_region, meta)
    done = skipped = 0
    for region, s, kind in todo:
        if web.left() <= 0:
            skipped += 1
            continue
        prefix = s["prefix"]
        load(region, prefix)
        k = region + "|" + prefix
        try:
            if kind == "list":
                lists[k] = {"cards": read_card_list(web, prefix, region)}
                write_json(cache_path("lists", "%s-%s.json" % (region, safe_name(prefix))), lists[k])
            elif kind == "price" and region == "jp":
                prices[k]["items"] = read_bigweb_prices(web, prefix, s["bigweb"], prices[k].get("items"))
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])
            elif kind == "price":
                prices[k]["cards"] = read_bunjang_cards(web, prefix)
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])
            else:
                prices[k]["box"] = read_bunjang_box(web, s["local"])
                write_json(cache_path("prices", "%s-%s.json" % (region, safe_name(prefix))), prices[k])
            meta["%s|%s|%s" % (region, prefix, kind)] = now_iso()
            done += 1
        except Exception as err:
            say("  %s %s (%s): %s" % (prefix, kind, region, err))
        if done % 25 == 0:
            write_json(cache_path("meta.json"), meta)
    write_json(cache_path("meta.json"), meta)

    for region, sets in sets_by_region.items():
        for s in sets:
            load(region, s["prefix"])
    data = assemble(sets_by_region, lists, prices, fx)
    write_site_file(data)
    priced = sum(1 for row in data["jp"] if row[5]), sum(1 for row in data["kr"] if row[5])
    say("  Japanese sets: %d (%d with prices). Korean sets: %d (%d with prices). %d lookups this time (%d requests), %d left for later. %.1f MB."
        % (len(data["jp"]), priced[0], len(data["kr"]), priced[1], done, web.count, skipped, os.path.getsize(OUT_FILE) / 1048576))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except KeyboardInterrupt:
        sys.exit(1)
