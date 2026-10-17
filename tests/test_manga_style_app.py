"""Manga-Style cards (Original Artwork Collection) in the app: entering, pricing and tracking each version.

A Manga-Style card (YAC1-JP071 to 100) has a black-and-white and a colour version, each as an Ultra Rare and a Secret Rare,
at four prices. These run the real page in a headless browser against a made-up daily list shaped like the real one (and a
made-up BIGWEB answer) and check what a collector would see: every version priced as itself, never as another, entered
and counted on its own. They need Playwright and its browser; without them they are skipped.
"""
import functools
import http.server
import json
import os
import threading
import unittest

import test_open_window_refresh as data

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

try:
    from playwright.sync_api import sync_playwright
except ImportError:     # pragma: no cover
    sync_playwright = None

BUILT = data.NEW
UR_MONO, UR_COLOR = "Ultra Rare (Manga Monochrome)", "Ultra Rare (Manga Color)"
SE_MONO, SE_COLOR = "Secret Rare (Manga Monochrome)", "Secret Rare (Manga Color)"
RAR = [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR, "Super Rare", "Ultra Rare"]
FX = 150.0       # yen to the dollar

# Dark Magician (YAC1-JP071): the colour Secret Rare is sold out. Red-Eyes (072): only some are for sale. Max Metalmorph (070): not Manga-Style.
ROWS = {"071": [[0, 1180, 3, 0, 0, 0, 0, 1], [1, 3500, 1, 0, 0, 0, 0, 1], [2, 2780, 3, 0, 0, 0, 0, 1], [3, 0, 0, 0, 0, 0, 0, 1]],
        "072": [[0, 1580, 3, 0, 0, 0, 0, 2], [1, 0, 0, 0, 0, 0, 0, 2], [2, 0, 0, 0, 0, 0, 0, 2], [3, 7480, 2, 0, 0, 0, 0, 2]],
        "070": [[4, 50, 3, 0, 0, 0, 0, 0]]}


def list_file(rows=ROWS, names=("Max Metalmorph", "Dark Magician", "Red-Eyes Black Dragon"), rar=RAR, ja=("", "ブラック・マジシャン", "真紅眼の黒竜")):
    cards = [[tail, i, rows[tail]] for i, tail in enumerate(sorted(rows))]
    # (the names are in the order of the numbers: 070, 071, 072)
    return data.js("OCG_CARDS", {"generated": BUILT, "fx": {"JPY": FX, "KRW": 1400}, "names": list(names), "rar": list(rar), "ja": list(ja),
                                 "jp": [["YAC1", ["", "", ""], cards]], "kr": []})


def mine(rid, number, rarity, name="Dark Magician", **more):
    r = {"id": rid, "name": name, "number": number, "rarity": rarity, "edition": "", "language": "Japanese", "qty": 1, "quantity": 1,
         "condition": "Near Mint", "setName": "Original Artwork Collection"}
    r.update(more)
    return r


DM = "YAC1-JP071"
BIGWEB_ANSWER = {"items": [
    {"fname": DM, "name": "ブラック・マジシャン【カラー版】", "rarity": {"web": "シークレットレア"}, "condition": {"web": "プレイ用"}, "price": 0, "stock_count": 0, "image": "https://img.example/a.jpg"},
    {"fname": DM, "name": "ブラック・マジシャン【モノクロ】", "rarity": {"web": "シークレットレア"}, "condition": {"web": "プレイ用"}, "price": 2780, "stock_count": 3, "image": "https://img.example/b.jpg"},
    {"fname": DM, "name": "ブラック・マジシャン【カラー版】", "rarity": {"web": "ウルトラレア"}, "condition": {"web": "プレイ用"}, "price": 3500, "stock_count": 1, "image": "https://img.example/c.jpg"},
    {"fname": DM, "name": "ブラック・マジシャン【モノクロ】", "rarity": {"web": "ウルトラレア"}, "condition": {"web": "プレイ用"}, "price": 1180, "stock_count": 3, "image": "https://img.example/d.jpg"}]}
