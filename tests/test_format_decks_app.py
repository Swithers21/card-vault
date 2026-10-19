"""Decks I can build, by format: real deck lists for every format held against your cards, in a real browser.

The deck lists are made-up data shaped like format-decks.js as format_decks.py writes it. The rule the collector asked
for: TCG formats (Edison, Advanced...) count English cards only, OCG formats Japanese and Korean ones, Rush Duel the
Rush Duel cards.
"""
import unittest

import test_open_window_refresh as data
from test_sealed_app import SealedBase, BUILT
from test_themes_app import eng, jpn

NAMES = ["Blackwing - Gale the Whirlwind", "Pot of Greed", "Black-Winged Dragon", "Ash Blossom & Joyous Spring", "Branded Fusion",
         "Sevens Road Magician", "Sevens Fusion", "Elemental HEROes!", "Monster Reborn", "Sangan", "Dark Magician"]
FORMATS = [["Edison", "TCG", "2010-04-24", 1, "5D's", "Format Library"], ["OCG Goat", "OCG", "2005-04-09", 1, "GX", "Format Library"],
           ["Advanced", "TCG", "", 1, "", "Format Library and YGOPRODeck"], ["Speed Duel", "Speed", "", 0, "", "YGOPRODeck"]]
DECKS = [[0, "Blackwing", "Patron Battle Royale 58", 1, "2026-09-21", "fl", "85616", [0, 3, 1, 1], [2, 1]],
         [0, "Frog OTK", "Edison Cup", 2, "2026-08-31", "fl", "85700", [8, 2], []],
         [1, "Chaos Return", "OMS01", 1, "2025-12-14", "fl", "90001", [1, 1, 8, 1], []],
         [2, "Branded Ritual", "YCS Houston", "Top 16", "2026-10-15", "ypd", "branded-ritual-739347", [3, 3, 4, 1], []],
         [1, "Sangan Test", "Some OCG Cup", 3, "2025-11-01", "fl", "90002", [9, 1], []],
         [3, "Elemental Hero", "", "", "2026-10-10", "ypd", "elemental-hero-737134", [7, 1, 1, 2], []]]
DECKS_JS = data.js("FORMAT_DECKS", {"v": 1, "generated": "2026-10-19T04:00:00+00:00", "names": NAMES, "formats": FORMATS, "decks": DECKS})

P = lambda pid, name, number, market: [pid, 0, name, number, 0, [0, market, market, market, market, market], 0]
PRODUCTS = [P(11, "Blackwing - Gale the Whirlwind", "LC5D-EN066", 1.0), P(12, "Pot of Greed", "LOB-EN119", 2.0), P(13, "Black-Winged Dragon", "TSHD-EN040", 10.0),
            P(18, "Black-Winged Dragon (Secret)", "LC5D-EN070", 6.0), P(14, "Monster Reborn", "LOB-EN118", 1.5), P(15, "Ash Blossom & Joyous Spring", "MACR-EN036", 20.0),
            P(16, "Branded Fusion", "DABL-EN050", 5.0), P(17, "Elemental HEROes!", "SBCB-ENS01", 0.5)]


def tcg():
    return data.js("TCG_DATA", {"format": 4, "generated": BUILT, "builtAt": BUILT, "groups": [[1, "Some Set", "SET", "2020-01-01"]], "rarities": ["Common"],
                                "subtypes": ["Normal"], "products": PRODUCTS, "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


RUSH_NAMES = ["Sevens Road Magician", "Sevens Fusion", "Rush A", "Rush B", "Rush C", "Dark Magician", "Dark 2", "Dark 3", "Dark 4", "Dark 5"]
row = lambda num, name, yen: [num, RUSH_NAMES.index(name), [[0, yen, 1, 0, 0, 0, 0, 0]]]


def ocg():
    """Two Rush Duel Starter Decks and a booster (150 yen to the dollar), and a (non-Rush) Dark Magician at ¥1500."""
    sevens = [row("001", "Sevens Road Magician", 100), row("002", "Sevens Fusion", 300), row("003", "Rush A", 0), row("004", "Rush B", 50), row("005", "Rush C", 50)]
    dark = [row("001", "Dark Magician", 0)] + [row("%03d" % i, "Dark %d" % i, 0) for i in range(2, 6)]
    return data.js("OCG_CARDS", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400}, "names": RUSH_NAMES, "rar": ["Common"], "ja": [""],
                                 "jp": [["RD/SD01", ["", "", ""], sevens], ["RD/SD02", ["", "", ""], dark], ["RD/KP02", ["", "", ""], [row("050", "Sevens Fusion", 300), row("051", "Rush A", 0), row("052", "Rush B", 0), row("053", "Rush C", 0), row("054", "Dark 2", 0)]],
                                        ["LOB", ["", "", ""], [row("005", "Dark Magician", 1500)]]], "kr": []})


