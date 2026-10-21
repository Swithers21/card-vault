"""Opening faster, and room for the saved lookups.

- tcgplayer-data.js is written as JSON.parse("..."), which a phone reads two to three times faster than the same data
  written as code; the website, Card Vault.html and every nightly script that reads the file read both shapes.
- The cards-by-number index is made the first time something looks a number up, not while opening.
- A big binder draws its first screens of cards at once and the rest straight after.
- Card search's list is made ready in the background, so the first search is as quick as the next.
- The saved lookups (PriceCharting matches, Yugipedia photo searches and the like) move from the browser's small local
  storage to its database (IndexedDB), are read back from there next time, and stay in local storage where there's no
  database.
The browser ones need Playwright and its browser.
"""
import json
import os
import sys
import unittest

from test_sealed_app import SealedBase
from test_themes_app import eng, tcg

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
import card_history  # noqa: E402
import card_scans  # noqa: E402
import check_site  # noqa: E402
import cloud_alerts  # noqa: E402
import stand_in_images  # noqa: E402
import update_tcgplayer_data  # noqa: E402

YUGI = "cardvault.v2.yugipedia"
PC = "cardvault.v2.pricecharting"


def as_parse(text):
    """The same file, the way the nightly update writes it now."""
    return update_tcgplayer_data.data_file_text(card_history.window_value(text[text.index("=", text.index("window.TCG_DATA")) + 1:]))


class DataFileShape(unittest.TestCase):
    DATA = {"format": 4, "generated": "2026-10-21T04:00:00+00:00", "groups": [[1, "Set \"Quoted\" é", "SET", "2020-01-01"]],
            "products": [[1, 1, "Dark Magician </script> \\ back", "SET-EN001", 0, [0, 1.5, 1.0, None, None, None]]]}

    def test_every_reader_reads_both_shapes(self):
        new = update_tcgplayer_data.data_file_text(self.DATA)
        self.assertIn("window.TCG_DATA = JSON.parse(\"", new)
        self.assertTrue(new.isascii())
        old = "/* x */\nwindow.TCG_DATA = " + json.dumps(self.DATA) + ";\n"
        for text in (new, old):
            body = text[text.index("=", text.index("window.TCG_DATA")) + 1:]
            for module in (card_history, card_scans, check_site, cloud_alerts, stand_in_images):
                self.assertEqual(module.window_value(body), self.DATA, module.__name__)

    def test_the_scripts_read_it_from_the_file(self):
        import tempfile
        folder = tempfile.mkdtemp()
        path = os.path.join(folder, "tcgplayer-data.js")
        with open(path, "w", encoding="ascii") as handle:
            handle.write(update_tcgplayer_data.data_file_text(self.DATA))
        self.assertEqual(card_history.read_data(path), self.DATA)
        self.assertEqual(stand_in_images.read_data(path), self.DATA)
        self.assertEqual(card_scans.read_js(path, "TCG_DATA")[1], self.DATA)
        self.assertEqual(check_site.read_window_json(path), self.DATA)


