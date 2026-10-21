"""grading_fees.py: the readers of the grading companies' pages. Pages change; these keep the known layouts working."""
import gzip
import http.server
import os
import sys
import threading
import unittest
import zlib

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


# Premier Card Grading's page as read on Oct 21 2026: a card per level for TCG's, then the same for Sports
PCG_CARD = ('<div class="card"><h3>{name}</h3><p class="price">${fee}/per card</p><ul><li>Turnaround: {days} Business Days</li>{cap}'
            '<li>Sub grades</li></ul><a href="/products/x">Submit</a></div>')
PCG_PAGE = ("<html><body><nav>Standard shipping · Express returns</nav><h2>TCG's</h2>" +
            PCG_CARD.format(name="Bulk 50+", fee="14.95", days="40 to 60", cap="<li>Insurance Cap: $250 Per Card</li>") +
            PCG_CARD.format(name="Standard", fee="19.95", days="20 to 30", cap="") +
            PCG_CARD.format(name="Express", fee="49.95", days="7-10", cap="<li>Insurance Cap: $10,000 Per Card</li>") +
            "<h2>Sports</h2>" + PCG_CARD.format(name="Express", fee="99.00", days="7-10", cap="") + "</body></html>")


class PCG(unittest.TestCase):
    def test_its_three_levels(self):
        got = g.parse_pcg(PCG_PAGE)
        self.assertEqual(summary(got), {"Bulk 50+": (14.95, 250, "40–60", False), "Standard": (19.95, None, "20–30", False),
                                        "Express": (49.95, 10000, "7–10", False)})                 # (the TCG card, not Sports')
        self.assertEqual(got["levels"][0]["min"], 50)
        self.assertTrue(got["complete"])

    def test_a_changed_page_reads_as_nothing(self):
        got = g.parse_pcg(PCG_PAGE.replace("Express</h3>", "Rush</h3>").replace(">Express<", ">Rush<"))
        self.assertEqual(got["levels"], [])
        self.assertIn("TCG", got["sample"])

    def test_it_is_one_of_the_companies_read(self):
        self.assertIn("PCG", g.COMPANIES)
        self.assertIn("PCG", g.URLS)


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


class Served(http.server.BaseHTTPRequestHandler):
    """A stand-in for a site: each path answers with the bytes and Content-Encoding it was given."""
    pages = {}
    asked = []

    def do_GET(self):
        Served.asked.append(self.headers.get("Accept-Encoding", ""))
        body, encoding = Served.pages.get(self.path, (b"", None))
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Compressed(unittest.TestCase):
    """PSA's page once came back as scrambled bytes (compressed, and not unpacked): the reader must unpack it."""

    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Served)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        raw = PSA_CURRENT.encode("utf-8")
        Served.pages = {
            "/plain": (raw, None),
            "/gzip": (gzip.compress(raw), "gzip"),
            "/gzip-unlabeled": (gzip.compress(raw), None),
            "/deflate": (zlib.compress(raw), "deflate"),
            "/deflate-raw": (zlib.compress(raw)[2:-4], "deflate"),
            "/junk": (bytes([0xfe, 0x9a, 0x01, 0xc3, 0x76, 0x80, 0x48]) * 60, None),
        }
        try:
            import brotli
            Served.pages["/br"] = (brotli.compress(raw), "br")
            Served.pages["/br-unlabeled"] = (brotli.compress(raw), None)
        except ImportError:
            pass
        try:
            import zstandard
            Served.pages["/zstd"] = (zstandard.ZstdCompressor().compress(raw), "zstd")
        except ImportError:
            pass

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def standard_fee(self, path):
        return summary(g.parse_psa(g.fetch(self.base + path)))["Standard"][0]

    def test_plain_gzip_and_deflate_pages_read(self):
        for path in ("/plain", "/gzip", "/gzip-unlabeled", "/deflate", "/deflate-raw"):
            with self.subTest(path=path):
                self.assertEqual(self.standard_fee(path), 59.99)

    def test_brotli_pages_read_when_brotli_is_installed(self):
        for path in ("/br", "/br-unlabeled"):
            if path not in Served.pages:
                self.skipTest("brotli isn't installed here")
            with self.subTest(path=path):
                self.assertEqual(self.standard_fee(path), 59.99)

    def test_zstd_pages_read_when_zstandard_is_installed(self):
        if "/zstd" not in Served.pages:
            self.skipTest("zstandard isn't installed here")
        self.assertEqual(self.standard_fee("/zstd"), 59.99)

    def test_data_that_cant_be_unpacked_says_so_instead_of_printing_junk(self):
        with self.assertRaises(ValueError) as caught:
            g.fetch(self.base + "/junk")
        self.assertIn("couldn't unpack", str(caught.exception))
        self.assertIn("fe 9a 01", str(caught.exception))

    def test_it_asks_for_the_encodings_it_can_unpack(self):
        Served.asked.clear()
        g.fetch(self.base + "/plain")
        self.assertIn("gzip", Served.asked[0])
        self.assertIn("deflate", Served.asked[0])
        self.assertEqual(g.accepted_encodings().split(", ")[:2], ["gzip", "deflate"])

    def test_looks_binary(self):
        self.assertFalse(g.looks_binary("<html><body>Standard $59.99/Card</body></html>"))
        self.assertTrue(g.looks_binary("\ufffd\ufffd\ufffd\ufffdv\ufffdH\ufffd \ufffd~\ufffd\ufffd\ufffd>)W"))
