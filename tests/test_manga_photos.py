"""Photos for Manga-Style cards: Yugipedia's scan of the version you have (black-and-white or colour).

BIGWEB's photos may not load from outside Japan, and each Manga-Style version looks different, so a Manga-Style card
you own gets Yugipedia's scan of its own version as its photo, automatically; the pick screen shows each version's
scan; and the version is never mixed up (a colour card never gets the black-and-white scan, nor a plain printing a
Manga-Style one). These run the real page in a headless browser against a made-up Yugipedia answer shaped like the
real one (file names like DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png). They need Playwright and its browser.
"""
import json
import unittest
from urllib.parse import parse_qs, urlsplit

import test_manga_style_app as manga
from test_manga_style_app import DM, UR_MONO, UR_COLOR, SE_MONO, SE_COLOR, mine

THUMB = "https://ms.yugipedia.com/thumb/%s/400px-%s"
GALLERY = ["DarkMagician-YAC1-JP-UR.png", "DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png", "DarkMagician-YAC1-JP-UR-MangaStyle-Color.png",
           "DarkMagician-LOB-EN-UR-1E.png", "DarkMagician-YAC1-JP-ScR-MangaStyle-Monochrome.png"]
# (no Secret Rare colour scan yet: that version has only the Ultra Rare's scan of the same artwork)
DEAD = "https://image.bigweb.co.jp/new/imgc/035/869/3586905.jpg"


# A popular card's gallery on Yugipedia: hundreds of files, over two pages, and photo links for only the first few of a
# page (the rest come when asked for by name), which is how the real API answers.
FILLER = ["DarkMagician-%s-EN-UR-1E.png" % code for code in ("CT13", "DLG1", "DPYG", "GLD1", "LCYW", "LDK2", "MVP1", "SDY", "SS01", "YGLD")]


def yugipedia(url, gallery=GALLERY):
    q = parse_qs(urlsplit(url).query)
    titles = q.get("titles", [""])[0].split("|")
    if q.get("generator") == ["images"]:
        files = sorted(set(FILLER + list(gallery)))
        pages = [files[:7], files[7:]]
        at = 1 if q.get("gimcontinue") else 0
        info = lambda i, f: ([{"url": "https://ms.yugipedia.com/" + f, "thumburl": THUMB % (f, f)}] if i < 2 else None)
        out = {"query": {"pages": [dict({"title": "File:" + f}, **({"imageinfo": info(i, f)} if info(i, f) else {})) for i, f in enumerate(pages[at])]}}
        if at == 0:
            out["continue"] = {"gimcontinue": "page2", "continue": "gimcontinue||"}
        return out
    if q.get("prop") == ["imageinfo"]:
        names = [t.replace("File:", "") for t in titles]
        return {"query": {"pages": [{"title": "File:" + f, "imageinfo": [{"url": "https://ms.yugipedia.com/" + f, "thumburl": THUMB % (f, f)}]} for f in names]}}
    known = {DM, "Dark Magician"}
    return {"query": {"pages": [{"title": t, "missing": True} for t in titles if t not in known] + [{"title": "Dark Magician", "pageid": 1}],
                      "redirects": [{"from": DM, "to": "Dark Magician"}] if DM in titles else []}}


