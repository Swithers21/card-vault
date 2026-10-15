"""A Card Vault window that stays open keeps up with the nightly update, Japanese, Korean and Rush Duel prices included.

Rush Duel cards get their price only from the nightly list (ocg-cards.js), so a window that kept yesterday's list, or
never got one, showed them with no price. These tests run the real page in a headless browser against made-up data files
and check that the list is read again with the new TCGplayer prices, and by "Check for new prices now". They need
Playwright and its browser; without them they are skipped.
"""
import functools
import http.server
import json
import os
import threading
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

try:
    from playwright.sync_api import sync_playwright
except ImportError:     # pragma: no cover
    sync_playwright = None

OLD, NEW = "2026-10-13T22:00:00Z", "2026-10-14T22:00:00Z"
RECORD = {"id": "r1", "name": "Over Rush Volcano", "number": "RD/ORP4-JP076", "rarity": "Over Rush Rare", "edition": "",
          "language": "Japanese", "qty": 1, "quantity": 1, "condition": "Near Mint"}


def js(name, value):
    return "window.%s = %s;" % (name, json.dumps(value))


def tcg(built):
    return js("TCG_DATA", {"format": 2, "generated": built, "builtAt": built, "groups": [[1, "Test Set", "TS", "2026-01-01"]],
                           "rarities": ["Common"], "subtypes": ["Normal"],
                           "products": [[1001, 0, "Test Card", "TST-EN001", 0, [0, 1.0, 0.5, 1.0, 1.0, 1.0], 0]]})


def version(built):
    return js("TCG_DATA_VERSION", {"builtAt": built, "generated": built})


def cards(built, yen):
    """The nightly Japanese/Korean list with one Rush Duel card, priced at this many yen (0: no price)."""
    return js("OCG_CARDS", {"generated": built, "fx": {"JPY": 150, "KRW": 1400}, "names": ["Over Rush Volcano"], "rar": ["Over Rush Rare"],
                            "ja": [""], "jp": [["RD/ORP4", ["", "", ""], [["076", 0, [[0, yen, 3, 0, 0, 0, 0, 0]]]]]], "kr": []})


def market(built):
    return js("OCG_MARKET", {"generated": built, "fx": {"JPY": 150, "KRW": 1400}, "jp": [], "kr": []})


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class OpenWindowRefresh(unittest.TestCase):
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

    def open(self, files):
        """A fresh page whose data files are whatever `files` holds (change it later to publish a new night)."""
        ctx = self.browser.new_context(service_workers="block")
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        ctx.add_init_script("localStorage.setItem('cardvault.v2.collection', %s);" % json.dumps(json.dumps([RECORD])))

        def serve(route):
            name = route.request.url.split("?")[0].rsplit("/", 1)[-1]
            body = files.get(name)
            if body is None or body == 500:
                route.fulfill(status=500 if body == 500 else 404, body="")
            else:
                route.fulfill(status=200, content_type="text/javascript", body=body)
        ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        for name in ("tcgplayer-data.js", "tcgplayer-data-version.js", "ocg-cards.js", "ocg-market.js"):
            ctx.route("**/" + name + "*", serve)
        page.goto("http://127.0.0.1:%d/index.html" % self.server.server_address[1])
        page.wait_for_function("typeof window.CardVault === 'object' && typeof window.CardVault.checkPricesNow === 'function'", timeout=20000)
        return page

    def night(self, built, yen):
        return {"tcgplayer-data.js": tcg(built), "tcgplayer-data-version.js": version(built), "ocg-cards.js": cards(built, yen), "ocg-market.js": market(built)}

    PRICE = "window.CardVault.priceInfo(window.CardVault.state().collection[0]).unit"

    def test_a_window_left_open_reads_the_new_list_with_the_new_prices(self):
        files = self.night(OLD, 0)
        page = self.open(files)
        page.evaluate("window.CardVault.loadOcgCardsSoft()")
        self.assertIsNone(page.evaluate(self.PRICE))
        files.update(self.night(NEW, 120))              # the next night's update is published
        page.evaluate("window.CardVault.checkForNewData(true)")
        page.wait_for_function(self.PRICE + " === 0.8", timeout=15000)

    def test_check_now_gets_the_list_even_when_it_failed_at_start(self):
        files = self.night(OLD, 120)
        files["ocg-cards.js"] = 500
        page = self.open(files)
        page.evaluate("window.CardVault.loadOcgCardsSoft()")
        self.assertIn("couldn't be loaded", page.evaluate("window.CardVault.ocgListStatus()"))
        self.assertIsNone(page.evaluate(self.PRICE))
        files["ocg-cards.js"] = cards(OLD, 120)         # the connection is back
        message = page.evaluate("window.CardVault.checkPricesNow()")
        self.assertIn("up to date", message)
        self.assertIn("Japanese, Korean and Rush Duel prices: from", message)
        self.assertEqual(page.evaluate(self.PRICE), 0.8)

    def test_check_now_loads_newer_prices_even_with_a_card_open(self):
        files = self.night(OLD, 0)
        page = self.open(files)
        page.evaluate("window.CardVault.loadOcgCardsSoft()")
        page.evaluate("document.getElementById('drawer').hidden = false")   # (busy: the automatic update would wait)
        files.update(self.night(NEW, 120))
        message = page.evaluate("window.CardVault.checkPricesNow()")
        self.assertIn("New TCGplayer prices loaded", message)
        self.assertEqual(page.evaluate(self.PRICE), 0.8)

    def test_check_now_says_so_when_the_update_file_cant_be_reached(self):
        files = self.night(OLD, 0)
        page = self.open(files)
        del files["tcgplayer-data-version.js"]
        message = page.evaluate("window.CardVault.checkPricesNow()")
        self.assertIn("Couldn't look for new TCGplayer prices", message)


if __name__ == "__main__":
    unittest.main()
