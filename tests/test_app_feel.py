"""How Card Vault feels to use: the slim value bar, the change summary, the Back button, swipes, scroll hints, and the add form.

These run the real page in a headless browser against made-up prices (four cards, three of which moved since the last
price day) and check what a person would see and press. They need Playwright and its browser; without them they are skipped.
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

DAY = "2026-10-14T22:00:00Z"
PHONE = {"width": 390, "height": 760}
DESKTOP = {"width": 1280, "height": 800}

# (id, name, number, market now, market on the last price day)
CARDS = [(1001, "Alpha Dragon", "TST-EN001", 12.00, 10.00), (1002, "Beta Mage", "TST-EN002", 5.00, 5.50),
         (1003, "Gamma Knight", "TST-EN003", 3.00, 3.00), (1004, "Delta Wyrm", "TST-EN004", 1.00, 1.00)]


def js(name, value):
    return "window.%s = %s;" % (name, json.dumps(value))


def tcg(cards=CARDS):
    products = [[pid, 0, name, number, 0, [1, now, now, before, before, before], 0] for pid, name, number, now, before in cards]
    return js("TCG_DATA", {"format": 2, "generated": DAY, "builtAt": DAY, "groups": [[1, "Test Set", "TST", "2026-01-01"]],
                           "rarities": ["Common"], "subtypes": ["Normal", "1st Edition"], "products": products,
                           "history": {"d1": "2026-10-13", "d7": "2026-10-07", "d30": "2026-09-14"}})


def version():
    return js("TCG_DATA_VERSION", {"builtAt": DAY, "generated": DAY})


def record(pid, name, number, qty=1, **more):
    r = {"id": "r%d" % pid, "productId": pid, "name": name, "productName": name, "setName": "Test Set", "number": number, "rarity": "Common",
         "edition": "1st Edition", "language": "English", "qty": qty, "quantity": qty, "condition": "Near Mint"}
    r.update(more)
    return r


def collection(extra=()):
    return [record(pid, name, number, qty=2 if pid == 1001 else 1) for pid, name, number, _, _ in CARDS] + list(extra)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@unittest.skipIf(sync_playwright is None, "Playwright isn't installed")
class Feel(unittest.TestCase):
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

    def open(self, viewport=DESKTOP, records=None, settings=None, history=None, url="index.html", touch=False, cards=CARDS, tab_session=None):
        ctx = self.browser.new_context(viewport=viewport, service_workers="block", has_touch=touch)
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        records = collection() if records is None else records
        # (set up once: a reload keeps whatever the page saved since)
        seed = "localStorage.setItem('cardvault.v2.collection', %s);" % json.dumps(json.dumps(records))
        if settings is not None:
            seed += "localStorage.setItem('cardvault.v2.settings', %s);" % json.dumps(json.dumps(settings))
        if history is not None:
            seed += "localStorage.setItem('cardvault.v2.valueHistory', %s);" % json.dumps(json.dumps(history))
        for key, value in (tab_session or {}).items():   # (this tab's session storage, as it would be)
            seed += "sessionStorage.setItem(%s, %s);" % (json.dumps(key), json.dumps(value))
        ctx.add_init_script("try { if (location.protocol === 'http:' && !localStorage.getItem('test.seeded')) { localStorage.setItem('test.seeded', '1'); %s } } catch (e) {}" % seed)
        files = {"tcgplayer-data.js": tcg(cards), "tcgplayer-data-version.js": version()}

        def serve(route):
            name = route.request.url.split("?")[0].rsplit("/", 1)[-1]
            body = files.get(name)
            route.fulfill(status=200 if body else 404, content_type="text/javascript", body=body or "")
        ctx.route("**/*", lambda route: route.continue_() if route.request.url.startswith("http://127.0.0.1") else route.abort())
        for name in files:
            ctx.route("**/" + name + "*", serve)
        page.goto("http://127.0.0.1:%d/%s" % (self.server.server_address[1], url))
        page.wait_for_function("typeof window.CardVault === 'object'", timeout=20000)
        page.wait_for_timeout(300)
        return page

    def tearDown(self):
        self.assertEqual(self.errors, [], "the page reported errors")

    # ----- the change since the last price day, in the big panel
    def test_the_value_panel_says_how_the_value_moved_and_what_moved_most(self):
        page = self.open()
        text = page.inner_text("#heroChange")
        # 2 x Alpha went 10 -> 12 (+4), Beta 5.50 -> 5 (-0.50): up $3.50 on a collection that was $29.50 before
        self.assertIn("+$3.50", text)
        self.assertIn("since Oct 13 prices", text)
        self.assertIn("Alpha Dragon", text)
        page.locator("#heroChange [data-open]").click()
        page.wait_for_selector("#drawer:not([hidden])")
        self.assertIn("Alpha Dragon", page.inner_text("#drawerTitle") + page.inner_text("#drawerBody"))

    def test_a_trend_line_comes_from_the_recorded_days_and_the_comparison_days(self):
        page = self.open(history=[{"d": "2026-10-10", "v": 27, "c": 5}, {"d": "2026-10-12", "v": 28, "c": 5}, {"d": "2026-10-13", "v": 29.5, "c": 5}])
        self.assertEqual(page.locator("#heroChange svg.spark").count(), 1)
        self.assertEqual(page.evaluate("document.querySelector('#heroChange svg.spark').getAttribute('aria-hidden')"), "true")

    def test_on_a_phone_the_change_is_one_of_the_facts_instead(self):
        page = self.open(PHONE)
        self.assertFalse(page.locator("#heroChange").is_visible())
        self.assertTrue(page.locator(".fact-chg").is_visible())
        self.assertFalse(self.open(DESKTOP).locator(".fact-chg").is_visible())

    # ----- the slim value bar
    def test_the_value_bar_shows_only_once_the_big_panel_has_scrolled_away(self):
        many = collection([record(2000 + i, "Filler %d" % i, "FIL-EN%03d" % i) for i in range(40)])
        page = self.open(PHONE, records=many)
        self.assertFalse(page.locator("#valueBar").is_visible())
        page.evaluate("window.scrollTo(0, 900)")
        page.wait_for_selector("#valueBar", state="visible", timeout=5000)
        shown = page.inner_text("#valueBar")
        self.assertIn("Collection value", shown)
        self.assertIn(page.inner_text("#totalValue"), shown)
        self.assertEqual(page.get_attribute("#valueBar", "aria-hidden"), "true")
        page.click("#valueBar")
        page.wait_for_function("window.scrollY < 5", timeout=5000)
        page.wait_for_selector("#valueBar", state="hidden", timeout=5000)

    # ----- since you last looked
    def test_new_prices_since_your_last_look_are_summed_up_once_and_can_be_dismissed(self):
        page = self.open(settings={"pricesSeenDay": "2026-10-13"})
        banner = page.locator("#changeBanner")
        self.assertTrue(banner.is_visible())
        self.assertIn("Since Oct 13 prices, your collection is up $3.50", banner.inner_text())
        self.assertIn("Alpha Dragon", banner.inner_text())
        banner.get_by_text("Dismiss").click()
        self.assertFalse(banner.is_visible())
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.assertFalse(page.locator("#changeBanner").is_visible())
        self.assertEqual(page.evaluate("window.CardVault.state().settings.pricesSeenDay"), "2026-10-14")

    def test_see_what_moved_opens_the_movers(self):
        page = self.open(settings={"pricesSeenDay": "2026-10-13"})
        page.get_by_text("See what moved").click()
        page.wait_for_selector("#panel-history:not([hidden])")
        state = page.evaluate("({tab: window.CardVault.state().settings.tab, view: window.CardVault.state().settings.insightView, seen: window.CardVault.state().settings.pricesSeenDay})")
        self.assertEqual(state, {"tab": "history", "view": "movers", "seen": "2026-10-14"})
        self.assertFalse(page.locator("#changeBanner").is_visible())

    def test_the_first_time_there_is_nothing_to_compare_with_so_no_banner(self):
        page = self.open()
        self.assertFalse(page.locator("#changeBanner").is_visible())
        self.assertEqual(page.evaluate("window.CardVault.state().settings.pricesSeenDay"), "2026-10-14")

    def test_cards_added_later_are_not_compared_with_prices_from_before_you_had_them(self):
        page = self.open(records=[], settings={"pricesSeenDay": "2026-10-01"})
        self.assertEqual(page.evaluate("window.CardVault.state().settings.pricesSeenDay"), "2026-10-14")
        self.assertFalse(page.locator("#changeBanner").is_visible())

    def test_a_tiny_change_is_not_worth_a_banner(self):
        page = self.open(records=[record(1001, "Alpha Dragon", "TST-EN001")], settings={"pricesSeenDay": "2026-10-13"})
        page.evaluate("""() => { const c = window.CardVault.state().catalog; const p = c.byId.get(1001); p.prices['1st Edition'].market = 12.20; p.prices['1st Edition'].m1 = 12.00; window.CardVault.render(); }""")
        self.assertFalse(page.locator("#changeBanner").is_visible())
        self.assertEqual(page.evaluate("window.CardVault.state().settings.pricesSeenDay"), "2026-10-14")

    def test_many_small_moves_that_add_up_are_worth_a_banner(self):
        fillers = [(3000 + i, "Filler %d" % i, "FIL-EN%03d" % i, 1.15, 1.00) for i in range(10)]   # +15 cents each, +$1.50 together
        page = self.open(records=[record(pid, name, number) for pid, name, number, _, _ in fillers], cards=fillers, settings={"pricesSeenDay": "2026-10-13"})
        self.assertIn("up $1.50", page.locator("#changeBanner").inner_text())

    # ----- the Back button
    def test_back_closes_an_open_card_instead_of_leaving(self):
        page = self.open()
        page.evaluate("window.CardVault.openDetails('r1001')")
        page.wait_for_selector("#drawer:not([hidden])")
        url = page.url
        page.go_back()
        page.wait_for_selector("#drawer", state="hidden", timeout=5000)
        self.assertEqual(page.url, url)
        self.assertTrue(page.locator("#panel-collection").is_visible())

    def test_closing_with_the_x_leaves_back_free_to_do_its_job(self):
        page = self.open()
        before = page.evaluate("history.length")
        page.evaluate("window.CardVault.openDetails('r1001')")
        page.wait_for_selector("#drawer:not([hidden])")
        page.click("#drawerClose")
        page.evaluate("window.CardVault.openDetails('r1002')")
        page.wait_for_selector("#drawer:not([hidden])")
        self.assertEqual(page.evaluate("history.length"), before)   # (no history is piled up by opening and closing)
        page.go_back()
        page.wait_for_selector("#drawer", state="hidden", timeout=5000)

    def test_back_from_another_tab_goes_to_the_collection_and_the_address_names_the_tab(self):
        page = self.open()
        page.click("#tab-wants")
        self.assertTrue(page.url.endswith("#wants"))
        page.go_back()
        page.wait_for_function("window.CardVault.state().settings.tab === 'collection'", timeout=5000)
        self.assertFalse(page.url.endswith("#wants"))
        self.assertTrue(page.locator("#panel-collection").is_visible())

    def test_each_back_press_does_one_thing_in_order(self):
        page = self.open()
        page.click("#tab-wants")
        page.evaluate("window.CardVault.openAdd({want: true})")
        page.wait_for_selector("#drawer:not([hidden])")
        page.go_back()                                    # closes the window, stays on the Want list
        page.wait_for_selector("#drawer", state="hidden", timeout=5000)
        self.assertEqual(page.evaluate("window.CardVault.state().settings.tab"), "wants")
        page.go_back()                                    # then back to the Collection
        page.wait_for_function("window.CardVault.state().settings.tab === 'collection'", timeout=5000)
        self.assertTrue(page.url.startswith("http://127.0.0.1"))

    def test_a_link_to_a_tab_opens_that_tab(self):
        page = self.open(url="index.html#sets")
        self.assertEqual(page.evaluate("window.CardVault.state().settings.tab"), "sets")
        self.assertTrue(page.locator("#panel-sets").is_visible())

    def opened_with_nothing_before_it(self):
        # (as a home-screen app: "cv.pre" 0 means no page comes before Card Vault in this tab)
        return self.open(tab_session={"cv.redirect": "1", "cv.pre": "0"})

    def test_after_the_press_back_again_hint_a_window_still_closes_with_back(self):
        page = self.opened_with_nothing_before_it()
        url = page.url
        page.go_back()
        page.wait_for_function("document.getElementById('toasts').textContent.includes('Press Back again')", timeout=5000)
        self.assertEqual(page.url, url)
        page.evaluate("window.CardVault.openDetails('r1001')")
        page.wait_for_selector("#drawer:not([hidden])")
        page.go_back()
        page.wait_for_selector("#drawer", state="hidden", timeout=5000)
        self.assertEqual(page.url, url)

    def test_after_the_hint_back_from_another_tab_still_goes_to_the_collection(self):
        page = self.opened_with_nothing_before_it()
        page.go_back()
        page.wait_for_function("document.getElementById('toasts').textContent.includes('Press Back again')", timeout=5000)
        page.click("#tab-wants")
        page.go_back()
        page.wait_for_function("window.CardVault.state().settings.tab === 'collection'", timeout=5000)
        self.assertTrue(page.url.startswith("http://127.0.0.1"))

    def test_the_hint_only_lasts_a_moment(self):
        page = self.opened_with_nothing_before_it()
        url = page.url
        page.go_back()
        page.wait_for_function("document.getElementById('toasts').textContent.includes('Press Back again')", timeout=5000)
        page.wait_for_timeout(2900)                           # (too late for "again": the next press is a first press once more)
        page.evaluate("document.getElementById('toasts').innerHTML = ''")
        page.go_back()
        page.wait_for_function("document.getElementById('toasts').textContent.includes('Press Back again')", timeout=5000)
        self.assertEqual(page.url, url)

    def test_back_still_leaves_in_one_press_after_a_google_sign_in_came_back_to_the_page(self):
        page = self.open()
        for how in ("location.replace", "location.assign"):      # (the quiet renewal, and the sign-in that shows a page)
            page.evaluate("sessionStorage.setItem('cv.redirect', '1'); %s(location.pathname + '?back=1')" % how)
            page.wait_for_function("location.search === '?back=1' && typeof window.CardVault === 'object'", timeout=15000)
            page.wait_for_timeout(300)
            self.errors = []
        page.go_back()
        page.wait_for_function("location.href === 'about:blank'", timeout=8000)    # (one press: the older entries are stepped over)
        self.errors = []

    def test_a_link_with_a_tab_in_it_does_not_pull_you_back_to_that_tab(self):
        page = self.open(url="index.html#wants")
        page.click("#tab-collection")
        self.assertFalse(page.url.endswith("#wants"))
        page.go_back()                                      # leaves, rather than flipping to the Want list
        page.wait_for_function("location.href === 'about:blank'", timeout=5000)
        self.errors = []

    def test_back_after_typing_a_tab_into_the_address_follows_the_address(self):
        page = self.open()
        page.evaluate("location.hash = '#sets'")
        page.wait_for_function("window.CardVault.state().settings.tab === 'sets'", timeout=5000)
        page.go_back()
        page.wait_for_function("window.CardVault.state().settings.tab === 'collection'", timeout=5000)

    def test_back_on_the_collection_leaves_the_page(self):
        page = self.open()
        page.go_back()
        page.wait_for_function("location.href === 'about:blank'", timeout=5000)
        self.errors = []   # (the blank page before the app isn't Card Vault's)

    # ----- the "Find photos" notice
    def test_the_photo_notice_can_be_put_off_and_returns_only_for_new_cards(self):
        manual = lambda n: record(0, "Manual %d" % n, "MAN-EN00%d" % n, id="m%d" % n, productId=None)
        page = self.open(records=collection([manual(1)]))
        notice = page.locator("#collection .notice")
        self.assertIn("no photo", notice.inner_text())
        notice.get_by_text("Not now").click()
        self.assertEqual(page.locator("#collection .notice").count(), 0)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        self.assertEqual(page.locator("#collection .notice").count(), 0)
        page.evaluate("""(r) => { const s = window.CardVault.state(); s.collection.push(r); window.CardVault.render(); }""", manual(2))
        self.assertIn("no photo", page.locator("#collection .notice").inner_text())

    # ----- a hint that something scrolls sideways
    def test_a_row_that_scrolls_sideways_fades_at_the_edge_that_has_more(self):
        page = self.open(PHONE)
        page.click("#tab-history")
        page.wait_for_selector(".seg-scroll")
        page.wait_for_function("document.querySelector('.seg-scroll').classList.contains('hs-r')", timeout=5000)
        self.assertFalse(page.evaluate("document.querySelector('.seg-scroll').classList.contains('hs-l')"))
        page.evaluate("const e = document.querySelector('.seg-scroll'); e.scrollLeft = e.scrollWidth")
        page.wait_for_function("document.querySelector('.seg-scroll').classList.contains('hs-l') && !document.querySelector('.seg-scroll').classList.contains('hs-r')", timeout=5000)

    # ----- swiping a card
    def swipe(self, page, selector, dx, dy=0):
        page.evaluate("""([sel, dx, dy]) => {
          const el = document.querySelector(sel), b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
          const fire = (type, ox, oy) => el.dispatchEvent(new PointerEvent(type, {pointerType: "touch", isPrimary: true, pointerId: 7, bubbles: true, cancelable: true, clientX: x + ox, clientY: y + oy}));
          fire("pointerdown", 0, 0); fire("pointermove", dx / 2, dy / 2); fire("pointermove", dx, dy); fire("pointerup", dx, dy);
        }""", [selector, dx, dy])

    def qty(self, page, rid):
        return page.evaluate("(id) => window.CardVault.state().collection.find(r => r.id === id).qty", rid)

    def test_swiping_right_adds_a_copy_and_left_takes_one_away_with_undo(self):
        page = self.open(PHONE)
        tile = '.tile[data-card="r1001"]'
        self.assertEqual(self.qty(page, "r1001"), 2)
        self.swipe(page, tile, 120)
        self.assertEqual(self.qty(page, "r1001"), 3)
        self.assertIn("you now have 3 of Alpha Dragon", page.inner_text("#toasts"))
        self.swipe(page, tile, -120)
        self.assertEqual(self.qty(page, "r1001"), 2)
        page.locator("#toasts").get_by_text("Undo").click()
        self.assertEqual(self.qty(page, "r1001"), 3)
        self.assertFalse(page.locator("#drawer").is_visible())     # (a swipe never opens the card)

    def test_a_short_or_mostly_vertical_swipe_does_nothing(self):
        page = self.open(PHONE)
        tile = '.tile[data-card="r1001"]'
        self.swipe(page, tile, 40)
        self.swipe(page, tile, 90, 120)
        self.assertEqual(self.qty(page, "r1001"), 2)

    def test_the_last_copy_is_never_swiped_away(self):
        page = self.open(PHONE)
        self.swipe(page, '.tile[data-card="r1002"]', -120)
        self.assertEqual(self.qty(page, "r1002"), 1)
        self.assertIn("only copy", page.inner_text("#toasts"))

    def test_swiping_can_be_turned_off_in_settings(self):
        page = self.open(PHONE, settings={"swipeCopies": False})
        self.swipe(page, '.tile[data-card="r1001"]', 120)
        self.assertEqual(self.qty(page, "r1001"), 2)
        page.evaluate("window.CardVault.openSettings()")
        page.wait_for_selector("#sSwipe")
        self.assertFalse(page.is_checked("#sSwipe"))

    def test_a_second_finger_cancels_the_swipe(self):
        page = self.open(PHONE)
        page.evaluate("""() => { const el = document.querySelector('.tile[data-card="r1001"]'), b = el.getBoundingClientRect();
          const fire = (t, id, ox, primary) => el.dispatchEvent(new PointerEvent(t, {pointerType: "touch", isPrimary: primary, pointerId: id, bubbles: true, clientX: b.left + 40 + ox, clientY: b.top + 40}));
          fire("pointerdown", 1, 0, true); fire("pointerdown", 2, 30, false); fire("pointermove", 2, 170, false); fire("pointerup", 2, 170, false); fire("pointerup", 1, 0, true); }""")
        self.assertEqual(self.qty(page, "r1001"), 2)

    def test_another_finger_that_never_touched_down_on_the_card_is_ignored(self):
        page = self.open(PHONE)
        page.evaluate("""() => { const el = document.querySelector('.tile[data-card="r1001"]'), b = el.getBoundingClientRect();
          const fire = (t, id, ox, primary) => el.dispatchEvent(new PointerEvent(t, {pointerType: "touch", isPrimary: primary, pointerId: id, bubbles: true, clientX: b.left + 40 + ox, clientY: b.top + 40}));
          fire("pointerdown", 1, 0, true); fire("pointermove", 2, 90, false); fire("pointermove", 2, 170, false); fire("pointerup", 2, 170, false); }""")
        self.assertEqual(self.qty(page, "r1001"), 2)

    def test_pinch_zoom_still_works_on_cards(self):
        page = self.open(PHONE)
        self.assertIn("pinch-zoom", page.evaluate("getComputedStyle(document.querySelector('.tile[data-card]')).touchAction"))

    def test_the_value_bar_does_not_restyle_the_where_your_value_is_labels(self):
        page = self.open()
        page.evaluate("window.CardVault.state().settings.insightView = 'value'")
        page.click("#tab-history")
        page.wait_for_selector(".vb-row .vb-label")
        self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.vb-row .vb-label')).fontSize"), "13.5px")

    def test_a_mouse_never_swipes(self):
        page = self.open(DESKTOP)
        page.evaluate("""() => { const el = document.querySelector('.tile[data-card="r1001"]'), b = el.getBoundingClientRect();
          const fire = (t, o) => el.dispatchEvent(new PointerEvent(t, {pointerType: "mouse", isPrimary: true, bubbles: true, clientX: b.left + 20 + o, clientY: b.top + 20}));
          fire("pointerdown", 0); fire("pointermove", 60); fire("pointermove", 140); fire("pointerup", 140); }""")
        self.assertEqual(self.qty(page, "r1001"), 2)

    # ----- adding cards
    def test_the_add_form_starts_from_the_condition_and_place_of_the_last_card(self):
        page = self.open()
        def add(number):
            page.evaluate("window.CardVault.openAdd({number: %s})" % json.dumps(number))
            page.wait_for_selector(".results .result")
            page.click(".results .result")
            page.wait_for_selector("#pickedForm")
        add("TST-EN003")
        self.assertEqual(page.input_value("#fCond"), "Near Mint")
        self.assertEqual(page.input_value("#fLoc"), "")
        page.select_option("#fCond", "Lightly Played")
        page.fill("#fLoc", "Binder 2")
        page.click("#pickedForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        add("TST-EN004")
        self.assertEqual(page.input_value("#fCond"), "Lightly Played")
        self.assertEqual(page.input_value("#fLoc"), "Binder 2")


if __name__ == "__main__":
    unittest.main()