class MangaPhotos(manga.MangaStyle):
    def setUp(self):
        self.gallery = list(GALLERY)
        self.yugi_calls = 0
        self.yugi_up = True

    def open(self, records, cards=None, width=1100):
        page = super().open(records, cards, width)

        def answer(route):
            self.yugi_calls += 1
            if not self.yugi_up:
                return route.abort()
            route.fulfill(status=200, content_type="application/json", body=json.dumps(yugipedia(route.request.url, self.gallery)), headers={"access-control-allow-origin": "*"})
        page.context.route("**/yugipedia.com/api.php*", answer)
        return page

    def photo(self, page, rid):
        return page.evaluate("(id) => window.CardVault.state().collection.find(r => r.id === id).customImage", rid)

    def wait_photo(self, page, rid, contains):
        page.wait_for_function("(a) => { const r = window.CardVault.state().collection.find(x => x.id === a[0]); return !!r.customImage && r.customImage.includes(a[1]); }", arg=[rid, contains], timeout=15000)

    # ----- the cards you own
    def test_a_black_and_white_card_gets_the_black_and_white_scan_and_a_colour_card_the_colour_one(self):
        page = self.open([mine("m", DM, UR_MONO), mine("c", DM, UR_COLOR)])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        self.wait_photo(page, "c", "MangaStyle-Color.png")

    def test_the_shops_photo_is_replaced_but_a_photo_you_chose_is_kept(self):
        page = self.open([mine("m", DM, UR_MONO, customImage=DEAD), mine("k", DM, UR_COLOR, customImage="https://my.photos/mine.jpg")])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        page.wait_for_timeout(500)
        self.assertEqual(self.photo(page, "k"), "https://my.photos/mine.jpg")

    def test_a_secret_rare_with_no_scan_of_its_own_gets_its_versions_scan_never_the_other_versions(self):
        page = self.open([mine("sc", DM, SE_COLOR), mine("sm", DM, SE_MONO)])
        self.wait_photo(page, "sc", "UR-MangaStyle-Color.png")
        self.wait_photo(page, "sm", "ScR-MangaStyle-Monochrome.png")

    def test_a_version_yugipedia_has_no_scan_of_gets_nothing_rather_than_the_wrong_one(self):
        self.gallery = ["DarkMagician-YAC1-JP-UR.png", "DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png"]
        page = self.open([mine("c", DM, UR_COLOR), mine("m", DM, UR_MONO)])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        page.wait_for_timeout(500)
        self.assertIsNone(self.photo(page, "c"))

    def test_a_plain_card_of_the_set_is_left_alone(self):
        page = self.open([mine("p", "YAC1-JP070", "Super Rare", name="Max Metalmorph"), mine("m", DM, UR_MONO)])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        page.wait_for_timeout(500)
        self.assertIsNone(self.photo(page, "p"))

    def test_the_photo_is_kept_and_yugipedia_is_not_asked_again_next_time(self):
        page = self.open([mine("m", DM, UR_MONO)])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        calls = self.yugi_calls
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.wait_for_timeout(4000)
        self.assertEqual(self.photo(page, "m").split("/")[-1], "400px-DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png")
        self.assertEqual(self.yugi_calls, calls)

    def test_yugipedia_being_down_changes_nothing_and_breaks_nothing(self):
        self.yugi_up = False
        page = self.open([mine("m", DM, UR_MONO, customImage=DEAD)])
        page.wait_for_timeout(4500)
        self.assertEqual(self.photo(page, "m"), DEAD)
        self.assertEqual(page.evaluate("document.querySelectorAll('.tile').length"), 1)

    def test_the_tile_shows_the_scan(self):
        page = self.open([mine("m", DM, UR_MONO)])
        self.wait_photo(page, "m", "MangaStyle-Monochrome.png")
        page.wait_for_function("(() => { const im = document.querySelector('.tile[data-card=m] img'); return im && im.getAttribute('src').includes('MangaStyle-Monochrome'); })()")

    # ----- picking and adding
    def test_the_pick_screen_shows_each_versions_scan(self):
        page = self.open([])
        page.evaluate("window.CardVault.loadOcgCards()")
        self.ready(page)
        page.evaluate("window.CardVault.openAdd({number: '%s'})" % DM)
        page.wait_for_selector("#lookupForm")
        page.evaluate("document.getElementById('lookupForm').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_selector("#lookupOut .result")
        page.wait_for_function("Array.from(document.querySelectorAll('#lookupOut .result img')).filter(i => i.getAttribute('src').includes('MangaStyle')).length >= 4", timeout=15000)
        srcs = page.evaluate("Array.from(document.querySelectorAll('#lookupOut .result')).map(b => [b.innerText.match(/(Ultra|Secret) Rare \\(Manga \\w+\\)/)[0], b.querySelector('img').getAttribute('src').split('400px-')[1]])")
        self.assertEqual(dict(srcs), {UR_MONO: "DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png", UR_COLOR: "DarkMagician-YAC1-JP-UR-MangaStyle-Color.png",
                                      SE_MONO: "DarkMagician-YAC1-JP-ScR-MangaStyle-Monochrome.png", SE_COLOR: "DarkMagician-YAC1-JP-UR-MangaStyle-Color.png"})

    def test_a_version_picked_there_is_added_with_its_scan(self):
        page = self.open([])
        page.evaluate("window.CardVault.loadOcgCards()")
        self.ready(page)
        page.evaluate("window.CardVault.openAdd({number: '%s'})" % DM)
        page.wait_for_selector("#lookupForm")
        page.evaluate("document.getElementById('lookupForm').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_function("Array.from(document.querySelectorAll('#lookupOut .result img')).filter(i => i.getAttribute('src').includes('MangaStyle')).length >= 4", timeout=15000)
        page.locator("#lookupOut .result", has_text=UR_COLOR).click()
        page.wait_for_selector("#ocgForm")
        page.click("#ocgForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        rec = page.evaluate("window.CardVault.state().collection[0]")
        self.assertEqual(rec["rarity"], UR_COLOR)
        self.assertIn("UR-MangaStyle-Color.png", rec["customImage"])

    # ----- the ranking itself
    def test_the_photo_picker_puts_the_right_version_first_and_names_it(self):
        page = self.open([])
        order = lambda rarity: page.evaluate("(r) => { const v = window.CardVault; const ims = %s.map(f => ({file: f, thumb: 'x/' + f})); const rk = v.rankYugiImages(ims, '%s', r); return rk.exact.map(i => [i.file, v.yugiLabel(i)]); }" % (json.dumps(GALLERY), DM), rarity)
        self.assertEqual(order(UR_COLOR)[0], ["DarkMagician-YAC1-JP-UR-MangaStyle-Color.png", "YAC1 · Japanese · Ultra Rare · Manga colour"])
        self.assertEqual(order(SE_MONO)[0], ["DarkMagician-YAC1-JP-ScR-MangaStyle-Monochrome.png", "YAC1 · Japanese · Secret Rare · Manga B&W"])
        self.assertEqual(order("Ultra Rare")[0][0], "DarkMagician-YAC1-JP-UR.png")
        self.assertEqual(order("Ultra Rare")[-1][0].count("MangaStyle"), 1)


# (only this file's tests: the harness is borrowed from test_manga_style_app, not its tests)
for _name in [n for n in dir(manga.MangaStyle) if n.startswith("test_")]:
    setattr(MangaPhotos, _name, None)


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(MangaPhotos)


if __name__ == "__main__":
    unittest.main()
