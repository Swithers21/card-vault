"""How Card Vault fits screens of every width: a small phone, a foldable phone opened up, a tablet, a half-width window.

These run the real page in a headless browser at many widths (and with the extra room a camera cut-out takes up in
landscape) and check what a person would see: nothing running off the edge, every tab name readable, the cards using the
room they have. They need Playwright and its browser; without them they are skipped.
"""
import unittest

import test_app_feel as base

WIDTHS = [300, 313, 320, 360, 390, 430, 466, 540, 560, 561, 600, 626, 640, 641, 700, 768, 820, 890, 960, 1024, 1099, 1100, 1280, 1600]
TABS = ["collection", "search", "history", "sets", "wants", "decks", "sales", "market"]

# Anything on the page that sticks out past the right edge, unless it sits inside something that scrolls or clips on its own.
STRAY = """() => {
  const out = [];
  for (const el of document.querySelectorAll('.app *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.right <= innerWidth + 1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
    let clipped = false;
    for (let p = el.parentElement; p && !p.classList.contains('app'); p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; }
    }
    if (!clipped) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + '.' + String(el.className).split(' ')[0] + ' ends at ' + Math.round(r.right));
  }
  return out.slice(0, 6);
}"""

TAB_ROW = """() => {
  const row = document.querySelector('.tabs');
  const bottom = getComputedStyle(row).position === 'fixed';
  const names = [...row.querySelectorAll('.tab')].map(tab => {
    const label = tab.querySelector('.tab-label'), short = tab.querySelector('.tab-short');
    const shown = el => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 2 && r.height > 2; };
    const r = (bottom || shown(short) && !shown(label) ? short : label).getBoundingClientRect();
    return {left: r.left, right: r.right, label: label.textContent, labelShown: shown(label), shortShown: shown(short)};
  });
  return {bottom, room: row.scrollWidth - row.clientWidth, names};
}"""


