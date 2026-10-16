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
        self.hold = set(hold)
        ctx = self.browser.new_context(service_workers="block")
        self.addCleanup(ctx.close)
        self.addCleanup(self.let_go)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        ctx.add_init_script("localStorage.setItem('cardvault.v2.collection', %s);" % json.dumps(json.dumps(records)))

        def serve(route):
            name = route.request.url.split("?")[0].rsplit("/", 1)[-1]
            if name in self.hold:
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

    def answer(self, name, yen=1500):
        route = self.held.pop(name)
        route.fulfill(status=200, content_type="text/javascript", body={"ocg-cards.js": data.cards(BUILT, yen), "ocg-market.js": data.market(BUILT)}[name])

    def fail(self, name):
        self.held.pop(name).fulfill(status=500, body="")

    def reopen(self, page, hold=("ocg-cards.js",)):
        """Close and open Card Vault again on the same device (what it saved stays), with the list held back."""
        self.hold = set(hold)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'", timeout=20000)
        page.wait_for_function(TOTAL + " !== '$0.00'", timeout=5000)

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

    # ----- the second time: last time's prices stand in until the list is here
    def first_visit(self, yen=1500, records=None):
        page = self.open(records or [ENGLISH, data.RECORD], hold=())
        page.wait_for_function(TOTAL + " === '$%.2f'" % (25 + yen / 150.0), timeout=5000)
        return page

    def test_the_total_is_right_from_the_first_moment_the_second_time(self):
        page = self.first_visit()
        self.reopen(page)
        self.assertEqual(page.evaluate(TOTAL), "$35.00")        # (not $25.00: the list is still on its way)
        self.assertEqual(page.evaluate("document.getElementById('valueSub').textContent"), "")     # (no "1 card without a price")
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))

    def test_todays_price_takes_over_when_the_list_arrives(self):
        page = self.first_visit()
        self.reopen(page)
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.answer("ocg-cards.js", yen=3000)                  # (it went up to $20)
        page.wait_for_function(TOTAL + " === '$45.00'", timeout=5000)
        self.reopen(page, hold=("ocg-cards.js",))             # (and that is what is remembered next time)
        self.assertEqual(page.evaluate(TOTAL), "$45.00")

    def test_a_card_the_list_no_longer_prices_is_not_kept_at_the_old_price(self):
        page = self.first_visit()
        self.reopen(page)
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.answer("ocg-cards.js", yen=0)                     # (the list has no price for it now)
        page.wait_for_function(TOTAL + " === '$25.00'", timeout=5000)

    def test_when_the_list_cant_be_read_nothing_stands_in_for_it(self):
        page = self.first_visit()
        self.reopen(page)
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.fail("ocg-cards.js")
        page.wait_for_function(TOTAL + " === '$25.00'", timeout=5000)

    def test_asking_again_after_a_failure_doesnt_bring_last_times_price_back(self):
        page = self.first_visit()
        self.reopen(page)
        self.assertTrue(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.fail("ocg-cards.js")
        page.wait_for_function(TOTAL + " === '$25.00'", timeout=5000)
        self.hold.add("tcgplayer-data-version.js")             # ("Check for new prices now", while the update file is slow to answer)
        page.evaluate("window.CardVault.checkPricesNow(); 0")
        page.wait_for_timeout(300)
        self.assertIsNone(page.evaluate("(() => { const v = window.CardVault; return v.priceInfo(v.state().collection.find(r => r.name === 'Over Rush Volcano')).unit; })()"))

    def test_the_card_window_doesnt_talk_about_the_price_it_is_still_waiting_for(self):
        mine = dict(data.RECORD, manualPrice=2, condition="Lightly Played")
        page = self.open([ENGLISH, mine], hold=())
        page.wait_for_function(TOTAL + " === '$33.50'", timeout=5000)     # (a Lightly Played copy: 85% of $10)
        self.reopen(page)
        page.evaluate("window.CardVault.openDetails(window.CardVault.state().collection.find(r => r.name === 'Over Rush Volcano').id)")
        page.wait_for_selector("#drawer:not([hidden])")
        page.wait_for_timeout(300)
        text = page.inner_text("#drawerBody")
        self.assertNotIn("not your estimate", text)
        self.assertNotIn("of that price", text)

    def test_an_estimate_of_your_own_gives_way_to_last_times_list_price(self):
        mine = dict(data.RECORD, manualPrice=2)
        page = self.first_visit(records=[ENGLISH, mine])
        self.reopen(page)
        self.assertEqual(page.evaluate(TOTAL), "$35.00")        # (not $27.00, then $35.00)

    def test_a_condition_other_than_near_mint_still_applies_to_the_kept_price(self):
        played = dict(data.RECORD, condition="Lightly Played")
        page = self.open([ENGLISH, played], hold=())
        page.wait_for_function("window.CardVault.state().collection.length === 2 && !document.getElementById('totalValue').textContent.includes('$0.00')", timeout=5000)
        settled = page.evaluate(TOTAL)
        self.assertNotEqual(settled, "$35.00")                  # (a played copy is worth a share of the Near Mint price)
        self.reopen(page)
        self.assertEqual(page.evaluate(TOTAL), settled)

    def test_nothing_is_kept_for_a_collection_without_such_cards(self):
        page = self.open([ENGLISH], hold=())
        page.wait_for_timeout(500)
        self.assertIn(page.evaluate("localStorage.getItem('cardvault.v2.ocgKept')"), (None, "{}"))

    def test_nothing_extra_is_fetched_when_you_have_no_such_cards(self):
        page = self.open([ENGLISH])
        self.assertFalse(self.wait_until_asked(page, "ocg-cards.js", 1.5))
        self.assertEqual(page.evaluate(TOTAL), "$25.00")


if __name__ == "__main__":
    unittest.main()
