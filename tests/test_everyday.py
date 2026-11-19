"""Everyday tools: Recent changes (every change you make to your cards, with Undo), a card's details docked beside the
list on a wide screen (the iPhone Duo's inside screen turned sideways, a computer), and shortcuts (Add card pressed and
held, the app icon's shortcuts, ?go= links). In a real browser.
"""
import json
import os
import unittest

from test_sealed_app import SealedBase
from test_themes_app import eng, tcg

HERE = os.path.dirname(os.path.abspath(__file__))


def rec(rid, pid, name, number, qty=1, **more):
    r = eng(rid, pid, name, number, qty)
    r.update(more)
    return r


RECORDS = [rec("a", 13, "Shaddoll Dragon", "DUEA-EN020", 3, location="Shelf 1"), rec("b", 21, "Dark Magician Girl", "MVP1-EN056", 1, location="Shelf 1"),
           rec("c", 14, "Shaddoll Beast", "DUEA-EN021", 2, location="Box")]


class Changes(SealedBase):
    def go(self):
        page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog && window.CardVault.big().settled", timeout=10000)
        return page

    def labels(self, page):
        return page.evaluate("window.CardVault.changesList().map(e => e.label)")

    def test_each_kind_of_change_is_named(self):
        page = self.go()
        page.evaluate("(() => { const v = window.CardVault; v.state().collection.find(r => r.id === 'b').condition = 'Lightly Played'; v.save(); })()")
        page.evaluate("(() => { const v = window.CardVault; v.moveCopies([{id: 'a', qty: 2}, {id: 'c', qty: 2}], 'Binder 3'); v.save(); })()")
        page.evaluate("""(() => { const v = window.CardVault, s = v.state();
            s.collection.push(Object.assign({}, s.collection.find(r => r.id === 'b'), {id: 'n', qty: 2, location: 'Shelf 2', condition: 'Near Mint', name: 'New Card', number: 'NEW-EN001'})); v.save(); })()""")
        page.evaluate("(() => { const v = window.CardVault, s = v.state(); s.collection.splice(s.collection.findIndex(r => r.id === 'n'), 1); v.save(); })()")
        page.evaluate("(() => { const v = window.CardVault; v.state().collection.find(r => r.id === 'b').qty = 3; v.save(); })()")
        self.assertEqual(self.labels(page), ["Added Dark Magician Girl (MVP1-EN056) ×2", "Removed New Card (NEW-EN001) ×2", "Added New Card (NEW-EN001) ×2",
                                             "Moved 4 cards to Binder 3", "Edited Dark Magician Girl (MVP1-EN056) (condition)"])

    def test_quiet_saves_and_bookkeeping_are_not_changes(self):
        page = self.go()
        page.evaluate("(() => { const v = window.CardVault; v.state().collection[0].customImage = 'https://example.test/x.jpg'; v.save({quiet: true}); })()")
        page.evaluate("(() => { const v = window.CardVault; v.state().collection[0].pcSent = 1; v.state().collection[1].ssSent = 1; v.save(); })()")
        self.assertEqual(self.labels(page), [])

    def test_undo_puts_the_cards_back_and_leaves_ones_changed_since(self):
        page = self.go()
        page.evaluate("(() => { const v = window.CardVault; v.moveCopies([{id: 'a', qty: 3}, {id: 'c', qty: 2}], 'Binder 3'); v.save(); })()")
        moved = page.evaluate("window.CardVault.changesList()[0].id")
        # (one of the two changes again afterwards)
        page.evaluate("(() => { const v = window.CardVault, r = v.state().collection.find(x => x.productId === 14); r.notes = 'mine'; v.save(); })()")
        res = page.evaluate("(id) => window.CardVault.undoChange(id)", moved)
        self.assertEqual(res, {"done": 1, "skipped": 1})
        where = page.evaluate("window.CardVault.state().collection.map(r => [r.productId, r.location, r.qty])")
        self.assertIn([13, "Shelf 1", 3], where)
        self.assertNotIn([13, "Binder 3", 3], where)
        self.assertIn([14, "Binder 3", 2], where)             # (changed since: stays)
        self.assertEqual(self.labels(page)[0], "Undid: Moved 5 cards to Binder 3")
        self.assertEqual(page.evaluate("(id) => window.CardVault.undoChange(id)", moved), {"done": 0, "skipped": 0})    # (once only)

    def test_the_list_and_its_undo_button_and_it_is_kept(self):
        page = self.go()
        page.evaluate("(() => { const v = window.CardVault; v.state().collection.find(r => r.id === 'b').qty = 4; v.save(); })()")
        page.click("#changesBtn")
        page.wait_for_selector(".ch-row")
        self.assertIn("TODAY", page.inner_text(".ch-day").upper())
        self.assertIn("Added Dark Magician Girl (MVP1-EN056) ×3", page.inner_text(".ch-row"))
        page.click("[data-ch-undo]")
        page.wait_for_function("window.CardVault.state().collection.find(r => r.id === 'b').qty === 1")
        page.wait_for_selector(".ch-undone")
        page.wait_for_timeout(200)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object' && window.CardVault.big().settled")
        self.assertEqual(self.labels(page), ["Undid: Added Dark Magician Girl (MVP1-EN056) ×3", "Added Dark Magician Girl (MVP1-EN056) ×3"])