# PriceCharting's items for the card: a "Manga Color" and a "Manga Monochrome" one, not told apart by rarity
PRICECHARTING = [{"product-name": "Dark Magician [Manga Color] " + DM, "console-name": "YuGiOh Japanese Original Artwork Collection"},
                 {"product-name": "Dark Magician [Manga Monochrome] " + DM, "console-name": "YuGiOh Japanese Original Artwork Collection"}]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def usd(yen):
    return round(yen / FX, 2)


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class MangaStyle(unittest.TestCase):
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

    def open(self, records, cards=None, width=1100):
        files = {"tcgplayer-data.js": data.tcg(BUILT), "tcgplayer-data-version.js": data.version(BUILT), "ocg-cards.js": cards or list_file(),
                 "ocg-market.js": data.market(BUILT)}
        ctx = self.browser.new_context(service_workers="block", viewport={"width": width, "height": 900})
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        ctx.add_init_script("localStorage.setItem('cardvault.v2.collection', %s);" % json.dumps(json.dumps(records)))
        ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        ctx.route("**/api.bigweb.co.jp/**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(BIGWEB_ANSWER),
                                                                         headers={"access-control-allow-origin": "*"}))
        def serve(body):
            return lambda route: route.fulfill(status=200, content_type="text/javascript", body=body)
        for name in files:
            ctx.route("**/" + name + "*", serve(files[name]))
        page.goto("http://127.0.0.1:%d/index.html" % self.server.server_address[1])
        page.wait_for_function("typeof window.CardVault === 'object'", timeout=20000)
        return page

    def ready(self, page):
        page.wait_for_function("!!window.CardVault.ocgCd().data", timeout=8000)
        return page

    def tearDown(self):
        self.assertEqual(self.errors, [], "the page reported errors")

    def unit(self, page, rid):
        return page.evaluate("(id) => { const v = window.CardVault; return v.priceInfo(v.state().collection.find(r => r.id === id)).unit; }", rid)

    # ----- prices: each version as itself
    def test_each_version_is_priced_as_itself(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, UR_COLOR), mine("c", DM, SE_MONO), mine("d", DM, SE_COLOR)]
        page = self.ready(self.open(records))
        page.wait_for_function("window.CardVault.state().collection.length === 4")
        page.wait_for_timeout(400)
        for rid, yen in (("a", 1180), ("b", 3500), ("c", 2780)):
            self.assertAlmostEqual(self.unit(page, rid), usd(yen), places=2, msg=rid)
        self.assertIsNone(self.unit(page, "d"))         # (sold out, no price seen: not another version's)

    def test_the_collection_total_counts_each_version_at_its_own_price(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, UR_COLOR), mine("c", DM, SE_MONO, qty=2, quantity=2)]
        page = self.ready(self.open(records))
        total = usd(1180) + usd(3500) + 2 * usd(2780)
        page.wait_for_function("document.getElementById('totalValue').textContent === '$%.2f'" % total, timeout=5000)

    def test_a_version_the_list_has_but_never_priced_says_so(self):
        page = self.ready(self.open([mine("d", DM, SE_COLOR)]))
        page.wait_for_timeout(300)
        info = page.evaluate("(() => { const v = window.CardVault, r = v.state().collection[0]; const f = v.ocgFilePrice(r); return [f.none, f.note]; })()")
        self.assertEqual(info, [True, "sold out, no price seen yet"])

    def test_a_card_with_no_version_named_is_not_given_one_version_s_price(self):
        page = self.ready(self.open([mine("p", DM, "Ultra Rare"), mine("q", DM, "")]))
        page.wait_for_timeout(300)
        for rid in ("p", "q"):
            self.assertIsNone(self.unit(page, rid), rid)
        note = page.evaluate("(() => { const v = window.CardVault; return v.ocgFilePrice(v.state().collection.find(r => r.id === 'p')).note; })()")
        self.assertEqual(note, "which version is yours?")

    def test_a_card_with_no_version_named_shows_the_versions_and_their_prices_to_choose_from(self):
        page = self.ready(self.open([mine("p", DM, "Ultra Rare")]))
        page.evaluate("window.CardVault.openDetails('p')")
        page.wait_for_selector("#drawer:not([hidden]) #ocgPrice")
        page.wait_for_timeout(400)
        text = page.inner_text("#ocgPrice")
        self.assertIn("separate versions", text)
        for rarity, price in ((UR_MONO, "¥1,180"), (UR_COLOR, "¥3,500"), (SE_MONO, "¥2,780"), (SE_COLOR, "no price")):
            self.assertRegex(text, r"%s: %s" % (rarity.replace("(", r"\(").replace(")", r"\)"), price))

    def test_a_want_list_card_is_priced_as_its_version_too(self):
        page = self.open([mine("a", DM, UR_MONO)])
        self.ready(page)
        got = page.evaluate("""(() => { const v = window.CardVault, w = r => { const p = v.ocgPrice({number: '%s', name: 'Dark Magician', language: 'Japanese', rarity: r}); return p && !p.none ? p.local : null; };
          return [w('%s'), w('%s'), w('%s'), w('Ultra Rare')]; })()""" % (DM, UR_COLOR, UR_MONO, SE_MONO))
        self.assertEqual(got, [3500, 1180, 2780, None])

    def test_a_card_that_is_not_manga_style_is_as_it_was(self):
        page = self.ready(self.open([mine("m", "YAC1-JP070", "Super Rare", name="Max Metalmorph")]))
        page.wait_for_timeout(300)
        self.assertAlmostEqual(self.unit(page, "m"), usd(50), places=2)

    def test_a_version_of_a_card_the_list_has_only_plain_is_priced_from_the_plain_row(self):
        # (the list or the shop doesn't tell this card's versions apart: the one price there is, not none)
        rows = {"071": [[5, 900, 3, 0, 0, 0, 0, 1]]}
        page = self.ready(self.open([mine("a", DM, UR_COLOR)], cards=list_file(rows, names=("Dark Magician",), ja=("", "ブラック・マジシャン"))))
        page.wait_for_timeout(300)
        self.assertAlmostEqual(self.unit(page, "a"), usd(900), places=2)

    # ----- entering a card
    def add_by_number(self, page, number):
        page.evaluate("window.CardVault.openAdd({number: %s})" % json.dumps(number))
        page.wait_for_selector(".results .result")

    def test_the_card_is_offered_in_every_version_with_its_own_price_and_names(self):
        page = self.open([])
        self.add_by_number(page, DM)
        results = page.locator(".results .result")
        self.assertEqual(results.count(), 4)
        text = [results.nth(i).inner_text() for i in range(4)]
        self.assertEqual([next(r for r in RAR[:4] if r in t) for t in text], [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR])
        self.assertIn("¥1,180", text[0])
        self.assertIn("¥3,500", text[1])
        self.assertIn("¥2,780", text[2])
        self.assertIn("No price", text[3])
        for t in text:
            self.assertIn("Dark Magician", t)
            self.assertIn("ブラック・マジシャン", t)
            self.assertNotIn("【", t)

    def pick(self, page, index):
        page.locator(".results .result").nth(index).click()
        page.wait_for_selector("#ocgForm")
        page.click("#ocgForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")

    def test_adding_a_version_keeps_the_version_and_the_english_name(self):
        page = self.open([])
        self.add_by_number(page, DM)
        self.pick(page, 1)
        rec = page.evaluate("window.CardVault.state().collection.map(r => [r.name, r.number, r.rarity, r.language, r.qty])")
        self.assertEqual(rec, [["Dark Magician", DM, UR_COLOR, "Japanese", 1]])
        page.wait_for_function("document.getElementById('totalValue').textContent === '$%.2f'" % usd(3500), timeout=5000)

    def test_two_versions_of_a_card_stay_two_entries_and_the_same_version_adds_up(self):
        page = self.open([])
        for index in (0, 1, 0):
            self.add_by_number(page, DM)
            self.pick(page, index)
        rec = page.evaluate("window.CardVault.state().collection.map(r => [r.rarity, r.qty])")
        self.assertEqual(sorted(rec), sorted([[UR_MONO, 2], [UR_COLOR, 1]]))

    def test_a_card_can_be_found_by_its_english_name(self):
        page = self.open([])
        page.evaluate("window.CardVault.loadOcgCards(); 0")
        self.ready(page)
        hits = page.evaluate("window.CardVault.ocgNameHits('Dark Magician').map(c => [c.number, c.rows.map(x => x.rarity)])")
        self.assertEqual(hits, [[DM, [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR]]])

    def test_the_version_can_be_picked_when_adding_by_hand_or_editing(self):
        page = self.open([mine("a", DM, UR_MONO)])
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#drawer:not([hidden]) #eRarity")
        names = page.evaluate("Array.from(document.querySelectorAll('#eRarity option')).map(o => o.value)")
        for rarity in RAR[:4]:
            self.assertIn(rarity, names)
        self.assertEqual(page.input_value("#eRarity"), UR_MONO)
        page.select_option("#eRarity", UR_COLOR)       # (a card entered as the wrong version is changed to the right one)
        page.click("#drawer button[type=submit]")
        page.wait_for_function("window.CardVault.state().collection[0].rarity === %s" % json.dumps(UR_COLOR))

    # ----- seeing and sorting them
    def test_each_card_in_the_binder_shows_which_version_it_is(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, SE_COLOR), mine("m", "YAC1-JP070", "Super Rare", name="Max Metalmorph")]
        page = self.ready(self.open(records))
        page.wait_for_selector(".tile")
        badges = page.evaluate("Object.fromEntries(Array.from(document.querySelectorAll('.tile')).map(t => [t.dataset.card, Array.from(t.querySelectorAll('.ed-mg')).map(b => b.textContent)]))")
        self.assertEqual(badges, {"a": ["Manga mono"], "b": ["Manga color"], "m": []})

    def test_the_manga_style_filter_shows_only_those(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, SE_COLOR), mine("m", "YAC1-JP070", "Super Rare", name="Max Metalmorph")]
        page = self.ready(self.open(records))
        page.evaluate("(() => { const s = document.getElementById('fShow'); s.value = 'manga'; s.dispatchEvent(new Event('change', {bubbles: true})); })()")
        page.wait_for_function("document.querySelectorAll('.tile').length === 2")
        self.assertEqual(sorted(page.evaluate("Array.from(document.querySelectorAll('.tile')).map(t => t.dataset.card)")), ["a", "b"])

    def test_typing_the_version_in_the_search_box_finds_it(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, SE_COLOR), mine("m", "YAC1-JP070", "Super Rare", name="Max Metalmorph")]
        page = self.ready(self.open(records))
        for words, found in (("monochrome", ["a"]), ("black and white", ["a"]), ("manga color", ["b"]), ("colour", ["b"]), ("manga", ["a", "b"])):
            page.fill("#q", words)
            page.wait_for_function("document.querySelectorAll('.tile').length === %d" % len(found))
            self.assertEqual(sorted(page.evaluate("Array.from(document.querySelectorAll('.tile')).map(t => t.dataset.card)")), found, words)

    def test_the_card_window_names_the_version_and_its_price(self):
        page = self.ready(self.open([mine("b", DM, UR_COLOR)]))
        page.evaluate("window.CardVault.openDetails('b')")
        page.wait_for_selector("#drawer:not([hidden])")
        page.wait_for_timeout(400)
        text = page.inner_text("#drawerBody")
        self.assertIn(UR_COLOR, text)
        self.assertIn("¥3,500", text)

    # ----- the set
    def test_a_set_counts_a_manga_style_number_once_however_many_versions_you_have(self):
        records = [mine("a", DM, UR_MONO), mine("b", DM, UR_COLOR), mine("c", DM, SE_MONO)]
        page = self.ready(self.open(records))
        prog = page.evaluate("(() => { const v = window.CardVault, set = v.ocgCd().data.jp.get('YAC1'); const p = v.ocgSetProgress(set); return [p.have, p.total]; })()")
        self.assertEqual(prog, [1, 3])

    # ----- the shop, asked right now from the phone (for a card the daily list doesn't have yet)
    def test_the_shops_answer_is_told_apart_by_version(self):
        page = self.open([])
        out = page.evaluate("""async () => {
          const v = window.CardVault, bw = await v.bigwebFor('%s', true);
          const pick = r => { const p = v.bigwebPick(bw.items, r); return p ? [p.price, p.name] : null; };
          return {rarities: bw.items.map(x => x.rarity).sort(), mono: pick('Ultra Rare (Manga Monochrome)'), color: pick('Ultra Rare (Manga Color)'),
                  seColor: pick('Secret Rare (Manga Color)'), plain: pick('Ultra Rare')};
        }""" % DM)
        self.assertEqual(out["rarities"], sorted([UR_MONO, UR_COLOR, SE_MONO, SE_COLOR]))
        self.assertEqual(out["mono"], [1180, "ブラック・マジシャン"])
        self.assertEqual(out["color"], [3500, "ブラック・マジシャン"])
        self.assertIsNone(out["seColor"][0])             # (sold out: no price)
        self.assertIsNone(out["plain"])                 # (which version? not a guess)

    # ----- graded prices (PriceCharting)
    def graded(self, page, rarity):
        return page.evaluate("([items, r]) => { const it = window.CardVault.pcMatch(items, r); return it ? it['product-name'] : null; }",
                             [PRICECHARTING, {"number": DM, "rarity": rarity, "edition": "", "language": "Japanese", "name": "Dark Magician"}])

    def test_graded_prices_come_from_the_matching_version(self):
        page = self.open([])
        self.assertEqual(self.graded(page, UR_COLOR), "Dark Magician [Manga Color] " + DM)
        self.assertEqual(self.graded(page, SE_COLOR), "Dark Magician [Manga Color] " + DM)
        self.assertEqual(self.graded(page, UR_MONO), "Dark Magician [Manga Monochrome] " + DM)
        self.assertEqual(self.graded(page, SE_MONO), "Dark Magician [Manga Monochrome] " + DM)

    def test_graded_prices_are_not_shared_between_versions(self):
        # (their saved answers are kept apart: one version's price is never the other's)
        page = self.open([mine("a", DM, UR_MONO), mine("b", DM, UR_COLOR), mine("c", DM, SE_COLOR), mine("m", "YAC1-JP070", "Super Rare", name="Max Metalmorph")])
        keys = page.evaluate("window.CardVault.state().collection.map(r => window.CardVault.pcKey(r))")
        self.assertEqual(len(set(keys[:3])), 3)
        self.assertEqual(keys[3], "n|YAC1-JP070|max metalmorph|")      # (another card's key is as it was)


if __name__ == "__main__":
    unittest.main()
