#!/usr/bin/env python3
"""Pictures of the Market's Japanese and Korean chase cards: Yugipedia's scan of each card's own print.

The daily GitHub workflow runs this after ocg_market.py. For the chase cards in ocg-market.js that have no photo that
loads (BIGWEB's photo server doesn't answer from outside Japan, some shops have none), it finds the scan of that exact
print on Yugipedia (same set, same language, same rarity, the right version of a Manga-Style or Overframe card),
downloads a small copy into card-scans/, and points ocg-market.js and ocg-cards.js at it, so the website shows it
without asking BIGWEB or Yugipedia. The cards with no photo at all come first (no English print either), then the
others, newest sets first; a few hundred a night until all are done.

Yugipedia asks for at most one request a second and for sites to keep their own copy of the pictures they use rather
than loading them from Yugipedia each time, so that is what this does: the folder is kept between runs (a picture is
never downloaded twice), a card Yugipedia has no scan of is asked again only after two weeks, and the pictures are
shrunk to the size the website shows them at.

    python card_scans.py            (the workflow; CARDVAULT_SCANS_MAX pictures at most, CARDVAULT_SCANS_MINUTES minutes)
"""
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MARKET_FILE = os.environ.get("CARDVAULT_OCG_OUT", os.path.join(HERE, "ocg-market.js"))
CARDS_FILE = os.environ.get("CARDVAULT_OCG_CARDS", os.path.join(HERE, "ocg-cards.js"))
TCG_FILE = os.environ.get("CARDVAULT_TCG_DATA", os.path.join(HERE, "tcgplayer-data.js"))
OUT_DIR = os.environ.get("CARDVAULT_SCANS_DIR", os.path.join(HERE, "card-scans"))
YUGIPEDIA = os.environ.get("YUGIPEDIA_API", "https://yugipedia.com/api.php")
MAX_DOWNLOADS = int(os.environ.get("CARDVAULT_SCANS_MAX", "700"))          # pictures per run; the rest come the next time
MAX_MINUTES = float(os.environ.get("CARDVAULT_SCANS_MINUTES", "12"))
API_PAUSE = float(os.environ.get("CARDVAULT_SCANS_API_PAUSE", "1.1"))      # seconds between Yugipedia's API answers
IMG_PAUSE = float(os.environ.get("CARDVAULT_SCANS_IMG_PAUSE", "0.4"))      # ...and between pictures
WIDTH = 200                 # pixels wide: the Market shows them at about 100, twice that for sharp screens
RETRY_MISSES_DAYS = 14      # a card with no scan yet is looked for again after this long
BLOCKED_AFTER = 6           # failures in a row from Yugipedia: the rest waits for the next run
USER_AGENT = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; https://github.com/Swithers21/card-vault; once per picture)"
INDEX_VERSION = 1

# Yugipedia's short names for rarities in its file names ("DarkMagician-YAC1-JP-UR.png")
RARITY_CODES = {
    "Common": ["C"], "Rare": ["R"], "Super Rare": ["SR"], "Ultra Rare": ["UR"], "Secret Rare": ["ScR"], "Ultimate Rare": ["UtR"],
    "Ghost Rare": ["GR"], "Starlight Rare": ["StR"], "Collector's Rare": ["CR"], "Quarter Century Secret Rare": ["QCScR"],
    "Prismatic Secret Rare": ["PScR"], "Platinum Secret Rare": ["PlScR"], "Platinum Rare": ["PlR"], "Gold Rare": ["GUR"],
    "Gold Secret Rare": ["GScR"], "Premium Gold Rare": ["PGR"], "Short Print": ["SP"], "Super Short Print": ["SSP"],
    "Shatterfoil Rare": ["SHR"], "Starfoil Rare": ["SFR"], "Mosaic Rare": ["MSR"], "Normal Parallel Rare": ["NPR"],
    "Super Parallel Rare": ["SPR"], "Ultra Parallel Rare": ["UPR"], "Extra Secret Rare": ["EScR", "ExScR"], "20th Secret Rare": ["20ScR"],
    "10000 Secret Rare": ["10000ScR"], "Holographic Rare": ["HGR"], "Millennium Rare": ["MLR"], "Rush Rare": ["RR"],
    "Gold Rush Rare": ["GRR"], "Over Rush Rare": ["ORR"], "Grand Master Rare": ["GMR"], "Prismatic Collector's Rare": ["PCR"],
    "Prismatic Ultimate Rare": ["PUR"], "Secret Parallel Rare": ["SePR"], "Extra Secret Parallel Rare": ["EScPR"],
}
REGIONS = {"EN", "NA", "EU", "AE", "JP", "JA", "KR", "TC", "SC", "FR", "DE", "IT", "PT", "SP"}
NOT_A_PHOTO = {"VG", "NC", "ARTWORK"}          # video-game renders and artwork crops aren't photos of real cards
MANGA = re.compile(r"\s*\(manga (monochrome|color)\)\s*$", re.I)
OVERFRAME = re.compile(r"\s*\(overframe\)\s*$", re.I)



