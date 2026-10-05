#!/usr/bin/env python3
"""Card pictures for the cards TCGplayer has no photo of yet (a new set, a promo), for the Card Vault website.

The daily GitHub workflow runs this after update_tcgplayer_data.py. It reads tcgplayer-data.js, finds the cards with
no TCGplayer photo in any printing, looks them up on YGOPRODeck and downloads each one's small picture into
card-images/<name key>.jpg, which the workflow publishes with the website. The website shows it in place of the
missing photo, marked "Similar photo".

YGOPRODeck asks apps to download each picture once and keep their own copy instead of loading pictures from its site,
so that is what this does: the workflow keeps the card-images folder between runs, a picture is never downloaded
twice, and requests are paced well under YGOPRODeck's limit (20 a second). Pictures of cards TCGplayer has since
photographed are removed.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "tcgplayer-data.js")
OUT_DIR = os.path.join(HERE, "card-images")
INDEX_FILE = os.path.join(OUT_DIR, "index.json")
API = os.environ.get("YGOPRODECK_API", "https://db.ygoprodeck.com/api/v7").rstrip("/")
API_ORIGIN = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(API))
PAUSE = float(os.environ.get("CARDVAULT_IMAGE_PAUSE", "0.3"))   # seconds between requests
MAX_DOWNLOADS = int(os.environ.get("CARDVAULT_IMAGE_MAX", "800"))  # per run; the rest come the next day
MAX_LOOSE = 60          # cards per run looked up by a looser search (names spelled differently on YGOPRODeck)
RETRY_MISSES_DAYS = 7   # a card YGOPRODeck didn't know is looked up again after this long
MAX_KEY = 150           # longest name key the website accepts
USER_AGENT = "CardVault/1.0 (personal collection tracker; daily, once per picture)"


def say(text):
    print(text, flush=True)


# ------------------------------------------------------------- name keys (the website's photoKey)
def lookup_name(name):
    return re.sub(r"\s*\([^()]*\)\s*$", "", name or "").strip()


def plain_name(name):
    """The card's name without TCGplayer's tags, however many: "X (Starlight Rare) (Extended Art)" -> "X"."""
    s = (name or "").strip()
    while True:
        t = lookup_name(s)
        if t == s:
            return s
        s = t


def loose(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", (text or "").lower()))


def name_key(name):
    """The picture's file name: the plain name's letters and digits, like the website's photoKey."""
    return loose(plain_name(name))


# ------------------------------------------------------------------------------------------------ the price data
def read_data(path=DATA_FILE):
    """The data in tcgplayer-data.js ("window.TCG_DATA = {...};")."""
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    body = text[text.index("=", text.index("window.TCG_DATA")) + 1:].strip()
    return json.loads(body[:-1] if body.endswith(";") else body)


def cards_needing_pictures(data):
    """{name key: plain card name} for cards no printing of which has a TCGplayer photo."""
    if (data.get("format") or 0) < 4:
        return {}
    printings = {}
    for row in data.get("products") or []:
        if len(row) > 6 and row[6] == 1:
            continue  # sealed product
        key = name_key(row[2])
        if not key or len(key) > MAX_KEY:
            continue
        has_photo = not (len(row) > 7 and row[7] == 1)
        entry = printings.setdefault(key, [False, plain_name(row[2])])
        entry[0] = entry[0] or has_photo
    return {key: name for key, (has_photo, name) in printings.items() if not has_photo and name}


# ------------------------------------------------------------------------------------------------------ requests
_last = [0.0]


