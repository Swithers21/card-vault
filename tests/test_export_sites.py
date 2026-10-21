"""Taking your cards to other sites: a file for PriceCharting's collection importer, and the want list as a TCGplayer cart.

PriceCharting's CSV importer (pricecharting.com/collection-import-csv, read Oct 18 2026) matches each row by PriceCharting's
product id ("id", required) and reads condition-id (its list: 1 ungraded, 7 Grade 10, 6 Grade 9.5, 5 Grade 9, 2 Grade 8,
8 BGS 10, 20 BGS 10 Black, 17 CGC 10, 19 CGC 10 Pristine, 18 SGC 10...), quantity, cost-basis-in-pennies, notes,
grading-company, grading-cert-id and folder; product-name and console-name are only for reading. It adds every row and
never replaces. TCGplayer's Mass Entry (tcgplayer.com/massentry) reads "2 Card Name [SETCODE]" lines and opens filled in
from ?productline=yugioh&c=line||line, as its own "Buy Deck" links do.

In a real browser against made-up data shaped like the real files and PriceCharting's API.
"""
import csv
import io
import json
import unittest
from urllib.parse import parse_qs, urlsplit

import test_open_window_refresh as data
from test_pricecharting_fix import PriceChartingAPI
from test_sealed_app import SealedBase, SEALED, SINGLE, BOX, tcg

HEADER = ["id", "product-name", "console-name", "condition-id", "quantity", "cost-basis-in-pennies", "notes", "grading-company", "grading-cert-id", "folder"]


def card(rid, number, name="Some Card", grade=None, **more):
    r = {"id": rid, "productId": None, "name": name, "productName": name, "setName": "Some Set", "number": number, "rarity": "Common",
         "edition": "1st Edition", "language": "English", "qty": 1, "quantity": 1, "condition": "Near Mint", "added": "2026-10-01T12:00:00Z"}
    if grade:
        r["grade"] = dict(zip(("company", "grade", "cert"), grade))
    r.update(more)
    return r


# A collection with every kind of card the file meets. "match": the PriceCharting item Card Vault found for it.
RECORDS = [
    (card("raw", "AAA-EN001", "Dark Magician Girl", qty=2, paid=3.5, location="Binder 1", notes="trade bait"), 1001),
    (card("psa", "AAA-EN002", "Blue-Eyes White Dragon", grade=("PSA", "10", "12345678"), paid=120), 1002),
    (card("black", "AAA-EN003", "Ash Blossom", grade=("BGS", "Black Label 10", "0012")), 1003),
    (card("pristine", "AAA-EN004", "Maxx C", grade=("CGC", "Pristine 10", "C-9")), 1004),
    (card("bgs95", "AAA-EN005", "Pot of Greed", grade=("BGS", "9.5", "")), 1005),
    (card("half", "AAA-EN006", "Raigeki", grade=("PSA", "8.5", "")), 1006),
    (card("lp", "AAA-EN007", "Monster Reborn", condition="Lightly Played", location="Box 2"), 1007),
    (card("picked", "AAA-EN008", "Mirror Force", pcId="777"), None),
    (card("korean", "AAA-K009", "Change of Heart", language="Korean"), None),
    (card("marked", "AAA-EN010", "Swords of Revealing Light", pcId="none"), None),
    (dict(card("box", "", "Rarity Collection Booster Box"), sealed=True, productId=BOX, condition="Sealed"), None),
    (card("never", "AAA-EN011", "Graceful Charity"), None),
    (card("miss", "AAA-EN012", "Snatch Steal"), "miss"),
]


