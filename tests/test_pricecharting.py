"""PriceCharting matching, tried in a real (headless) browser against names PriceCharting actually returned.

The cases are cards from a real collection that once found no match (see fixtures/pricecharting_search.json). It
needs Playwright and its browser; without them the tests are skipped.
"""
import functools
import http.server
import json
import os
import threading
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "pricecharting_search.json"), encoding="utf-8") as f:
    FIXTURE = json.load(f)

try:
    from playwright.sync_api import sync_playwright
except ImportError:     # pragma: no cover
    sync_playwright = None


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def card(number, rarity, edition="", language="English", name="A Card"):
    return {"number": number, "rarity": rarity, "edition": edition, "language": language, "name": name}


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class PriceChartingMatching(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(Quiet, directory=ROOT)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch()
        except Exception as err:        # no browser here
            cls.pw.stop()
            cls.server.shutdown()
            raise unittest.SkipTest("no browser to test with: %s" % str(err)[:80])
        cls.page = cls.browser.new_page()
        cls.page.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        cls.page.goto("http://127.0.0.1:%d/index.html" % cls.server.server_address[1])
        cls.page.wait_for_function("typeof window.CardVault === 'object' && typeof window.CardVault.pcMatch === 'function'", timeout=20000)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()

    def match(self, number, **kw):
        found = self.page.evaluate("([items, r]) => { const it = window.CardVault.pcMatch(items, r); return it ? it['product-name'] : null; }",
                                   [FIXTURE[number], card(number, **kw)])
        return found

    def why(self, number, **kw):
        return self.page.evaluate("([items, r]) => window.CardVault.pcWhy(items, r)", [FIXTURE[number], card(number, **kw)])

    # ---- Overframe naming
    def test_overframe_ultra_rare_is_the_plain_overframe_item(self):
        self.assertEqual(self.match("LOCH-JP017", rarity="Ultra Rare (Overframe)"), "Cyberse Code Magician [Overframe] LOCH-JP017")
        self.assertEqual(self.match("LOCR-JP012", rarity="Ultra Rare (Overframe)"), "Galaxy Defense Robot Orbital 7 [Overframe] LOCR-JP012")

    def test_plain_ultra_rare_still_gets_the_plain_item(self):
        self.assertEqual(self.match("LOCH-JP017", rarity="Ultra Rare"), "Cyberse Code Magician [Ultra Rare] LOCH-JP017")

    def test_other_overframe_rarities_put_the_word_first(self):
        self.assertEqual(self.match("LOCH-JP017", rarity="Prismatic Secret Rare (Overframe)"),
                         "Cyberse Code Magician [Overframe Prismatic Secret Rare] LOCH-JP017")
        self.assertEqual(self.match("LOCH-JP017", rarity="Grand Master Rare"), "Cyberse Code Magician [Overframe Grand Master Rare] LOCH-JP017")

    def test_overframe_secret_rare_is_not_the_plain_overframe(self):
        self.assertIsNone(self.match("LOCH-JP017", rarity="Secret Rare (Overframe)"))

    # ---- Prismatic rarities stay unmatched (PriceCharting's names can't be tied to them safely)
    def test_prismatic_rarities_are_not_guessed(self):
        self.assertIsNone(self.match("RA04-EN054", rarity="Prismatic Collector's Rare", edition="1st Edition"))
        self.assertIsNone(self.match("RA02-EN070", rarity="Prismatic Ultimate Rare", edition="1st Edition"))

    def test_the_rarity_it_does_have_still_matches(self):
        self.assertEqual(self.match("RA04-EN054", rarity="Ultimate Rare", edition="1st Edition"), "The Dark Magicians [Ultimate Rare] RA04-EN054")

    # ---- Reasons
    def test_reason_for_korean_cards(self):
        self.assertEqual(self.why("LDK2-ENS01", rarity="Common", language="Korean"), "PriceCharting doesn't list Korean cards.")

    def test_reason_for_a_rarity_it_doesnt_list(self):
        why = self.why("RA02-EN070", rarity="Prismatic Ultimate Rare", edition="1st Edition")
        self.assertIn("not as Prismatic Ultimate Rare", why)
        self.assertIn("Collector's Rare", why)

    def test_reason_for_a_printing_it_doesnt_list(self):
        self.assertEqual(self.match("LDK2-ENS01", rarity="Ultra Rare", edition="Limited"), None)
        self.assertEqual(self.why("LDK2-ENS01", rarity="Ultra Rare", edition="Limited"),
                         "PriceCharting has it only as Unlimited and 1st Edition, not Limited.")

    def test_reason_when_the_card_number_isnt_there(self):
        why = self.page.evaluate("([items, r]) => window.CardVault.pcWhy(items, r)", [FIXTURE["LDK2-ENS01"], card("XYZ1-EN999", "Ultra Rare")])
        self.assertIn("no card numbered XYZ1-EN999", why)
        self.assertIn("closest it found is Slifer the Sky Dragon", why)


if __name__ == "__main__":
    unittest.main()
