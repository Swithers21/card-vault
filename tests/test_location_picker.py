"""The location field: the last location stays filled in, and tapping the field lists every location (not only the ones
matching what's in it, as the browser's own suggestions did), so the next card can go somewhere else without erasing.
In a real browser.
"""
import unittest

from test_sealed_app import SealedBase
from test_themes_app import eng


def at(rid, loc, number):
    return dict(eng(rid, 1001, "Test Card", number), location=loc)


RECORDS = [at("a", "Binder 1", "TST-EN001"), at("b", "Binder 2", "TST-EN002"), at("c", "Box", "TST-EN003"), at("d", "Binder 10", "TST-EN004")]


class LocationPicker(SealedBase):
    def manual(self, page, value="Binder 1"):
        page.evaluate("window.CardVault.openManual({})")
        page.wait_for_selector("#mLoc", state="attached")
        page.fill("#mLoc", value)
        page.evaluate("document.activeElement.blur()")

    def test_tapping_back_in_after_typing_lists_every_location_again(self):
        page = self.open(RECORDS)
        page.evaluate("window.CardVault.openManual({})")
        page.click("#mLoc")
        page.keyboard.type("Binder 1")
        self.assertEqual(self.options(page), ["Binder 1", "Binder 10"])
        page.evaluate("document.activeElement.blur()")
        page.click("#mLoc")                     # (straight back, before the list had closed)
        self.assertEqual(len(self.options(page)), 5)

    def options(self, page):
        return page.locator(".loc-pick .lp-opt").all_inner_texts()

    def test_a_filled_in_field_lists_every_location(self):
        page = self.open(RECORDS)
        self.manual(page)
        page.click("#mLoc")
        page.wait_for_selector(".loc-pick")
        self.assertEqual([o.replace(" (filled in)", "") for o in self.options(page)], ["Binder 1", "Binder 2", "Binder 10", "Box", "No location"])
        self.assertEqual(page.get_attribute("#mLoc", "aria-expanded"), "true")
        page.locator(".lp-opt", has_text="Box").click()
        self.assertEqual(page.input_value("#mLoc"), "Box")
        self.assertEqual(page.locator(".loc-pick").count(), 0)

    def test_tapping_selects_the_text_so_typing_replaces_it_and_narrows_the_list(self):
        page = self.open(RECORDS)
        self.manual(page)
        page.click("#mLoc")
        page.wait_for_timeout(50)
        self.assertEqual(page.evaluate("(() => { const i = document.getElementById('mLoc'); return i.value.slice(i.selectionStart, i.selectionEnd); })()"), "Binder 1")
        page.keyboard.type("bind")
        self.assertEqual(page.input_value("#mLoc"), "bind")
        self.assertEqual(self.options(page), ["Binder 1", "Binder 2", "Binder 10"])
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        self.assertEqual(page.input_value("#mLoc"), "Binder 2")

    def test_a_new_location_can_still_be_typed(self):
        page = self.open(RECORDS)
        self.manual(page)
        page.click("#mLoc")
        page.keyboard.type("Deck box")
        self.assertEqual(self.options(page), [])
        self.assertTrue(page.evaluate("document.querySelector('.loc-pick') === null || document.querySelector('.loc-pick').hidden"))
        page.keyboard.press("Escape")
        self.assertEqual(page.input_value("#mLoc"), "Deck box")

    def test_no_location_clears_it(self):
        page = self.open(RECORDS)
        self.manual(page)
        page.click("#mLoc")
        page.locator(".lp-opt", has_text="No location").click()
        self.assertEqual(page.input_value("#mLoc"), "")

    def test_every_location_field_has_it(self):
        page = self.open(RECORDS)
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#eLoc", state="attached")
        self.assertEqual(page.evaluate("[...document.querySelectorAll('input')].filter(i => i.getAttribute('list') === 'locationList').length"), 0)
        self.assertEqual(page.get_attribute("#eLoc", "data-loc"), "1")
        page.evaluate("document.getElementById('eLoc').scrollIntoView()")
        page.click("#eLoc")
        page.wait_for_selector(".loc-pick")
        self.assertIn("Binder 2", self.options(page))
        page.keyboard.press("Escape")
        self.assertEqual(page.locator(".loc-pick").count(), 0)

    def test_no_locations_yet_no_list(self):
        page = self.open([eng("a", 1001, "Test Card", "TST-EN001")])
        self.manual(page, "")
        page.click("#mLoc")
        page.wait_for_timeout(100)
        self.assertEqual(page.locator(".loc-pick").count(), 0)


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(LocationPicker)


if __name__ == "__main__":
    unittest.main()
