"""Price paid for many cards at once ("Price paid…" on the bar of selected cards). In a real browser.

What each was worth when added (the price kept with the card then, today's for one added without it), today's value, the
same price for each, or one total split by what each is worth; only the ones without a price paid unless told otherwise;
Undo.
"""
import unittest

from test_sealed_app import SealedBase
from test_themes_app import eng, jpn, tcg


def rec(rid, pid, name, number, qty=1, **more):
    r = eng(rid, pid, name, number, qty)
    r.update(more)
    return r


RECORDS = [rec("a", 13, "Shaddoll Dragon", "DUEA-EN020", 2, snap={"market": 0.8, "low": 0.7, "date": "2026-09-01T00:00:00Z"}),   # $1 today
           rec("b", 21, "Dark Magician Girl", "MVP1-EN056"),                                                                     # $10 today, no snap
           rec("c", 14, "Shaddoll Beast", "DUEA-EN021", paid=0.25),                                                              # already has one
           jpn("d", "Some Japanese Card", "XXXX-JP001")]                                                                         # no price at all


class PricePaid(SealedBase):
    def go(self):
        page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def plan(self, page, how, each="", total="", only_empty=True):
        return page.evaluate("""([how, each, total, only]) => { const v = window.CardVault, p = v.pp();
            p.ids = ['a', 'b', 'c', 'd']; p.how = how; p.each = each; p.total = total; p.onlyEmpty = only;
            const x = v.paidPlan(); return {rows: Object.fromEntries(x.rows.map(r => [r.r.id, r.unit])), copies: x.copies, sum: x.sum, kept: x.kept, unpriced: x.unpriced, today: x.today}; }""",
                             [how, each, total, only_empty])

    def test_worth_when_added(self):
        got = self.plan(self.go(), "added")
        self.assertEqual(got["rows"], {"a": 0.8, "b": 10.0})          # (a: the price kept with it; b: today's, said apart)
        self.assertEqual((got["copies"], got["sum"], got["today"], got["kept"], got["unpriced"]), (3, 11.6, 1, 1, 1))

    def test_worth_today(self):
        got = self.plan(self.go(), "today")
        self.assertEqual(got["rows"], {"a": 1.0, "b": 10.0})

    def test_the_same_for_each_and_the_ones_already_filled_in(self):
        page = self.go()
        got = self.plan(page, "each", each="2")
        self.assertEqual((got["rows"], got["sum"]), ({"a": 2.0, "b": 2.0, "d": 2.0}, 8.0))
        got = self.plan(page, "each", each="2", only_empty=False)
        self.assertEqual(got["rows"]["c"], 2.0)

    def test_one_total_split_by_what_each_is_worth(self):
        got = self.plan(self.go(), "total", total="30")
        # (weights: a $1 ×2, b $10, d no value: the average known one, $5.50; 17.5 in all)
        self.assertEqual(got["rows"], {"a": 1.71, "b": 17.15, "d": 9.43})          # (b, the biggest single card, takes the rounding cent)
        self.assertEqual(got["sum"], 30.0)

    def test_from_the_selected_cards_bar_and_undo(self):
        page = self.go()
        self.assertEqual(page.locator("#bulkPaid").count(), 1)
        page.evaluate("window.CardVault.openPaidTool(['a', 'b', 'c', 'd'])")
        page.wait_for_selector("#ppBody")
        self.assertIn("3 cards get a price paid, $11.60 in all", page.inner_text("#ppSum"))
        self.assertIn("1 card was added before Card Vault kept its price", page.inner_text("#ppSum"))
        page.check("[name=ppHow][value=each]")
        page.fill("#ppEach", "1.5")
        page.wait_for_function("document.getElementById('ppSum').innerText.includes('$6.00 in all')")
        page.click("#ppGo")
        page.wait_for_function("window.CardVault.state().collection.find(r => r.id === 'a').paid === 1.5")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => r.paid)"), [1.5, 1.5, 0.25, 1.5])
        page.click(".toast button")
        page.wait_for_function("window.CardVault.state().collection.find(r => r.id === 'a').paid === null")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => r.paid)"), [None, None, 0.25, None])


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(PricePaid)


if __name__ == "__main__":
    unittest.main()