def window_value(body):
    """The value after "window.NAME =": the data itself, or JSON.parse("...") around it (tcgplayer-data.js, read faster that way)."""
    body = body.strip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    if body.startswith("JSON.parse(") and body.endswith(")"):
        return json.loads(json.loads(body[len("JSON.parse("):-1]))
    return json.loads(body)

def say(text):
    print(text, flush=True)


def today():
    return date.today().isoformat()


def days_since(day):
    try:
        return (date.today() - date.fromisoformat(str(day)[:10])).days
    except ValueError:
        return 9999


# ------------------------------------------------------------------ names and files
def loose(text):
    """A name's letters and digits, the way Yugipedia's file names spell it ("Blue-Eyes White Dragon" -> blueeyeswhitedragon)."""
    s = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def parse_file(title):
    """"File:DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png" -> {name, set, region, rarity, extra, file}; None for a
    file that isn't a card scan."""
    file = re.sub(r"^File:", "", str(title or "")).strip()
    stem, dot, ext = file.rpartition(".")
    if not dot or ext.lower() not in ("png", "jpg", "jpeg", "gif", "webp"):
        return None
    parts = stem.split("-")
    for i in range(2, len(parts)):
        if parts[i] in REGIONS:
            out = {"file": file, "name": loose("".join(parts[:i - 1])), "set": parts[i - 1].upper(), "region": parts[i],
                   "rarity": parts[i + 1] if i + 1 < len(parts) else "", "extra": parts[i + 2:]}
            if any(x.upper() in NOT_A_PHOTO for x in [out["rarity"]] + out["extra"]):
                return None
            return out
    return None


def wanted(rarity):
    """What a print's scan is called: (rarity codes, style), style "" plain, "EA" Overframe (extended art), "Monochrome" /
    "Color" a Manga-Style version."""
    r = str(rarity or "").strip()
    m = MANGA.search(r)
    style = m.group(1).capitalize() if m else "EA" if OVERFRAME.search(r) else ""
    base = OVERFRAME.sub("", MANGA.sub("", r)).strip()
    return RARITY_CODES.get(base, []), style


def style_of(f):
    extra = f["extra"]
    if "MangaStyle" in extra:
        return "Color" if "Color" in extra else "Monochrome"
    return "EA" if "EA" in extra else ""


def best_file(files, name, region, rarity):
    """The scan of this print among a gallery's files: same name and language; the same version (a Manga-Style card's
    black-and-white or colour, never the other; an Overframe card's extended art, else its usual art); the same rarity
    when there is a scan of it, else another rarity's (the same artwork). None when there's none."""
    key = loose(name)
    if not key:
        return None
    codes, style = wanted(rarity)
    best, best_score = None, None
    for f in files:
        if f["name"] != key or f["region"] != region:
            continue
        s = style_of(f)
        if s != style:
            if not (style == "EA" and s == ""):      # (only an Overframe card falls back to its usual art)
                continue
        score = (1 if s == style else 0, 1 if f["rarity"] in codes else 0, 0 if f["rarity"] == "OP" else 1,
                 0 if any(re.fullmatch(r"\d+|AA|Alt", x) for x in f["extra"]) else 1)
        if best_score is None or score > best_score:
            best, best_score = f, score
    return best


