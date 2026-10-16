"""The collection's total doesn't sit low for the first seconds after opening Card Vault.

Japanese, Korean and Rush Duel cards are priced from a list that has to be fetched; until it is here they count as $0.
These tests run the real page in a headless browser against made-up data files (one English card at $25, one Rush Duel
card at 1,500 yen, which is $10) and hold the list back to check that it is asked for straight away and that the total
is corrected the moment it arrives. They need Playwright and its browser; without them they are skipped.
"""
import functools
import http.server
import json
import os
import threading
import time
import unittest

import test_open_window_refresh as data

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

try:
    from playwright.sync_api import sync_playwright
except ImportError:     # pragma: no cover
    sync_playwright = None

BUILT = data.NEW
ENGLISH = {"id": "r2", "productId": 1001, "name": "Test Card", "number": "TST-EN001", "rarity": "Common", "edition": "Normal",
           "language": "English", "qty": 1, "quantity": 1, "condition": "Near Mint"}
TCG = data.js("TCG_DATA", {"format": 2, "generated": BUILT, "builtAt": BUILT, "groups": [[1, "Test Set", "TS", "2026-01-01"]],
                           "rarities": ["Common"], "subtypes": ["Normal"], "products": [[1001, 0, "Test Card", "TST-EN001", 0, [0, 25.0, 20.0, 25.0, 25.0, 25.0], 0]]})
TOTAL = "document.getElementById('totalValue').textContent"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class StartUpPrices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch()
        except Exception as err:        # no browser here
            cls.pw.stop()
            cls.server.shutdown()
            raise unittest.SkipTest("no browser to test with: %s" % str(err)[:80])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()

    def open(self, records, hold=("ocg-cards.js",)):
        """A page that opens with these cards. The files named in `hold` aren't answered until the test says so."""
        files = {"tcgplayer-data.js": TCG, "tcgplayer-data-version.js": data.version(BUILT), "ocg-cards.js": data.cards(BUILT, 1500), "ocg-market.js": data.market(BUILT)}
        self.held = {}      # name -> the request waiting for an answer
        ctx = self.browser.new_context(service_workers="block")
        self.addCleanup(ctx.close)
        self.addCleanup(self.let_go)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        ctx.add_init_script("localStorage.setItem('cardvault.v2.collection', %s);" % json.dumps(json.dumps(records)))

        def serve(route):
            name = route.request.url.split("?")[0].rsplit("/", 1)[-1]
            if name in hold:
                self.held[name] = route
            else:
                route.fulfill(status=200, content_type="text/javascript", body=files[name])
        ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        for name in files:
            ctx.route("**/" + name + "*", serve)
        self.started = time.time()
        page.goto("http://127.0.0.1:%d/index.html" % self.server.server_address[1])
        page.wait_for_function("typeof window.CardVault === 'object'", timeout=20000)
        return page

    def let_go(self):
        """(whatever is still waiting is dropped before the page closes)"""
        for route in self.held.values():
            try:
                route.abort()
            except Exception:       # pragma: no cover
                pass
        self.held = {}

    def answer(self, name):
        route = self.held.pop(name)
        route.fulfill(status=200, content_type="text/javascript", body={"ocg-cards.js": data.cards(BUILT, 1500), "ocg-market.js": data.market(BUILT)}[name])

    def wait_until_asked(self, page, name, seconds):
        deadline = time.time() + seconds
        while name not in self.held and time.time() < deadline:
            page.wait_for_timeout(50)
        return name in self.held

    def tearDown(self):
        self.assertEqual(self.errors, [], "the page reported errors")

    def test_the_list_is_asked_for_straight_away_when_you_have_such_cards(self):
        page = self.open([ENGLISH, data.RECORD])
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5), "the list wasn't asked for within 1.5 seconds")
        self.assertEqual(page.evaluate(TOTAL), "$25.00")           # (the English card; the other is waiting for its price)
        self.answer("ocg-cards.js")
        page.wait_for_function(TOTAL + " === '$35.00'", timeout=5000)

    def test_the_total_is_right_as_soon_as_the_list_is_in_without_waiting_for_the_set_names(self):
        page = self.open([ENGLISH, data.RECORD], hold=("ocg-cards.js", "ocg-market.js"))
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.answer("ocg-cards.js")
        self.assertTrue(self.wait_until_asked(page, "ocg-market.js", 3))     # (it follows, and is slow)
        page.wait_for_function(TOTAL + " === '$35.00'", timeout=3000)
        self.assertIn("ocg-market.js", self.held)                      # (still waiting)

    def test_nothing_extra_is_fetched_when_you_have_no_such_cards(self):
        page = self.open([ENGLISH])
        self.assertFalse(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.assertEqual(page.evaluate(TOTAL), "$25.00")


if __name__ == "__main__":
    unittest.main()
