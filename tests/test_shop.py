"""The shop: sales brought in from SortSwift's orders (or a TCGplayer order export), matched to your cards, the copies
sent to SortSwift taken out first, each sale logged with its price and fees, never twice; and the shop's money by
month. In a real browser, with the made-up set in test_binders.
"""
import json
import unittest

import test_binders as tb
from test_sealed_app import SealedBase

R = tb.rec
RECORDS = [R("a", 13, "Chaos Dragon", "CORI-EN001", qty=2, location="Shelf 1", paid=0.05),
           R("b", 13, "Chaos Dragon", "CORI-EN001", qty=3, location="SortSwift box", ssSent=2, paid=0.10),
           R("c", 15, "Dark Spell", "CORI-EN002", qty=1, condition="Lightly Played", location="Shelf 2"),
           R("d", 21, "Other Card", "SOME-EN001", qty=1, location="Shelf 2", sell={"price": 2.5, "qty": None})]

HEAD = "Order Number,Order Date,Channel,Product Name,Set Name,Card Number,Rarity,Condition,Printing,Language,Quantity,Price,Fees,Customer Name,Status\n"
ORDERS = HEAD + (
    "1001,10/14/2026 3:22 PM,TCGplayer,Chaos Dragon,Chaos Origins,CORI-EN001,Common,Near Mint,1st Edition,English,3,$0.50,0.30,Jane Buyer,Completed\n"
    "1001,10/14/2026 3:22 PM,TCGplayer,Dark Spell,Chaos Origins,CORI-EN002,Common,Near Mint,1st Edition,English,1,0.40,0.10,Jane Buyer,Completed\n"
    "1002,2026-10-15,eBay,Magician of Dark Chaos,Chaos Origins,CORI-EN027,Secret Rare,NM,1st Edition,EN,1,12.00,1.80,Bob Bidder,Shipped\n"
    "1003,2026-10-16,eBay,Other Card,Some Other Set,SOME-EN001,Common,NM,1st Edition,EN,1,2.00,0.40,Al,Cancelled\n"
    "1004,2026-10-16,TCGplayer,Chaos Dragon (Quarter Century Secret Rare),Chaos Origins,CORI-EN001,Quarter Century Secret Rare,Near Mint,1st Edition,English,1,31.00,4.00,Zed,Completed\n")


