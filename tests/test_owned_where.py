"""Adding a card: how many you already have, and where.

Each add form (TCGplayer card, Japanese/Korean card, sealed product, Add manually) says what you already have of it and
in which binder, box or deck, with a count per place; tapping a place puts it in the Location field so the new copies
go with the others. Nothing is shown for a card you don't have yet.
"""
import unittest

import test_sealed_app as base
from test_sealed_app import SealedBase, BOX


def card(rid, location="", qty=1, **more):
    r = {"id": rid, "productId": 1001, "name": "Test Card", "productName": "Test Card", "setName": "Rarity Collection", "number": "TST-EN001", "rarity": "Common",
         "edition": "1st Edition", "language": "English", "qty": qty, "quantity": qty, "condition": "Near Mint", "location": location}
    r.update(more)
    return r


def jp(rid, location="", qty=1, rarity="Ultra Rare"):
    return {"id": rid, "productId": None, "name": "Jinzo", "productName": "Jinzo", "setName": "Original Artwork Collection", "number": "YAC1-JP085", "rarity": rarity,
            "edition": "", "language": "Japanese", "qty": qty, "quantity": qty, "condition": "Near Mint", "location": location}


class OwnedWhere(SealedBase):
    def picked(self, page):
        page.evaluate("window.CardVault.openPickedForm(window.CardVault.state().catalog.byId.get(1001))")
        page.wait_for_selector("#pickedForm")

    def line(self, page, loc_id="fLoc"):
        el = page.query_selector("#" + loc_id + "Owned")
        return el.inner_text().replace("\n", " ").strip() if el else None

    def chips(self, page, loc_id="fLoc"):
        return page.evaluate("(id) => Array.from(document.querySelectorAll('#' + id + 'Owned .chip')).map(b => [b.dataset.locPick, b.textContent])", loc_id)

    def test_nothing_is_said_for_a_card_you_dont_have(self):
        page = self.open()
        self.picked(page)
        self.assertIsNone(self.line(page))

    def test_the_count_per_place_is_shown_most_first(self):
        page = self.open([card("a", "Binder 1", 2), card("b", "Deck box", 3), card("c", "", 1), card("d", "Binder 1", 1, condition="Lightly Played")])
        self.picked(page)
        self.assertIn("You already have 7", self.line(page))
        self.assertEqual(self.chips(page), [["Binder 1", "Binder 1 ×3"], ["Deck box", "Deck box ×3"], ["", "No location ×1"]])

    def test_all_in_one_place_reads_as_a_sentence(self):
        page = self.open([card("a", "Binder 1", 2)])
        self.picked(page)
        self.assertEqual(self.line(page), "You already have 2 in Binder 1 ×2")

    def test_all_with_no_location_says_so_without_a_chip(self):
        page = self.open([card("a", "", 2)])
        self.picked(page)
        self.assertEqual(self.line(page), "You already have 2, in no location.")
        self.assertEqual(self.chips(page), [])

    def test_tapping_a_place_fills_the_location_field(self):
        page = self.open([card("a", "Binder 1", 2), card("b", "Deck box", 1)])
        self.picked(page)
        page.click("#fLocOwned .chip:nth-child(3)")          # (Deck box; the first child is the sentence)
        self.assertEqual(page.input_value("#fLoc"), "Deck box")
        page.click("#fLocOwned .chip:nth-child(2)")
        self.assertEqual(page.input_value("#fLoc"), "Binder 1")
        page.click("#pickedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.filter(r => r.location === 'Binder 1').reduce((t, r) => t + r.qty, 0)"), 3)

    def test_graded_copies_count_too(self):
        page = self.open([card("a", "Safe", 1, grade={"company": "PSA", "grade": "10", "cert": "123", "value": 100})])
        self.picked(page)
        self.assertEqual(self.line(page), "You already have 1 in Safe ×1")

    def test_a_japanese_card_counts_every_version_of_the_number(self):
        page = self.open([jp("a", "Binder J", 1, "Ultra Rare (Manga Monochrome)"), jp("b", "Binder J", 1, "Secret Rare (Manga Color)"), jp("c", "", 2)])
        page.evaluate("window.CardVault.openOcgForm({code: 'YAC1-JP085', name: 'Jinzo', setName: 'Original Artwork Collection', rarities: []}, 'Japanese', {rarity: 'Ultra Rare', image: '', backup: '', ja: '', price: null})")
        page.wait_for_selector("#ocgForm")
        self.assertIn("You already have 4", self.line(page, "oLoc"))
        self.assertEqual(self.chips(page, "oLoc"), [["", "No location ×2"], ["Binder J", "Binder J ×2"]])
        page.click("#oLocOwned .chip:nth-child(3)")
        self.assertEqual(page.input_value("#oLoc"), "Binder J")

    def test_a_sealed_product_shows_it_too(self):
        page = self.open([base.sealed("p", BOX, "Rarity Collection Booster Box", qty=2, quantity=2, location="Closet")])
        page.evaluate("window.CardVault.openSealedForm(window.CardVault.state().catalog.byId.get(%d), '')" % BOX)
        page.wait_for_selector("#sealedForm")
        self.assertEqual(self.line(page, "sLocS"), "You already have 2 in Closet ×2")

    def test_add_manually_shows_it_as_you_type_the_number_or_name(self):
        page = self.open([card("a", "Binder 1", 2), jp("j", "Binder J", 1)])
        page.evaluate("window.CardVault.openManual({})")
        page.wait_for_selector("#manualForm")
        self.assertIsNone(self.line(page, "mLoc"))
        page.fill("#mNumber", "yac1-jp085")
        page.dispatch_event("#mNumber", "input")
        self.assertEqual(self.line(page, "mLoc"), "You already have 1 in Binder J ×1")
        page.fill("#mNumber", "")
        page.dispatch_event("#mNumber", "input")
        page.fill("#mName", "Test Card")
        page.dispatch_event("#mName", "input")
        self.assertEqual(self.line(page, "mLoc"), "You already have 2 in Binder 1 ×2")
        page.click("#mLocOwned .chip")
        self.assertEqual(page.input_value("#mLoc"), "Binder 1")


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(OwnedWhere)


if __name__ == "__main__":
    unittest.main()
