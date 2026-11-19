"""Look (Settings): light or dark colours (or matching the phone), and the size of the words. Every bit of text on every
tab and the main panels readable against what's behind it in light (contrast.js), the choice there before the page is
drawn, the phone switching by itself, and the biggest words still fitting a phone's width. In a real browser.
"""
import json
import os
import unittest

import test_binders as tb
from test_sealed_app import SealedBase

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRAST = open(os.path.join(HERE, "contrast.js"), encoding="utf-8").read()
TABS = ["collection", "search", "history", "sets", "wants", "decks", "sales", "market"]
PANELS = ["window.CardVault.openDetails(window.CardVault.state().collection[0].id)", "window.CardVault.openAdd()", "window.CardVault.openSettings()",
          "window.CardVault.openChanges()", "window.CardVault.openBinder(1)", "window.CardVault.openPriceCard(14)"]


def settings(**more):
    s = {"tab": "collection", "binders": [{"g": 1, "name": tb.BINDER, "pockets": 9, "t": 1}]}
    s.update(more)
    return {"cardvault.v2.settings": json.dumps(s)}


class Look(SealedBase):
    def go(self, width=390, **more):
        page = self.open(tb.RECORDS, files={"tcgplayer-data.js": tb.tcg()}, local=settings(**more), width=width)
        page.set_viewport_size({"width": width, "height": 844})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def unreadable(self, page):
        # (the little "no change" dot is an icon beside its words: 3 to 1 is enough for it)
        return [x for x in page.evaluate(CONTRAST) if not ("chg-icon" in x["sel"] and x["r"] >= 3)]

    def test_light_everywhere_is_readable(self):
        for width in (390, 1100):
            with self.subTest(width=width):
                page = self.go(width, theme="light")
                self.assertEqual(page.evaluate("document.documentElement.dataset.theme"), "light")
                self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#f4eee2")
                for tab in TABS:
                    page.evaluate("t => window.CardVault.setTab(t)", tab)
                    page.wait_for_timeout(250)
                    self.assertEqual(self.unreadable(page), [], tab)
                page.evaluate("window.CardVault.setTab('collection')")
                for js in PANELS:
                    page.evaluate(js)
                    page.wait_for_timeout(300)
                    self.assertEqual(self.unreadable(page), [], js)
                    page.keyboard.press("Escape")

    def test_picked_in_settings_and_kept(self):
        page = self.go()
        self.assertIsNone(page.evaluate("document.documentElement.dataset.theme || null"))      # (dark, as before)
        base = float(page.evaluate("getComputedStyle(document.body).fontSize")[:-2])
        page.evaluate("window.CardVault.openSettings()")
        page.click('#sTheme [data-look="light"]')
        page.click('#sTextSize [data-look="larger"]')
        self.assertEqual(page.evaluate("[document.documentElement.dataset.theme, document.documentElement.dataset.text]"), ["light", "larger"])
        self.assertAlmostEqual(float(page.evaluate("getComputedStyle(document.body).fontSize")[:-2]), base * 1.12, places=2)
        self.assertEqual(page.get_attribute('#sTheme [data-look="light"]', "aria-pressed"), "true")
        saved = json.loads(page.evaluate("localStorage.getItem('cardvault.v2.settings')"))
        self.assertEqual((saved["theme"], saved["textSize"]), ("light", "larger"))
        # just this device: a backup from another one doesn't change it
        page.evaluate("""() => { const v = window.CardVault, data = v.backupPayload(); data.settings.theme = 'dark'; data.settings.textSize = 'smaller';
            data.settings.sharedMod = Date.now() + 1e6; v.mergeBackup(data, {}); }""")
        self.assertEqual(page.evaluate("[window.CardVault.state().settings.theme, window.CardVault.state().settings.textSize]"), ["light", "larger"])
        page.click('#sTheme [data-look="dark"]')
        page.click('#sTextSize [data-look="normal"]')
        self.assertEqual(page.evaluate("[document.documentElement.dataset.theme || null, document.documentElement.dataset.text || null]"), [None, None])
        self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#0f0b1c")

    def test_there_before_the_page_is_drawn(self):
        # (the little script at the top of the page, on its own: app.js here only notes what it found)
        stub = "window.CardVault = {seen: [document.documentElement.dataset.theme || null, document.documentElement.dataset.text || null]};"
        page = self.open([], files={"app.js": stub}, local=settings(theme="light", textSize="largest"))
        self.assertEqual(page.evaluate("window.CardVault.seen"), ["light", "largest"])
        page = self.open([], files={"app.js": stub}, local=settings(theme="auto", textSize="huge"))
        phone = page.evaluate("matchMedia('(prefers-color-scheme: light)').matches ? 'light' : null")
        self.assertEqual(page.evaluate("window.CardVault.seen"), [phone, None])        # (as the browser is set; an unknown size is normal)
        page = self.open([], files={"app.js": stub}, local=settings(theme="dark"))
        self.assertEqual(page.evaluate("window.CardVault.seen"), [None, None])

    def test_match_my_phone_follows_it(self):
        page = self.go(theme="auto")
        page.emulate_media(color_scheme="light")
        page.wait_for_function("document.documentElement.dataset.theme === 'light'")
        page.emulate_media(color_scheme="dark")
        page.wait_for_function("!document.documentElement.dataset.theme")
        # (only when it's chosen)
        page.evaluate("window.CardVault.state().settings.theme = 'dark'")
        page.emulate_media(color_scheme="light")
        page.wait_for_timeout(200)
        self.assertIsNone(page.evaluate("document.documentElement.dataset.theme || null"))

    def test_the_biggest_words_still_fit_a_phone(self):
        page = self.go(375, textSize="largest", theme="light")
        self.assertEqual(page.evaluate("getComputedStyle(document.body).fontSize"), "17.5px")         # (a phone's 14px × 1.25)
        wide = """(() => { const W = document.documentElement.clientWidth;
            const scroller = e => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
            return [document.documentElement.scrollWidth > W ? 'page ' + document.documentElement.scrollWidth : null].concat(
              [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && r.right > W + 1 && getComputedStyle(e).position !== 'fixed' && !scroller(e); })
                .map(e => e.tagName + '.' + (typeof e.className === 'string' ? e.className : ''))).filter(Boolean).slice(0, 6); })()"""
        for tab in TABS:
            page.evaluate("t => window.CardVault.setTab(t)", tab)
            page.wait_for_timeout(250)
            self.assertEqual(page.evaluate(wide), [], tab)
        for js in PANELS:
            page.evaluate(js)
            page.wait_for_timeout(300)
            self.assertEqual(page.evaluate(wide), [], js)
            page.keyboard.press("Escape")


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(Look)


if __name__ == "__main__":
    unittest.main()