class Docked(SealedBase):
    def go(self, width):
        page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()}, width=width)
        page.set_viewport_size({"width": width, "height": 700})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        return page

    def state(self, page):
        return page.evaluate("""({docked: document.body.classList.contains('docked'), scrim: !document.getElementById('scrim').hidden,
            inert: !!document.querySelector('.app').inert, modal: document.getElementById('drawer').getAttribute('aria-modal'), noScroll: document.body.classList.contains('no-scroll')})""")

    def test_nothing_runs_under_the_panel(self):
        for width in (900, 960, 1100, 1279, 1440):
            with self.subTest(width=width):
                page = self.go(width)
                page.evaluate("window.CardVault.openDetails('a')")
                page.wait_for_function("document.body.classList.contains('docked')")
                under = page.evaluate("""(() => { const L = document.getElementById('drawer').getBoundingClientRect().left;
                    return [...document.querySelectorAll('.app *')].filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
                      return r.width && r.height && cs.visibility !== 'hidden' && cs.position !== 'fixed' && r.right > L + 1; }).map(e => e.id || e.className).slice(0, 8); })()""")
                self.assertEqual(under, [])

    def test_beside_the_cards_on_a_wide_screen(self):
        page = self.go(960)
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#eLoc", state="attached")
        self.assertEqual(self.state(page), {"docked": True, "scrim": False, "inert": False, "modal": "false", "noScroll": False})
        # the cards make room, and another one opens in the same place
        self.assertLessEqual(page.evaluate("Math.max(...[...document.querySelectorAll('#collection .tile')].map(t => t.getBoundingClientRect().right))"),
                             page.evaluate("document.getElementById('drawer').getBoundingClientRect().left") + 1)
        # (nothing on the page runs under the panel: the tabs, the toolbar, the value)
        under = page.evaluate("""(() => { const L = document.getElementById('drawer').getBoundingClientRect().left;
            return [...document.querySelectorAll('.app *')].filter(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
              return r.width && r.height && cs.visibility !== 'hidden' && cs.position !== 'fixed' && r.right > L + 1 && r.left < L; }).map(e => e.id || e.className).slice(0, 8); })()""")
        self.assertEqual(under, [])
        page.click('#collection .tile[data-card="b"]')
        page.wait_for_function("document.getElementById('drawerBody').innerText.includes('Dark Magician Girl')")
        self.assertTrue(self.state(page)["docked"])
        # narrower (turned, or folded): the usual panel over the page
        page.set_viewport_size({"width": 700, "height": 700})
        page.wait_for_function("!document.body.classList.contains('docked')")
        self.assertEqual(self.state(page), {"docked": False, "scrim": True, "inert": True, "modal": "true", "noScroll": True})
        page.keyboard.press("Escape")
        page.wait_for_function("document.getElementById('drawer').hidden")
        self.assertFalse(self.state(page)["docked"])

    def test_not_on_a_narrow_screen_or_for_other_panels(self):
        page = self.go(700)
        page.evaluate("window.CardVault.openDetails('a')")
        self.assertFalse(self.state(page)["docked"])
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": 1200, "height": 800})
        page.evaluate("window.CardVault.openSettings()")
        self.assertFalse(self.state(page)["docked"])           # (Settings, adding a card: still over the page)


class Shortcuts(SealedBase):
    def test_go_links_open_the_right_place_once(self):
        for go, check in (("show", "document.getElementById('drawerTitle').textContent === 'Show mode'"),
                          ("wants", "window.CardVault.state().settings.tab === 'wants'"),
                          ("changes", "document.getElementById('drawerTitle').textContent === 'Recent changes'")):
            with self.subTest(go=go):
                page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()})
                page.goto(page.url.split("?")[0] + "?go=" + go)
                page.wait_for_function(check, timeout=10000)
                self.assertNotIn("go=", page.url)

    def test_add_card_pressed_and_held(self):
        page = self.open(RECORDS, files={"tcgplayer-data.js": tcg()})
        page.wait_for_function("!!window.CardVault.state().catalog", timeout=10000)
        page.click("#addBtn")                                     # (a tap: add a card, as before)
        page.wait_for_function("document.getElementById('drawerTitle').textContent === 'Add a card'")
        page.keyboard.press("Escape")
        box = page.locator("#addBtn").bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + 10)
        page.mouse.down()
        page.wait_for_timeout(650)
        page.mouse.up()
        self.assertTrue(page.is_visible("#addMenu"))
        self.assertTrue(page.evaluate("document.getElementById('drawer').hidden"))      # (holding didn't also open Add a card)
        self.assertEqual(page.locator("#addMenu [role=menuitem]").count(), 6)
        page.click('#addMenu [data-go="show"]')
        page.wait_for_function("document.getElementById('drawerTitle').textContent === 'Show mode'")
        self.assertFalse(page.is_visible("#addMenu"))
        page.keyboard.press("Escape")
        page.click("#addBtn", button="right")                    # (right-click, on a computer)
        self.assertTrue(page.is_visible("#addMenu"))
        page.keyboard.press("Escape")
        self.assertFalse(page.is_visible("#addMenu"))

class Manifest(unittest.TestCase):
    def test_the_app_icon_shortcuts(self):
        with open(os.path.join(HERE, "..", "manifest.webmanifest"), encoding="utf-8") as f:
            m = json.load(f)
        self.assertEqual([s["url"] for s in m["shortcuts"]], ["./?go=add", "./?go=scan", "./?go=show", "./?go=search", "./?go=wants"])
        self.assertTrue(all(s["icons"] and s["name"] for s in m["shortcuts"]))


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for c in (Changes, Docked, Shortcuts, Manifest):
        suite.addTests(loader.loadTestsFromTestCase(c))
    return suite


if __name__ == "__main__":
    unittest.main()