class Speed(SealedBase):
    def test_the_json_parse_shape_loads(self):
        page = self.open([eng("a", 13, "Shaddoll Dragon", "DUEA-EN020")], files={"tcgplayer-data.js": as_parse(tcg())})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        self.assertEqual(self.unit(page, "a"), 1.0)
        # (and when it's fetched again, as when new prices come while Card Vault is open)
        self.assertEqual(page.evaluate("window.CardVault.readDataText(%s).products.length" % json.dumps(as_parse(tcg()))) > 0, True)

    def test_cards_by_number_are_found_without_being_indexed_while_opening(self):
        page = self.open([], files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        self.assertTrue(page.evaluate("typeof Object.getOwnPropertyDescriptor(window.CardVault.state().catalog, 'byNumber').get === 'function'"))
        self.assertEqual(page.evaluate("window.CardVault.findByNumber('DUEA-EN020').map(p => p.name)"), ["Shaddoll Dragon"])
        self.assertEqual(page.evaluate("window.CardVault.findByNumber('duea-en020').length"), 1)

    def test_a_big_binder_draws_the_first_cards_then_all_of_them(self):
        records = [eng("r%d" % i, 13, "Card %03d" % i, "TST-EN%03d" % i) for i in range(400)]
        page = self.open(records)
        page.wait_for_function("document.querySelectorAll('#collection .tile').length >= 60")
        page.wait_for_function("document.querySelectorAll('#collection .tile').length === 400", timeout=10000)
        # (redrawn, a filter say: the drawing that was going on stops, and the new list is drawn once)
        page.evaluate("window.CardVault.render()")
        page.evaluate("window.CardVault.render()")
        page.wait_for_timeout(500)
        self.assertEqual(page.evaluate("document.querySelectorAll('#collection .tile').length"), 400)
        self.assertEqual(page.evaluate("new Set([...document.querySelectorAll('#collection .tile')].map(t => t.dataset.card)).size"), 400)

    def test_card_search_is_made_ready_in_the_background(self):
        page = self.open([], files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        page.wait_for_function("(() => { const c = window.CardVault.state().catalog; return !!c.csNames && c.csHay && c.csHay.size === c.products.length; })()", timeout=10000)

    # ----- the saved lookups
    def test_they_move_to_the_database_and_are_read_back_from_it(self):
        yugi = {"LOB-EN001|dark magician|2": {"t": 1760000000000, "title": "Dark Magician", "images": []}}
        pc = {"x": {"id": 5, "t": 1760000000000}}
        page = self.open([], local={YUGI: json.dumps(yugi), PC: json.dumps(pc)})
        page.wait_for_function("window.CardVault.big().settled")
        page.wait_for_function("localStorage.getItem(%s) === null && localStorage.getItem(%s) === null" % (json.dumps(YUGI), json.dumps(PC)))
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(YUGI)), yugi)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object' && window.CardVault.big().settled")
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(YUGI)), yugi)
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(PC)), pc)
        self.assertEqual(page.evaluate("Object.keys(window.CardVault.yugiCache())"), list(yugi))
        self.assertIsNone(page.evaluate("localStorage.getItem(%s)" % json.dumps(YUGI)))
        # (and one looked up now goes to the database too, not to local storage)
        page.evaluate("window.CardVault.bigSet(%s, {fresh: 1})" % json.dumps(YUGI))
        page.wait_for_timeout(300)
        self.assertIsNone(page.evaluate("localStorage.getItem(%s)" % json.dumps(YUGI)))
        self.assertEqual(page.evaluate("""(key) => new Promise(done => { const o = indexedDB.open('cardvault', 1);
            o.onsuccess = () => { const g = o.result.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => done(g.result); }; })""", YUGI), {"fresh": 1})

    def test_one_looked_up_just_before_closing_is_kept(self):
        page = self.open([])
        page.wait_for_function("window.CardVault.big().settled")
        page.evaluate("window.CardVault.bigSet(%s, {k: 1})" % json.dumps(PC))
        page.reload()      # (straight away: the database may not have finished)
        page.wait_for_function("typeof window.CardVault === 'object' && window.CardVault.big().settled")
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(PC)), {"k": 1})

    def test_one_looked_up_while_the_database_opens_is_added_to_the_ones_kept(self):
        page = self.open([])
        page.wait_for_function("window.CardVault.big().settled")
        page.evaluate("window.CardVault.bigSet(%s, {old: 1, both: 'old'})" % json.dumps(PC))
        page.wait_for_timeout(300)
        # (next time: one more, written to local storage before the database was open)
        page.evaluate("localStorage.setItem(%s, JSON.stringify({both: 'new', added: 2}))" % json.dumps(PC))
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object' && window.CardVault.big().settled")
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(PC)), {"old": 1, "both": "new", "added": 2})

    def test_without_a_database_they_stay_in_local_storage(self):
        page = self.browser.new_context(service_workers="block").new_page()
        self.addCleanup(page.context.close)
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.context.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        page.context.add_init_script("Object.defineProperty(window, 'indexedDB', {value: undefined});")
        page.goto("http://127.0.0.1:%d/index.html" % self.server.server_address[1])
        page.wait_for_function("typeof window.CardVault === 'object' && window.CardVault.big().settled", timeout=20000)
        page.evaluate("window.CardVault.bigSet(%s, {k: 2})" % json.dumps(PC))
        self.assertEqual(json.loads(page.evaluate("localStorage.getItem(%s)" % json.dumps(PC))), {"k": 2})
        self.assertEqual(page.evaluate("window.CardVault.bigGet(%s, null)" % json.dumps(PC)), {"k": 2})


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(DataFileShape))
    suite.addTests(loader.loadTestsFromTestCase(Speed))
    return suite


if __name__ == "__main__":
    unittest.main()
