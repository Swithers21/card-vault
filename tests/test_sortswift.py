"""SortSwift, the shop software: cards going from Card Vault to SortSwift's inventory import, and SortSwift's own files
(its inventory export and its scan lists) coming into Card Vault with Import CSV.

SortSwift's docs (sortswift.com/docs, read Oct 25 2026; marked "in progress"): its import takes TCGplayer identifiers,
skuId, or productId with condition (NM, LP, MP, HP, DMG), language (EN, JP, FR…) and printing, plus quantity; price, cost,
comment and remarks are optional. Its inventory export can have productId, skuId, Product Name, Set, Collector Number,
Game, Quantity, Reserved, Location, Remarks, Cost, Price, Condition, Language and Printing Type; its scan lists Card Name,
Set, Set Code, Condition, Language, Foil/Printing, Quantity, Price and Total Value.

In a real browser against made-up data shaped like the real files.
"""
import csv
import io
import unittest

import test_open_window_refresh as data
from test_sealed_app import SealedBase, BUILT

HEADER = ["productId", "condition", "language", "printing", "quantity", "price", "cost"]
GROUPS = [[1, "Legend of Blue Eyes White Dragon", "LOB", "2002-03-08"], [2, "Maximum Gold", "MAGO", "2020-11-13"], [3, "Tournament Pack", "TU01", "2009-01-01"]]
SUBTYPES = ["Normal", "1st Edition", "Unlimited"]
RARITIES = ["Ultra Rare", "Rare", "Common"]


def prices(*pairs):
    out = []
    for sub, market in pairs:
        out += [SUBTYPES.index(sub), market, market, market, market, market]
    return out


# [id, set, name, number, rarity, prices, sealed]
PRODUCTS = [[1001, 0, "Blue-Eyes White Dragon", "LOB-EN001", 0, prices(("1st Edition", 500.0), ("Unlimited", 60.0)), 0],
            [1002, 0, "Dark Magician", "LOB-EN005", 0, prices(("1st Edition", 200.0), ("Unlimited", 40.0)), 0],
            [1003, 1, "Dark Magician", "MAGO-EN002", 1, prices(("1st Edition", 3.0)), 0],
            [1004, 2, "Mystical Space Typhoon", "TU01-EN000", 2, prices(("Normal", 5.0)), 0],
            [1005, 0, "Legend of Blue Eyes White Dragon Booster Box", "", 2, prices(("Normal", 9000.0)), 1]]


