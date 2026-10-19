"""The nightly deck lists for every format (format_decks.py), against pretend sites shaped like the real ones.

Format Library (read Oct 19 2026): /api/formats (name, date, banlist, category TCG/OCG, era, isPopular),
/api/decks/?limit=&page=&filter=formatName:eq:X,origin:eq:event (newest first; id, deckTypeName, placement, publishDate,
event {id, name}; no cards), /api/decks/<id> (main / extra / side: one entry per copy, with the card's name).
YGOPRODeck's deck search (/api/decks/getDecks.php?format=<category>&offset=, 20 a page): deck_name, deckNum, pretty_url,
main_deck / extra_deck as JSON text of card ids, tournamentName, tournamentPlacement, submit_date ("2 days ago").
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import format_decks as fd  # noqa: E402

FORMATS = [
    {"name": "Edison", "date": "2010-04-24", "banlist": "March 2010", "category": "TCG", "era": "5D's", "isPopular": True},
    {"name": "Critter", "date": "2002-07-01", "banlist": "July 2002", "category": "TCG", "era": "DM", "isPopular": False},
    {"name": "OCG Goat", "date": "2005-04-09", "banlist": "March 2005", "category": "OCG", "era": "GX", "isPopular": True},
    {"name": "Advanced", "date": None, "banlist": "September 2026", "category": "TCG", "era": "GO RUSH!!", "isPopular": False},
    {"name": "Some Speed Thing", "date": None, "category": "SPEED"},
]


def listing(fmt):
    """Event decks, newest first: Edison has 5 Blackwing, 3 Lightsworn, 1 Frog OTK and an "Other"."""
    if fmt == "Edison":
        rows = [(101, "Blackwing", 1, "2026-09-21"), (102, "Blackwing", 4, "2026-09-21"), (103, "Lightsworn", 2, "2026-09-14"),
                (104, "Blackwing", 2, "2026-09-07"), (105, "Other", 1, "2026-09-07"), (106, "Frog OTK", 3, "2026-08-31"),
                (107, "Blackwing", 1, "2026-08-24"), (108, "Lightsworn", 1, "2026-08-24"), (109, "Blackwing", 8, "2026-08-17"),
                (110, "Lightsworn", 5, "2026-08-10")]
    elif fmt == "OCG Goat":
        rows = [(201, "Chaos Return", 1, "2025-12-14")]
    elif fmt == "Advanced":
        rows = [(301, "Branded", 1, "2026-10-01")]
    else:
        rows = []
    return [{"id": i, "name": None, "deckTypeName": t, "placement": p, "publishDate": d + "T18:26:06.691Z", "event": {"id": 9, "name": "Event " + str(i)},
             "eventAbbreviation": "E" + str(i), "formatName": fmt} for i, t, p, d in rows]


def deck(i):
    main = ["Blackwing - Gale the Whirlwind"] * 3 + ["Pot of Greed"] + ["Card " + str(i)] * 2
    return {"id": i, "ydk": "created by...", "main": [{"name": n, "id": 1} for n in main], "extra": [{"name": "Black-Winged Dragon"}], "side": [{"name": "Side Card"}]}


YPD = {"Tournament Meta Decks": [{"deck_name": "Branded Ritual", "deckNum": 739347, "pretty_url": "branded-ritual-739347", "tournamentName": "YCS Houston",
                                  "tournamentPlacement": "Top 16", "submit_date": "2 days ago", "main_deck": json.dumps(["1", "1", "1", "2"]), "extra_deck": json.dumps(["3"])},
                                 {"deck_name": "Mostly Unknown", "deckNum": 5, "pretty_url": "x-5", "main_deck": json.dumps(["1", "91", "92", "93", "94"])}],
       "Speed Duel Decks": [{"deck_name": "Elemental Hero | Speed Duel Deck", "deckNum": 737134, "pretty_url": "elemental-hero-737134", "submit_date": "1 week ago",
                             "main_deck": json.dumps(["300302041", "2", "2"])}]}
IDS = {"1": "Ash Blossom & Joyous Spring", "2": "Branded Fusion", "3": "Mirrorjade the Iceblade Dragon", "300302041": "Elemental HEROes!"}


class Sites:
    def __init__(self):
        self.calls = []
        self.down = set()

    def __call__(self, web_self, url):
        u = urlsplit(url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        self.calls.append(u.path + ("?" + u.query if u.query else ""))
        web_self.requests += 1
        if u.netloc in self.down:
            raise IOError("down")
        if u.path.endswith("/api/formats"):
            return FORMATS
        if u.path.endswith("/api/decks/"):
            fmt = q["filter"].split(",")[0].split(":", 2)[2]
            rows = listing(fmt)
            page, limit = int(q["page"]), int(q["limit"])
            return rows[(page - 1) * limit: page * limit]
        if "/api/decks/" in u.path and u.path.rsplit("/", 1)[-1].isdigit():
            return deck(int(u.path.rsplit("/", 1)[-1]))
        if u.path.endswith("getDecks.php"):
            rows = YPD.get(q["format"], [])
            return rows[int(q["offset"]): int(q["offset"]) + 20] or {"error": "No decks matching your query were found in the database."}
        raise IOError("unknown " + url)


class FormatDecks(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.out, self.cache, self.ids = (os.path.join(self.dir, n) for n in ("format-decks.js", "cache.json", "card-ids.json"))
        with open(self.ids, "w") as f:
            json.dump({"ids": IDS}, f)
        self.sites = Sites()
        real = fd.Web.json
        fd.Web.json = lambda web_self, url: self.sites(web_self, url)
        self.addCleanup(setattr, fd.Web, "json", real)
        self.said = []
        real_say = fd.say
        fd.say = self.said.append
        self.addCleanup(setattr, fd, "say", real_say)

    def load(self):
        with open(self.cache, encoding="utf-8") as f:
            return json.load(f)

    def save(self, cache):
        with open(self.cache, "w", encoding="utf-8") as f:
            json.dump(cache, f)

    def run_it(self, **kw):
        fd.run(out_file=self.out, cache_file=self.cache, ids_file=self.ids, **kw)
        with open(self.out, encoding="utf-8") as f:
            text = f.read()
        self.assertTrue(text.startswith("/* Card Vault"))
        return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))

    def decks(self, data, fmt):
        fi = [f[0] for f in data["formats"]].index(fmt)
        names = data["names"]
        out = []
        for d in data["decks"]:
            if d[0] != fi:
                continue
            pairs = lambda flat: {names[flat[i]]: flat[i + 1] for i in range(0, len(flat), 2)}
            out.append({"type": d[1], "event": d[2], "place": d[3], "date": d[4], "src": d[5], "ref": d[6], "main": pairs(d[7]), "extra": pairs(d[8])})
        return out

    def test_the_formats_and_where_they_come_from(self):
        data = self.run_it()
        got = {f[0]: f[1:] for f in data["formats"]}
        self.assertEqual(list(got), ["Edison", "OCG Goat", "Advanced", "Speed Duel"])       # (popular first; only ones with decks)
        self.assertEqual(got["Edison"], ["TCG", "2010-04-24", 1, "5D's", "Format Library"])
        self.assertEqual(got["OCG Goat"][0], "OCG")
        self.assertEqual(got["Advanced"][-1], "Format Library and YGOPRODeck")                       # (both sources, one format)
        self.assertEqual(got["Speed Duel"][0], "Speed")
        self.assertNotIn("Some Speed Thing", got)                                                     # (not TCG or OCG)

    def test_a_spread_of_deck_types_best_placings_first(self):
        data = self.run_it()
        ed = self.decks(data, "Edison")
        # Blackwing (5), Lightsworn (3), Frog OTK (1): round and round, the best placing (then the newest) first; no "Other"
        self.assertEqual([(d["type"], d["place"], d["ref"]) for d in ed],
                         [("Blackwing", 1, "101"), ("Lightsworn", 1, "108"), ("Frog OTK", 3, "106"), ("Blackwing", 1, "107"), ("Lightsworn", 2, "103"),
                          ("Blackwing", 2, "104"), ("Lightsworn", 5, "110")])
        self.assertEqual(ed[0]["main"], {"Blackwing - Gale the Whirlwind": 3, "Pot of Greed": 1, "Card 101": 2})
        self.assertEqual(ed[0]["extra"], {"Black-Winged Dragon": 1})
        self.assertEqual((ed[0]["event"], ed[0]["date"], ed[0]["src"]), ("Event 101", "2026-09-21", "fl"))

    def test_choose_caps_and_per_type(self):
        rows = [{"id": i, "deckTypeName": "T%d" % (i % 30), "placement": 1, "publishDate": "2026-01-01"} for i in range(200)]
        self.assertEqual(len(fd.choose(rows, False)), fd.OTHER_DECKS)
        self.assertEqual(len(fd.choose(rows, True)), fd.POPULAR_DECKS)
        one = [{"id": i, "deckTypeName": "Only", "placement": i, "publishDate": "2026-01-01"} for i in range(1, 11)]
        self.assertEqual([d["id"] for d in fd.choose(one, True)], [1, 2, 3])

    def test_ygoprodecks_ids_become_names(self):
        data = self.run_it()
        adv = [d for d in self.decks(data, "Advanced") if d["src"] == "ypd"]
        self.assertEqual(len(adv), 1)                                         # (a deck with more than 3 unknown cards is left out)
        b = adv[0]
        self.assertEqual(b["main"], {"Ash Blossom & Joyous Spring": 3, "Branded Fusion": 1})
        self.assertEqual(b["extra"], {"Mirrorjade the Iceblade Dragon": 1})
        self.assertEqual((b["type"], b["event"], b["place"], b["ref"]), ("Branded Ritual", "YCS Houston", "Top 16", "branded-ritual-739347"))
        self.assertRegex(b["date"], r"^\d{4}-\d\d-\d\d$")
        speed = self.decks(data, "Speed Duel")[0]
        self.assertEqual(speed["main"], {"Elemental HEROes!": 1, "Branded Fusion": 2})       # (its Skill counts as a card)

    def test_decks_are_downloaded_once_and_lists_read_weekly(self):
        self.run_it()
        first = len(self.sites.calls)
        self.sites.calls.clear()
        self.run_it()
        self.assertEqual(self.sites.calls, [])                               # (all kept: nothing asked again inside the week)
        cache = self.load()
        for e in cache["fl"].values():
            e["t"] = "2026-01-01T00:00:00+00:00"
        self.save(cache)
        self.run_it()
        self.assertTrue(all("/api/decks/?" in c for c in self.sites.calls))  # (the lists again, no deck downloaded twice)
        self.assertGreater(first, len(self.sites.calls))

    def test_a_budget_spreads_the_work_over_nights_popular_first(self):
        first = None
        for night in range(8):
            data = self.run_it(budget=6)
            have = set((self.load().get("decks") or {}))
            if have and first is None:
                first = have
        self.assertTrue(first and first <= {str(i) for i in range(101, 111)}, first)        # (Edison, a popular format, first)
        self.assertEqual(len(self.decks(data, "Edison")), 7)
        self.assertIn("OCG Goat", [f[0] for f in data["formats"]])
        self.assertIn("Advanced", [f[0] for f in data["formats"]])

    def test_a_site_thats_down_keeps_what_was_there(self):
        before = self.run_it()
        cache = self.load()
        for e in cache["fl"].values():
            e["t"] = "2026-01-01T00:00:00+00:00"
        for e in cache["ypd"].values():
            e["t"] = "2026-01-01T00:00:00+00:00"
        self.save(cache)
        self.sites.down = {"formatlibrary.com", "ygoprodeck.com"}
        after = self.run_it()
        self.assertEqual(len(after["decks"]), len(before["decks"]))
        self.assertIn("Format decks:", self.said[-1])

    def test_without_the_ids_file_ygoprodeck_waits(self):
        os.remove(self.ids)
        data = self.run_it()
        self.assertNotIn("Speed Duel", [f[0] for f in data["formats"]])
        self.assertIn("no card-ids.json yet", self.said[-1])
        self.assertFalse(any("getDecks" in c for c in self.sites.calls))


if __name__ == "__main__":
    unittest.main()
