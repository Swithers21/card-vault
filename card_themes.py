#!/usr/bin/env python3
"""Which cards belong to which archetype or name, for Card Vault's theme goals ("every Shaddoll card", "every Dark
Magician Girl card").

The daily GitHub workflow runs this; once a week it downloads every card from YGOPRODeck (one request, as YGOPRODeck
asks: download the data once and keep your own copy) and its list of archetypes, and writes card-themes.js for the
website: each card's name, its archetype, the names quoted in its text (the cards and archetypes it supports, like
"Shaddoll" or "Dark Magician Girl") and the ones it is "always treated as". The rest of the week the file is kept as
it is (the workflow keeps it between runs). If YGOPRODeck can't be reached, the last file stays.

    python card_themes.py            (the workflow; weekly)
    python card_themes.py --force    (now, whatever the file's age)
"""
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.environ.get("CARDVAULT_THEMES_OUT", os.path.join(HERE, "card-themes.js"))
API = os.environ.get("YGOPRODECK_API", "https://db.ygoprodeck.com/api/v7").rstrip("/")
REFRESH_DAYS = 7
FORMAT = 1
USER_AGENT = "CardVault/1.0 (personal Yu-Gi-Oh! collection tracker; weekly, once)"
QUOTED = re.compile(r'"([^"\n]{2,60})"')
TREATED = re.compile(r'(?:always\s+)?treated\s+as\s+(?:an?\s+)?"([^"\n]{2,60})"', re.I)
SKIP_FRAMES = {"skill", "token"}
EXTRA_FRAMES = {"fusion", "synchro", "xyz", "link", "fusion_pendulum", "synchro_pendulum", "xyz_pendulum"}


def say(text):
    print(text, flush=True)


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_json(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = res.read()
        if res.headers.get("Content-Encoding", "").lower() == "gzip" or body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
    return json.loads(body.decode("utf-8"))


def read_existing(path=OUT_FILE):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
        body = text[text.index("=", text.index("window.CARD_THEMES")) + 1:].strip()
        return json.loads(body[:-1] if body.endswith(";") else body)
    except (OSError, ValueError):
        return None


def age_days(data):
    try:
        then = datetime.fromisoformat(str(data.get("generated")))
        return (datetime.now(timezone.utc) - then).total_seconds() / 86400
    except (TypeError, ValueError, AttributeError):
        return 9999


def kind_of(card):
    frame = str(card.get("frameType") or "").lower()
    t = str(card.get("type") or "").lower()
    if frame == "spell" or "spell" in t:
        return "s"
    if frame == "trap" or "trap" in t:
        return "t"
    return "e" if frame in EXTRA_FRAMES else "m"


def playable(card):
    """A real card of the TCG or OCG: not a Skill or token, not one only in Rush Duel or the video games."""
    if str(card.get("frameType") or "").lower() in SKIP_FRAMES or str(card.get("type") or "").lower() in ("skill card", "token"):
        return False
    misc = (card.get("misc_info") or [{}])[0] or {}
    formats = misc.get("formats")
    if isinstance(formats, list) and formats and not ({"TCG", "OCG"} & set(formats)):
        return False
    return bool(str(card.get("name") or "").strip())


def build(cards, archetypes):
    """The website's index: {v, generated, terms, arch, cards}. terms: every archetype and every name a card's text
    quotes that is a card or an archetype; cards: [name, archetype (term index or -1), [quoted terms], [treated as terms],
    kind (m monster, e Extra Deck, s spell, t trap)]."""
    cards = [c for c in cards if isinstance(c, dict) and playable(c)]
    names = {str(c["name"]).strip() for c in cards}
    arch_names = {str(a).strip() for a in archetypes if str(a).strip()} | {str(c.get("archetype") or "").strip() for c in cards if c.get("archetype")}
    arch_lower = {a.lower(): a for a in arch_names}
    terms, index = [], {}

    def term(s):
        if s not in index:
            index[s] = len(terms)
            terms.append(s)
        return index[s]

    for a in sorted(arch_names, key=str.lower):
        term(a)
    out = []
    for c in sorted(cards, key=lambda x: str(x["name"]).lower()):
        name = str(c["name"]).strip()
        desc = str(c.get("desc") or "")
        arch = str(c.get("archetype") or "").strip()
        refs, treated = [], []
        for q in QUOTED.findall(desc):
            q = q.strip()
            hit = arch_lower.get(q.lower()) or (q if q in names else None)
            if hit and hit != name and term(hit) not in refs:
                refs.append(term(hit))
        misc = (c.get("misc_info") or [{}])[0] or {}
        for q in TREATED.findall(desc) + ([misc["treated_as"]] if isinstance(misc.get("treated_as"), str) else []):
            q = q.strip()
            hit = arch_lower.get(q.lower()) or (q if q in names else None)
            if hit and term(hit) not in treated:
                treated.append(term(hit))
        refs = [r for r in refs if r not in treated]
        out.append([name, term(arch) if arch else -1, refs, treated, kind_of(c)])
    return {"v": FORMAT, "generated": now_iso(), "terms": terms, "arch": sorted(index[a] for a in arch_names), "cards": out}


def write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write("/* Card Vault: which cards belong to which archetype or name (theme goals), from YGOPRODeck. Rebuilt weekly by card_themes.py */\n")
        handle.write("window.CARD_THEMES = ")
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    os.replace(tmp, path)


def run(force=False, out_file=OUT_FILE):
    old = read_existing(out_file)
    if old and not force and old.get("v") == FORMAT and age_days(old) < REFRESH_DAYS:
        say("Card themes: kept (%d cards, from %s); read again weekly." % (len(old.get("cards") or []), str(old.get("generated"))[:10]))
        return 0
    try:
        started = time.time()
        cards = (get_json(API + "/cardinfo.php?misc=yes") or {}).get("data") or []
        try:
            archetypes = [a.get("archetype_name") for a in get_json(API + "/archetypes.php") or [] if isinstance(a, dict)]
        except (urllib.error.URLError, OSError, ValueError):
            archetypes = []
        if len(cards) < 5000:
            raise ValueError("only %d cards in YGOPRODeck's answer" % len(cards))
        data = build(cards, archetypes)
        if old and len(data["cards"]) < 0.9 * len(old.get("cards") or []):
            raise ValueError("%d cards, far fewer than last time's %d" % (len(data["cards"]), len(old.get("cards") or [])))
    except (urllib.error.URLError, OSError, ValueError) as err:
        say("Card themes: YGOPRODeck couldn't be read (%s); %s." % (str(err)[:120], "the last list stays" if old else "no list yet"))
        return 0
    write(out_file, data)
    say("Card themes: %d cards, %d archetypes and names, read in %.0f s (%.1f MB)." % (len(data["cards"]), len(data["terms"]), time.time() - started,
                                                                               os.path.getsize(out_file) / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(run(force="--force" in sys.argv))
