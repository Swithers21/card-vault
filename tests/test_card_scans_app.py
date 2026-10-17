"""Card photos of each card's own print, in the app: the website's copies of Yugipedia's scans (card-scans/), and the
scans of your own cards' prints in any language.

The nightly job (card_scans.py) points the Market's lists at "scan:<file>"; these check the app shows those pictures
(Market chase cards, the pick screen, your Japanese and Korean cards, before a BIGWEB photo that may not load), and
that your cards with no such picture get one from Yugipedia on their own: a Japanese or Korean card its print's, a
card from TCGplayer in French, German, Italian, Spanish or Portuguese that language's print (kept on the device,
TCGplayer's photo underneath, your own photo always first). Against a made-up Yugipedia shaped like the real one.
"""
import io
import json
import unittest
from urllib.parse import parse_qs, urlsplit

import test_open_window_refresh as data
from test_sealed_app import SealedBase, BUILT

try:
    from PIL import Image
    _buf = io.BytesIO()
    Image.new("RGB", (20, 29), (90, 60, 30)).save(_buf, "JPEG")
    PICTURE = _buf.getvalue()
except ImportError:     # pragma: no cover
    PICTURE = b"\xff\xd8\xff\xd9"

BIGWEB = "https://image.bigweb.co.jp/new/imgc/035/869/3586905.jpg"
SCAN = "jp-yac1-jp085-ultra-rare.jpg"
THUMB = "https://ms.yugipedia.com/thumb/%s/200px-%s"


def ocg_files(scan_row=True, scan_chase=True):
    rar = ["Ultra Rare", "Super Rare", "Secret Rare"]
    cards = data.js("OCG_CARDS", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400}, "names": ["Jinzo", "Max Metalmorph"], "rar": rar, "ja": [""],
                                  "jp": [["YAC1", ["", "", ""], [["085", 0, [[0, 480, 1, ("scan:" + SCAN) if scan_row else 3586905, 0, 0, 0, 0],
                                                                            [2, 980, 1, 3586906, 0, 0, 0, 0]]],
                                                                   ["070", 1, [[1, 100, 1, 3586907, 0, 0, 0, 0]]]]]], "kr": []})
    market = data.js("OCG_MARKET", {"generated": BUILT, "fx": {"JPY": 150, "KRW": 1400},
                                    "jp": [["YAC1", "Original Artwork Collection", "2026-09-26", "boxed", 100,
                                            [["YAC1-JP085", "Jinzo", "Ultra Rare", 480, 1, ("scan:" + SCAN) if scan_chase else BIGWEB],
                                             ["YAC1-JP070", "Max Metalmorph", "Super Rare", 100, 1, BIGWEB]], ""]], "kr": []})
    return {"ocg-cards.js": cards, "ocg-market.js": market}


# Yugipedia: card pages by number or name, each with its gallery
GALLERIES = {"Jinzo": ["Jinzo-YAC1-JP-UR.png", "Jinzo-YAC1-JP-ScR.png", "Jinzo-YAC1-JP-UR-MangaStyle-Color.png", "Jinzo-LOB-EN-UR-1E.png"],
             "Max Metalmorph": ["MaxMetalmorph-YAC1-JP-SR.png", "MaxMetalmorph-PGD-EN-UR-1E.png"],
             "Test Card": ["TestCard-TST-EN-C-1E.png", "TestCard-TST-FR-C-1E.png", "TestCard-TST-DE-C.png"]}
TITLES = {"YAC1-JP085": "Jinzo", "YAC1-JP070": "Max Metalmorph", "TST-EN001": "Test Card", "TST-FR001": "Test Card", "TST-DE001": "Test Card",
          "Jinzo": "Jinzo", "Max Metalmorph": "Max Metalmorph", "Test Card": "Test Card"}


class Yugipedia:
    def __init__(self, galleries=None):
        self.galleries = dict(GALLERIES if galleries is None else galleries)
        self.calls = []
        self.up = True

    def __call__(self, url):
        self.calls.append(url)
        q = parse_qs(urlsplit(url).query)
        titles = q.get("titles", [""])[0].split("|")
        if q.get("generator") == ["images"]:
            name = titles[0].replace("Card Gallery:", "")
            return {"query": {"pages": [{"title": "File:" + f} for f in self.galleries.get(name, [])]}}
        if q.get("prop") == ["imageinfo"]:
            return {"query": {"pages": [{"title": t, "imageinfo": [{"url": "https://ms.yugipedia.com/" + t[5:], "thumburl": THUMB % (t[5:], t[5:])}]} for t in titles]}}
        pages, redirects = [], []
        for t in titles:
            if t in TITLES and TITLES[t] in self.galleries:
                if TITLES[t] != t:
                    redirects.append({"from": t, "to": TITLES[t]})
                pages.append({"title": TITLES[t], "pageid": 1})
            else:
                pages.append({"title": t, "missing": True})
        return {"query": {"pages": pages, "redirects": redirects}}


