"""A single card that is still sealed (in its original pack or sleeve: a promo, a Lost Art card).

Not a sealed product (a box, a pack): still a card, with its number, rarity, price and grading. A "Still sealed" box on
the add and edit forms sets its condition to Sealed; it shows a Sealed badge, has its own filter, is found by searching
"sealed", is valued at the full market price, and stays apart from an opened copy of the same printing.
"""
import unittest

import test_sealed_app as base
from test_sealed_app import SealedBase, SINGLE


def card(rid, condition="Near Mint", **more):
    r = {"id": rid, "productId": 1001, "name": "Test Card", "productName": "Test Card", "setName": "Rarity Collection", "number": "TST-EN001", "rarity": "Common",
         "edition": "1st Edition", "language": "English", "qty": 1, "quantity": 1, "condition": condition}
    r.update(more)
    return r


class SealedCard(SealedBase):
    def records(self, page):
        return page.evaluate("window.CardVault.state().collection.map(r => ({id: r.id, condition: r.condition, sealed: !!r.sealed, qty: r.qty, number: r.number}))")

    # ----- adding
    def picked(self, page):
        page.evaluate("window.CardVault.openPickedForm(window.CardVault.state().catalog.byId.get(1001))")
        page.wait_for_selector("#pickedForm")

    def test_the_add_form_has_the_box_and_ticking_it_sets_the_condition(self):
        page = self.open()
        self.picked(page)
        self.assertFalse(page.is_checked("#fSealedCard"))
        self.assertEqual(page.input_value("#fCond"), "Near Mint")
        page.check("#fSealedCard")
        self.assertEqual(page.input_value("#fCond"), "Sealed")
        page.uncheck("#fSealedCard")
        self.assertEqual(page.input_value("#fCond"), "Near Mint")
        # the other way round too
        page.select_option("#fCond", "Sealed")
        self.assertTrue(page.is_checked("#fSealedCard"))
        page.select_option("#fCond", "Lightly Played")
        self.assertFalse(page.is_checked("#fSealedCard"))

    def test_a_card_added_with_the_box_ticked_is_a_sealed_card_not_a_sealed_product(self):
        page = self.open()
        self.picked(page)
        page.check("#fSealedCard")
        page.click("#pickedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        recs = self.records(page)
        self.assertEqual((recs[0]["condition"], recs[0]["sealed"], recs[0]["number"]), ("Sealed", False, "TST-EN001"))

    def test_the_japanese_add_form_and_add_manually_have_the_box_too(self):
        page = self.open()
        page.evaluate("window.CardVault.openOcgForm({code: 'YAC1-JP085', name: 'Jinzo', setName: 'Original Artwork Collection', rarities: []}, 'Japanese', {rarity: 'Ultra Rare', image: '', backup: '', ja: '', price: null})")
        page.wait_for_selector("#ocgForm")
        page.check("#oSealedCard")
        self.assertEqual(page.input_value("#oCond"), "Sealed")
        page.click("#ocgForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        page.evaluate("window.CardVault.openManual({})")
        page.wait_for_selector("#manualForm")
        self.assertTrue(page.is_visible("#mSealedCard"))
        page.fill("#mName", "Promo Card")
        page.check("#mSealedCard")
        page.click("#manualForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual([(r["condition"], r["sealed"]) for r in self.records(page)], [("Sealed", False), ("Sealed", False)])

    def test_a_sealed_product_by_hand_does_not_show_the_card_box(self):
        page = self.open()
        page.evaluate("window.CardVault.openManual({sealed: true})")
        page.wait_for_selector("#manualForm.m-sealed")
        self.assertFalse(page.is_visible("#mSealedCard"))

    # ----- the details
    def test_the_details_box_turns_it_sealed_and_back(self):
        page = self.open([card("a")])
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#editForm")
        self.assertFalse(page.is_checked("#eSealedCard"))
        page.check("#eSealedCard")
        page.click("#editForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(self.records(page)[0]["condition"], "Sealed")
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#editForm")
        self.assertTrue(page.is_checked("#eSealedCard"))
        self.assertEqual(page.input_value("#eCond"), "Sealed")
        page.uncheck("#eSealedCard")
        page.click("#editForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(self.records(page)[0]["condition"], "Near Mint")

    # ----- seeing it
    def test_it_is_valued_at_the_full_market_price_and_still_graded_like_a_card(self):
        page = self.open([card("a", "Sealed")])
        page.wait_for_function("document.getElementById('totalValue').textContent === '$25.00'", timeout=5000)
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#editForm")
        text = page.inner_text("#drawerBody")
        self.assertIn("Graded value", text)              # (a card, so grading applies; a sealed product has none)
        self.assertIn("TST-EN001", text)

    def test_it_has_a_sealed_badge_its_own_filter_and_is_found_by_searching(self):
        page = self.open([card("a", "Sealed"), card("b"), base.sealed("p", base.BOX, "Rarity Collection Booster Box")])
        page.wait_for_selector(".tile")
        self.assertEqual(page.evaluate("Array.from(document.querySelectorAll('.tile[data-card=a] .ed')).map(b => b.textContent)"), ["1st Edition", "Sealed"])
        self.assertEqual(page.evaluate("Array.from(document.querySelectorAll('.tile[data-card=b] .ed')).map(b => b.textContent)"), ["1st Edition"])
        base.EnglishSealed.show(self, page, "sealedcards")
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        self.assertEqual(page.evaluate("document.querySelector('.tile').dataset.card"), "a")
        base.EnglishSealed.show(self, page, "sealed")                 # (sealed products: the box only)
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        self.assertEqual(page.evaluate("document.querySelector('.tile').dataset.card"), "p")
        base.EnglishSealed.show(self, page, "played")                 # (not played: it has never been opened)
        page.wait_for_function("document.querySelectorAll('.tile').length === 0")
        base.EnglishSealed.show(self, page, "")
        page.fill("#q", "sealed")
        page.wait_for_function("document.querySelectorAll('.tile').length === 2")
        self.assertEqual(sorted(page.evaluate("Array.from(document.querySelectorAll('.tile')).map(t => t.dataset.card)")), ["a", "p"])

    def add(self, page, sealed):
        self.picked(page)
        if sealed:
            page.check("#fSealedCard")
        page.click("#pickedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")

    def test_a_sealed_copy_and_an_opened_copy_stay_apart(self):
        page = self.open()
        self.add(page, True)
        self.add(page, False)
        self.assertEqual(sorted((r["condition"], r["qty"]) for r in self.records(page)), [("Near Mint", 1), ("Sealed", 1)])
        self.add(page, True)
        self.assertEqual(sorted((r["condition"], r["qty"]) for r in self.records(page)), [("Near Mint", 1), ("Sealed", 2)])

    def test_it_survives_closing_and_opening_again(self):
        page = self.open([card("a", "Sealed")])
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.assertEqual(self.records(page)[0]["condition"], "Sealed")


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(SealedCard)


if __name__ == "__main__":
    unittest.main()
