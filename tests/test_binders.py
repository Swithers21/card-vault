"""Master set binders (Sets tab): a binder (a location) holding one copy of every printing of a set, each rarity on its
own, and the set's tokens; a checklist in binder order with each card's page and pocket; putting one of each card you
have elsewhere into it; the ones still needed onto the want list; and card-sized placeholders to print for the gaps.

TCGplayer gives most tokens no card number, so the card list files them with the sealed products; a pack or box of
tokens isn't a token card. In a real browser.
"""
import re
import unittest

import test_open_window_refresh as data
from test_sealed_app import SealedBase, BUILT

SET = "Chaos Origins"
GROUPS = [[1, SET, "CORI", "2025-01-01"], [2, "Some Other Set", "SOME", "2024-01-01"]]
SUBTYPES = ["Normal", "1st Edition", "Unlimited"]
RARITIES = ["Common", "Ultra Rare", "Secret Rare", "Quarter Century Secret Rare", ""]


def prices(*pairs):
    out = []
    for sub, market in pairs:
        out += [SUBTYPES.index(sub), market, market, market, market, market]
    return out


# [id, set, name, number, rarity, prices, sealed]
PRODUCTS = [[11, 0, "Magician of Dark Chaos (Secret Rare)", "CORI-EN027", 2, prices(("1st Edition", 10.58)), 0],
            [12, 0, "Magician of Dark Chaos", "CORI-EN027", 1, prices(("1st Edition", 60.67)), 0],
            [13, 0, "Chaos Dragon", "CORI-EN001", 0, prices(("1st Edition", 0.25), ("Unlimited", 0.10)), 0],
            [14, 0, "Chaos Dragon (Quarter Century Secret Rare)", "CORI-EN001", 3, prices(("1st Edition", 30.0)), 0],
            [15, 0, "Dark Spell", "CORI-EN002", 0, prices(("1st Edition", 0.20)), 0],
            [16, 0, "Chaos Origins Booster Box", "", 4, prices(("Normal", 90.0)), 1],
            [17, 0, "Token: Chaos Sheep", "", 4, prices(("Normal", 1.50)), 1],            # (a token: no number)
            [18, 0, "Chaos Origins Token Pack", "", 4, prices(("Normal", 4.0)), 1],       # (a pack of tokens: not a card)
            [21, 1, "Other Card", "SOME-EN001", 0, prices(("1st Edition", 1.0)), 0]]