class SortSwiftSales(SealedBase):
    def go(self, records=RECORDS):
        page = self.open(records, files={"tcgplayer-data.js": tb.tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def plan(self, page, text, **opts):
        return page.evaluate("([t, o]) => { const p = window.CardVault.ssSalesPlan(t, o); return p.error ? p : {lines: p.lines.map(x => ({state: x.state, why: x.why, date: x.date, qty: x.qty, price: x.price, fees: x.fees, "
                             "feesFrom: x.feesFrom, pid: x.rec && x.rec.productId, takes: x.takes, short: x.short})), fileFees: p.fileFees, cols: p.cols}; }", [text, opts])

    def test_each_line_finds_its_cards(self):
        page = self.go()
        p = self.plan(page, ORDERS)
        L = p["lines"]
        self.assertEqual([x["state"] for x in L], ["new", "new", "new", "off", "new"])
        self.assertEqual([x["pid"] for x in L], [13, 15, 11, 21, 14])
        self.assertEqual([x["date"] for x in L], ["2026-10-14", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-16"])
        # (the copies sent to SortSwift first: all three from b, two of them sent)
        self.assertEqual(L[0]["takes"], [{"id": "b", "n": 3, "ss": 2, "cond": False}])
        # (a played copy in Card Vault: the closest there is)
        self.assertEqual(L[1]["takes"], [{"id": "c", "n": 1, "ss": 0, "cond": True}])
        self.assertEqual((L[2]["takes"], L[2]["short"]), ([], 1))
        self.assertEqual((L[0]["price"], L[0]["fees"], L[0]["feesFrom"]), (0.5, 0.3, "file"))
        self.assertTrue(p["fileFees"])
        self.assertNotIn("Customer Name", p["cols"])

    def test_brought_in_once(self):
        page = self.go()
        res = page.evaluate("(t) => { const v = window.CardVault, r = v.ssSalesApply(v.ssSalesPlan(t), {missing: true}); delete r.undo; return r; }", ORDERS)
        self.assertEqual(res, {"sales": 4, "copies": 6, "out": 4, "missing": 2, "gross": 44.9})
        left = page.evaluate("window.CardVault.state().collection.map(r => [r.id, r.qty])")
        self.assertEqual(left, [["a", 2], ["d", 1]])
        sales = page.evaluate("window.CardVault.state().sales")
        self.assertEqual(sorted((s["productId"], s["qty"], s["price"], s["fees"], s["date"]) for s in sales),
                         [(11, 1, 12, 1.8, "2026-10-15"), (13, 3, 0.5, 0.3, "2026-10-14"), (14, 1, 31, 4, "2026-10-16"), (15, 1, 0.4, 0.1, "2026-10-14")])
        dragon = next(s for s in sales if s["productId"] == 13)
        self.assertEqual((dragon["paid"], dragon["notes"]), (0.1, "SortSwift (TCGplayer), order 1001"))
        self.assertNotIn("Jane", json.dumps(sales))                                  # (buyers' names aren't kept)
        self.assertEqual(page.evaluate("window.CardVault.changesList()[0].label"), "Sold 4 cards (SortSwift orders)")
        # the same file again, and a later one that overlaps it: only what's new
        p = self.plan(page, ORDERS)
        self.assertEqual([x["state"] for x in p["lines"]], ["done", "done", "done", "off", "done"])
        later = ORDERS + "1005,2026-10-18,eBay,Other Card,Some Other Set,SOME-EN001,Common,NM,1st Edition,EN,1,2.75,0.45,Al,Completed\n"
        p = self.plan(page, later)
        self.assertEqual([x["state"] for x in p["lines"]], ["done", "done", "done", "off", "done", "new"])
        self.assertEqual(p["lines"][5]["takes"], [{"id": "d", "n": 1, "ss": 0, "cond": False}])

    def test_undo_and_without_the_missing_ones(self):
        page = self.go()
        res = page.evaluate("(t) => { const v = window.CardVault; window.r = v.ssSalesApply(v.ssSalesPlan(t), {missing: false}); return [r.sales, r.missing]; }", ORDERS)
        self.assertEqual(res, [2, 0])
        page.evaluate("window.r.undo()")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => [r.id, r.qty, r.ssSent || 0])"), [["a", 2, 0], ["b", 3, 2], ["c", 1, 0], ["d", 1, 0]])
        self.assertEqual(page.evaluate("window.CardVault.state().sales.length"), 0)

    def test_other_files(self):
        page = self.go()
        # a TCGplayer order export: the printing in the condition, a line total, no fees (from Settings: 13% + $0.30 a card)
        tcg = ("Order #,Order Date,Product Name,Set Name,Number,Rarity,Condition,Quantity,Total,Buyer Name\n"
               "77,2026-10-20T03:10:00Z,Chaos Dragon,Chaos Origins,CORI-EN001,Common,Near Mint 1st Edition,2,$20.00,Pat\n")
        p = self.plan(page, tcg)
        x = p["lines"][0]
        self.assertEqual((x["state"], x["pid"], x["qty"], x["price"], x["fees"], x["feesFrom"]), ("new", 13, 2, 10, 3.2, "settings"))
        self.assertEqual(x["takes"][0]["id"], "b")
        self.assertEqual(self.plan(page, tcg, estimate=False)["lines"][0]["fees"], 0)
        # (two of b's three go, both of the two sent to SortSwift: one left, none sent)
        page.evaluate("(t) => { const v = window.CardVault; v.ssSalesApply(v.ssSalesPlan(t)); }", tcg)
        self.assertEqual(page.evaluate("(({qty, ssSent}) => [qty, ssSent || 0])(window.CardVault.state().collection.find(r => r.id === 'b'))"), [1, 0])
        self.assertEqual(page.evaluate("window.CardVault.state().sales[0].fees"), 3.2)
        self.assertIn("price", self.plan(page, "Order Number,Product Name,Quantity\n1,Chaos Dragon,1\n")["error"])
        self.assertIn("card name", self.plan(page, "Order Number,Price\n1,2.00\n")["error"])
        self.assertEqual(page.evaluate("['10/14/26', 'Oct 14, 2026', '2026-10-14'].map(window.CardVault.saleDay)"), ["2026-10-14", "2026-10-14", "2026-10-14"])

    def test_from_the_sales_log(self):
        page = self.go()
        page.evaluate("window.CardVault.setTab('sales')")
        page.click('[data-salesview="log"]')
        page.click("#salesImportSs")
        page.wait_for_selector("#ssoFile", state="attached")
        page.set_input_files("#ssoFile", files=[{"name": "orders.csv", "mimeType": "text/csv", "buffer": ORDERS.encode()}])
        page.wait_for_selector("#ssoGo")
        text = page.inner_text("#ssoBody")
        self.assertIn("6 cards sold for $44.90", text)
        self.assertIn("4 cards come out of your collection, 2 sent to SortSwift.", text)
        self.assertIn("2 cards aren't in Card Vault.", text)
        self.assertIn("1 cancelled or refunded line left out.", text)
        self.assertIn("1 from Shelf 2 (Lightly Played in Card Vault)", text)
        page.click("#ssoGo")
        page.wait_for_selector("#ssoUndo")
        self.assertIn("Recorded 4 sales (6 cards, $44.90)", page.inner_text("#ssoBody"))
        page.click("#ssoLog")
        page.wait_for_function("document.querySelectorAll('#salesBody .sale-row, #salesBody tbody tr').length > 0 || document.getElementById('salesBody').innerText.includes('Chaos Dragon')")
        page.evaluate("window.CardVault.openSsSales()")
        page.set_input_files("#ssoFile", files=[{"name": "orders.csv", "mimeType": "text/csv", "buffer": ORDERS.encode()}])
        page.wait_for_selector("#ssoGo")
        self.assertIn("Nothing new to bring in", page.inner_text("#ssoBody"))
        self.assertTrue(page.is_disabled("#ssoGo"))
        # (and from the SortSwift export)
        page.keyboard.press("Escape")
        page.evaluate("window.CardVault.openSsExport()")
        page.click("#ssxSales")
        page.wait_for_function("document.getElementById('drawerTitle').textContent === 'Sales from SortSwift'")


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for c in (SortSwiftSales,):
        suite.addTests(loader.loadTestsFromTestCase(c))
    return suite


if __name__ == "__main__":
    unittest.main()