def french(rid="f", **more):
    r = {"id": rid, "productId": 1001, "name": "Test Card", "productName": "Test Card", "setName": "Rarity Collection", "number": "TST-EN001", "rarity": "Common",
         "edition": "1st Edition", "language": "French", "qty": 1, "quantity": 1, "condition": "Near Mint"}
    r.update(more)
    return r


def jinzo(rid="j", rarity="Ultra Rare", **more):
    r = {"id": rid, "productId": None, "name": "Jinzo", "productName": "Jinzo", "setName": "Original Artwork Collection", "number": "YAC1-JP085", "rarity": rarity,
         "edition": "", "language": "Japanese", "qty": 1, "quantity": 1, "condition": "Near Mint"}
    r.update(more)
    return r


class CardScans(SealedBase):
    def go(self, records=(), files=None, galleries=None, yugi_up=True, **kw):
        self.yp = Yugipedia(galleries)
        self.yp.up = yugi_up
        return self.open(records, files=dict(ocg_files(), **(files or {})), routes={"**/yugipedia.com/api.php*": self.yp if yugi_up else None},
                         raw={"**/card-scans/**": ("image/jpeg", PICTURE), "**/ms.yugipedia.com/**": ("image/jpeg", PICTURE),
                              "**/tcgplayer-cdn.tcgplayer.com/**": ("image/jpeg", PICTURE),
                              "**/my.photos/**": ("image/jpeg", PICTURE)}, **kw)

    def base(self, page):
        return "http://127.0.0.1:%d/card-scans/" % self.server.server_address[1]

    def lists(self, page):
        page.evaluate("window.CardVault.loadOcgCards()")
        page.wait_for_function("!!window.CardVault.ocgCd().data && !!window.CardVault.ocgMk().data", timeout=10000)

    def tile_src(self, page, rid):
        return page.evaluate("(id) => { const im = document.querySelector('.tile[data-card=\"' + id + '\"] img'); return im ? im.getAttribute('src') : null; }", rid)

    # ----- the website's copies
    def test_a_scan_in_the_lists_is_the_websites_copy(self):
        page = self.go()
        self.lists(page)
        self.assertEqual(page.evaluate("window.CardVault.ocgMk().data.jp[0].chase[0].img"), self.base(page) + SCAN)
        self.assertEqual(page.evaluate("window.CardVault.ocgCd().data.jp.get('YAC1') ? 1 : 1"), 1)
        row_img = page.evaluate("window.CardVault.ocgCd().data.byNumber.get('YAC1-JP085').rows[0].img")
        self.assertEqual(row_img, self.base(page) + SCAN)
        # (anything else in "scan:" isn't an address)
        self.assertEqual(page.evaluate("window.CardVault.scanURL('scan:../../evil.js')"), "")
        self.assertEqual(page.evaluate("window.CardVault.scanURL('scan:x.jpg\" onerror=\"alert(1)')"), "")

    def test_the_market_shows_the_scan(self):
        page = self.go()
        self.lists(page)
        page.evaluate("window.CardVault.setTab('market')")
        page.wait_for_selector("#mkRegion")
        page.click("#mkRegion [data-mkregion=jp]")
        page.wait_for_selector("[data-ocg-set='jp:YAC1']")
        page.click("[data-ocg-set='jp:YAC1']")
        page.wait_for_function("(u) => Array.from(document.querySelectorAll('.result img')).some(i => i.getAttribute('src') === u)", arg=self.base(page) + SCAN, timeout=5000)

    def test_the_pick_screen_shows_it_and_a_card_added_from_there_keeps_it(self):
        page = self.go()
        self.lists(page)
        page.evaluate("window.CardVault.openAdd({number: 'YAC1-JP085'})")
        page.wait_for_selector("#lookupForm")
        page.evaluate("document.getElementById('lookupForm').dispatchEvent(new Event('submit', {cancelable: true}))")
        page.wait_for_selector("#lookupOut .result")
        first = page.locator("#lookupOut .result", has_text="Ultra Rare")
        self.assertEqual(first.locator("img").get_attribute("src"), self.base(page) + SCAN)
        # (the Secret Rare has no copy: Yugipedia's scan of it, once that's here)
        page.wait_for_function("Array.from(document.querySelectorAll('#lookupOut .result')).some(b => /Secret Rare/.test(b.innerText) && ((b.querySelector('img') || {getAttribute: () => ''}).getAttribute('src') || '').includes('Jinzo-YAC1-JP-ScR.png'))", timeout=10000)
        first.click()
        page.wait_for_selector("#ocgForm")
        page.click("#ocgForm button[type=submit]")
        page.wait_for_selector("#drawer", state="hidden")
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].customImage"), self.base(page) + SCAN)

    def test_a_card_with_a_bigweb_photo_shows_the_websites_copy_first(self):
        page = self.go([jinzo(customImage=BIGWEB)])
        self.lists(page)
        page.evaluate("window.CardVault.render()")
        page.wait_for_function("(u) => { const im = document.querySelector('.tile[data-card=j] img'); return im && im.getAttribute('src') === u; }", arg=self.base(page) + SCAN, timeout=8000)

    # ----- your own cards' prints, from Yugipedia
    def test_a_japanese_card_with_no_copy_gets_its_prints_scan(self):
        page = self.go([jinzo("m", "Super Rare", name="Max Metalmorph", productName="Max Metalmorph", number="YAC1-JP070", customImage=BIGWEB)])
        page.wait_for_function("(window.CardVault.state().collection[0].customImage || '').includes('MaxMetalmorph-YAC1-JP-SR.png')", timeout=15000)

    def test_a_plain_print_never_gets_a_manga_style_scan(self):
        page = self.go([jinzo("x", "Ultra Rare", customImage=BIGWEB)], files=ocg_files(scan_row=False, scan_chase=False),
                       galleries={"Jinzo": ["Jinzo-YAC1-JP-UR-MangaStyle-Color.png"]})
        page.wait_for_timeout(6000)
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].customImage"), BIGWEB)

    def test_a_french_card_from_tcgplayer_shows_the_french_print(self):
        page = self.go([french()])
        page.wait_for_function("(() => { const v = window.CardVault, e = v.printPicOf(v.state().collection[0]); return !!(e && e.u); })()", timeout=15000)
        self.assertIn("TestCard-TST-FR-C-1E.png", page.evaluate("window.CardVault.printPicOf(window.CardVault.state().collection[0]).u"))
        self.assertIsNone(page.evaluate("window.CardVault.state().collection[0].customImage"))      # (TCGplayer's photo stays underneath)
        page.wait_for_function("(() => { const im = document.querySelector('.tile[data-card=f] img'); return im && im.getAttribute('src').includes('TestCard-TST-FR'); })()", timeout=5000)

    def test_a_german_card_gets_the_german_print_and_an_english_one_is_left_alone(self):
        page = self.go([french("g", language="German"), french("e", language="English")])
        page.wait_for_function("(() => { const v = window.CardVault, r = v.state().collection.find(x => x.id === 'g'), e = v.printPicOf(r); return !!(e && e.u); })()", timeout=15000)
        self.assertIn("TestCard-TST-DE-C.png", page.evaluate("window.CardVault.printPicOf(window.CardVault.state().collection.find(x => x.id === 'g')).u"))
        self.assertIsNone(page.evaluate("window.CardVault.printPicOf(window.CardVault.state().collection.find(x => x.id === 'e'))"))

    def test_your_own_photo_comes_first(self):
        page = self.go([french(customImage="https://my.photos/mine.jpg")])
        page.wait_for_timeout(4500)
        self.assertIsNone(page.evaluate("window.CardVault.printPicOf(window.CardVault.state().collection[0])"))
        self.assertEqual(self.tile_src(page, "f"), "https://my.photos/mine.jpg")

    def test_a_language_with_no_scan_keeps_tcgplayers_photo_and_isnt_asked_again(self):
        page = self.go([french("i", language="Italian")])
        page.wait_for_function("(() => { const v = window.CardVault, e = v.printPicOf(v.state().collection[0]); return !!e; })()", timeout=15000)
        self.assertEqual(page.evaluate("window.CardVault.printPicOf(window.CardVault.state().collection[0]).u"), "")
        self.assertIn("tcgplayer-cdn", self.tile_src(page, "i"))
        calls = len(self.yp.calls)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.wait_for_timeout(4500)
        self.assertEqual(len(self.yp.calls), calls)

    def test_the_language_print_is_kept_and_not_asked_for_again(self):
        page = self.go([french()])
        page.wait_for_function("(() => { const v = window.CardVault, e = v.printPicOf(v.state().collection[0]); return !!(e && e.u); })()", timeout=15000)
        calls = len(self.yp.calls)
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.wait_for_timeout(4500)
        self.assertEqual(len(self.yp.calls), calls)
        page.wait_for_function("(() => { const im = document.querySelector('.tile[data-card=f] img'); return im && im.getAttribute('src').includes('TestCard-TST-FR'); })()", timeout=5000)

    def test_yugipedia_being_down_breaks_nothing(self):
        page = self.go([french(), jinzo(customImage=BIGWEB)], yugi_up=False)
        page.wait_for_timeout(5000)
        self.assertEqual(page.evaluate("document.querySelectorAll('.tile').length"), 2)

    def test_numbers_in_other_languages(self):
        page = self.go()
        got = page.evaluate("[['LOB-EN001', 'French'], ['LOB-001', 'German'], ['MP23-EN001', 'Spanish'], ['RA01-EN054', 'Portuguese'], ['LOB-EN001', 'English'], ['LOB-EN001', 'Chinese (Simplified)']]"
                            ".map(([n, l]) => window.CardVault.langNumber(n, l))")
        self.assertEqual(got, ["LOB-FR001", "LOB-DE001", "MP23-SP001", "RA01-PT054", "", ""])


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(CardScans)


if __name__ == "__main__":
    unittest.main()
