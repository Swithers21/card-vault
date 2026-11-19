"""For finishing master sets: the binder as its pages (pockets in a grid, gaps faded, turned by swipe, arrows or the
keyboard), show mode (scan or type a card at a show: does it fill a gap in a binder, do you have it, is their price
fair, add it at that price), and binders kept in the backup and synced between devices like set goals.
In a real browser, with the made-up set in test_binders.
"""
import json
import unittest

import test_binders as tb
from test_sealed_app import SealedBase

BINDER = tb.BINDER


class BinderPages(SealedBase):
    def go(self, records=tb.RECORDS, pockets=9):
        page = self.open(records, files={"tcgplayer-data.js": tb.tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        page.evaluate("window.CardVault.openBinder(1)")
        page.wait_for_selector("#bxPockets")
        if pockets != 9:
            page.select_option("#bxPockets", str(pockets))
        page.click('[data-bx-view="pages"]')
        page.wait_for_selector(".bx-sheet")
        return page

    def pockets(self, page):
        return page.evaluate("[...document.querySelectorAll('.bx-sheet .bx-pocket')].map(x => [...x.classList].filter(c => c !== 'bx-pocket').join(' ') + ':' + (x.dataset.bxOpen || ''))")

    def test_one_page_of_nine(self):
        page = self.go()
        # (number order, the commonest rarity first, the token last; then three empty pockets)
        self.assertEqual(self.pockets(page), ["bx-move:13", "bx-need:14", "bx-in:15", "bx-kept:12", "bx-kept:11", "bx-move:17", "bx-empty:", "bx-empty:", "bx-empty:"])
        self.assertIn("Page 1 of 1", page.inner_text(".bx-pager"))
        self.assertIn("1 of 6 in", page.inner_text(".bx-pager"))
        self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.bx-sheet')).gridTemplateColumns.split(' ').length"), 3)
        self.assertIn("Needed", page.inner_text('[data-bx-open="14"]'))
        self.assertIn("To put in", page.inner_text('[data-bx-open="13"]'))
        self.assertNotIn("Needed", page.inner_text('[data-bx-open="15"]'))      # (in the binder: just its picture)

    def test_pages_of_four_turned_by_arrows_keys_and_swipes(self):
        page = self.go(pockets=4)
        self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.bx-sheet')).gridTemplateColumns.split(' ').length"), 2)
        self.assertEqual(len(self.pockets(page)), 4)
        self.assertTrue(page.is_disabled('[data-bx-turn="-1"]'))
        page.click('[data-bx-turn="1"]')
        self.assertIn("Page 2 of 2", page.inner_text(".bx-pager"))
        self.assertEqual(self.pockets(page), ["bx-kept:11", "bx-move:17", "bx-empty:", "bx-empty:"])
        page.focus(".bx-sheet")
        page.keyboard.press("ArrowLeft")
        page.wait_for_function("document.querySelector('.bx-pager').innerText.includes('Page 1 of 2')")
        # a swipe to the left: the next page
        page.evaluate("""(() => { const s = document.querySelector('.bx-sheet');
            const t = (x) => new Touch({identifier: 1, target: s, clientX: x, clientY: 200});
            s.dispatchEvent(new TouchEvent('touchstart', {touches: [t(300)], changedTouches: [t(300)], bubbles: true}));
            s.dispatchEvent(new TouchEvent('touchend', {touches: [], changedTouches: [t(180)], bubbles: true})); })()""")
        page.wait_for_function("document.querySelector('.bx-pager').innerText.includes('Page 2 of 2')")

    def test_a_pocket_opens_its_card(self):
        page = self.go()
        page.click('[data-bx-open="15"]')                 # (in the binder: that copy)
        page.wait_for_selector("#eLoc", state="attached")
        self.assertEqual(page.input_value("#eLoc"), BINDER)
        page.evaluate("window.CardVault.openBinder(1)")
        page.click('[data-bx-view="pages"]')
        page.click('[data-bx-open="14"]')                 # (needed: its prices, to want it)
        page.wait_for_selector("#csWant")


class ShowMode(SealedBase):
    def go(self, binder=True):
        local = {"cardvault.v2.settings": json.dumps({"tab": "collection", "binders": [{"g": 1, "name": BINDER, "pockets": 9, "t": 1}]})} if binder else None
        page = self.open(tb.RECORDS, files={"tcgplayer-data.js": tb.tcg()}, local=local)
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        page.evaluate("window.CardVault.openScanner({show: true})")
        page.wait_for_selector("#scanNumber", state="attached")
        page.wait_for_function("!document.getElementById('scanForm').hidden || document.getElementById('scanStatus').textContent.length > 0")
        page.evaluate("document.getElementById('scanForm').hidden = false")
        page.fill("#scanNumber", "CORI-EN001")
        page.press("#scanNumber", "Enter")
        page.wait_for_selector(".show-box")
        return page

    def test_what_it_means_for_your_binders(self):
        page = self.go()
        self.assertEqual(page.inner_text(".drawer-title, #drawerTitle").strip(), "Show mode")
        common, qcsr = page.locator('.show-box[data-show="13"]'), page.locator('.show-box[data-show="14"]')
        self.assertIn("You have one to put in " + BINDER + ": it's in Shelf 2.", common.inner_text())
        self.assertIn("Fills a gap in " + BINDER + ": page 1, pocket 2.", qcsr.inner_text())
        self.assertIn("I bought it: put it in " + BINDER, qcsr.inner_text())
        self.assertIn("I bought it: add it to my collection", common.inner_text())

    def test_how_their_price_compares(self):
        page = self.go()
        box = '.show-box[data-show="14"]'
        page.fill(box + " [data-show-ask]", "25")
        page.wait_for_function("document.querySelector('.show-box[data-show=\"14\"] [data-show-verdict]').textContent.length > 0")
        # (in this made-up data the lowest listing is the market price too)
        self.assertEqual(page.inner_text(box + " [data-show-verdict]"), "Good deal: 17% under the market price of $30.00. That's less than any TCGplayer listing ($30.00).")
        page.select_option(box + " [data-show-cond]", "Lightly Played")          # (a played copy: its market is 85% of a near-mint one's)
        self.assertEqual(page.inner_text(box + " [data-show-verdict]"), "Fair: 2% under the market price of $25.50. That's less than any TCGplayer listing ($25.50).")
        page.fill(box + " [data-show-ask]", "40")
        self.assertEqual(page.inner_text(box + " [data-show-verdict]"), "Above market: 57% over the market price of $25.50.")

    def test_the_verdicts(self):
        page = self.go(binder=False)
        v = lambda *a: page.evaluate("([a, m, l]) => window.CardVault.dealVerdict(a, m, l)", list(a))
        self.assertEqual(v(85, 100, None)["k"], "good")
        self.assertEqual(v(86, 100, None)["k"], "fair")
        self.assertEqual(v(105, 100, None)["k"], "fair")
        self.assertEqual(v(106, 100, None)["k"], "high")
        self.assertEqual(v(100, 100, None)["t"], "Fair: right at the market price of $100.00.")
        self.assertIn("less than any TCGplayer listing ($90.00)", v(80, 100, 90)["t"])
        self.assertEqual(v(5, None, 4)["k"], "none")
        self.assertIsNone(v(None, 100, None))

    def test_i_bought_it_goes_into_the_binder_at_their_price(self):
        page = self.go()
        box = '.show-box[data-show="14"]'
        page.fill(box + " [data-show-ask]", "26.5")
        page.click(box + " [data-show-buy]")
        page.wait_for_function("window.CardVault.state().collection.some(r => r.productId === 14)")
        got = page.evaluate("window.CardVault.state().collection.find(r => r.productId === 14)")
        self.assertEqual((got["location"], got["paid"], got["edition"], got["condition"], got["qty"]), (BINDER, 26.5, "1st Edition", "Near Mint", 1))
        self.assertEqual(page.evaluate("window.CardVault.binderPlan(1).in"), 2)
        self.assertIn("Added to " + BINDER + " at $26.50.", page.inner_text(box))
        page.click(".toast button")                                           # (Undo)
        page.wait_for_function("!window.CardVault.state().collection.some(r => r.productId === 14)")

    def test_without_a_binder_it_goes_where_the_last_card_went(self):
        page = self.go(binder=False)
        self.assertEqual(page.locator(".show-gap").count(), 0)
        page.evaluate("window.CardVault.state().settings.lastAdd = {condition: 'Lightly Played', location: 'Box 2'}")
        page.click('.show-box[data-show="14"] [data-show-buy]')
        got = page.evaluate("window.CardVault.state().collection.find(r => r.productId === 14)")
        self.assertEqual((got["location"], got["paid"]), ("Box 2", None))

    def test_from_the_search_tab_and_a_binder(self):
        page = self.open(tb.RECORDS, files={"tcgplayer-data.js": tb.tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        page.evaluate("window.CardVault.setTab('search')")
        page.click("#csShow")
        page.wait_for_function("document.querySelector('.drawer-title, #drawerTitle').textContent.includes('Show mode')")
        page.keyboard.press("Escape")
        page.evaluate("window.CardVault.openBinder(1)")
        page.click("#bxShow")
        page.wait_for_function("document.querySelector('.drawer-title, #drawerTitle').textContent.includes('Show mode')")


class BinderSync(SealedBase):
    def test_binders_merge_one_by_one_and_are_in_the_backup(self):
        page = self.open([], local={"cardvault.v2.settings": json.dumps({"tab": "collection", "binders": [{"g": 1, "name": "Mine", "pockets": 9, "t": 5}, {"g": 3, "name": "Only here", "pockets": 4, "t": 7}]})})
        m = page.evaluate("""() => window.CardVault.mergeBinders(window.CardVault.state().settings.binders,
            [{g: 1, name: "Theirs", pockets: 12, t: 9}, {g: 2, name: "New", pockets: 9, t: 3}], false)""")
        self.assertEqual([(b["g"], b["name"], b["pockets"]) for b in m["list"]], [(2, "New", 9), (3, "Only here", 4), (1, "Theirs", 12)])
        self.assertTrue(m["changed"])
        self.assertTrue(m["behind"])          # (3 is only here: the backup needs it)
        # an older one doesn't win; bad entries are dropped
        m = page.evaluate("() => window.CardVault.mergeBinders([{g: 1, name: 'Mine', pockets: 9, t: 5}], [{g: 1, name: 'Old', pockets: 9, t: 2}, {g: 'x', name: 'Bad'}, {g: 4, name: ''}], false)")
        self.assertEqual([(b["g"], b["name"]) for b in m["list"]], [(1, "Mine")])
        self.assertFalse(m["changed"])
        backup = page.evaluate("window.CardVault.backupPayload()")
        self.assertEqual([(b["g"], b["name"]) for b in backup["settings"]["binders"]], [(1, "Mine"), (3, "Only here")])
        # a backup from the other device brings its binders in
        res = page.evaluate("""() => { const v = window.CardVault, data = v.backupPayload();
            data.settings.binders = [{g: 1, name: 'Theirs', pockets: 12, t: 99}]; data.settings.sharedMod = 0;
            const r = v.mergeBackup(data, {}); return {changed: r.changed, binders: v.state().settings.binders.map(b => [b.g, b.name])}; }""")
        self.assertEqual(sorted(res["binders"]), [[1, "Theirs"], [3, "Only here"]])


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for c in (BinderPages, ShowMode, BinderSync):
        suite.addTests(loader.loadTestsFromTestCase(c))
    return suite


if __name__ == "__main__":
    unittest.main()