class ScreenSizes(base.FeelBase):
    def sized(self, width, height=800, **more):
        return self.open({"width": width, "height": height}, **more)

    def test_nothing_runs_off_the_edge_of_the_collection_at_any_width(self):
        many = base.collection([base.record(2000 + i, "Filler %d" % i, "FIL-EN%03d" % i) for i in range(10)])
        for width in WIDTHS:
            with self.subTest(width=width):
                self.assertEqual(self.sized(width, records=many).evaluate(STRAY), [])

    def test_nothing_runs_off_the_edge_on_any_tab_at_the_sizes_a_foldable_uses(self):
        for width in (313, 466, 626, 890):         # (half a screen, the outside, opened up, opened up and turned)
            page = self.sized(width)
            for tab in TABS:
                with self.subTest(width=width, tab=tab):
                    page.click('.tab[data-tab="%s"]' % tab, force=True)
                    page.wait_for_timeout(200)
                    self.assertEqual(page.evaluate(STRAY), [])

    def test_the_cards_use_the_room_they_have(self):
        want = {313: 2, 390: 2, 466: 2, 560: 2, 561: 3, 626: 3, 640: 3, 700: 3, 890: 4, 1280: 6}
        for width, columns in want.items():
            with self.subTest(width=width):
                page = self.sized(width)
                self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.binder')).gridTemplateColumns.split(' ').length"), columns)

    def test_the_names_in_the_bottom_tab_bar_never_run_together(self):
        for width in [w for w in WIDTHS if w <= 640 and w >= 313]:
            with self.subTest(width=width):
                row = self.sized(width).evaluate(TAB_ROW)
                self.assertTrue(row["bottom"])
                names = row["names"]
                self.assertEqual(len(names), 8)
                for before, after in zip(names, names[1:]):
                    self.assertGreaterEqual(after["left"] - before["right"], 1, "%s and %s touch" % (before["label"], after["label"]))
                self.assertGreaterEqual(names[0]["left"], 0)
                self.assertLessEqual(names[-1]["right"], width)

    def test_every_tab_along_the_top_fits_in_one_row(self):
        for width in [w for w in WIDTHS if w >= 641]:
            with self.subTest(width=width):
                row = self.sized(width).evaluate(TAB_ROW)
                self.assertFalse(row["bottom"])
                self.assertLessEqual(row["room"], 2, "the tabs run %dpx past their row" % row["room"])
                for name in row["names"]:
                    self.assertTrue(name["labelShown"] or name["shortShown"], "%s has no visible name" % name["label"])

    def test_short_tab_names_still_have_their_full_name_for_a_screen_reader(self):
        page = self.sized(768)
        row = page.evaluate(TAB_ROW)
        self.assertTrue(all(n["shortShown"] and not n["labelShown"] for n in row["names"]))      # short names show...
        self.assertEqual(page.evaluate("[...document.querySelectorAll('.tab .tab-label')].map(x => x.textContent).join()"),
                         "Collection,Card search,Insights,Sets,Want list,Deck check,Trades & sales,Market")   # ...the full ones are still there
        self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.tab .tab-label')).display"), "block")
        # a wide window shows the full names
        row = self.sized(1280).evaluate(TAB_ROW)
        self.assertTrue(all(n["labelShown"] and not n["shortShown"] for n in row["names"]))

    # ----- the room a camera cut-out takes at the side of a phone turned on its side
    def with_cutout(self, page, left=0, right=0, bottom=0):
        page.context.new_cdp_session(page).send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": 0, "left": left, "right": right, "bottom": bottom}})
        page.wait_for_timeout(150)

    def test_the_page_keeps_clear_of_a_cutout_on_either_side(self):
        page = self.sized(890, 626)
        self.with_cutout(page, left=59)
        self.assertGreaterEqual(page.evaluate("document.querySelector('.brand').getBoundingClientRect().left"), 58.5)
        self.with_cutout(page, right=59)
        self.assertLessEqual(page.evaluate("document.querySelector('#addBtn').getBoundingClientRect().right"), 890 - 58.5)

    def test_the_side_panel_and_pop_up_keep_clear_of_a_cutout(self):
        page = self.sized(890, 626)
        self.with_cutout(page, right=59, bottom=21)
        page.click("#settingsBtn")
        page.wait_for_selector("#drawer:not([hidden])")
        page.wait_for_timeout(400)         # (it slides in)
        box = page.evaluate("(() => { const r = document.querySelector('#drawer .drawer-head').getBoundingClientRect(); return [r.right, document.querySelector('#drawer .drawer-body').getBoundingClientRect().bottom]; })()")
        self.assertLessEqual(box[0], 890 - 58.5)
        self.assertLessEqual(box[1], 626 - 20.5)
        page.keyboard.press("Escape")
        page.evaluate("document.getElementById('importModal').hidden = false")
        self.with_cutout(page, left=59, right=0, bottom=21)
        box = page.evaluate("(() => { const r = document.getElementById('importModal').getBoundingClientRect(); return [r.left, r.right]; })()")
        self.assertGreaterEqual(box[0], 58.5)
        self.assertLessEqual(box[1], 890)
        # (and it never grows taller than the room left above and below the cut-outs: 626 - 32 - 21)
        self.assertEqual(page.evaluate("getComputedStyle(document.getElementById('importModal')).maxHeight"), "573px")

    def test_the_slim_value_bar_keeps_clear_of_a_cutout(self):
        many = base.collection([base.record(2000 + i, "Filler %d" % i, "FIL-EN%03d" % i) for i in range(40)])
        page = self.sized(890, 626, records=many)
        self.with_cutout(page, left=59, right=59)
        self.assertEqual(page.evaluate("getComputedStyle(document.getElementById('valueBar')).paddingLeft"), "59px")
        self.assertEqual(page.evaluate("getComputedStyle(document.getElementById('valueBar')).paddingRight"), "59px")


if __name__ == "__main__":
    unittest.main()