class PriceChartingFile(SealedBase):
    def go(self, records=RECORDS, matches=True, routes=None, settings=None):
        local = {"cardvault.v2.settings": json.dumps(dict({"pcToken": "test-key"}, **(settings or {})))}
        page = self.open([r for r, _ in records], local=local, routes=routes)
        if matches:
            seed = {r["id"]: m for r, m in records if m}
            page.evaluate("""(seed) => { const v = window.CardVault, c = v.pcCache();
                for (const r of v.state().collection) { const m = seed[r.id]; if (!m) continue;
                  c[v.pcKey(r)] = m === 'miss' ? {t: Date.now(), p: null, why: 'PriceCharting has no card numbered ' + r.number + '.'}
                    : {t: Date.now(), p: {id: String(m), name: r.name + ' [1st Edition] ' + r.number, set: 'YuGiOh Some Set', vol: 3}}; } }""", seed)
        return page

    def rows(self, page, only_new=False, folders=True):
        text = page.evaluate("([onlyNew, folders]) => { const v = window.CardVault; return v.pcExportText(v.pcExportPlan(onlyNew).rows, folders); }", [only_new, folders])
        self.assertTrue(text.startswith("id,"), "no byte-order mark before the id column")
        got = list(csv.DictReader(io.StringIO(text)))
        return {r["id"]: r for r in got}, text

    def test_the_file_has_priceChartings_columns_and_every_matched_card(self):
        page = self.go()
        rows, text = self.rows(page)
        self.assertEqual(text.splitlines()[0].split(","), HEADER)
        self.assertEqual(sorted(rows), ["1001", "1002", "1003", "1004", "1005", "1006", "1007", "777"])
        raw = rows["1001"]
        self.assertEqual((raw["condition-id"], raw["quantity"], raw["cost-basis-in-pennies"], raw["notes"], raw["folder"], raw["grading-company"]),
                         ("1", "2", "350", "trade bait", "Binder 1", ""))
        self.assertEqual(raw["product-name"], "Dark Magician Girl [1st Edition] AAA-EN001")      # (PriceCharting's own name, for reading)

    def test_grades_are_priceChartings_condition_ids(self):
        rows, _ = self.rows(self.go())
        got = {k: (rows[k]["condition-id"], rows[k]["grading-company"], rows[k]["grading-cert-id"], rows[k]["notes"]) for k in ("1002", "1003", "1004", "1005", "1006")}
        self.assertEqual(got, {"1002": ("7", "PSA", "12345678", ""),          # PSA 10: Grade 10
                               "1003": ("20", "Beckett", "0012", ""),        # BGS 10 Black
                               "1004": ("19", "CGC", "C-9", ""),             # CGC 10 Pristine
                               "1005": ("6", "Beckett", "", ""),             # Grade 9.5
                               "1006": ("2", "PSA", "", "Grade 8.5")})       # (no 8.5 for cards: Grade 8, and the notes say so)
        self.assertEqual(rows["1002"]["cost-basis-in-pennies"], "12000")

    def test_every_grade_maps(self):
        page = self.go(records=[], matches=False)
        got = page.evaluate("""[['PSA','10'],['BGS','10'],['Beckett','Black Label 10'],['CGC','10'],['CGC','Pristine 10'],['SGC','10'],['TAG','10'],['ACE','10'],
            ['PSA','9'],['PSA','8'],['PSA','7'],['PSA','6'],['PSA','5'],['PSA','4'],['PSA','3'],['PSA','2'],['PSA','1'],['Other','10'],['PSA','']]
            .map(([company, grade]) => { const g = window.CardVault.pcGrade({company, grade}); return [g.condition, g.company]; })""")
        self.assertEqual([g[0] for g in got], [7, 8, 20, 17, 19, 18, 21, 22, 5, 2, 3, 16, 15, 14, 13, 10, 9, 7, 1])
        self.assertEqual(got[-2][1], "Other")
        self.assertEqual(page.evaluate("window.CardVault.pcGrade(null)"), {"condition": 1, "company": "", "note": ""})

    def test_played_copies_say_so_in_the_notes(self):
        rows, _ = self.rows(self.go())
        self.assertEqual((rows["1007"]["notes"], rows["1007"]["condition-id"], rows["1007"]["folder"]), ("Lightly Played", "1", "Box 2"))

    def test_folders_can_be_left_out(self):
        rows, _ = self.rows(self.go(), folders=False)
        self.assertEqual({r["folder"] for r in rows.values()}, {""})

    def test_the_rest_are_said_apart_with_why(self):
        page = self.go()
        skipped = page.evaluate("(() => { const s = window.CardVault.pcExportPlan(false).skipped; const o = {}; for (const k in s) o[k] = s[k].map(r => r.id); return o; })()")
        self.assertEqual(skipped, {"unknown": ["never"], "nomatch": ["miss"], "korean": ["korean"], "marked": ["marked"], "sealed": ["box"], "nonumber": []})

    def open_drawer(self, page):
        page.click("#filtersBtn")                                    # (Export is with the filters)
        page.click("#exportMenuBtn")
        page.click("#pcExportBtn")
        page.wait_for_selector("#pcxBody .pcx-sum")
        return page.inner_text("#pcxBody")

    def test_the_drawer_downloads_the_file_and_remembers_it(self):
        page = self.go()
        text = self.open_drawer(page)
        self.assertIn("9 cards ready (8 printings)", text)
        self.assertIn("1 printing not looked up on PriceCharting yet", text)
        self.assertIn("1 printing PriceCharting had no match for", text)
        self.assertIn("1 Korean card: PriceCharting doesn't list Korean cards", text)
        self.assertIn("1 printing you marked as not on PriceCharting", text)
        self.assertIn("1 sealed product", text)
        self.assertIn("Upload the file once", text)
        with page.expect_download() as dl:
            page.click("#pcxGo")
        path = dl.value.path()
        with open(path, encoding="utf-8") as f:
            body = f.read()
        self.assertTrue(dl.value.suggested_filename.startswith("card-vault-for-pricecharting-"))
        self.assertEqual(len(list(csv.DictReader(io.StringIO(body)))), 8)
        # remembered on each card: next time, only what PriceCharting doesn't have yet
        page.wait_for_selector("#pcxBody .notice.good")
        text = page.inner_text("#pcxBody")
        self.assertIn("Saved 9 cards for PriceCharting", text)
        self.assertIn("Nothing new for PriceCharting", text)
        self.assertIn("9 cards already went to PriceCharting", text)
        self.assertTrue(page.is_checked("[name=pcxWhich][value=new]"))
        self.assertTrue(page.is_disabled("#pcxGo"))
        self.assertEqual(page.evaluate("window.CardVault.state().collection.filter(r => r.pcSent).map(r => [r.id, r.pcSent])"),
                         [["raw", 2], ["psa", 1], ["black", 1], ["pristine", 1], ["bgs95", 1], ["half", 1], ["lp", 1], ["picked", 1]])
        # "Everything, again" warns
        page.check("[name=pcxWhich][value=all]")
        self.assertIn("Uploading them again counts them twice", page.inner_text("#pcxBody"))
        page.check("[name=pcxWhich][value=new]")
        # a new card, an extra copy, and the card never looked up (now matched): those and only those
        page.evaluate("""(() => { const v = window.CardVault, c = v.state().collection, r = {id: 'new1', productId: null, name: 'Jinzo', productName: 'Jinzo', setName: 'Some Set',
            number: 'AAA-EN020', rarity: 'Common', edition: '1st Edition', language: 'English', qty: 1, condition: 'Near Mint', added: '2026-01-01T00:00:00Z'};
            c.push(r); v.pcCache()[v.pcKey(r)] = {t: Date.now(), p: {id: '2020', name: 'Jinzo', set: 'YuGiOh Some Set'}};
            c.find(x => x.id === 'raw').qty = 5;
            const never = c.find(x => x.id === 'never'); v.pcCache()[v.pcKey(never)] = {t: Date.now(), p: {id: '3030', name: 'Graceful Charity', set: 'YuGiOh Some Set'}}; })()""")
        page.check("[name=pcxWhich][value=all]")
        page.check("[name=pcxWhich][value=new]")
        self.assertIn("5 cards ready (3 printings)", page.inner_text("#pcxBody"))
        rows, _ = self.rows(page, only_new=True)
        self.assertEqual({k: r["quantity"] for k, r in rows.items()}, {"1001": "3", "2020": "1", "3030": "1"})
        # downloaded, then taken back (it wasn't uploaded): offered again
        with page.expect_download():
            page.click("#pcxGo")
        page.wait_for_selector("#pcxUndo")
        self.assertIn("Nothing new for PriceCharting", page.inner_text("#pcxBody"))
        page.click("#pcxUndo")
        page.wait_for_function("document.querySelector('#pcxBody').innerText.includes('5 cards ready')")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.find(r => r.id === 'raw').pcSent"), 2)

    def test_sent_copies_follow_moves_grading_and_joins(self):
        recs = [(card("a", "AAA-EN030", "Dark Hole", qty=3, pcSent=3, location="Binder 1"), 3001), (card("b", "AAA-EN031", "Raigeki", qty=2, pcSent=1), 3002)]
        page = self.go(records=recs)
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => r.pcSent)"), [3, 1])    # (kept with the card: synced and backed up)
        # 2 of the 3 sent copies moved to another binder: they're still sent
        page.evaluate("window.CardVault.moveCopies([{id: 'a', qty: 2}], 'Binder 2')")
        got = page.evaluate("window.CardVault.state().collection.filter(r => r.name === 'Dark Hole').map(r => [r.location, r.qty, r.pcSent || 0])")
        self.assertEqual(sorted(got), [["Binder 1", 1, 1], ["Binder 2", 2, 2]])
        self.assertEqual(page.evaluate("window.CardVault.pcExportPlan(true).copies"), 1)                   # (Raigeki's unsent copy only)
        # the last one joins them in Binder 2: 3 there, all sent
        page.evaluate("window.CardVault.moveCopies([{id: 'a', qty: 1}], 'Binder 2')")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.filter(r => r.name === 'Dark Hole').map(r => [r.location, r.qty, r.pcSent || 0])"), [["Binder 2", 3, 3]])
        # moving the one not-yet-sent Raigeki and the sent one apart keeps the count
        page.evaluate("window.CardVault.moveCopies([{id: 'b', qty: 1}], 'Box')")
        self.assertEqual(page.evaluate("window.CardVault.pcExportPlan(true).copies"), 1)

    def test_a_reminder_when_cards_arent_on_pricecharting_yet(self):
        # never exported: no reminder
        page = self.go(records=[(card("x", "AAA-EN060", "Jinzo"), 6001)])
        self.assertTrue(page.is_hidden("#pcBanner"))
        # once you keep a collection there: the cards it doesn't have, ready or not looked up yet
        recs = [(card("s", "AAA-EN061", "Sent One", pcSent=1), 6002), (card("n", "AAA-EN062", "New One"), 6003), (card("u", "AAA-EN063", "Not Looked Up"), None),
                (card("k", "AAA-K064", "Korean One", language="Korean"), None)]
        page = self.go(records=recs, settings={"pcExportAt": "2026-10-20T22:00:49.383Z", "pcSentKept": True})
        page.evaluate("window.CardVault.render()")
        page.wait_for_selector("#pcBanner:not([hidden])")
        text = page.inner_text("#pcBanner")
        self.assertIn("2 cards aren't on PriceCharting yet", text)                 # (not the sent one, nor the Korean one)
        self.assertIn("1 of them need looking up there first", text)
        self.assertEqual(page.get_attribute("#pcExportBtn", "data-waiting"), "2")
        page.click("[data-banner=pc-send]")
        page.wait_for_selector("#pcxBody .pcx-sum")
        page.keyboard.press("Escape")
        # "Not now": hidden until more cards wait
        page.click("[data-banner=pc-later]")
        self.assertTrue(page.is_hidden("#pcBanner"))
        page.evaluate("""(() => { const v = window.CardVault, r = {id: 'm', productId: null, name: 'More', productName: 'More', setName: 'Some Set', number: 'AAA-EN065',
            rarity: 'Common', edition: '1st Edition', language: 'English', qty: 1, condition: 'Near Mint', added: '2026-10-22T00:00:00Z'};
            v.state().collection.push(r); v.pcCache()[v.pcKey(r)] = {t: Date.now(), p: {id: '6005', name: 'More', set: 'YuGiOh Some Set'}}; v.render(); })()""")
        page.wait_for_selector("#pcBanner:not([hidden])")
        self.assertIn("3 cards aren't on PriceCharting yet", page.inner_text("#pcBanner"))
        # a device without your PriceCharting key: only the cards matched there count (nothing to look up from here)
        page.evaluate("(() => { window.CardVault.state().settings.pcToken = ''; window.CardVault.render(); })()")
        self.assertEqual(page.evaluate("window.CardVault.pcWaiting()"), {"copies": 2, "ready": 2, "unknown": 0})
        # a card sent from another device, not looked up on this one, isn't counted again
        self.assertEqual(page.evaluate("(() => { window.CardVault.state().settings.pcToken = 'k'; delete window.CardVault.pcCache()[window.CardVault.pcKey(window.CardVault.state().collection[0])]; return window.CardVault.pcWaiting().copies; })()"), 3)

    def test_duplicates_joined_keep_their_sent_copies(self):
        recs = [(card("d1", "AAA-EN050", "Sangan", qty=2, pcSent=1), 5001), (card("d2", "AAA-EN050", "Sangan", qty=1, pcSent=1), 5001)]
        page = self.go(records=recs)
        page.evaluate("window.CardVault.mergeDuplicates()")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => [r.qty, r.pcSent || 0])"), [[3, 2]])
        self.assertEqual(page.evaluate("window.CardVault.pcExportPlan(true).copies"), 1)

    def test_an_export_made_before_cards_remembered_it_counts_as_sent(self):
        recs = [(card("old", "AAA-EN040", "Swords", added="2026-10-01T00:00:00Z", qty=2), 4001),
                (card("later", "AAA-EN041", "Fissure", added="2026-10-25T00:00:00Z"), 4002),
                (card("unmatched", "AAA-EN042", "Sangan", added="2026-10-01T00:00:00Z"), None)]       # (not matched then: not in that file)
        page = self.go(records=recs)
        self.assertTrue(page.evaluate("window.CardVault.state().settings.pcSentKept !== true"))
        page.evaluate("(() => { const s = window.CardVault.state().settings; s.pcExportAt = '2026-10-20T22:00:49.383Z'; return window.CardVault.pcSentFromLastExport(); })()")
        self.assertTrue(page.evaluate("window.CardVault.state().settings.pcSentKept"))
        self.assertEqual(page.evaluate("window.CardVault.pcSentFromLastExport()"), 0)                  # (once)
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => [r.id, r.pcSent || 0])"), [["old", 2], ["later", 0], ["unmatched", 0]])

    def test_cards_never_looked_up_can_be_looked_up_from_here(self):
        api = PriceChartingAPI()
        recs = [(card("o", "RA04-EN078", "Some Other Card"), None), (card("a", "RA04-EN077", "Amphibious Swarmship Amblowhale", rarity="Prismatic Collector's Rare"), None)]
        page = self.go(records=recs, matches=False, routes={"**/www.pricecharting.com/api/**": api})
        text = self.open_drawer(page)
        self.assertIn("2 printings not looked up on PriceCharting yet", text)
        page.click("#pcxLook")
        page.wait_for_function("!window.CardVault.pcx().busy && window.CardVault.pcx().done === 2", timeout=20000)
        text = page.inner_text("#pcxBody")
        self.assertIn("1 card ready (1 printing)", text)
        self.assertIn("1 printing PriceCharting had no match for", text)
        rows, _ = self.rows(page)
        self.assertEqual(list(rows), ["9004"])

    def test_settings_graded_values_has_it_too(self):
        page = self.go()
        page.evaluate("window.CardVault.openSettings({section: 'graded'})")
        page.click("[data-pc-export]")
        page.wait_for_selector("#pcxBody .pcx-sum")
        self.assertIn("9 cards ready", page.inner_text("#pcxBody"))

    def test_without_a_key_it_says_where_to_put_one(self):
        page = self.go(records=[(card("never", "AAA-EN011"), None)], matches=False, settings={"pcToken": ""})
        text = self.open_drawer(page)
        self.assertIn("Card Vault needs your PriceCharting key", text)
        self.assertEqual(page.locator("#pcxLook").count(), 0)