def get(url, limit=2_000_000):
    wait = _last[0] + PAUSE - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read(limit + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(limit + 1) if error.fp else b""


def api(params):
    status, body = get(API + "/cardinfo.php?" + urllib.parse.urlencode(params))
    if status == 400:
        return []   # YGOPRODeck's answer for "no card matching your query"
    if status != 200:
        raise RuntimeError("YGOPRODeck answered %s" % status)
    return (json.loads(body.decode("utf-8")) or {}).get("data") or []


def picture_url(card):
    images = card.get("card_images") or []
    url = (images[0].get("image_url_small") or images[0].get("image_url") or "") if images else ""
    return url if url.startswith("https://") or url.startswith(API_ORIGIN + "/") else ""


def download(url, path):
    status, body = get(url)
    if status != 200 or len(body) > 1_500_000 or not body.startswith(b"\xff\xd8"):
        return False
    with open(path + ".tmp", "wb") as handle:
        handle.write(body)
    os.replace(path + ".tmp", path)
    return True


# ---------------------------------------------------------------------------------------------------------- main
def run(data_path=DATA_FILE, out_dir=OUT_DIR):
    if not os.path.exists(data_path):
        say("No tcgplayer-data.js yet: nothing to do.")
        return 0
    needed = cards_needing_pictures(read_data(data_path))
    os.makedirs(out_dir, exist_ok=True)
    index_file = os.path.join(out_dir, "index.json")
    try:
        with open(index_file, "r", encoding="utf-8") as handle:
            index = json.load(handle)
    except (OSError, ValueError):
        index = {}
    now = time.time()

    # Pictures of cards TCGplayer now has a photo of aren't needed any more.
    removed = 0
    for key in list(index):
        if key not in needed:
            index.pop(key, None)
            try:
                os.remove(os.path.join(out_dir, key + ".jpg"))
                removed += 1
            except OSError:
                pass

    def have(key):
        return os.path.exists(os.path.join(out_dir, key + ".jpg"))

    todo = [key for key in sorted(needed)
            if not have(key) and not (index.get(key, {}).get("miss") and now - index[key]["miss"] < RETRY_MISSES_DAYS * 86400)]
    say("%d cards have no TCGplayer photo; %d pictures kept already, %d to look up." % (len(needed), sum(1 for k in needed if have(k)), len(todo)))

    downloads = 0
    found = {}
    try:
        # 1) by exact name, 40 a request
        for start in range(0, len(todo), 40):
            chunk = todo[start:start + 40]
            for card in api({"name": "|".join(needed[k] for k in chunk)}):
                k = name_key(card.get("name", ""))
                if k in chunk and picture_url(card):
                    found[k] = card
        # 2) names spelled differently ("Mystical Elf White Lightning" for "Mystical Elf - White Lightning"):
        #    search by the longest word and compare letters and digits
        misses = [k for k in todo if k not in found and not needed[k].lower().startswith("token")][:MAX_LOOSE]
        for k in misses:
            if k in found:
                continue
            words = sorted(re.findall(r"[A-Za-z0-9]{4,}", needed[k]), key=len, reverse=True)
            if not words:
                continue
            for card in api({"fname": words[0]}):
                ck = name_key(card.get("name", ""))
                if ck in needed and ck not in found and not have(ck) and picture_url(card):
                    found[ck] = card
        # 3) each picture, once
        for k in todo:
            if downloads >= MAX_DOWNLOADS:
                say("Reached today's limit of %d pictures; the rest come tomorrow." % MAX_DOWNLOADS)
                break
            card = found.get(k)
            if not card:
                index[k] = {"miss": now}
                continue
            if download(picture_url(card), os.path.join(out_dir, k + ".jpg")):
                index[k] = {"id": card.get("id"), "t": now}
                downloads += 1
            else:
                index[k] = {"miss": now}
    except (OSError, RuntimeError, ValueError) as error:
        say("Stopped early: %s" % error)
    finally:
        with open(index_file + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(index, handle, separators=(",", ":"))
        os.replace(index_file + ".tmp", index_file)
    say("Downloaded %d new pictures, removed %d no longer needed; %d cards still without a picture."
        % (downloads, removed, sum(1 for k in needed if not have(k))))
    return 0


if __name__ == "__main__":
    sys.exit(run())