def gallery_names(wikitext):
    """{card number: English name} from a set gallery's wiki text ("YAC1-JP001; Exodia the Obliterator; Ultra Rare")."""
    out = {}
    for line in str(wikitext or "").splitlines():
        parts = [x.strip() for x in line.split("//")[0].split(";")]
        if len(parts) >= 2 and re.fullmatch(r"(?:RD/)?[A-Z0-9]+-[A-Z]{0,2}[A-Z]?\d+[A-Z]?", parts[0].upper()) and parts[1]:
            out.setdefault(parts[0].upper(), re.sub(r"\s*\(Rush Duel\)$", "", parts[1]))
    return out


def scan_key(number, rarity):
    return str(number).upper() + "|" + str(rarity or "").strip().lower()


def scan_file_name(region, number, rarity, ext):
    slug = re.sub(r"[^a-z0-9]+", "-", str(rarity or "").lower()).strip("-") or "card"
    num = re.sub(r"[^A-Za-z0-9_-]", "", str(number).upper().replace("/", "_"))
    return ("%s-%s-%s.%s" % (region, num, slug, ext)).lower()


# ------------------------------------------------------------------ the website's files
def read_js(path, name):
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    at = text.index("window." + name)
    head = text[:at]
    return head, window_value(text[text.index("=", at) + 1:])


def write_js(path, head, name, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(head)
        handle.write("window." + name + " = ")
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp, path)


def shop_photo_works(img):
    """A chase card's photo from its shop that loads: Fullahead's, not BIGWEB's (whose server doesn't answer from outside
    Japan) nor a shop's "no image" picture."""
    u = str(img or "")
    return u.startswith("https://") and "image.bigweb.co.jp" not in u and "nonimg" not in u


def tcg_photo_names(path=TCG_FILE):
    """The names of the cards TCGplayer has a photo of (any printing): the website shows that English photo when the shop
    has none, so those wait until the cards with nothing at all are done."""
    try:
        _, data = read_js(path, "TCG_DATA")
    except (OSError, ValueError):
        return set()
    out = set()
    for row in data.get("products") or []:
        if len(row) > 6 and row[6] == 1:
            continue
        if len(row) > 7 and row[7] == 1:
            continue
        out.add(loose(re.sub(r"(\s*\([^()]*\))+\s*$", "", str(row[2] or ""))))
    return out


def targets(market, index, photo_names):
    """The chase cards to find a scan for, in order: no photo at all first (or only the English print's when that looks
    different: a Manga-Style or Overframe version, a Rush Duel card), then the ones showing the English print's photo,
    newest sets first. [(priority, region, set row, card)]"""
    out = []
    for region in ("jp", "kr"):
        for s in market.get(region) or []:
            for c in s[5] if len(s) > 5 and isinstance(s[5], list) else []:
                if not isinstance(c, list) or len(c) < 6:
                    continue
                key = scan_key(c[0], c[2])
                if key in index["scans"] or shop_photo_works(c[5]):
                    continue
                if key in index["miss"] and days_since(index["miss"][key]) < RETRY_MISSES_DAYS:
                    continue
                # (the English print's photo the website shows instead is the wrong picture for a Manga-Style or
                # Overframe version, or a Rush Duel card: those count as having none)
                looks_different = bool(wanted(c[2])[1]) or str(c[0]).upper().startswith("RD/")
                prio = 1 if loose(c[1]) in photo_names and not looks_different else 0
                out.append((prio, region, s, c))
    out.sort(key=lambda t: str(t[2][2] or "") if len(t[2]) > 2 else "", reverse=True)   # (newest sets first...)
    out.sort(key=lambda t: t[0])                                                           # (...within each priority)
    return out


def point_files_at_scans(market, cards, index, out_dir):
    """ocg-market.js's chase cards and ocg-cards.js's rows that have a scan get "scan:<file>" for a photo."""
    have = {k: v["f"] for k, v in index["scans"].items() if os.path.isfile(os.path.join(out_dir, v["f"]))}
    n_market = n_cards = 0
    for region in ("jp", "kr"):
        for s in market.get(region) or []:
            for c in s[5] if len(s) > 5 and isinstance(s[5], list) else []:
                f = have.get(scan_key(c[0], c[2])) if isinstance(c, list) and len(c) >= 6 else None
                if f:
                    c[5] = "scan:" + f
                    n_market += 1
    if cards:
        rar = cards.get("rar") or []
        for region, tag in (("jp", "-JP"), ("kr", "-KR")):
            for row in cards.get(region) or []:
                prefix = str(row[0])
                for c in row[2] if len(row) > 2 and isinstance(row[2], list) else []:
                    t = str(c[0] or "")
                    number = prefix + "-" + t[1:] if t.startswith("*") else prefix + tag + t
                    for x in c[2] if len(c) > 2 and isinstance(c[2], list) else []:
                        f = have.get(scan_key(number, rar[x[0]] if isinstance(x[0], int) and x[0] < len(rar) else ""))
                        if f and len(x) > 3:
                            x[3] = "scan:" + f
                            n_cards += 1
    return n_market, n_cards