def market():
    s = lambda prefix, name, line: [prefix, name, "2020-04-04", line, 5, [], ""]
    return data.js("OCG_MARKET", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400}, "kr": [],
                                  "jp": [s("RD/SD01", "Starter Deck: Sevens", "structure"), s("RD/SD02", "Starter Deck: Dark", "structure"),
                                         s("RD/KP02", "Rush Booster 2", "booster"), s("LOB", "Legend of Blue Eyes", "booster")]})


def kor(rid, name, number):
    return dict(jpn(rid, name, number), language="Korean")


RECORDS = [eng("g", 11, "Blackwing - Gale the Whirlwind", "LC5D-EN066", 3), eng("p", 12, "Pot of Greed", "LOB-EN119"), eng("m", 14, "Monster Reborn", "LOB-EN118"),
           jpn("bwd-jp", "Black-Winged Dragon", "TSHD-JP040"),          # (Japanese: not for Edison)
           jpn("pot-jp", "Pot of Greed", "LOB-JP119"), kor("mr-kr", "Monster Reborn", "LOB-K118"),   # (for OCG Goat)
           jpn("rush", "Sevens Road Magician", "RD/KP01-JP001"),
           eng("sangan", 19, "Sangan", "MRD-EN069"), eng("dm", 20, "Dark Magician", "LOB-EN005")]   # (English: not for OCG Goat, nor for Rush Duel)


