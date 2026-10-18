"""Theme goals: every card of an archetype (Shaddoll) or a name (Dark Magician Girl), one language at a time.

In a real browser against made-up data shaped like the real files: card-themes.js as card_themes.py writes it (from a
pretend YGOPRODeck answer), TCGplayer's price file, and the Japanese list. Checks what a collector does and sees:
find the theme, track it in English and Japanese, see the progress (members and support apart, each language on its
own, cards never printed in that language left out), see the cards, put the missing ones on the want list.
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import card_themes  # noqa: E402
import test_open_window_refresh as data  # noqa: E402
from test_card_themes import c  # noqa: E402
from test_sealed_app import SealedBase, BUILT  # noqa: E402

YGO = [
    c("El Shaddoll Winda", 'Must be Special Summoned with "Shaddoll Fusion".', arch="Shaddoll", frame="fusion", type_="Fusion Monster"),
    c("Shaddoll Dragon", "", arch="Shaddoll"),
    c("Shaddoll Beast", "", arch="Shaddoll"),
    c("Shaddoll Fusion", 'Fusion Summon 1 "Shaddoll" Fusion Monster.', arch="Shaddoll", frame="spell", type_="Spell Card"),
    c("Nephe Shaddoll Fusion", 'Fusion Summon 1 "Shaddoll" Fusion Monster.', frame="spell", type_="Spell Card"),
    c("Shaddoll Core", 'Treated as a "Shaddoll" card.', arch="Shaddoll", frame="trap", type_="Trap Card"),
    c("Sinister Shadow Games", 'Send 1 "Shaddoll" card from your Deck to the GY.', frame="trap", type_="Trap Card"),     # (support)
    c("Dark Magician Girl", "", arch="Dark Magician"),
    c("Toon Dark Magician Girl", "", arch="Toon"),
    c("Dark Magician Girl the Dragon Knight", '"Dark Magician Girl" + 1 Dragon monster', arch="Dark Magician", frame="fusion", type_="Fusion Monster"),
    c("Magician's Valkyria", 'This card is always treated as a "Dark Magician Girl" card.'),
    c("Dark Magic Twin Burst", 'Target 1 "Dark Magician Girl" you control.', frame="spell", type_="Spell Card"),
    c("Dark Magician", "", arch="Dark Magician", frame="normal", type_="Normal Monster"),
    c("Elemental HERO Neos", "", arch="Elemental HERO"),
    c("Heroic Challenger - Spartan", "", arch="Heroic"),
]
THEMES = data.js("CARD_THEMES", card_themes.build(YGO, ["Shaddoll", "Dark Magician", "Toon", "Elemental HERO", "Heroic", "HERO"]))

# TCGplayer: [id, set, name, number, rarity, [subtype, market, low, d1, d7, d30], sealed]
P = lambda pid, name, number, market: [pid, 0, name, number, 0, [0, market, market, market, market, market], 0]
PRODUCTS = [P(11, "El Shaddoll Winda", "DUEA-EN099", 6.0), P(12, "El Shaddoll Winda (Secret)", "SHVA-EN001", 2.5),
            P(13, "Shaddoll Dragon", "DUEA-EN020", 1.0), P(14, "Shaddoll Beast", "DUEA-EN021", 0.5), P(15, "Shaddoll Fusion", "DUEA-EN062", 3.0),
            P(16, "Nephe Shaddoll Fusion", "SHVA-EN002", 0.75), P(17, "Sinister Shadow Games", "SECE-EN090", 0.4),
            P(21, "Dark Magician Girl", "MVP1-EN056", 10.0), P(22, "Toon Dark Magician Girl", "LDK2-ENY13", 1.5),
            P(23, "Dark Magic Twin Burst", "DRL3-EN043", 0.6), P(24, "Magician's Valkyria", "LDK2-ENY08", 0.3)]
# (Shaddoll Core and the Dragon Knight: never printed in English here)


def tcg():
    return data.js("TCG_DATA", {"format": 4, "generated": BUILT, "builtAt": BUILT, "groups": [[1, "Some Set", "SET", "2020-01-01"]], "rarities": ["Common"],
                                "subtypes": ["Normal"], "products": PRODUCTS, "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


def ocg():
    # Japanese: El Shaddoll Winda and Shaddoll Core, and a Rush Duel "Dark Magician Girl" (another game's card)
    return data.js("OCG_CARDS", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400}, "names": ["El Shaddoll Winda", "Shaddoll Core", "Dark Magician Girl"],
                                 "rar": ["Super Rare", "Common"], "ja": [""],
                                 "jp": [["DUEA", ["", "", ""], [["099", 0, [[0, 900, 1, 0, 0, 0, 0, 0]]], ["075", 1, [[1, 300, 1, 0, 0, 0, 0, 0]]]]],
                                        ["RD/KP01", ["", "", ""], [["001", 2, [[1, 50, 1, 0, 0, 0, 0, 0]]]]]], "kr": []})


def eng(rid, pid, name, number, qty=1):
    return {"id": rid, "productId": pid, "name": name, "productName": name, "setName": "Some Set", "number": number, "rarity": "Common", "edition": "1st Edition",
            "language": "English", "qty": qty, "quantity": qty, "condition": "Near Mint"}


def jpn(rid, name, number):
    return {"id": rid, "productId": None, "name": name, "productName": name, "setName": "", "number": number, "rarity": "Super Rare", "edition": "",
            "language": "Japanese", "qty": 1, "quantity": 1, "condition": "Near Mint"}


class Themes(SealedBase):
    def go(self, records=(), themes=THEMES, goals=None):
        local = {}
        if goals:
            local["cardvault.v2.settings"] = json.dumps({"themeGoals": [{"k": k, "l": l, "t": 1760000000000 + i} for i, (k, l) in enumerate(goals)]})
        files = {"tcgplayer-data.js": tcg(), "ocg-cards.js": ocg(), "card-themes.js": themes}
        return self.open(records, files=files, local=local)

    def ready(self, page):
        page.evaluate("window.CardVault.loadThemes()")
        page.wait_for_function("!!window.CardVault.th().data", timeout=10000)

    def status(self, page, k, l):
        page.evaluate("window.CardVault.loadOcgCards && window.CardVault.loadOcgCards()")
        page.wait_for_function("!!window.CardVault.ocgCd().data", timeout=10000)
        return page.evaluate("([k, l]) => { const s = window.CardVault.themeStatus({k, l}); return {m: s.m, s: s.s, missing: s.missing.map(x => x.c.name).sort(), notPrinted: s.notPrinted, cost: Math.round(s.cost * 100) / 100,"
                             " members: s.members.map(x => x.c.name).sort(), support: s.support.map(x => x.c.name).sort()}; }", [k, l])

    # ----- what a theme is
    def test_an_archetype_has_its_cards_and_its_support_apart(self):
        page = self.go()
        self.ready(page)
        got = page.evaluate("(() => { const t = window.CardVault.themeCards('Shaddoll'); return [t.members.map(c => c.name).sort(), t.support.map(c => c.name)]; })()")
        self.assertEqual(got[0], ["El Shaddoll Winda", "Nephe Shaddoll Fusion", "Shaddoll Beast", "Shaddoll Core", "Shaddoll Dragon", "Shaddoll Fusion"])
        self.assertEqual(got[1], ["Sinister Shadow Games"])

    def test_a_monster_has_the_cards_with_its_name_the_ones_treated_as_it_and_its_support(self):
        page = self.go()
        self.ready(page)
        got = page.evaluate("(() => { const t = window.CardVault.themeCards('Dark Magician Girl'); return [t.members.map(c => c.name).sort(), t.support.map(c => c.name)]; })()")
        self.assertEqual(got[0], ["Dark Magician Girl", "Dark Magician Girl the Dragon Knight", "Magician's Valkyria", "Toon Dark Magician Girl"])
        self.assertEqual(got[1], ["Dark Magic Twin Burst"])

    def test_a_name_is_matched_as_a_whole_word(self):
        page = self.go()
        self.ready(page)
        self.assertEqual(page.evaluate("window.CardVault.themeCards('HERO').members.map(c => c.name)"), ["Elemental HERO Neos"])

    # ----- finding and tracking one
    def test_the_picker_suggests_archetypes_then_cards_with_how_many(self):
        page = self.go()
        page.evaluate("window.CardVault.openThemePicker('')")
        page.wait_for_selector("#thQ")
        page.fill("#thQ", "shadd")
        page.wait_for_selector(".theme-sug")
        first = page.locator(".theme-sug").first.inner_text()
        self.assertIn("Shaddoll", first)
        self.assertIn("Archetype · 6 cards and 1 support card", first)
        page.fill("#thQ", "dark magician girl")
        page.wait_for_function("Array.from(document.querySelectorAll('.theme-sug .result-name')).some(e => e.textContent === 'Dark Magician Girl')")
        self.assertIn("Card · 4 cards and 1 support card", page.locator(".theme-sug", has_text="Dark Magician Girl").first.inner_text())

    def test_tracking_in_two_languages_makes_two_goals(self):
        page = self.go()
        page.evaluate("window.CardVault.openThemePicker('Shaddoll')")
        page.wait_for_selector(".theme-sug")
        page.check("[data-th-lang=Japanese]")
        page.locator(".theme-sug", has_text="Archetype").locator("button").click()
        page.wait_for_function("window.CardVault.themeGoals().length === 2")
        self.assertEqual(page.evaluate("window.CardVault.themeGoals().map(g => g.k + '|' + g.l)"), ["Shaddoll|English", "Shaddoll|Japanese"])
        page.wait_for_selector("#goalsBar .goal")
        names = page.locator("#goalsBar .goal-name").all_inner_texts()
        self.assertEqual(names, ["Shaddoll · English", "Shaddoll · Japanese"])
        # (kept: comes back after closing)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.assertEqual(page.evaluate("window.CardVault.themeGoals().length"), 2)

    def test_no_language_ticked_tracks_nothing(self):
        page = self.go()
        page.evaluate("window.CardVault.openThemePicker('Shaddoll')")
        page.wait_for_selector(".theme-sug")
        page.uncheck("[data-th-lang=English]")
        page.locator(".theme-sug").first.locator("button").click()
        page.wait_for_timeout(300)
        self.assertEqual(page.evaluate("window.CardVault.themeGoals().length"), 0)

    # ----- progress, each language on its own
    def test_each_language_counts_only_its_own_copies_and_prints(self):
        recs = [eng("a", 13, "Shaddoll Dragon", "DUEA-EN020", 2), eng("b", 12, "El Shaddoll Winda (Secret)", "SHVA-EN001"), jpn("j", "Shaddoll Core", "DUEA-JP075")]
        page = self.go(recs)
        self.ready(page)
        en = self.status(page, "Shaddoll", "English")
        # English: Shaddoll Core was never printed in English here: left out; the Japanese Core doesn't count
        self.assertEqual((en["m"], en["s"], en["notPrinted"]), ({"have": 2, "total": 5}, {"have": 0, "total": 1}, 1))
        self.assertEqual(en["missing"], ["Nephe Shaddoll Fusion", "Shaddoll Beast", "Shaddoll Fusion", "Sinister Shadow Games"])
        self.assertEqual(en["cost"], 0.75 + 0.5 + 3.0 + 0.4)
        jp = self.status(page, "Shaddoll", "Japanese")
        # Japanese: only El Shaddoll Winda and Shaddoll Core were printed (in Card Vault's list); the English copies don't count
        self.assertEqual((jp["m"], jp["s"]), ({"have": 1, "total": 2}, {"have": 0, "total": 0}))
        self.assertEqual(jp["missing"], ["El Shaddoll Winda"])
        self.assertEqual(jp["cost"], 6.0)                         # (¥900 at 150 yen to the dollar)

    def test_a_rush_duel_card_with_the_same_name_isnt_the_card(self):
        page = self.go([jpn("r", "Dark Magician Girl", "RD/KP01-JP001")])
        self.ready(page)
        st = self.status(page, "Dark Magician Girl", "Japanese")
        self.assertEqual(st["m"]["have"], 0)
        self.assertEqual(st["m"]["total"], 0)

    def test_the_goal_shows_the_numbers_when_opened(self):
        page = self.go([eng("a", 13, "Shaddoll Dragon", "DUEA-EN020")], goals=[("Shaddoll", "English")])
        page.wait_for_selector("#goalsBar .goal-name")
        page.click("#goalsBar [data-theme-fold]")
        page.wait_for_selector("#goalsBar .goal-nums")
        text = page.inner_text("#goalsBar .goal-nums")
        self.assertIn("1 of 5 Shaddoll cards", text)
        self.assertIn("0 of 1 support cards", text)
        self.assertIn("about $7.15 to finish", text)           # (2.50 + 0.50 + 3.00 + 0.75 + 0.40: Winda's cheaper printing)
        self.assertIn("1 card never printed in English left out", text)

    # ----- the cards, and the want list
    def test_see_the_cards_lists_both_groups_and_want_adds_the_cheapest_printing(self):
        page = self.go([eng("a", 13, "Shaddoll Dragon", "DUEA-EN020")], goals=[("Shaddoll", "English")])
        self.ready(page)
        page.evaluate("window.CardVault.openThemeCards('Shaddoll', 'English')")
        page.wait_for_selector(".theme-card")
        text = page.inner_text("#drawerBody")
        self.assertIn("Shaddoll cards", text)
        self.assertIn("Support cards", text)
        self.assertIn("You have 1", text)
        self.assertIn("Never printed in English", text)
        page.locator(".theme-card", has_text="El Shaddoll Winda").locator("[data-th-want]").click()
        page.wait_for_function("window.CardVault.state().wants.length === 1")
        self.assertEqual(page.evaluate("(() => { const w = window.CardVault.state().wants[0]; return [w.productId, w.edition, w.notes]; })()"), [12, "Any", "For Shaddoll"])

    def test_add_the_missing_cards_to_the_want_list_and_undo(self):
        page = self.go([eng("a", 13, "Shaddoll Dragon", "DUEA-EN020")], goals=[("Shaddoll", "English")])
        self.ready(page)
        page.evaluate("window.CardVault.themeAddMissing('English|shaddoll')")
        page.wait_for_function("window.CardVault.state().wants.length === 5")
        self.assertEqual(sorted(page.evaluate("window.CardVault.state().wants.map(w => w.productId)")), [12, 14, 15, 16, 17])
        page.click(".toast button")
        page.wait_for_function("window.CardVault.state().wants.length === 0")

    def test_japanese_missing_cards_go_on_the_want_list_by_number(self):
        page = self.go([], goals=[("Shaddoll", "Japanese")])
        self.ready(page)
        self.status(page, "Shaddoll", "Japanese")
        page.evaluate("window.CardVault.themeAddMissing('Japanese|shaddoll')")
        page.wait_for_function("window.CardVault.state().wants.length === 2")
        self.assertEqual(sorted(page.evaluate("window.CardVault.state().wants.map(w => [w.number, w.productId])")), [["DUEA-JP075", None], ["DUEA-JP099", None]])

    def test_removing_a_goal_and_undo(self):
        page = self.go(goals=[("Shaddoll", "English")])
        page.wait_for_selector("#goalsBar [data-theme-fold]")
        page.evaluate("window.CardVault.removeThemeGoal('English|shaddoll')")
        self.assertEqual(page.evaluate("window.CardVault.themeGoals().length"), 0)
        self.assertTrue(page.evaluate("document.getElementById('goalsBar').hidden"))
        page.click(".toast button")
        page.wait_for_function("window.CardVault.themeGoals().length === 1")

    # ----- where it's offered
    def test_card_search_offers_to_track_an_archetype(self):
        page = self.go()
        page.evaluate("window.CardVault.setTab('search')")
        page.wait_for_selector("#csQ")
        page.fill("#csQ", "Shaddoll")
        page.dispatch_event("#csQ", "input")
        page.wait_for_selector(".theme-hint", timeout=10000)
        self.assertIn("Shaddoll: 6 cards and 1 support card", page.inner_text(".theme-hint"))
        page.click(".theme-hint button")
        page.wait_for_selector("#thQ")
        self.assertEqual(page.input_value("#thQ"), "Shaddoll")

    def test_a_cards_page_offers_its_archetype_and_name(self):
        page = self.go([eng("d", 21, "Dark Magician Girl", "MVP1-EN056")])
        page.evaluate("window.CardVault.openDetails('d')")
        page.wait_for_selector("#themeLinks .link-btn", timeout=10000)
        self.assertEqual(page.locator("#themeLinks .link-btn").all_inner_texts(), ["Dark Magician", "Dark Magician Girl"])

    # ----- keeping it, and devices
    def test_goals_go_in_the_backup_and_merge_across_devices(self):
        page = self.go(goals=[("Shaddoll", "English")])
        self.assertEqual([g["k"] for g in page.evaluate("window.CardVault.backupPayload().settings.themeGoals")], ["Shaddoll"])
        merged = page.evaluate("""(() => { const v = window.CardVault;
            const mine = [{k: 'Shaddoll', l: 'English', t: 100}], theirs = [{k: 'Dark Magician Girl', l: 'Japanese', t: 200}, {k: 'Shaddoll', l: 'English', t: 300, off: 1}];
            return v.mergeThemeGoals(mine, theirs, false).list.filter(g => !g.off).map(g => g.k + '|' + g.l); })()""")
        self.assertEqual(merged, ["Dark Magician Girl|Japanese"])        # (the later removal wins; the other device's goal is added)

    def test_the_list_not_loading_says_so_and_breaks_nothing(self):
        page = self.go(goals=[("Shaddoll", "English")], themes=None)
        page.wait_for_selector("#goalsBar [data-theme-retry]", timeout=10000)
        self.assertIn("Couldn't load the list of cards", page.inner_text("#goalsBar"))


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(Themes)


if __name__ == "__main__":
    unittest.main()