# ------------------------------------------------------------------ Yugipedia
class Blocked(Exception):
    pass


class Web:
    def __init__(self, deadline):
        self.deadline = deadline
        self.last = {}
        self.streak = 0
        self.requests = 0
        self.failed = 0

    def time_left(self):
        return self.deadline - time.time()

    def fetch(self, url, pause, accept="application/json", limit=3_000_000):
        if self.streak >= BLOCKED_AFTER:
            raise Blocked("Yugipedia: %d failures in a row" % self.streak)
        host = urllib.parse.urlsplit(url).netloc
        wait = self.last.get(host, 0) + pause - time.time()
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.time()
        self.requests += 1
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, "Accept": accept})
        try:
            with urllib.request.urlopen(req, timeout=40) as res:
                body = res.read(limit + 1)
                kind = res.headers.get("Content-Type", "")
        except (urllib.error.URLError, OSError) as err:
            self.streak += 1
            self.failed += 1
            raise IOError(str(err)[:120])
        self.streak = 0
        return body, kind

    def api(self, **params):
        params.update(format="json", formatversion="2")
        body, _ = self.fetch(YUGIPEDIA + "?" + urllib.parse.urlencode(params), API_PAUSE)
        return json.loads(body.decode("utf-8", "replace"))


def gallery_titles(web, number, region):
    """Yugipedia's gallery pages for the set a card number is in: its list page "Set Card Lists:X (OCG-JP)" has a gallery
    "Set Card Galleries:X (OCG-JP)" next to it."""
    j = web.api(action="ask", query="[[Card number::%s]]|?Card number|limit=20" % number)
    results = (j.get("query") or {}).get("results") or {}
    tag = "(OCG-%s)" % ("JP" if region == "jp" else "KR")
    titles = []
    for key, row in (results.items() if isinstance(results, dict) else enumerate(results)):
        title = str((row or {}).get("fulltext") or (key if isinstance(key, str) else "")).split("#", 1)[0].strip()
        if title.startswith("Set Card Lists:") and title.endswith(tag):
            g = "Set Card Galleries:" + title[len("Set Card Lists:"):]
            if g not in titles:
                titles.append(g)
    return titles[:3]


def read_gallery(web, title):
    """A gallery page's card scans (parsed file names) and its {card number: English name}."""
    files, cont = [], {}
    for _ in range(6):
        j = web.api(action="query", prop="images", titles=title, imlimit="500", **cont)
        for p in (j.get("query") or {}).get("pages") or []:
            for im in p.get("images") or []:
                f = parse_file(im.get("title"))
                if f:
                    files.append(f)
        c = j.get("continue") or {}
        if not c.get("imcontinue"):
            break
        cont = {"imcontinue": c["imcontinue"]}
    names = {}
    if files:
        j = web.api(action="query", prop="revisions", rvprop="content", rvslots="main", titles=title)
        pages = (j.get("query") or {}).get("pages") or []
        rev = ((pages[0] if pages else {}).get("revisions") or [{}])[0] or {}
        names = gallery_names(rev.get("content") or ((rev.get("slots") or {}).get("main") or {}).get("content") or "")
    return files, names


def thumb_urls(web, files):
    """{file: small picture's address} for up to 50 files a request."""
    out = {}
    for i in range(0, len(files), 50):
        batch = files[i:i + 50]
        j = web.api(action="query", prop="imageinfo", iiprop="url", iiurlwidth=str(WIDTH), titles="|".join("File:" + f for f in batch))
        for p in (j.get("query") or {}).get("pages") or []:
            info = (p.get("imageinfo") or [{}])[0] or {}
            url = info.get("thumburl") or info.get("url") or ""
            if url.startswith("https://"):
                out[re.sub(r"^File:", "", p.get("title") or "")] = url
    return out