def tcg():
    return data.js("TCG_DATA", {"format": 4, "generated": BUILT, "builtAt": BUILT, "groups": GROUPS, "rarities": RARITIES, "subtypes": SUBTYPES,
                                "products": PRODUCTS, "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


def rec(rid, pid, name, number, edition="1st Edition", qty=1, **more):
    r = {"id": rid, "productId": pid, "name": name, "productName": name, "setName": "Legend of Blue Eyes White Dragon", "number": number, "rarity": "Ultra Rare",
         "edition": edition, "language": "English", "qty": qty, "quantity": qty, "condition": "Near Mint", "added": "2026-10-01T12:00:00Z"}
    r.update(more)
    return r


RECORDS = [rec("bewd", 1001, "Blue-Eyes White Dragon", "LOB-EN001", qty=2, paid=300),
           rec("dm1", 1002, "Dark Magician", "LOB-EN005", "Unlimited", condition="Lightly Played", paid=20, location="Binder 1"),
           rec("dm2", 1002, "Dark Magician", "LOB-EN005", "Unlimited", condition="Lightly Played", paid=30, location="Binder 2"),   # (goes with dm1)
           rec("mst", 1004, "Mystical Space Typhoon", "TU01-EN000", "No edition mark", language="French"),
           rec("mago", 1003, "Dark Magician", "MAGO-EN002", ""),                       # (no printing set, but the card has only one)
           rec("which", 1001, "Blue-Eyes White Dragon", "LOB-EN001", ""),              # (no printing set, and it has two)
           rec("jp", None, "ブラック・マジシャン", "LOB-JP005", "", language="Japanese"),
           rec("psa", 1001, "Blue-Eyes White Dragon", "LOB-EN001", grade={"company": "PSA", "grade": "9", "cert": "1"}),
           dict(rec("box", 1005, "Legend of Blue Eyes White Dragon Booster Box", "", ""), sealed=True, condition="Sealed"),
           rec("loose", None, "Some Card", "XXX-EN001")]


class SortSwiftExport(SealedBase):
    def go(self, records=RECORDS):
        page = self.open(records, files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def file(self, page, src="all", only_new=False, price=True):
        text = page.evaluate("([src, onlyNew, price]) => { const v = window.CardVault; return v.ssExportText(v.ssExportPlan(src, onlyNew, price).rows); }", [src, only_new, price])
        self.assertTrue(text.startswith("productId,"), "no byte-order mark before the first column")
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(list(rows[0].keys()) if rows else HEADER, HEADER)
        return rows

    def test_each_card_goes_as_its_tcgplayer_printing(self):
        page = self.go()
        lp = page.evaluate("(() => { const v = window.CardVault; return Math.round(v.marketValue(v.state().collection.find(r => r.id === 'dm1')).unit * 100) / 100; })()")
        rows = self.file(page)
        self.assertEqual([[r[h] for h in HEADER] for r in rows], [
            ["1001", "NM", "EN", "1st Edition", "2", "500.00", "300.00"],
            ["1002", "LP", "EN", "Unlimited", "2", "%.2f" % lp, "25.00"],      # (two entries of the same card: together, the cost averaged)
            ["1004", "NM", "FR", "Normal", "1", "5.00", ""],                   # (no edition mark: TCGplayer's "Normal"; French)
            ["1003", "NM", "EN", "1st Edition", "1", "3.00", ""]])             # (its only printing)

    def test_the_printing_you_set_wins(self):
        # (no edition mark on a card whose TCGplayer prices list only its 1st Edition: still "Normal", as you said)
        page = self.go([rec("x", 1003, "Dark Magician", "MAGO-EN002", "No edition mark")])
        self.assertEqual([r["printing"] for r in self.file(page)], ["Normal"])

    def test_the_ones_left_out_say_why(self):
        page = self.go()
        sk = page.evaluate("(() => { const s = window.CardVault.ssExportPlan('all', false, true).skipped; return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.map(r => r.id)])); })()")
        self.assertEqual(sk, {"ocg": ["jp"], "nomatch": ["loose"], "printing": ["which"], "graded": ["psa"], "away": [], "sealed": ["box"]})
        page.evaluate("window.CardVault.openSsExport({from: 'all'})")
        page.wait_for_selector("#ssxSum")
        text = page.inner_text("#ssxBody")
        for bit in ("6 cards ready (4 rows)", "1 Japanese or Korean card", "1 card without a printing", "1 graded card", "1 sealed product",
                    "1 card not linked to a TCGplayer printing", "Direct Import"):
            self.assertIn(bit, text)

    def test_prices_are_the_asking_price_then_the_market_or_none(self):
        page = self.go()
        page.evaluate("(() => { const r = window.CardVault.state().collection.find(r => r.id === 'bewd'); r.sell = {price: 650, qty: 1, since: '2026-10-20T00:00:00Z'}; })()")
        rows = self.file(page)
        self.assertEqual(rows[0]["price"], "650.00")
        self.assertEqual({r["price"] for r in self.file(page, price=False)}, {""})       # (SortSwift's own pricing rules)

    def test_the_sell_list_sends_as_many_as_you_said_to_sell(self):
        page = self.go()
        page.evaluate("""(() => { const c = window.CardVault.state().collection;
            c.find(r => r.id === 'bewd').sell = {price: null, qty: 1, since: '2026-10-20T00:00:00Z'}; c.find(r => r.id === 'mst').sell = {price: 7.5, qty: null, since: '2026-10-20T00:00:00Z'}; })()""")
        rows = self.file(page, src="sell")
        self.assertEqual([(r["productId"], r["quantity"], r["price"]) for r in rows], [("1001", "1", "500.00"), ("1004", "1", "7.50")])
        # from the Selling page's button
        page.evaluate("(() => { const v = window.CardVault; v.state().settings.salesView = 'selling'; v.save(); v.setTab('sales'); })()")
        page.click("[data-sell-act=sortswift]")
        page.wait_for_selector("#ssxSum")
        self.assertTrue(page.is_checked("[name=ssxFrom][value=sell]"))
        self.assertIn("2 cards ready", page.inner_text("#ssxSum"))

    def test_the_selected_cards(self):
        page = self.go()
        page.evaluate("window.CardVault.openSsExport({ids: ['mst', 'mago']})")
        page.wait_for_selector("#ssxSum")
        self.assertTrue(page.is_checked("[name=ssxFrom][value=selected]"))
        self.assertIn("2 cards ready (2 rows)", page.inner_text("#ssxSum"))
        page.check("[name=ssxFrom][value=all]")
        self.assertIn("6 cards ready", page.inner_text("#ssxSum"))

    def test_downloaded_once_then_only_the_rest_and_take_it_back(self):
        page = self.go()
        page.evaluate("window.CardVault.openSsExport({from: 'all'})")
        page.wait_for_selector("#ssxSum")
        with page.expect_download() as dl:
            page.click("#ssxGo")
        self.assertTrue(dl.value.suggested_filename.startswith("card-vault-for-sortswift-"))
        with open(dl.value.path(), encoding="utf-8") as f:
            self.assertEqual(len(list(csv.DictReader(f))), 4)
        page.wait_for_selector("#ssxBody .notice.good")
        text = page.inner_text("#ssxBody")
        self.assertIn("Saved 6 cards for SortSwift", text)
        self.assertIn("Nothing new for SortSwift", text)
        self.assertIn("6 cards of these already went to SortSwift", text)
        self.assertTrue(page.is_disabled("#ssxGo"))
        self.assertEqual(page.evaluate("window.CardVault.state().collection.filter(r => r.ssSent).map(r => [r.id, r.ssSent])"),
                         [["bewd", 2], ["dm1", 1], ["dm2", 1], ["mst", 1], ["mago", 1]])
        # an extra copy: only that one next time; everything again warns
        page.evaluate("window.CardVault.state().collection.find(r => r.id === 'bewd').qty = 3")
        self.assertEqual([(r["productId"], r["quantity"]) for r in self.file(page, only_new=True)], [("1001", "1")])
        page.check("[name=ssxWhich][value=all]")
        self.assertIn("Importing them again may add them twice", page.inner_text("#ssxBody"))
        page.check("[name=ssxWhich][value=new]")
        # taken back (it wasn't imported): offered again
        page.click("#ssxUndo")
        page.wait_for_function("document.querySelector('#ssxSum').innerText.includes('7 cards ready')")
        self.assertIsNone(page.evaluate("window.CardVault.state().collection.find(r => r.id === 'bewd').ssSent || null"))

    def test_sent_copies_follow_moves_and_sales(self):
        page = self.go([rec("a", 1001, "Blue-Eyes White Dragon", "LOB-EN001", qty=3, ssSent=3, location="Binder 1"),
                        rec("b", 1002, "Dark Magician", "LOB-EN005", qty=2, ssSent=1)])
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => r.ssSent)"), [3, 1])    # (kept with the card)
        page.evaluate("window.CardVault.moveCopies([{id: 'a', qty: 2}], 'Binder 2')")
        got = page.evaluate("window.CardVault.state().collection.filter(r => r.productId === 1001).map(r => [r.location, r.qty, r.ssSent || 0])")
        self.assertEqual(sorted(got), [["Binder 1", 1, 1], ["Binder 2", 2, 2]])
        self.assertEqual(page.evaluate("window.CardVault.ssExportPlan('all', true, true).copies"), 1)          # (Dark Magician's unsent copy)
        # one sold: it was one of the copies in SortSwift
        page.evaluate("(() => { const v = window.CardVault, r = v.state().collection.find(x => x.id === 'b'); v.recordSale(r, {qty: 1, price: 50, fees: 0, date: '2026-10-25', notes: ''}); })()")
        self.assertEqual(page.evaluate("[window.CardVault.state().collection.find(r => r.id === 'b').qty, window.CardVault.state().collection.find(r => r.id === 'b').ssSent || 0]"), [1, 0])
        self.assertEqual(page.evaluate("window.CardVault.ssExportPlan('all', true, true).copies"), 1)

    def test_it_is_on_the_export_menu(self):
        page = self.go()
        page.click("#filtersBtn")
        page.click("#exportMenuBtn")
        page.click("#ssExportBtn")
        page.wait_for_selector("#ssxSum")
        self.assertIn("Export for SortSwift", page.inner_text("#drawer"))
        self.assertTrue(page.is_checked("[name=ssxFrom][value=all]"))      # (nothing selected, no sell list)
        self.assertEqual(page.locator("[name=ssxFrom]").count(), 1)


SS_INVENTORY = ("productId,skuId,Product Name,Set,Collector Number,Game,Quantity,Reserved,Location,Remarks,Cost,Price,Condition,Language,Printing Type\r\n"
                "1001,5550001,Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,LOB-EN001,Yu-Gi-Oh!,2,0,Shop shelf A,from the Friday lot,250.00,549.99,LP,EN,1st Edition\r\n"
                "1004,5550002,Mystical Space Typhoon,Tournament Pack,TU01-EN000,YuGiOh,1,0,,,1.00,6.00,NM,FR,Normal\r\n"
                "99999,5550003,Lightning Bolt,Alpha,161,Magic: The Gathering,4,0,,,0.50,1.00,NM,EN,Normal\r\n")
SS_SCAN = ("Card Name,Set,Set Code,Condition,Language,Foil/Printing,Quantity,Price,Total Value\r\n"
           "Blue-Eyes White Dragon,Legend of Blue Eyes White Dragon,LOB-EN001,NM,EN,Unlimited,1,60.00,60.00\r\n"
           "Dark Magician,Maximum Gold,MAGO,NM,EN,Foil,2,3.00,6.00\r\n"
           "Dark Magician,,,NM,EN,Normal,1,40.00,40.00\r\n"
           "Dark Magician,Maximum Gold,MAGO,NM,JP,Normal,1,10.00,10.00\r\n")       # (a Japanese copy: not the English printing)


class SortSwiftImport(SealedBase):
    def analyze(self, page, text, name="sortswift.csv"):
        return page.evaluate("""([text, name]) => { const a = window.CardVault.analyzeCSV(text, name);
            return {sortswift: a.isSortSwift, tcg: a.isTCG, skipped: a.skipped, recs: a.records.map(r => ({pid: r.productId, name: r.name, number: r.number, edition: r.edition,
              condition: r.condition, language: r.language, qty: r.qty, paid: r.paid, location: r.location, notes: r.notes}))}; }""", [text, name])

    def go(self):
        page = self.open([], files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def test_its_inventory_export(self):
        page = self.go()
        got = self.analyze(page, SS_INVENTORY)
        self.assertTrue(got["sortswift"])
        self.assertFalse(got["tcg"])
        self.assertEqual(got["skipped"], {"not Yu-Gi-Oh! (Magic: The Gathering)": 1})
        self.assertEqual(got["recs"], [
            {"pid": 1001, "name": "Blue-Eyes White Dragon", "number": "LOB-EN001", "edition": "1st Edition", "condition": "Lightly Played", "language": "English",
             "qty": 2, "paid": 250, "location": "Shop shelf A", "notes": "from the Friday lot"},
            {"pid": 1004, "name": "Mystical Space Typhoon", "number": "TU01-EN000", "edition": "No edition mark", "condition": "Near Mint", "language": "French",
             "qty": 1, "paid": 1, "location": "", "notes": ""}])
        # the import window says where it's from
        page.evaluate("(text) => window.CardVault.openImport(window.CardVault.analyzeCSV(text, 'inventory.csv'))", SS_INVENTORY)
        page.wait_for_selector("#importModal:not([hidden])")
        self.assertEqual(page.inner_text("#importTitle"), "Import from SortSwift")

    def test_its_scan_list(self):
        page = self.go()
        got = self.analyze(page, SS_SCAN, "scan.csv")
        self.assertTrue(got["sortswift"])
        recs = got["recs"]
        # by card number
        self.assertEqual((recs[0]["pid"], recs[0]["edition"], recs[0]["qty"]), (1001, "Unlimited", 1))
        # the set's code, not a card number: by the name in that set; "Foil" isn't a printing it has, so its only one
        self.assertEqual((recs[1]["pid"], recs[1]["number"], recs[1]["edition"], recs[1]["qty"]), (1003, "MAGO-EN002", "1st Edition", 2))
        # a name with two printings and no set to tell them apart: not guessed
        self.assertIsNone(recs[2]["pid"])
        self.assertEqual(recs[2]["name"], "Dark Magician")
        # a Japanese card is never matched to an English printing by name
        self.assertIsNone(recs[3]["pid"])
        self.assertEqual(recs[3]["language"], "Japanese")

    def test_a_card_vault_file_for_sortswift_reads_back_the_same(self):
        page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        text = page.evaluate("(() => { const v = window.CardVault; return v.ssExportText(v.ssExportPlan('all', false, true).rows); })()")
        got = self.analyze(page, text)
        self.assertEqual([(r["pid"], r["edition"], r["condition"], r["language"], r["qty"], r["paid"]) for r in got["recs"]], [
            (1001, "1st Edition", "Near Mint", "English", 2, 300), (1002, "Unlimited", "Lightly Played", "English", 2, 25),
            (1004, "No edition mark", "Near Mint", "French", 1, None), (1003, "1st Edition", "Near Mint", "English", 1, None)])


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(SortSwiftExport))
    suite.addTests(loader.loadTestsFromTestCase(SortSwiftImport))
    return suite


if __name__ == "__main__":
    unittest.main()
