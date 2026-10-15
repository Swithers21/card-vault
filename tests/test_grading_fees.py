"""grading_fees.py: the readers of the grading companies' pages. Pages change; these keep the known layouts working."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import grading_fees as g  # noqa: E402


def summary(result):
    return {l["name"]: (l["fee"], l["max"], l["days"], l["paused"]) for l in result["levels"]}


PSA_CURRENT = """<html><body>
<h2>Value Bulk</h2><p>Max Insured Value: $500</p><p>Currently Unavailable</p>
<h2>Standard</h2><p>$59.99/Card</p><p>Max Insured Value: $1,000</p><p>Estimated Turnaround Time: 90 - 100 Business Days*</p><a>Get Started</a>
<h2>Priority</h2><p>$79.99 /Card</p><p>Max Insured Value: $1,500</p><p>Estimated Turnaround Time: 70 - 80 Business Days*</p><a>Get Started</a>
<h2>Premium 1</h2><p>$999.00/Card</p><p>Max Insured Value: $25,000</p><p>Estimated Turnaround Time: 5 - 7 Business Days*</p>
<h2>Premium 10</h2><p>From $9,999.00/Card</p><p>Max Insured Value: $250,001 or higher&dagger;</p><p>Estimated Turnaround Time: 5 - 7 Business Days*</p>
</body></html>"""

PSA_OLDER = ("Currently Unavailable Value Bulk Max Insured Value: $500 Standard $59.99/Card Max Insured Value: $1,000 "
             "Estimated Turnaround Time: 90 - 100 Business Days Express $199.00/Card Max Insured Value: $2,500 "
             "Estimated Turnaround Time: 20 - 30 Business Days")


class PSA(unittest.TestCase):
    def test_current_layout(self):
        got = summary(g.parse_psa(PSA_CURRENT))
        self.assertEqual(got["Standard"], (59.99, 1000, "90–100", False))
        self.assertEqual(got["Priority"][0], 79.99)
        self.assertEqual(got["Premium 1"], (999, 25000, "5–7", False))
        self.assertEqual(got["Premium 10"][0:2], (9999, 250001))
        self.assertEqual(got["Value Bulk"], (None, 500, "", True))
        self.assertNotIn("Premium 10 From", got)

    def test_older_layout_still_reads(self):
        got = summary(g.parse_psa(PSA_OLDER))
        self.assertEqual(got["Standard"][0], 59.99)
        self.assertEqual(got["Express"], (199, 2500, "20–30", False))
        self.assertTrue(got["Value Bulk"][3])

    def test_a_check_you_are_human_page_finds_nothing_and_says_what_it_began_with(self):
        got = g.parse_psa("<html><title>Just a moment...</title><body>Verify you are human</body></html>")
        self.assertEqual(got["levels"], [])
        self.assertIn("Just a moment", got["sample"])

    def test_no_level_is_listed_twice(self):
        names = [l["name"] for l in g.parse_psa(PSA_CURRENT + PSA_CURRENT)["levels"]]
        self.assertEqual(len(names), len(set(n.lower() for n in names)))


class OtherCompanies(unittest.TestCase):
    def test_bgs_options(self):
        page = ('<select><option value="1">EXPRESS: $79.95/card (15 Business Days)</option>'
                '<option value="2">Standard: $24.00/card (45 Business Days)</option></select>'
                "Any card graded a 10 gets a $3 upgrade fee.")
        got = g.parse_bgs(page)
        self.assertEqual(summary(got)["Express"][0], 79.95)
        self.assertEqual(summary(got)["Standard"][2], "45")
        self.assertIn("$3 more", got["note"])

    def test_cgc_levels(self):
        page = ("<p>Card Grading Economy $20 Per Item Est. Turnaround: 90 Business Days Max. FMV: $500 "
                "Card Grading Bulk Economy $15 Per Item Est. Turnaround: 90 Business Days Min. Items: 25 Max. FMV: $500 "
                "Card Grading Unlimited Value $300 + 1% of FMV Per Item Est. Turnaround: 5 Business Days Max. FMV: Unlimited "
                "Jumbo Card Grading Economy $99 Per Item</p>")
        got = g.parse_cgc(page)["levels"]
        by_name = {l["name"]: l for l in got}
        self.assertEqual(by_name["Economy"]["fee"], 20)
        self.assertEqual(by_name["Bulk Economy"]["min"], 25)
        self.assertEqual(by_name["Unlimited Value"]["pct"], 1.0)
        self.assertEqual(len(got), 3)   # (Jumbo cards are left out)


class Helpers(unittest.TestCase):
    def test_money(self):
        self.assertEqual(g.money("$1,500"), 1500)
        self.assertEqual(g.money("$59.99"), 59.99)
        self.assertIsNone(g.money("free"))

    def test_text_of_drops_scripts_and_tags(self):
        self.assertEqual(g.text_of("<script>var a=1;</script><p>Hello&nbsp;&amp; <b>bye</b></p>"), "Hello & bye")

    def test_compare_notices_fee_changes_pauses_and_new_levels(self):
        before = [g.level("Standard", 59.99), g.level("Express", 199), g.level("Value", None, 500, "", True)]
        after = [g.level("Standard", 64.99), g.level("Express", 199, paused=True), g.level("Value", 25, 500), g.level("Super", 349)]
        what = {(c["level"], c["what"]) for c in g.compare("PSA", before, after, "2026-10-12")}
        self.assertEqual(what, {("Standard", "fee"), ("Express", "paused"), ("Value", "reopened"), ("Super", "new")})


if __name__ == "__main__":
    unittest.main()