def shrink(body):
    """A small JPEG of a picture (Yugipedia's scans are PNGs, ten times the size), on the website's dark background where
    the card's corners are see-through. Without Pillow the picture is kept as it came."""
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        im = Image.open(io.BytesIO(body))
        im.load()
    except Exception:
        return None
    if im.width > WIDTH:
        im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        back = Image.new("RGB", im.size, (22, 18, 15))
        back.paste(im, mask=im.split()[-1])
        im = back
    elif im.mode != "RGB":
        im = im.convert("RGB")
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80, optimize=True, progressive=True)
    return out.getvalue()


def download(web, url, out_dir, name_without_ext):
    body, kind = web.fetch(url, IMG_PAUSE, accept="image/*")
    if len(body) > 3_000_000 or not (body.startswith(b"\x89PNG") or body.startswith(b"\xff\xd8") or body[:6] in (b"GIF89a", b"GIF87a") or body[8:12] == b"WEBP"):
        return None
    small = shrink(body)
    if small:
        body, ext = small, "jpg"
    else:
        ext = "png" if body.startswith(b"\x89PNG") else "jpg" if body.startswith(b"\xff\xd8") else "gif" if body.startswith(b"GIF") else "webp"
    file = name_without_ext + "." + ext
    path = os.path.join(out_dir, file)
    with open(path + ".tmp", "wb") as handle:
        handle.write(body)
    os.replace(path + ".tmp", path)
    return file


# ------------------------------------------------------------------ the kept index
def read_index(out_dir):
    try:
        with open(os.path.join(out_dir, "index.json"), "r", encoding="utf-8") as handle:
            idx = json.load(handle)
    except (OSError, ValueError):
        idx = {}
    if not isinstance(idx, dict) or idx.get("v") != INDEX_VERSION:
        idx = {}
    idx = {"v": INDEX_VERSION, "scans": dict(idx.get("scans") or {}), "miss": dict(idx.get("miss") or {}), "sets": dict(idx.get("sets") or {})}
    # (a picture that isn't in the folder any more, say the kept folder was lost, is fetched again)
    idx["scans"] = {k: v for k, v in idx["scans"].items() if isinstance(v, dict) and v.get("f") and os.path.isfile(os.path.join(out_dir, v["f"]))}
    return idx