# ----- the want list, as a TCGplayer cart
BEWD = [1002, 1, "Blue-Eyes White Dragon (Secret)", "MT26-EN001", 0, [0, 5.0, 4.0, 5.0, 5.0, 5.0], 0]


def want(wid, pid, name, qty=1, target=None, edition="Any", number="", kind=None):
    w = {"id": wid, "productId": pid, "name": name, "productName": name, "setName": "", "number": number, "rarity": "", "edition": edition,
         "target": target, "qty": qty, "notes": "", "added": "2026-10-01T00:00:00Z"}
    if kind:
        w["kind"] = kind
    return w


WANTS = [want("w1", 1001, "Test Card", qty=2, target=30),                    # $25: at or below target
         want("w2", 1002, "Blue-Eyes White Dragon", edition="1st Edition", target=1),
         want("w3", 1002, "Blue-Eyes White Dragon", qty=2),                 # (same card again: added up)
         want("w4", None, "El Shaddoll Winda", number="DUEA-JP099"),          # Japanese
         want("w5", BOX, "Rarity Collection Booster Box", kind="box"),
         want("w6", None, "Some Hand-Typed Card")]


class TcgplayerCart(SealedBase):
    def go(self, wants=WANTS):
        page = self.open(wants=wants, files={"tcgplayer-data.js": tcg(SEALED + [SINGLE, BEWD])})
        page.wait_for_function("!!window.CardVault.state && window.CardVault.tcgCartPlan(false).lines.length > 0", timeout=15000)
        return page

    def test_the_lines_are_mass_entrys_format(self):
        page = self.go()
        plan = page.evaluate("window.CardVault.tcgCartPlan(false)")
        self.assertEqual(plan["lines"], ["2 Test Card [RA01]", "3 Blue-Eyes White Dragon [MT26]"])
        self.assertEqual((len(plan["left"]["away"]), len(plan["left"]["sealed"]), len(plan["left"]["unmatched"]), plan["picky"], plan["hits"]), (1, 1, 1, 1, 1))
        url = page.evaluate("window.CardVault.tcgCartURL(window.CardVault.tcgCartPlan(false).lines)")
        u = urlsplit(url)
        self.assertEqual((u.scheme, u.netloc, u.path), ("https", "www.tcgplayer.com", "/massentry"))
        q = parse_qs(u.query)
        self.assertEqual(q["productline"], ["yugioh"])
        self.assertEqual(q["c"], ["2 Test Card [RA01]||3 Blue-Eyes White Dragon [MT26]"])

    def test_the_want_list_button_opens_it(self):
        page = self.go()
        page.evaluate("window.CardVault.setTab('wants')")
        page.click("[data-want-action=tcg-cart]")
        page.wait_for_selector("#tcgxList")
        self.assertEqual(page.input_value("#tcgxList"), "2 Test Card [RA01]\n3 Blue-Eyes White Dragon [MT26]")
        text = page.inner_text("#tcgxBody")
        self.assertIn("5 cards for TCGplayer", text)
        self.assertIn("Left out: 1 Japanese or Korean card (TCGplayer doesn't sell them); 1 sealed product (Mass Entry is for single cards); 1 card not matched to a TCGplayer card.", text)
        self.assertIn("1 card on your list is for one printing", text)
        self.assertIn("Nothing is bought until you check out yourself", text)
        href = page.get_attribute("#tcgxOpen", "href")
        self.assertTrue(href.startswith("https://www.tcgplayer.com/massentry?productline=yugioh&c="))
        self.assertEqual(page.get_attribute("#tcgxOpen", "target"), "_blank")
        # only the ones at or below target
        page.check("[name=tcgxWhich][value=hits]")
        self.assertEqual(page.input_value("#tcgxList"), "2 Test Card [RA01]")

    def test_no_button_without_tcgplayer_cards(self):
        page = self.go(wants=WANTS[:1])
        page.evaluate("window.CardVault.setTab('wants')")
        page.wait_for_selector("[data-want-action=tcg-cart]")
        page2 = self.open(wants=[WANTS[3]])
        page2.evaluate("window.CardVault.setTab('wants')")
        page2.wait_for_selector("[data-want-action=add]")
        self.assertEqual(page2.locator("[data-want-action=tcg-cart]").count(), 0)


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for case in (PriceChartingFile, TcgplayerCart):
        suite.addTests(loader.loadTestsFromTestCase(case))
    return suite


if __name__ == "__main__":
    unittest.main()
