"""PCG (Premier Card Grading) as a grading company: for cards you own graded by it, for cards you send it, and its fees.

Its price list as read on its own page on Oct 21 2026 (premiercardgrading.com/pages/pricing-services): Bulk 50+ $14.95
(50 cards or more, insurance cap $250, 40 to 60 business days), Standard $19.95 (20 to 30), Express $49.95 (cap $10,000,
7 to 10). In a real browser.
"""
import json
import unittest

from test_sealed_app import SealedBase
from test_themes_app import eng


class PCGGrading(SealedBase):
    def test_a_card_can_be_graded_by_pcg(self):
        page = self.open([eng("a", 1001, "Test Card", "TST-EN001")])
        page.evaluate("window.CardVault.openManual({})")
        page.wait_for_selector("#mCompany", state="attached")
        self.assertIn("PCG", page.evaluate("Array.from(document.querySelectorAll('#mCompany option')).map(o => o.value)"))
        # a card you have: its edit form
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#eCompany", state="attached")
        self.assertIn("PCG", page.evaluate("Array.from(document.querySelectorAll('#eCompany option')).map(o => o.value)"))

    def test_kept_and_sent_to_pricecharting_as_another_company(self):
        rec = dict(eng("a", 1001, "Test Card", "TST-EN001"), grade={"company": "PCG", "grade": "10", "cert": "PCG123"})
        page = self.open([rec])
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].grade.company"), "PCG")
        g = page.evaluate("window.CardVault.pcGrade({company: 'PCG', grade: '9.5'})")
        self.assertEqual((g["condition"], g["company"]), (6, "Other"))          # (PriceCharting has no PCG: "Other", at Grade 9.5)

    def test_its_fees_are_in_settings(self):
        page = self.open([], local={"cardvault.v2.settings": json.dumps({"tab": "collection"})})
        page.evaluate("window.CardVault.openSettings({section: 'gradingFees'})")
        page.wait_for_selector("#gradingFeesSection")
        text = page.inner_text("#gradingFeesSection")
        self.assertIn("PCG (Premier Card Grading)", text)
        for bit in ("Bulk 50+", "$14.95", "Standard", "$19.95", "Express", "$49.95"):
            self.assertIn(bit, text)


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(PCGGrading)


if __name__ == "__main__":
    unittest.main()