def write_index(out_dir, idx):
    path = os.path.join(out_dir, "index.json")
    with open(path + ".tmp", "w", encoding="utf-8") as handle:
        json.dump(idx, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(path + ".tmp", path)


def tidy_folder(out_dir, idx):
    """Pictures no card uses any more are removed."""
    used = {v["f"] for v in idx["scans"].values()} | {"index.json"}
    removed = 0
    for f in os.listdir(out_dir):
        if f not in used and not f.endswith(".tmp"):
            try:
                os.remove(os.path.join(out_dir, f))
                removed += 1
            except OSError:
                pass
    return removed


# ------------------------------------------------------------------ main
def run(market_file=MARKET_FILE, cards_file=CARDS_FILE, out_dir=OUT_DIR, tcg_file=TCG_FILE, max_downloads=MAX_DOWNLOADS, minutes=MAX_MINUTES):
    if not os.path.isfile(market_file):
        say("No ocg-market.js yet: nothing to do.")
        return 0
    os.makedirs(out_dir, exist_ok=True)
    m_head, market = read_js(market_file, "OCG_MARKET")
    c_head, cards = (None, None)
    if os.path.isfile(cards_file):
        try:
            c_head, cards = read_js(cards_file, "OCG_CARDS")
        except ValueError:
            c_head, cards = None, None
    idx = read_index(out_dir)
    todo = targets(market, idx, tcg_photo_names(tcg_file))
    total_todo = len(todo)
    web = Web(time.time() + minutes * 60)
    galleries, set_files = {}, {}
    got = missed = 0
    stopped = ""

    def files_for(region, s, number):
        """The scans of a set's galleries, read once a run ({set id: (files, names)})."""
        sid = region + ":" + str(s[0])
        if sid in set_files:
            return set_files[sid]
        known = idx["sets"].get(sid) or {}
        titles = known.get("g") if known.get("g") and days_since(known.get("t")) < 60 else None
        if titles is None:
            titles = gallery_titles(web, number, region)
            idx["sets"][sid] = {"g": titles, "t": today()}
        files, names = [], {}
        for t in titles:
            if t not in galleries:
                galleries[t] = read_gallery(web, t)
            files.extend(galleries[t][0])
            names.update(galleries[t][1])
        set_files[sid] = (files, names)
        return set_files[sid]

    def jp_twin_set(prefix):
        return next((s for s in market.get("jp") or [] if str(s[0]) == prefix), None)

    plan = []   # (key, file to fetch, region, number, rarity)
    try:
        for prio, region, s, c in todo:
            if len(plan) + got >= max_downloads or web.time_left() < 60:
                stopped = "the rest wait for the next run"
                break
            number, name, rarity = str(c[0]).upper(), str(c[1] or ""), str(c[2] or "")
            key = scan_key(number, rarity)
            files, names = files_for(region, s, number)
            english = names.get(number) or name
            f = best_file(files, english, "JP" if region == "jp" else "KR", rarity)
            save_as = (region, number)
            if not f and region == "kr":
                # (a Korean print with no scan of its own: the Japanese print of the same number, the same artwork)
                twin = number.replace("-KR", "-JP", 1)
                done = idx["scans"].get(scan_key(twin, rarity))
                if done:
                    idx["scans"][key] = dict(done, twin=True)
                    continue
                js = jp_twin_set(str(s[0]))
                if js:
                    jfiles, jnames = files_for("jp", js, twin)
                    f = best_file(jfiles, jnames.get(twin) or english, "JP", rarity)
                    save_as = ("jp", twin)    # (kept under the Japanese print's name: one picture for both)
            if not f:
                idx["miss"][key] = today()
                missed += 1
                continue
            kept = next((v for v in idx["scans"].values() if v.get("src") == f["file"]), None)
            if kept:   # (the same scan, already kept for another print: a Korean card and its Japanese twin)
                idx["scans"][key] = {"f": kept["f"], "src": f["file"], "t": today()}
                idx["miss"].pop(key, None)
                continue
            plan.append((key, f["file"], save_as[0], save_as[1], rarity))
            # (fetch in batches of 50: one request for 50 addresses)
            if len(plan) >= 50:
                got += fetch_plan(web, plan, idx, out_dir)
                plan = []
                write_index(out_dir, idx)
        if plan:
            got += fetch_plan(web, plan, idx, out_dir)
    except Blocked as err:
        stopped = str(err) + "; the rest wait for the next run"
    except (IOError, ValueError) as err:
        stopped = "Yugipedia didn't answer (%s); the rest wait for the next run" % err
    write_index(out_dir, idx)
    removed = tidy_folder(out_dir, idx)
    n_market, n_cards = point_files_at_scans(market, cards, idx, out_dir)
    write_js(market_file, m_head, "OCG_MARKET", market)
    if cards is not None:
        write_js(cards_file, c_head, "OCG_CARDS", cards)
    say("Card scans: %d new, %d with no scan on Yugipedia yet, %d kept in all (%d chase cards and %d list rows use them), %d of %d still to look for%s%s. %d requests."
        % (got, missed, len(idx["scans"]), n_market, n_cards, max(0, total_todo - got - missed), total_todo,
           ", %d unused removed" % removed if removed else "", "; " + stopped if stopped else "", web.requests))
    return 0


def fetch_plan(web, plan, idx, out_dir):
    urls = thumb_urls(web, sorted({f for _, f, _, _, _ in plan}))
    got = 0
    fetched = {}
    for key, f, region, number, rarity in plan:
        url = urls.get(f)
        if not url:
            idx["miss"][key] = today()
            continue
        if f in fetched:
            file = fetched[f]
        else:
            try:
                file = download(web, url, out_dir, scan_file_name(region, number, rarity, "x")[:-2])
            except IOError:
                if web.streak >= BLOCKED_AFTER:
                    raise Blocked("Yugipedia: %d failures in a row" % web.streak)
                continue
            fetched[f] = file
            if file:
                got += 1
        if file:
            idx["scans"][key] = {"f": file, "src": f, "t": today()}
            idx["miss"].pop(key, None)
        else:
            idx["miss"][key] = today()
    return got


if __name__ == "__main__":
    try:
        sys.exit(run())
    except KeyboardInterrupt:
        sys.exit(1)
