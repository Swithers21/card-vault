"""Sealed products (booster boxes, packs, tins, decks) in the app: English from TCGplayer, Japanese and Korean from their shops.

These run the real page in a headless browser against made-up data shaped like the real files (TCGplayer's price file with
sealed products, Yugi-Market's product lists, the Market's Korean box prices) and check what a collector would do and see:
add a box by name, see it priced and its price move, keep several together, find it again, and move it from the want list.
They need Playwright and its browser; without them they are skipped.
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
# English sealed products on TCGplayer: [id, set, name, number, rarity, [subtype, market, low, 1 day ago, 7 days ago, 30 days ago], sealed]
BOX, PACK, TIN = 5001, 5002, 5003
SEALED = [
    [BOX, 0, "Rarity Collection Booster Box", "", 0, [0, 100.0, 95.0, 98.0, 90.0, 80.0], 1],
    [PACK, 0, "Rarity Collection Booster Pack", "", 0, [0, 4.0, 3.5, 4.0, 4.0, 5.0], 1],
    [TIN, 1, "Mega Tin 2026", "", 0, [0, 30.0, 28.0, 30.0, 30.0, 30.0], 1],
]
SINGLE = [1001, 0, "Test Card", "TST-EN001", 0, [0, 25.0, 20.0, 25.0, 25.0, 25.0], 0]


def tcg(products=SEALED + [SINGLE]):
    return data.js("TCG_DATA", {"format": 4, "generated": BUILT, "builtAt": BUILT, "groups": [[1, "Rarity Collection", "RA01", "2026-01-01"], [2, "Mega Tins", "MT26", "2026-02-01"]],
                                "rarities": ["Common"], "subtypes": ["Normal"], "products": products,
                                "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


def sealed(rid, pid, name, setName="Rarity Collection", **more):
    r = {"id": rid, "productId": pid, "sealed": True, "name": name, "productName": name, "setName": setName, "number": "", "rarity": "", "edition": "",
         "condition": "Sealed", "language": "English", "qty": 1, "quantity": 1}
    r.update(more)
    return r


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class SealedBase(unittest.TestCase):
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

    def open(self, records=(), wants=(), files=None, routes=None, width=1100, local=None):
        files = dict({"tcgplayer-data.js": tcg(), "tcgplayer-data-version.js": data.version(BUILT), "ocg-cards.js": data.cards(BUILT, 1500), "ocg-market.js": data.market(BUILT)}, **(files or {}))
        ctx = self.browser.new_context(service_workers="block", viewport={"width": width, "height": 900})
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        extra = "".join("localStorage.setItem(%s, %s);" % (json.dumps(k), json.dumps(v)) for k, v in (local or {}).items())
        ctx.add_init_script("if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('cardvault.v2.collection', %s); localStorage.setItem('cardvault.v2.wants', %s); %s }"
                            % (json.dumps(json.dumps(list(records))), json.dumps(json.dumps(list(wants))), extra))
        ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        def answer(body):
            def go(route):
                if body is None:        # the shop can't be reached
                    return route.abort()
                value = body(route.request.url) if callable(body) else body
                route.fulfill(status=200, content_type="application/json", body=json.dumps(value), headers={"access-control-allow-origin": "*"})
            return go
        for pattern, body in (routes or {}).items():
            ctx.route(pattern, answer(body))

        def serve(body):
            if body is None:        # the file can't be fetched at all
                return lambda route: route.abort()
            return lambda route: route.fulfill(status=200, content_type="text/javascript", body=body)
        for name in files:
            ctx.route("**/" + name + "*", serve(files[name]))
        page.goto("http://127.0.0.1:%d/index.html" % self.server.server_address[1])
        page.wait_for_function("typeof window.CardVault === 'object'", timeout=20000)
        return page

    def tearDown(self):
        self.assertEqual(self.errors, [], "the page reported errors")

    def unit(self, page, rid):
        return page.evaluate("(id) => { const v = window.CardVault; return v.priceInfo(v.state().collection.find(r => r.id === id)).unit; }", rid)

    def total(self, page):
        return page.evaluate("document.getElementById('totalValue').textContent")

    def records(self, page):
        return page.evaluate("window.CardVault.state().collection.map(r => ({name: r.name, qty: r.qty, sealed: !!r.sealed, productId: r.productId, language: r.language, condition: r.condition, setName: r.setName, paid: r.paid, ref: r.ref || null}))")


class EnglishSealed(SealedBase):
    # ----- entering
    def search(self, page, text):
        page.evaluate("window.CardVault.openSealedSearch('')")
        page.wait_for_selector("#sealedQuery")
        page.fill("#sealedQuery", text)
        page.wait_for_selector("#sealedOut .result")

    def test_a_box_is_found_by_part_of_its_name_or_its_set(self):
        page = self.open()
        self.search(page, "booster box")
        self.assertEqual(page.locator("#sealedOut .result .result-name").all_inner_texts(), ["Rarity Collection Booster Box"])
        self.search(page, "rarity collection")
        self.assertEqual(sorted(page.locator("#sealedOut .result .result-name").all_inner_texts()), ["Rarity Collection Booster Box", "Rarity Collection Booster Pack"])
        self.search(page, "mega tin")
        self.assertEqual(page.locator("#sealedOut .result .result-name").all_inner_texts(), ["Mega Tin 2026"])

    def test_the_results_show_what_each_costs(self):
        page = self.open()
        self.search(page, "rarity collection")
        text = page.inner_text("#sealedOut")
        self.assertIn("$100.00", text)
        self.assertIn("$4.00", text)

    def add(self, page, text, qty=None, paid=None):
        self.search(page, text)
        page.locator("#sealedOut .result").first.click()
        page.wait_for_selector("#sealedForm")
        if qty:
            page.fill("#sQtyS", str(qty))
        if paid is not None:
            page.fill("#sPaidS", str(paid))
        page.click("#sealedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")

    def test_adding_a_box_puts_it_in_the_collection_at_its_price(self):
        page = self.open()
        self.add(page, "booster box", qty=2, paid=85)
        self.assertEqual(self.records(page), [{"name": "Rarity Collection Booster Box", "qty": 2, "sealed": True, "productId": BOX, "language": "English",
                                                "condition": "Sealed", "setName": "Rarity Collection", "paid": 85, "ref": None}])
        page.wait_for_function("document.getElementById('totalValue').textContent === '$200.00'", timeout=5000)

    def test_the_same_box_added_twice_adds_up_and_another_stays_separate(self):
        page = self.open()
        self.add(page, "booster box")
        self.add(page, "booster box")
        self.add(page, "booster pack")
        recs = sorted((r["name"], r["qty"]) for r in self.records(page))
        self.assertEqual(recs, [("Rarity Collection Booster Box", 2), ("Rarity Collection Booster Pack", 1)])

    # ----- pricing
    def test_a_box_is_valued_at_the_market_price_with_no_condition_discount(self):
        page = self.open([sealed("a", BOX, "Rarity Collection Booster Box", qty=3, quantity=3)])
        page.wait_for_function("document.getElementById('totalValue').textContent === '$300.00'", timeout=5000)
        self.assertEqual(self.unit(page, "a"), 100.0)

    def test_how_the_price_moved_is_known_for_a_box(self):
        page = self.open([sealed("a", BOX, "Rarity Collection Booster Box")])
        page.wait_for_timeout(300)
        ch = page.evaluate("(() => { const v = window.CardVault, r = v.state().collection[0]; const c = v.changeFor ? v.changeFor(r, 'm7') : null; return c ? [c.now, c.then] : null; })()")
        self.assertEqual(ch, [100.0, 90.0])

    def test_a_box_is_not_given_a_graded_value(self):
        page = self.open([sealed("a", BOX, "Rarity Collection Booster Box")])
        page.wait_for_timeout(300)
        self.assertIsNone(page.evaluate("window.CardVault.gradedValue(window.CardVault.state().collection[0])"))

    def test_a_box_keeps_its_last_price_when_the_price_file_cant_be_read(self):
        records = [sealed("a", BOX, "Rarity Collection Booster Box", snap={"market": 99.0, "low": 90.0, "date": "2026-10-10"})]
        page = self.open(records, files={"tcgplayer-data.js": None})
        page.wait_for_timeout(800)
        self.assertEqual(self.unit(page, "a"), 99.0)

    # ----- seeing it
    def mixed(self):
        return [sealed("a", BOX, "Rarity Collection Booster Box"), sealed("b", TIN, "Mega Tin 2026", setName="Mega Tins"),
                {"id": "c", "productId": 1001, "name": "Test Card", "productName": "Test Card", "setName": "Rarity Collection", "number": "TST-EN001", "rarity": "Common",
                 "edition": "", "language": "English", "qty": 1, "quantity": 1, "condition": "Near Mint"}]

    def tiles(self, page):
        return sorted(page.evaluate("Array.from(document.querySelectorAll('.tile')).map(t => t.dataset.card)"))

    def show(self, page, value):
        page.evaluate("(v) => { const s = document.getElementById('fShow'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", value)

    def test_the_sealed_filter_shows_only_sealed_and_single_cards_only_hides_it(self):
        page = self.open(self.mixed())
        page.wait_for_selector(".tile")
        self.show(page, "sealed")
        page.wait_for_function("document.querySelectorAll('.tile').length === 2")
        self.assertEqual(self.tiles(page), ["a", "b"])
        self.show(page, "cards")
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        self.assertEqual(self.tiles(page), ["c"])

    def test_a_sealed_tile_says_sealed_and_is_found_by_its_name_and_set(self):
        page = self.open(self.mixed())
        page.wait_for_selector(".tile")
        self.assertEqual(page.evaluate("Array.from(document.querySelectorAll('.tile[data-card=a] .ed')).map(b => b.textContent)"), ["Sealed"])
        for words, found in (("booster box", ["a"]), ("mega tins", ["b"]), ("tin", ["b"])):
            page.fill("#q", words)
            page.wait_for_function("document.querySelectorAll('.tile').length === %d" % len(found))
            self.assertEqual(self.tiles(page), found, words)

    def test_the_total_counts_boxes_and_cards_together(self):
        page = self.open(self.mixed())
        page.wait_for_function("document.getElementById('totalValue').textContent === '$155.00'", timeout=5000)      # 100 + 30 + 25

    # ----- the want list
    def test_a_box_on_the_want_list_moves_to_the_collection_when_you_get_it(self):
        want = {"id": "w1", "productId": BOX, "name": "Rarity Collection Booster Box", "productName": "Rarity Collection Booster Box", "setName": "Rarity Collection",
                "number": "", "rarity": "", "edition": "Any", "qty": 1, "notes": "", "kind": "box", "added": "2026-10-01T00:00:00Z"}
        page = self.open(wants=[want])
        page.evaluate("window.CardVault.gotWant('w1')")
        page.wait_for_selector("#sealedForm")
        page.click("#sealedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual([r["name"] for r in self.records(page)], ["Rarity Collection Booster Box"])
        self.assertEqual(page.evaluate("window.CardVault.state().wants.length"), 0)

    # ----- keeping it
    def test_a_box_survives_closing_and_opening_again(self):
        page = self.open()
        self.add(page, "booster box", qty=2)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.wait_for_function("window.CardVault.state().collection.length === 1")
        self.assertEqual(self.records(page)[0]["qty"], 2)
        self.assertEqual(self.records(page)[0]["productId"], BOX)


# ---------- Japanese and Korean sealed products (Yugi-Market, Bunjang) ----------
import time

BOX_JP, PACK_JP, LIMITED_JP = "duelist-nexus-booster-box", "duelist-nexus-booster-pack", "limited-edition-box"
YM_KEY = "cardvault.v2.yugimarket"


class Shop:
    """Yugi-Market's three kinds of listing, as the shop answers (Shopify's products.json) and as Card Vault keeps them."""
    def __init__(self):
        self.items = {
            BOX_JP: dict(id=11, handle=BOX_JP, title="Yu-Gi-Oh! OCG Duelist Nexus Booster Box", price=52.0, kind="box", available=True, code="DBVS"),
            PACK_JP: dict(id=12, handle=PACK_JP, title="Yu-Gi-Oh! OCG Duelist Nexus Booster Pack", price=4.5, kind="pack", available=True, code="DBVS"),
            LIMITED_JP: dict(id=13, handle=LIMITED_JP, title="Yu-Gi-Oh! OCG Limited Edition Box", price=80.0, kind="boxset", available=False, code=None)}

    COLLECTION_KINDS = {"yu-gi-oh-booster-box": "box", "yu-gi-oh-box": "boxset", "yu-gi-oh-deck": "structure", "yu-gi-oh-booster-pack": "pack", "yu-gi-oh-booster-pack-retro": "pack"}

    def shopify(self, url):
        kind = self.COLLECTION_KINDS.get(url.split("/collections/")[1].split("/")[0])
        return {"products": [{"id": x["id"], "title": x["title"], "handle": x["handle"], "tags": ([x["code"] + "-JP"] if x["code"] else []),
                              "published_at": "2026-05-01T00:00:00Z", "images": [{"src": "https://cdn.shopify.com/s/files/1/x/%s.jpg" % x["handle"]}],
                              "variants": [{"title": "Default Title", "price": "%.2f" % x["price"], "available": x["available"]}]}
                             for x in self.items.values() if x["kind"] == kind]}

    def cached(self):
        return json.dumps({"t": int(time.time() * 1000), "list": [
            {"id": x["id"], "title": x["title"], "pre": False, "handle": x["handle"], "kind": x["kind"], "price": x["price"], "available": x["available"], "variants": [],
             "img": "https://cdn.shopify.com/s/files/1/x/%s.jpg?width=400" % x["handle"], "date": "2026-05-01", "codes": [x["code"]] if x["code"] else [], "rush": False}
            for x in self.items.values()]})


def market_file(kr_box=84000):
    return data.js("OCG_MARKET", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400},
                                  "jp": [["DBVS", "Duelist Nexus", "2026-05-01", "core", 100, [], ""]],
                                  "kr": [["RA01", "Rage of the Abyss", "2026-03-01", "core", 100, [], "", [kr_box, 6] if kr_box else None]]})


def jp_box(rid="j1", **more):
    r = {"id": rid, "productId": None, "sealed": True, "name": "Yu-Gi-Oh! OCG Duelist Nexus Booster Box", "productName": "Yu-Gi-Oh! OCG Duelist Nexus Booster Box",
         "setName": "Duelist Nexus", "number": "", "rarity": "", "edition": "", "condition": "Sealed", "language": "Japanese", "qty": 1, "quantity": 1,
         "ref": "ym:" + BOX_JP, "shop": "Yugi-Market", "link": "https://yugi-market.com/products/" + BOX_JP, "shopPrice": 50.0}
    r.update(more)
    return r


def kr_box(rid="k1", **more):
    r = {"id": rid, "productId": None, "sealed": True, "name": "Rage of the Abyss booster box", "productName": "Rage of the Abyss booster box",
         "setName": "Rage of the Abyss", "number": "", "rarity": "", "edition": "", "condition": "Sealed", "language": "Korean", "qty": 1, "quantity": 1,
         "ref": "krbox:RA01", "shop": "Bunjang", "link": "https://m.bunjang.co.kr/search/products?q=x", "shopPrice": 55.0}
    r.update(more)
    return r


class ShopSealedBase(SealedBase):
    YM = "**/yugi-market.com/collections/**"

    def setUp(self):
        self.shop = Shop()

    def go(self, records=(), wants=(), cached=True, kr_box=84000, shop_up=True, **kw):
        local = {YM_KEY: self.shop.cached()} if cached else {}
        files = {"ocg-market.js": market_file(kr_box)}
        files.update(kw.pop("files", {}))
        return self.open(records, wants, files=files, routes={self.YM: self.shop.shopify if shop_up else None}, local=local, **kw)

    def wait_total(self, page, text, timeout=8000):
        page.wait_for_function("(t) => document.getElementById('totalValue').textContent === t", arg=text, timeout=timeout)


class JapaneseKoreanSealedPricing(ShopSealedBase):
    def test_a_japanese_box_is_valued_at_yugi_markets_price(self):
        page = self.go([jp_box(qty=2, quantity=2)])
        self.wait_total(page, "$104.00")
        self.assertEqual(self.unit(page, "j1"), 52.0)

    def test_a_korean_box_is_valued_at_the_middle_of_the_bunjang_listings(self):
        page = self.go([kr_box()])
        self.wait_total(page, "$60.00")                # 84,000 won at 1,400 won to the dollar

    def test_the_value_moves_when_the_shop_changes_its_price(self):
        page = self.go([jp_box()], cached=False)
        self.wait_total(page, "$52.00", 20000)         # (read from the shop; the first read is a few seconds)
        self.shop.items[BOX_JP]["price"] = 61.0
        page.evaluate("window.CardVault.loadYugiMarket(true)")
        self.wait_total(page, "$61.00", 20000)

    def test_a_korean_box_follows_bunjang_too(self):
        page = self.go([kr_box()], kr_box=98000)
        self.wait_total(page, "$70.00")

    def test_a_value_you_entered_is_kept_whatever_the_shop_does(self):
        page = self.go([jp_box(manualPrice=70.0)])
        page.wait_for_timeout(500)
        self.assertEqual(self.unit(page, "j1"), 70.0)
        self.wait_total(page, "$70.00")

    def test_the_price_it_had_when_added_counts_until_the_shops_list_comes_in(self):
        page = self.go([jp_box()], cached=False, shop_up=False)
        page.wait_for_timeout(800)
        self.wait_total(page, "$50.00")

    def test_the_last_price_seen_is_kept_when_the_shop_cant_be_reached(self):
        page = self.go([jp_box()])
        self.wait_total(page, "$52.00")
        page.wait_for_timeout(300)
        self.assertEqual(page.evaluate("window.CardVault.shopKept()['ym:%s'].usd" % BOX_JP), 52.0)
        # the shop's list is gone from this device and the shop is down: 52 (seen last), not the 50 it was bought at
        page.evaluate("localStorage.removeItem('%s')" % YM_KEY)
        self.shop_up = False
        page.context.unroute(self.YM)
        page.context.route(self.YM, lambda route: route.abort())
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.wait_total(page, "$52.00")

    def test_a_box_the_shop_no_longer_lists_keeps_its_last_price(self):
        page = self.go([jp_box()])
        self.wait_total(page, "$52.00")
        page.wait_for_timeout(300)
        del self.shop.items[BOX_JP]
        page.evaluate("window.CardVault.loadYugiMarket(true)")
        page.wait_for_function("window.CardVault.ymk().list && !window.CardVault.ymk().list.some(x => x.handle === '%s')" % BOX_JP, timeout=20000)
        page.wait_for_timeout(500)
        self.wait_total(page, "$52.00")

    def test_a_sold_out_box_is_still_valued_at_its_last_listed_price(self):
        page = self.go([jp_box(name="Yu-Gi-Oh! OCG Limited Edition Box", productName="Yu-Gi-Oh! OCG Limited Edition Box", ref="ym:" + LIMITED_JP)])
        self.wait_total(page, "$80.00")


class JapaneseKoreanSealedAdding(ShopSealedBase):
    def search(self, page, lang, text, want=False):
        page.evaluate("(a) => window.CardVault.openSealedSearch('', {lang: a[0], want: a[1]})", [lang, want])
        page.wait_for_selector("#sealedQuery")
        page.fill("#sealedQuery", text)
        page.wait_for_selector("#sealedOut .result", timeout=15000)

    def names(self, page):
        return page.locator("#sealedOut .result .result-name").all_inner_texts()

    def test_the_language_choice_is_at_the_top_of_the_search(self):
        page = self.go()
        page.evaluate("window.CardVault.openSealedSearch('')")
        page.wait_for_selector("#sealedLang")
        self.assertEqual(page.locator("#sealedLang button").all_inner_texts(), ["English", "Japanese", "Korean"])
        self.assertEqual(page.get_attribute("#sealedLang button[data-slang=English]", "aria-pressed"), "true")

    def test_a_japanese_box_is_found_by_name_set_or_code_and_shows_its_price(self):
        page = self.go()
        self.search(page, "Japanese", "duelist nexus")
        self.assertEqual(sorted(self.names(page)), ["Yu-Gi-Oh! OCG Duelist Nexus Booster Box", "Yu-Gi-Oh! OCG Duelist Nexus Booster Pack"])
        text = page.inner_text("#sealedOut")
        self.assertIn("$52.00", text)
        self.assertIn("$4.50", text)
        self.search(page, "Japanese", "dbvs box")
        self.assertEqual(self.names(page), ["Yu-Gi-Oh! OCG Duelist Nexus Booster Box"])
        self.search(page, "Japanese", "limited")
        self.assertIn("sold out", page.inner_text("#sealedOut"))

    def test_a_korean_booster_box_is_found_by_its_set(self):
        page = self.go()
        self.search(page, "Korean", "rage")
        self.assertEqual(self.names(page), ["Rage of the Abyss booster box"])
        self.assertIn("$60.00", page.inner_text("#sealedOut"))

    def test_a_japanese_search_reads_the_shop_when_this_device_has_never_asked(self):
        page = self.go(cached=False)
        self.search(page, "Japanese", "duelist")
        self.assertEqual(len(self.names(page)), 2)

    def test_a_shop_that_cant_be_reached_says_so(self):
        page = self.go(cached=False, shop_up=False)
        page.evaluate("window.CardVault.openSealedSearch('nexus', {lang: 'Japanese'})")
        page.wait_for_selector("#sealedOut .notice", timeout=30000)
        self.assertIn("Couldn't reach Yugi-Market", page.inner_text("#sealedOut"))

    def pick(self, page, lang, text, qty=None, paid=None, value=None):
        self.search(page, lang, text)
        page.locator("#sealedOut .result").first.click()
        page.wait_for_selector("#shopSealedForm")
        if qty:
            page.fill("#gQty", str(qty))
        if paid is not None:
            page.fill("#gPaid", str(paid))
        if value is not None:
            page.fill("#gValue", str(value))
        page.click("#shopSealedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")

    def test_adding_a_japanese_box_keeps_which_product_it_is_and_follows_its_price(self):
        page = self.go()
        self.pick(page, "Japanese", "nexus box", qty=2, paid=40)
        rec = self.records(page)
        self.assertEqual(len(rec), 1)
        self.assertEqual((rec[0]["name"], rec[0]["qty"], rec[0]["sealed"], rec[0]["productId"], rec[0]["language"], rec[0]["paid"]),
                         ("Yu-Gi-Oh! OCG Duelist Nexus Booster Box", 2, True, None, "Japanese", 40))
        self.assertEqual(page.evaluate("(() => { const r = window.CardVault.state().collection[0]; return [r.ref, r.shop, r.link, r.shopPrice, r.manualPrice, r.setName]; })()"),
                         ["ym:" + BOX_JP, "Yugi-Market", "https://yugi-market.com/products/" + BOX_JP, 52.0, None, "Duelist Nexus"])
        self.wait_total(page, "$104.00")

    def test_adding_a_korean_box(self):
        page = self.go()
        self.pick(page, "Korean", "rage of the abyss")
        self.assertEqual(page.evaluate("(() => { const r = window.CardVault.state().collection[0]; return [r.ref, r.shop, r.language, r.name, r.sealed, r.shopPrice]; })()"),
                         ["krbox:RA01", "Bunjang", "Korean", "Rage of the Abyss booster box", True, 60.0])
        self.wait_total(page, "$60.00")

    def test_a_value_entered_while_adding_is_the_value_kept(self):
        page = self.go()
        self.pick(page, "Japanese", "nexus box", value=70)
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].manualPrice"), 70.0)
        self.wait_total(page, "$70.00")

    def test_the_same_box_added_again_adds_up_and_one_with_your_own_value_stays_apart(self):
        page = self.go()
        self.pick(page, "Japanese", "nexus box")
        self.pick(page, "Japanese", "nexus box")
        self.assertEqual([r["qty"] for r in self.records(page)], [2])
        self.pick(page, "Japanese", "nexus box", value=70)
        self.assertEqual(sorted(r["qty"] for r in self.records(page)), [1, 2])

    def test_a_japanese_and_a_korean_box_and_an_english_one_are_counted_together(self):
        page = self.go([sealed("a", BOX, "Rarity Collection Booster Box")])
        self.pick(page, "Japanese", "nexus box")
        self.pick(page, "Korean", "rage")
        self.wait_total(page, "$212.00")                # 100 + 52 + 60

    def test_a_box_in_the_want_list_search_is_added_to_wants(self):
        page = self.go()
        self.search(page, "Japanese", "nexus box", want=True)
        page.locator("#sealedOut .result").first.click()
        page.wait_for_function("window.CardVault.state().wants.length === 1")
        self.assertEqual(page.evaluate("window.CardVault.state().wants[0].ref"), "ym:" + BOX_JP)

    def test_i_got_it_from_the_want_list_keeps_following_the_shops_price(self):
        page = self.go()
        page.evaluate("window.CardVault.loadYugiMarket(); window.CardVault.loadOcgMarket()")
        page.wait_for_function("window.CardVault.ymk().list && window.CardVault.ocgMk().data")
        page.evaluate("window.CardVault.ymWant(window.CardVault.ymk().list.find(x => x.handle === '%s'))" % BOX_JP)
        wid = page.evaluate("window.CardVault.state().wants[0].id")
        page.evaluate("(id) => window.CardVault.gotWant(id)", wid)
        page.wait_for_selector("#shopSealedForm")
        page.click("#shopSealedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(page.evaluate("window.CardVault.state().wants.length"), 0)
        self.assertEqual(page.evaluate("(() => { const r = window.CardVault.state().collection[0]; return [r.ref, r.manualPrice, r.language]; })()"), ["ym:" + BOX_JP, None, "Japanese"])
        self.shop.items[BOX_JP]["price"] = 58.0
        page.evaluate("window.CardVault.loadYugiMarket(true)")
        self.wait_total(page, "$58.00", 20000)

    def test_a_korean_want_becomes_a_box_that_follows_bunjang(self):
        page = self.go()
        page.evaluate("window.CardVault.loadOcgMarket()")
        page.wait_for_function("window.CardVault.ocgMk().data && window.CardVault.ocgMk().data.kr.length")
        page.evaluate("window.CardVault.krBoxWant(window.CardVault.ocgMk().data.kr[0])")
        wid = page.evaluate("window.CardVault.state().wants[0].id")
        page.evaluate("(id) => window.CardVault.gotWant(id)", wid)
        page.wait_for_selector("#shopSealedForm")
        page.click("#shopSealedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(page.evaluate("(() => { const r = window.CardVault.state().collection[0]; return [r.ref, r.manualPrice, r.language]; })()"), ["krbox:RA01", None, "Korean"])
        self.wait_total(page, "$60.00")


class JapaneseKoreanSealedSeeing(ShopSealedBase):
    def records_set(self):
        return [jp_box(), kr_box(), sealed("e", BOX, "Rarity Collection Booster Box"),
                {"id": "c", "productId": 1001, "name": "Test Card", "productName": "Test Card", "setName": "Rarity Collection", "number": "TST-EN001", "rarity": "Common",
                 "edition": "", "language": "English", "qty": 1, "quantity": 1, "condition": "Near Mint"}]

    def tiles(self, page):
        return sorted(page.evaluate("Array.from(document.querySelectorAll('.tile')).map(t => t.dataset.card)"))

    def test_the_sealed_filter_and_the_language_filter_find_them(self):
        page = self.go(self.records_set())
        page.wait_for_selector(".tile")
        EnglishSealed.show(self, page, "sealed")
        page.wait_for_function("document.querySelectorAll('.tile').length === 3")
        self.assertEqual(self.tiles(page), ["e", "j1", "k1"])
        EnglishSealed.show(self, page, "cards")
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        EnglishSealed.show(self, page, "")
        page.evaluate("(() => { const s = document.getElementById('fLang'); if (s) { s.value = 'Japanese'; s.dispatchEvent(new Event('change', {bubbles: true})); } })()")
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        self.assertEqual(self.tiles(page), ["j1"])

    def test_a_tile_says_sealed_and_its_language_and_is_found_by_searching(self):
        page = self.go(self.records_set())
        page.wait_for_selector(".tile")
        self.assertEqual(page.evaluate("Array.from(document.querySelectorAll('.tile[data-card=j1] .ed')).map(b => b.textContent)"), ["Sealed"])
        self.assertIn("Sealed product · Japanese", page.inner_text(".tile[data-card=j1]"))
        for words, found in (("duelist nexus", ["j1"]), ("japanese", ["j1"]), ("korean", ["k1"]), ("rage", ["k1"]), ("sealed", ["e", "j1", "k1"])):
            page.fill("#q", words)
            page.wait_for_function("document.querySelectorAll('.tile').length === %d" % len(found))
            self.assertEqual(self.tiles(page), found, words)

    def test_the_details_show_the_shops_price_and_a_link_to_it(self):
        page = self.go(self.records_set())
        self.wait_total(page, "$237.00")                # 52 + 60 + 100 + 25
        page.evaluate("window.CardVault.openDetails('j1')")
        page.wait_for_selector("#editForm")
        text = page.inner_text("#drawerBody")
        self.assertIn("Yugi-Market price", text)
        self.assertIn("$52.00", text)
        self.assertIn("See it at Yugi-Market", text)
        self.assertNotIn("Graded value", text)
        self.assertEqual(page.get_attribute("#drawerBody a[href*='yugi-market.com']", "href"), "https://yugi-market.com/products/" + BOX_JP)

    def test_the_details_say_when_the_price_is_from_last_time(self):
        page = self.go([jp_box()], cached=False, shop_up=False)
        page.wait_for_timeout(500)
        page.evaluate("window.CardVault.openDetails('j1')")
        page.wait_for_selector("#editForm")
        self.assertIn("as of last time", page.inner_text("#drawerBody"))

    def test_entering_a_value_fixes_it_and_clearing_it_follows_the_shop_again(self):
        page = self.go([jp_box()])
        self.wait_total(page, "$52.00")
        page.evaluate("window.CardVault.openDetails('j1')")
        page.wait_for_selector("#editForm")
        self.assertIn("follows Yugi-Market", page.inner_text("#editForm"))
        page.fill("#eValue", "75")
        page.click("#editForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.wait_total(page, "$75.00")
        page.evaluate("window.CardVault.openDetails('j1')")
        page.wait_for_selector("#editForm")
        page.fill("#eValue", "")
        page.click("#editForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.wait_total(page, "$52.00")

    def test_what_is_kept_comes_back_after_closing_and_opening(self):
        page = self.go([jp_box(), kr_box()])
        self.wait_total(page, "$112.00")
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => [r.ref, r.shop, r.shopPrice]).sort()"),
                         [["krbox:RA01", "Bunjang", 55.0], ["ym:" + BOX_JP, "Yugi-Market", 50.0]])
        self.wait_total(page, "$112.00")

    def test_the_market_has_an_i_have_it_button_on_a_japanese_product(self):
        page = self.go()
        page.evaluate("window.CardVault.loadOcgMarket(); window.CardVault.loadYugiMarket()")
        page.wait_for_function("window.CardVault.ocgMk().data && window.CardVault.ocgMk().data.jp.length && window.CardVault.ymk().list")
        html = page.evaluate("window.CardVault.ymTileHTML(window.CardVault.ymk().list.find(x => x.handle === '%s'), true)" % BOX_JP)
        self.assertIn('data-ym-have="11"', html)
        self.assertIn('data-ym-want="11"', html)


# ---------- sealed products no shop sells (an OTS pack, a video game promo pack): added by hand, at your own value ----------
class HandAddedSealed(SealedBase):
    def by_hand(self, page, name, value=None, qty=1, lang=None, paid=None):
        page.evaluate("window.CardVault.openManual({sealed: true})")
        page.wait_for_selector("#manualForm.m-sealed")
        page.fill("#mName", name)
        page.fill("#mQty", str(qty))
        if value is not None:
            page.fill("#mValue", str(value))
        if paid is not None:
            page.fill("#mPaid", str(paid))
        if lang:
            page.select_option("#mLang", lang)
        page.click("#manualForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")

    def test_the_sealed_search_offers_to_add_one_by_hand_with_the_words_typed(self):
        page = self.open()
        page.evaluate("window.CardVault.openSealedSearch('')")
        page.wait_for_selector("#sealedQuery")
        page.fill("#sealedQuery", "OTS Tournament Pack 30")
        page.click("#goSealedManual")
        page.wait_for_selector("#manualForm.m-sealed")
        self.assertTrue(page.is_checked("#mSealed"))
        self.assertEqual(page.input_value("#mName"), "OTS Tournament Pack 30")
        # the card-only fields are out of the way
        self.assertFalse(page.is_visible("#mNumber"))
        self.assertFalse(page.is_visible("#mRarity"))
        self.assertFalse(page.is_visible("#mCond"))
        self.assertTrue(page.is_visible("#mValue"))
        self.assertTrue(page.is_visible("#mLang"))

    def test_ticking_the_box_in_add_manually_switches_the_form_and_back(self):
        page = self.open()
        page.evaluate("window.CardVault.openManual({})")
        page.wait_for_selector("#manualForm")
        self.assertTrue(page.is_visible("#mNumber"))
        page.check("#mSealed")
        self.assertFalse(page.is_visible("#mNumber"))
        page.uncheck("#mSealed")
        self.assertTrue(page.is_visible("#mNumber"))

    def test_a_pack_added_by_hand_is_a_sealed_product_at_the_value_entered(self):
        page = self.open()
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5, qty=4, paid=10)
        recs = self.records(page)
        self.assertEqual(recs, [{"name": "OTS Tournament Pack 30", "qty": 4, "sealed": True, "productId": None, "language": "English", "condition": "Sealed",
                                 "setName": "", "paid": 10, "ref": None}])
        self.assertEqual(page.evaluate("(() => { const r = window.CardVault.state().collection[0]; return [r.number, r.rarity, r.edition, r.manualPrice, r.grade]; })()"), ["", "", "", 12.5, None])
        page.wait_for_function("document.getElementById('totalValue').textContent === '$50.00'", timeout=5000)

    def test_without_a_value_it_counts_nothing_and_says_so(self):
        page = self.open()
        self.by_hand(page, "Stardust Accelerator promo pack")
        page.wait_for_selector(".tile")
        self.assertIsNone(self.unit(page, page.evaluate("window.CardVault.state().collection[0].id")))
        self.assertIn("No price yet", page.inner_text(".tile .tile-price"))

    def test_it_is_under_the_sealed_filter_with_a_sealed_badge_and_its_language(self):
        page = self.open()
        self.by_hand(page, "Over the Nexus promo pack", value=20, lang="Japanese")
        page.wait_for_selector(".tile")
        self.assertEqual(page.evaluate("Array.from(document.querySelectorAll('.tile .ed')).map(b => b.textContent)"), ["Sealed"])
        self.assertIn("Sealed product · Japanese", page.inner_text(".tile"))
        EnglishSealed.show(self, page, "sealed")
        page.wait_for_function("document.querySelectorAll('.tile').length === 1")
        EnglishSealed.show(self, page, "cards")
        page.wait_for_function("document.querySelectorAll('.tile').length === 0")

    def test_the_same_pack_added_again_adds_up(self):
        page = self.open()
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5)
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5)
        self.assertEqual([r["qty"] for r in self.records(page)], [2])

    def test_the_value_can_be_changed_under_edit(self):
        page = self.open()
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5)
        rid = page.evaluate("window.CardVault.state().collection[0].id")
        page.evaluate("(id) => window.CardVault.openDetails(id)", rid)
        page.wait_for_selector("#editForm")
        self.assertNotIn("Graded value", page.inner_text("#drawerBody"))
        page.fill("#eValue", "15")
        page.click("#editForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        page.wait_for_function("document.getElementById('totalValue').textContent === '$15.00'", timeout=5000)

    def test_it_is_not_listed_as_a_card_missing_a_tcgplayer_link(self):
        page = self.open()
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5)
        page.wait_for_timeout(300)
        self.assertEqual(page.evaluate("window.CardVault.tidyData ? window.CardVault.tidyData().unlinked.length : 0"), 0)

    def test_it_comes_back_after_closing_and_opening_again(self):
        page = self.open()
        self.by_hand(page, "OTS Tournament Pack 30", value=12.5, qty=2)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.wait_for_function("window.CardVault.state().collection.length === 1")
        self.assertEqual((self.records(page)[0]["qty"], self.records(page)[0]["sealed"]), (2, True))
        page.wait_for_function("document.getElementById('totalValue').textContent === '$25.00'", timeout=5000)


if __name__ == "__main__":
    unittest.main()