def tcg():
    return data.js("TCG_DATA", {"format": 4, "generated": BUILT, "builtAt": BUILT, "groups": GROUPS, "rarities": RARITIES, "subtypes": SUBTYPES,
                                "products": PRODUCTS, "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


def rec(rid, pid, name, number, rarity="Common", edition="1st Edition", qty=1, **more):
    r = {"id": rid, "productId": pid, "name": name, "productName": name, "setName": SET, "number": number, "rarity": rarity,
         "edition": edition, "language": "English", "qty": qty, "quantity": qty, "condition": "Near Mint", "added": "2026-10-01T12:00:00Z"}
    r.update(more)
    return r


BINDER = SET + " master set"
RECORDS = [rec("dragon-unl", 13, "Chaos Dragon", "CORI-EN001", edition="Unlimited", qty=2, location="Shelf 1"),
           rec("dragon-1st-lp", 13, "Chaos Dragon", "CORI-EN001", qty=3, condition="Lightly Played", location="Shelf 2"),   # (the one to put in: 1st Edition)
           rec("mdc-ur-graded", 12, "Magician of Dark Chaos", "CORI-EN027", "Ultra Rare", grade={"company": "PSA", "grade": "10", "cert": "1"}),
           rec("spell-in", 15, "Dark Spell", "CORI-EN002", qty=2, location=BINDER),                                       # (two in the binder: one extra)
           rec("mdc-sr-deck", 11, "Magician of Dark Chaos", "CORI-EN027", "Secret Rare", location="Deck: Chaos"),
           dict(rec("sheep", 17, "Token: Chaos Sheep", "", "", "", location="Box"), sealed=True, condition="Sealed"),
           rec("other", 21, "Other Card", "SOME-EN001", location=BINDER)]                                                # (not from this set)


class Binders(SealedBase):
    def go(self, records=RECORDS, **more):
        page = self.open(records, files={"tcgplayer-data.js": tcg()}, **more)
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def plan(self, page):
        return page.evaluate("""() => { const x = window.CardVault.binderPlan(1);
            return {b: x.b, items: x.items.map(it => [it.p.id, it.page, it.pocket, it.state, it.from ? it.from.id : null, it.inside]),
              total: x.total, tokens: x.tokens, in: x.in, move: x.move, kept: x.kept, need: x.need, cost: Math.round(x.cost * 100) / 100, extra: x.extra, stray: x.stray.map(r => r.id), pages: x.pages}; }""")

    def test_the_checklist_in_binder_order(self):
        got = self.plan(self.go())
        self.assertEqual(got["b"], {"g": 1, "name": BINDER, "pockets": 9})
        # (number order; within a number the commonest rarity first; the token last; no booster box, no token pack, no other set)
        self.assertEqual([x[0] for x in got["items"]], [13, 14, 15, 12, 11, 17])
        self.assertEqual([x[3] for x in got["items"]], ["move", "need", "in", "kept", "kept", "move"])
        self.assertEqual(got["items"][0][4], "dragon-1st-lp")       # (1st Edition over Unlimited)
        self.assertEqual(got["items"][5][4], "sheep")               # (a token you own goes in like a card)
        self.assertEqual((got["total"], got["tokens"], got["in"], got["move"], got["kept"], got["need"], got["cost"]), (6, 1, 1, 2, 2, 1, 30.0))
        self.assertEqual((got["extra"], got["stray"], got["pages"]), (1, ["other"], 1))
        self.assertEqual([x[1:3] for x in got["items"]], [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]])

    def test_pages_of_four_pockets(self):
        page = self.go()
        page.evaluate("window.CardVault.openBinder(1)")
        page.wait_for_selector("#bxPockets")
        page.select_option("#bxPockets", "4")
        got = self.plan(page)
        self.assertEqual([x[1:3] for x in got["items"]], [[1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2]])
        self.assertEqual(got["pages"], 2)
        self.assertEqual(page.locator(".bx-page").all_inner_texts(), ["PAGE 1", "PAGE 2"])

    def test_put_one_of_each_in_and_undo(self):
        page = self.go()
        page.evaluate("window.CardVault.openBinder(1)")
        page.wait_for_selector("#bxFill")
        self.assertIn("Put one of each of the 2 in the binder", page.inner_text("#bxFill"))
        page.click("#bxFill")
        page.wait_for_function("window.CardVault.binderPlan(1).move === 0")
        where = page.evaluate("window.CardVault.state().collection.map(r => [r.productId, r.location || '', r.qty, r.edition])")
        self.assertIn([13, BINDER, 1, "1st Edition"], where)
        self.assertIn([13, "Shelf 2", 2, "1st Edition"], where)      # (the rest stay where they were)
        self.assertIn([13, "Shelf 1", 2, "Unlimited"], where)
        self.assertIn([17, BINDER, 1, ""], where)
        self.assertIn([12, "", 1, "1st Edition"], where)             # (the graded one stays)
        self.assertIn([11, "Deck: Chaos", 1, "1st Edition"], where)  # (and the deck's)
        self.assertEqual(self.plan(page)["in"], 3)
        self.assertEqual(page.evaluate("window.CardVault.state().settings.binders.map(b => [b.g, b.name, b.pockets, b.t > 0])"), [[1, BINDER, 9, True]])
        self.assertEqual(page.locator("#bxFill").count(), 0)          # (nothing more to put in: never a second copy)
        page.click(".toast button")
        page.wait_for_function("window.CardVault.binderPlan(1).move === 2")

    def test_the_ones_needed_onto_the_want_list(self):
        page = self.go()
        page.evaluate("window.CardVault.openBinder(1)")
        page.click("#bxWant")
        page.wait_for_function("window.CardVault.state().wants.length === 1")
        self.assertEqual(page.evaluate("window.CardVault.state().wants.map(w => [w.productId, w.number, w.rarity])"), [[14, "CORI-EN001", "Quarter Century Secret Rare"]])

    def test_renaming_the_binder_takes_its_cards_along(self):
        page = self.go()
        page.evaluate("window.CardVault.openBinder(1)")
        page.click("#bxFill")
        page.wait_for_function("window.CardVault.binderPlan(1).move === 0")
        page.fill("#bxName", "Binder 3")
        page.evaluate("document.getElementById('bxName').dispatchEvent(new Event('change', {bubbles: true}))")
        page.wait_for_function("window.CardVault.binderOf(1).name === 'Binder 3'")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.filter(r => r.location === %r).length" % BINDER), 0)
        self.assertEqual(self.plan(page)["in"], 3)

    def test_from_the_sets_tab(self):
        page = self.go()
        page.evaluate("window.CardVault.setTab('sets')")
        page.click('.set-toggle[data-set="1"]')
        page.click('[data-binder="1"]')
        page.wait_for_selector("#bxBody")
        self.assertIn("one of every printing, each rarity on its own, and its 1 token", page.inner_text("#bxBody"))
        self.assertIn("1 of 6 in the binder", page.inner_text("#bxBody"))
        page.click("#bxFill")
        page.wait_for_function("!!window.CardVault.binderOf(1)")
        page.keyboard.press("Escape")
        page.wait_for_selector('.set-row[data-gid="1"] .goal-tag')
        self.assertIn("Binder", page.inner_text('.set-row[data-gid="1"] .set-name'))

    def test_placeholders_for_the_gaps(self):
        page = self.go()
        got = page.evaluate("(() => { const x = window.CardVault.binderSlipsHTML(1, 'need', false); return {count: x.count, html: x.html}; })()")
        self.assertEqual(got["count"], 3)          # (the one needed and the two kept elsewhere)
        names = re.findall(r'class="slip-name">([^<]+)<', got["html"])
        self.assertEqual(names, ["Chaos Dragon", "Magician of Dark Chaos", "Magician of Dark Chaos"])
        self.assertIn("CORI-EN001 · Quarter Century Secret Rare", got["html"])
        self.assertIn("CORI · page 1, pocket 2", got["html"])
        self.assertIn("tcgplayer-cdn.tcgplayer.com/product/14_in_1000x1000.jpg", got["html"])
        every = page.evaluate("window.CardVault.binderSlipsHTML(1, 'all', true)")
        self.assertEqual(every["count"], 5)
        self.assertIn('class="slips slips-bw"', every["html"])
        self.assertIn('class="slip-meta">Token<', every["html"])     # (the token, which has no number)
        # printing: the slips go into the print area, on portrait letter paper, and the print window opens
        page.evaluate("window.print = () => { window.__printed = (window.__printed || 0) + 1; }")
        page.evaluate("window.CardVault.openBinder(1)")
        page.click(".bx-print summary")
        page.click("#bxPrint")
        page.wait_for_function("window.__printed === 1", timeout=20000)
        self.assertEqual(page.locator("#report .slip").count(), 3)
        self.assertIn("size:letter portrait", page.evaluate("document.getElementById('phPage').textContent"))
        page.evaluate("window.dispatchEvent(new Event('afterprint'))")
        self.assertEqual(page.locator("#phPage").count(), 0)

    def test_nine_slips_fit_a_sheet_of_letter_paper(self):
        page = self.go([])
        page.evaluate("(() => { const r = document.getElementById('report'); r.innerHTML = window.CardVault.binderSlipsHTML(1, 'all', false).html; })()")
        page.emulate_media(media="print")
        box = page.evaluate("(() => { const s = document.querySelector('.slip').getBoundingClientRect(); return [s.width, s.height]; })()")
        self.assertAlmostEqual(box[0], 240, delta=1.5)              # (2.5 inches at 96 to the inch)
        self.assertAlmostEqual(box[1], 336, delta=1.5)              # (3.5 inches)


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(Binders)


if __name__ == "__main__":
    unittest.main()