class FormatDecksApp(SealedBase):
    def go(self, records=RECORDS, decks=DECKS_JS):
        page = self.open(records, files={"tcgplayer-data.js": tcg(), "ocg-cards.js": ocg(), "ocg-market.js": market(), "format-decks.js": decks})
        page.evaluate("window.CardVault.loadOcgCards && window.CardVault.loadOcgCards()")
        page.wait_for_function("!!window.CardVault.ocgCd().data", timeout=10000)
        return page

    def ideas(self, page):
        page.evaluate("window.CardVault.setTab('decks')")
        page.click("[data-deckview=ideas]")
        page.wait_for_selector(".fdk-tools", timeout=10000)
        page.wait_for_function("(() => { const f = window.CardVault.fdk(); return f.data && f.data.rush && !f.rushWait; })()", timeout=10000)
        page.wait_for_timeout(100)

    def status(self, page):
        return page.evaluate("""(() => { const v = window.CardVault; const out = {};
            for (const d of v.fdk().data.decks) { const s = v.fdkStatus(d); out[d.f.name + '/' + d.type] = [s.have, s.need, Math.round(s.cost * 100) / 100]; } return out; })()""")

    def test_each_format_counts_the_cards_its_tournaments_allow(self):
        page = self.go()
        self.ideas(page)
        got = self.status(page)
        self.assertEqual(got["Edison/Blackwing"], [4, 5, 6.0])           # (the Japanese Black-Winged Dragon doesn't count; the cheapest English one is $6)
        self.assertEqual(got["Edison/Frog OTK"], [1, 2, 1.5])
        self.assertEqual(got["OCG Goat/Chaos Return"], [2, 2, 0])        # (the Japanese Pot of Greed and the Korean Monster Reborn do)
        self.assertEqual(got["Advanced/Branded Ritual"], [0, 4, 65.0])
        self.assertEqual(got["Rush Duel/Starter Deck: Sevens"], [1, 5, 2.66])   # (the Rush card counts for Rush Duel; ¥300 + ¥50 + ¥50, one unpriced)
        self.assertEqual(got["Speed Duel/Elemental Hero"], [1, 3, 2.5])
        self.assertEqual(got["OCG Goat/Sangan Test"], [0, 1, 0])           # (an English Sangan isn't an OCG card)
        self.assertEqual(got["Rush Duel/Starter Deck: Dark"], [0, 5, 0])   # (nor is a TCG Dark Magician a Rush Duel one, owned or priced)
        self.assertNotIn("Rush Duel/Rush Booster 2", got)                 # (a booster isn't a deck)

    def test_every_format_closest_first(self):
        page = self.go()
        self.ideas(page)
        names = page.locator(".fdk-row .idea-name").all_inner_texts()
        self.assertEqual([n.split(" ")[0] for n in names], ["OCG", "Edison", "Speed", "Rush", "Advanced"])
        first = page.locator(".fdk-row").first.inner_text()
        self.assertIn("You can build it", first)
        self.assertIn("Closest: Chaos Return (1st at OMS01)", first)
        self.assertIn("2 of 2", first)
        page.check("#fdkOnlyDone")
        page.wait_for_function("document.querySelectorAll('.fdk-row').length === 1")

    def test_a_formats_decks_and_the_want_list(self):
        page = self.go()
        self.ideas(page)
        page.select_option("#fdkFormat", "Edison")
        page.wait_for_selector("[data-fdk-deck]")
        self.assertEqual(page.locator("[data-fdk-deck] .idea-name").all_inner_texts(), ["Blackwing", "Frog OTK"])
        self.assertIn("Counts your English cards", page.inner_text("#panel-decks"))
        page.locator("[data-fdk-deck]").first.click()
        page.wait_for_selector(".fdk-cards")
        table = page.inner_text(".fdk-cards")
        self.assertIn("Black-Winged Dragon (Extra Deck)", table)
        self.assertIn("$6.00", table)
        self.assertEqual(page.get_attribute(".idea-body a.btn", "href"), "https://formatlibrary.com/decks/85616")
        page.click("[data-fdk-want]")
        page.wait_for_function("window.CardVault.state().wants.length === 1")
        self.assertEqual(page.evaluate("(() => { const w = window.CardVault.state().wants[0]; return [w.productId, w.edition, w.notes, w.qty]; })()"),
                         [18, "Any", "For Blackwing (Edison)", 1])
        self.assertIn("On want list", page.inner_text(".fdk-cards"))

    def test_add_all_the_missing_cards_and_undo(self):
        page = self.go()
        self.ideas(page)
        page.select_option("#fdkFormat", "Advanced")
        page.locator("[data-fdk-deck]").first.click()
        page.click("[data-fdk-wants]")
        page.wait_for_function("window.CardVault.state().wants.length === 2")
        self.assertEqual(sorted(page.evaluate("window.CardVault.state().wants.map(w => [w.productId, w.qty])")), [[15, 3], [16, 1]])
        self.assertEqual(page.get_attribute(".idea-body a.btn", "href"), "https://ygoprodeck.com/deck/branded-ritual-739347")
        page.click(".toast button")
        page.wait_for_function("window.CardVault.state().wants.length === 0")

    def test_rush_duel_missing_cards_are_wanted_by_number(self):
        page = self.go()
        self.ideas(page)
        page.select_option("#fdkFormat", "Rush Duel")
        self.assertIn("Nobody publishes Rush Duel deck lists", page.inner_text("#panel-decks"))
        page.locator("[data-fdk-deck]").first.click()
        page.click("[data-fdk-wants]")
        page.wait_for_function("window.CardVault.state().wants.length === 3")
        self.assertEqual(sorted(page.evaluate("window.CardVault.state().wants.map(w => [w.productId, w.number])")),
                         [[None, "RD/SD01-JP002"], [None, "RD/SD01-JP004"], [None, "RD/SD01-JP005"]])
        self.assertEqual(page.locator("[data-fdk-check]").count(), 0)          # (an archetype's cards aren't a deck to check)

    def test_open_a_deck_in_check_a_deck(self):
        page = self.go()
        self.ideas(page)
        page.select_option("#fdkFormat", "Edison")
        page.locator("[data-fdk-deck]").first.click()
        page.click("[data-fdk-check]")
        page.wait_for_selector("#deckText")
        self.assertEqual(page.input_value("#deckName"), "Blackwing (Edison)")
        self.assertEqual(page.input_value("#deckText"), "Main Deck\n3 Blackwing - Gale the Whirlwind\n1 Pot of Greed\n\nExtra Deck\n1 Black-Winged Dragon\n")

    def test_by_archetype_is_still_there(self):
        page = self.go()
        self.ideas(page)
        page.click("[data-ideas-mode=archetypes]")
        page.wait_for_selector("[data-ideas=run]")
        page.click("[data-ideas-mode=formats]")
        page.wait_for_selector(".fdk-tools")

    def test_the_list_not_loading_says_so(self):
        page = self.go(decks=None)
        page.evaluate("window.CardVault.setTab('decks')")
        page.click("[data-deckview=ideas]")
        page.wait_for_selector("[data-fdk-retry]", timeout=10000)
        self.assertIn("Couldn't load the deck lists", page.inner_text("#panel-decks"))


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(FormatDecksApp)


if __name__ == "__main__":
    unittest.main()
