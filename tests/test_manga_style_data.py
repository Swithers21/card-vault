"""Manga-Style cards (Original Artwork Collection): the nightly job tells their versions apart.

A Manga-Style card (YAC1-JP071 to 100) comes in a black-and-white and a colour version, each as an Ultra Rare and a Secret
Rare: four printings of one number, selling at four prices. These run ocg_market.py's reading of Yugipedia's list and
BIGWEB's listings against made-up answers shaped like the real ones (seen on 17 October 2026) and check what ends up in
the card list the website uses.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import ocg_market as m  # noqa: E402

UR_MONO, UR_COLOR = "Ultra Rare (Manga Monochrome)", "Ultra Rare (Manga Color)"
SE_MONO, SE_COLOR = "Secret Rare (Manga Monochrome)", "Secret Rare (Manga Color)"

# Yugipedia's list page as it is: the numbered cards, then the Manga-Style ones with no number
WIKI = """{{Set page header}}

{{Set list|region=JP|rarities=Ultra Rare, Secret Rare|print=New as Manga-Style|
YAC1-JP001; Exodia the Obliterator;; New
YAC1-JP069; Exxod Fires of Rage; Super Rare, Secret Rare; Reprint
YAC1-JP070; Max Metalmorph; Super Rare, Secret Rare, Prismatic Secret Rare; Reprint
; Dark Magician //description::(Manga-Style)
; Red-Eyes Black Dragon //description::(Manga-Style)
; Blue-Eyes White Dragon //description::(Manga-Style)
; Mystical Elf //description::(Manga-Style)
; Baby Dragon //description::(Manga-Style)
}}
"""
LIST_PAGE = "Set Card Lists:Original Artwork Collection (OCG-JP)"


def wiki_answer(text):
    return {"query": {"pages": [{"title": LIST_PAGE, "revisions": [{"slots": {"main": {"content": text}}}]}]}}


def ask_answer(cards):
    """Yugipedia's "ask" answer for these {number: (name, [rarities])}: a row per card page, as the real one is."""
    results = {}
    for number, (name, rarities) in cards.items():
        results[LIST_PAGE + "# " + number] = {"fulltext": LIST_PAGE + "# " + number, "printouts": {
            "Card number": [{"raw": number}], "Rarity": [{"raw": r} for r in rarities], "Set contains": [{"fulltext": name}]}}
    return {"query": {"results": results}}


class FakeWeb:
    """Answers like the sites do, and counts what was asked."""
    def __init__(self, wiki=WIKI, cards=None, products=None):
        self.wiki, self.cards, self.products = wiki, cards or {}, products or []
        self.asked = []

    def get_json(self, url, pause, headers=None):
        self.asked.append(url)
        if "action=ask" in url:
            return ask_answer(self.cards)
        if "action=query" in url:
            return wiki_answer(self.wiki)
        if "/products" in url:
            page = int(url.rsplit("page=", 1)[1])
            return {"items": self.products if page == 1 else [], "pagenate": {"nextPage": None}}
        raise AssertionError("asked for " + url)


def item(number, name, rarity, price, stock, cond="プレイ用", image="https://img.example/1.jpg"):
    return {"fname": number, "name": name, "rarity": {"web": rarity}, "condition": {"web": cond}, "price": price, "stock_count": stock,
            "image": image, "is_hidden_price": price == 0}


# BIGWEB's four listings of Dark Magician, as they were: the colour ones hidden (sold out), the black-and-white ones for sale
DARK_MAGICIAN = [
    item("YAC1-JP071", "ブラック・マジシャン【カラー版】", "シークレットレア", 0, 0),
    item("YAC1-JP071", "ブラック・マジシャン【モノクロ】", "シークレットレア", 2780, 3),
    item("YAC1-JP071", "ブラック・マジシャン【カラー版】", "ウルトラレア", 0, 0),
    item("YAC1-JP071", "ブラック・マジシャン【モノクロ】", "ウルトラレア", 1180, 3),
]
RED_EYES = [
    item("YAC1-JP072", "真紅眼の黒竜【カラー版】", "シークレットレア", 7480, 2),
    item("YAC1-JP072", "真紅眼の黒竜【モノクロ】", "シークレットレア", 0, 0),
    item("YAC1-JP072", "真紅眼の黒竜【カラー版】", "ウルトラレア", 0, 0),
    item("YAC1-JP072", "真紅眼の黒竜【モノクロ】", "ウルトラレア", 1580, 3),
]
OVERFRAME = [item("YAC1-JP001", "業火の魔神エクゾディア", "【オーバーフレーム】ウルトラレア", 380, 3)]


class Names(unittest.TestCase):
    def test_the_version_comes_from_the_name_of_the_listing(self):
        self.assertEqual(m.manga_rarity("Ultra Rare", "ブラック・マジシャン【モノクロ】"), UR_MONO)
        self.assertEqual(m.manga_rarity("Secret Rare", "ブラック・マジシャン【カラー版】"), SE_COLOR)
        self.assertEqual(m.manga_rarity("Secret Rare", "ブラック・マジシャン【カラー】"), SE_COLOR)       # (a shorter mark, should it come)
        self.assertEqual(m.manga_rarity("Secret Rare", "ブラック・マジシャン【 カラー版 】"), SE_COLOR)

    def test_a_listing_that_says_nothing_keeps_its_rarity(self):
        self.assertEqual(m.manga_rarity("Ultra Rare", "ブラック・マジシャン"), "Ultra Rare")
        self.assertEqual(m.manga_rarity("Ultra Rare (Overframe)", "業火の魔神エクゾディア"), "Ultra Rare (Overframe)")
        self.assertEqual(m.manga_rarity("", "ブラック・マジシャン【モノクロ】"), "")

    def test_the_japanese_name_loses_the_mark(self):
        self.assertEqual(m.manga_free("ブラック・マジシャン【モノクロ】"), "ブラック・マジシャン")
        self.assertEqual(m.manga_free("聖なるバリア ―ミラーフォース―【カラー版】"), "聖なるバリア ―ミラーフォース―")
        self.assertEqual(m.manga_free("融合"), "融合")

    def test_versions_of_a_rarity(self):
        self.assertEqual(m.manga_versions("Ultra Rare"), [UR_MONO, UR_COLOR])
        self.assertEqual(m.manga_versions(UR_COLOR), [UR_MONO, UR_COLOR])      # (already one: its own two)
        self.assertEqual(m.manga_base(SE_MONO), "Secret Rare")
        self.assertTrue(m.is_manga(SE_MONO))
        self.assertFalse(m.is_manga("Ultra Rare (Overframe)"))


class YugipediaList(unittest.TestCase):
    def cards(self, **more):
        return dict({"YAC1-JP001": ["Exodia the Obliterator", ["Ultra Rare"]], "YAC1-JP070": ["Max Metalmorph", ["Super Rare"]]}, **more)

    def test_numberless_lines_continue_the_numbers_in_the_sets_order(self):
        cards = self.cards()
        m.read_manga_style(FakeWeb(), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual([cards["YAC1-JP07%d" % i][0] for i in range(1, 6)],
                         ["Dark Magician", "Red-Eyes Black Dragon", "Blue-Eyes White Dragon", "Mystical Elf", "Baby Dragon"])
        self.assertNotIn("YAC1-JP076", cards)
        self.assertEqual(cards["YAC1-JP001"][1], ["Ultra Rare"])        # (the others are left alone)

    def test_every_rarity_is_a_rarity_per_version(self):
        cards = self.cards()
        m.read_manga_style(FakeWeb(), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(cards["YAC1-JP071"][1], [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR])

    def test_a_line_with_its_own_rarities_keeps_to_them(self):
        wiki = WIKI.replace("; Baby Dragon //", "; Baby Dragon; Secret Rare //")
        cards = self.cards()
        m.read_manga_style(FakeWeb(wiki), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(cards["YAC1-JP075"][1], [SE_MONO, SE_COLOR])

    def test_a_line_that_has_its_number_is_that_card_with_its_versions(self):
        wiki = WIKI.replace("; Dark Magician //", "YAC1-JP071; Dark Magician //")
        cards = self.cards(**{"YAC1-JP071": ["Dark Magician", ["Ultra Rare", "Secret Rare"]]})
        m.read_manga_style(FakeWeb(wiki), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(cards["YAC1-JP071"][1], [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR])
        self.assertEqual(cards["YAC1-JP072"][0], "Red-Eyes Black Dragon")        # (the next line goes on from its number)

    def test_a_number_that_is_taken_is_not_given_again(self):
        cards = self.cards(**{"YAC1-JP072": ["Somebody Else", ["Common"]]})
        m.read_manga_style(FakeWeb(), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(cards["YAC1-JP072"], ["Somebody Else", ["Common"]])
        self.assertEqual(cards["YAC1-JP073"][0], "Blue-Eyes White Dragon")       # (the line still counts as 072)

    def test_numberless_lines_that_are_not_manga_style_are_not_numbered(self):
        wiki = WIKI.replace(" //description::(Manga-Style)", " //description::(a promo)")
        cards = self.cards()
        m.read_manga_style(FakeWeb(wiki), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(sorted(cards), ["YAC1-JP001", "YAC1-JP070"])

    def test_without_a_numbered_card_before_them_nothing_is_numbered(self):
        wiki = "{{Set list|region=JP|rarities=Ultra Rare|\n; Dark Magician //description::(Manga-Style)\n}}\n"
        cards = {}
        m.read_manga_style(FakeWeb(wiki), [LIST_PAGE], cards, "YAC1-JP")
        self.assertEqual(cards, {})

    def test_the_whole_list_read_for_a_recent_set(self):
        web = FakeWeb(cards={"YAC1-JP001": ("Exodia the Obliterator", ["Ultra Rare"]), "YAC1-JP070": ("Max Metalmorph", ["Super Rare", "Secret Rare"])})
        cards = m.read_card_list(web, "YAC1", "jp", manga=True)
        self.assertEqual(cards["YAC1-JP071"], ["Dark Magician", [UR_MONO, UR_COLOR, SE_MONO, SE_COLOR]])
        self.assertEqual(cards["YAC1-JP070"][1], ["Super Rare", "Secret Rare"])

    def test_an_older_set_isnt_asked_for_its_page_again(self):
        web = FakeWeb(cards={"YAC1-JP001": ("Exodia the Obliterator", ["Ultra Rare"])})
        cards = m.read_card_list(web, "YAC1", "jp")
        self.assertEqual(list(cards), ["YAC1-JP001"])
        self.assertFalse([u for u in web.asked if "action=query" in u])

    def test_a_page_that_cant_be_read_fails_the_list_so_it_is_read_again(self):
        class Down(FakeWeb):
            def get_json(self, url, pause, headers=None):
                if "action=query" in url:
                    raise OSError("down")
                return super().get_json(url, pause, headers)
        with self.assertRaises(OSError):
            m.read_card_list(Down(cards={"YAC1-JP001": ("Exodia the Obliterator", ["Ultra Rare"])}), "YAC1", "jp", manga=True)


class Prices(unittest.TestCase):
    def read(self, products, old=None):
        return m.read_bigweb_prices(FakeWeb(products=products), "YAC1", [8978], old)

    def test_each_version_has_its_own_price(self):
        got = self.read(DARK_MAGICIAN)
        self.assertEqual(sorted(got), ["YAC1-JP071|" + r for r in (SE_COLOR, SE_MONO, UR_COLOR, UR_MONO)])
        self.assertEqual(got["YAC1-JP071|" + UR_MONO]["p"], 1180)
        self.assertEqual(got["YAC1-JP071|" + SE_MONO]["p"], 2780)

    def test_a_version_with_a_hidden_price_has_none_not_the_others(self):
        got = self.read(DARK_MAGICIAN)
        for r in (UR_COLOR, SE_COLOR):
            self.assertNotIn("p", got["YAC1-JP071|" + r])
            self.assertNotIn("last", got["YAC1-JP071|" + r])

    def test_the_japanese_name_is_the_cards_own(self):
        self.assertEqual(self.read(DARK_MAGICIAN)["YAC1-JP071|" + UR_MONO]["ja"], "ブラック・マジシャン")

    def test_a_sold_out_version_remembers_its_own_last_price(self):
        old = {"YAC1-JP071|" + UR_COLOR: {"p": 5149, "at": "2026-10-10"}, "YAC1-JP071|" + UR_MONO: {"p": 1200, "at": "2026-10-10"}}
        got = self.read(DARK_MAGICIAN, old)
        self.assertEqual(got["YAC1-JP071|" + UR_COLOR]["last"], 5149)
        self.assertEqual(got["YAC1-JP071|" + UR_MONO]["p"], 1180)

    def test_the_old_price_that_mixed_the_versions_is_not_a_versions_price(self):
        old = {"YAC1-JP071|Ultra Rare": {"p": 1180, "at": "2026-10-10"}}
        got = self.read(DARK_MAGICIAN, old)
        self.assertNotIn("last", got["YAC1-JP071|" + UR_COLOR])
        self.assertNotIn("YAC1-JP071|Ultra Rare", got)

    def test_an_overframe_printing_is_as_it_was(self):
        self.assertEqual(sorted(self.read(OVERFRAME)), ["YAC1-JP001|Ultra Rare (Overframe)"])

    def test_cheapest_copy_in_stock_is_picked_within_a_version(self):
        two = [item("YAC1-JP093", "光の護封剣【モノクロ】", "シークレットレア", 380, 1, cond="特価[傷含む]"),
               item("YAC1-JP093", "光の護封剣【モノクロ】", "シークレットレア", 680, 1)]
        self.assertEqual(self.read(two)["YAC1-JP093|" + SE_MONO]["p"], 680)       # (the play copy, not the cheaper damaged one)


class ManyListings(unittest.TestCase):
    def test_a_set_with_a_listing_per_version_is_read_to_its_last_page(self):
        # (30 a page, as BIGWEB gives them: 11 pages for 320 listings, more than the 8 pages a set used to be read to)
        listings = [item("YAC1-JP%03d" % (1 + i), "カード%d【モノクロ】" % i, "ウルトラレア", 100 + i, 1) for i in range(320)]

        class Paged(FakeWeb):
            def get_json(self, url, pause, headers=None):
                page = int(url.rsplit("page=", 1)[1])
                self.asked.append(url)
                chunk = listings[(page - 1) * 30:page * 30]
                return {"items": chunk, "pagenate": {"nextPage": page + 1 if page * 30 < len(listings) else None}}
        web = Paged()
        got = m.read_bigweb_prices(web, "YAC1", [8978], {})
        self.assertEqual(len(web.asked), 11)
        self.assertEqual(len(got), 320)


class CardList(unittest.TestCase):
    def build(self, cards, items):
        names, ja, rar = m.Table(), m.Table(), m.Table()
        s = {"prefix": "YAC1", "date": "2026-09-26"}
        with mock.patch.object(m, "history_path", return_value=os.path.join(tempfile.gettempdir(), "no-such-history.json")):
            prefix, refs, rows = m.cards_jp(s, {"jp|YAC1": {"cards": cards}}, {"jp|YAC1": {"items": items}}, names, ja, rar)
        out = {}
        for tail, name, printings in rows:
            out[tail] = (names.items[name], [(rar.items[p[0]], p[1], p[2], ja.items[p[7]]) for p in printings])
        return out

    def test_a_manga_style_card_has_four_rows_with_their_own_prices_and_the_english_name(self):
        cards = {"YAC1-JP071": ["Dark Magician", m.manga_versions("Ultra Rare") + m.manga_versions("Secret Rare")]}
        got = self.build(cards, self.read_items(DARK_MAGICIAN))["071"]
        self.assertEqual(got[0], "Dark Magician")
        self.assertEqual([(r, yen, stock) for r, yen, stock, _ in got[1]], [(UR_MONO, 1180, 3), (UR_COLOR, 0, 0), (SE_MONO, 2780, 3), (SE_COLOR, 0, 0)])
        self.assertEqual({ja for *_, ja in got[1]}, {"ブラック・マジシャン"})

    def read_items(self, products):
        return m.read_bigweb_prices(FakeWeb(products=products), "YAC1", [8978], {})

    def test_without_the_list_the_shop_alone_gives_the_four_rows(self):
        got = self.build({}, self.read_items(DARK_MAGICIAN))["071"]
        self.assertEqual(sorted(r for r, *_ in got[1]), sorted([UR_MONO, UR_COLOR, SE_MONO, SE_COLOR]))
        self.assertEqual(got[0], "ブラック・マジシャン")       # (the shop's name, until the list has the English one)

    def test_a_plain_row_from_a_list_that_doesnt_know_the_versions_gives_way(self):
        cards = {"YAC1-JP071": ["Dark Magician", ["Ultra Rare", "Secret Rare"]]}
        got = self.build(cards, self.read_items(DARK_MAGICIAN))["071"]
        self.assertEqual(sorted(r for r, *_ in got[1]), sorted([UR_MONO, UR_COLOR, SE_MONO, SE_COLOR]))

    def test_a_plain_price_next_to_the_versions_is_kept(self):
        # (a listing that tells no version is a printing of its own)
        products = DARK_MAGICIAN + [item("YAC1-JP071", "ブラック・マジシャン", "ウルトラレア", 900, 1)]
        cards = {"YAC1-JP071": ["Dark Magician", ["Ultra Rare"]]}
        got = self.build(cards, self.read_items(products))["071"]
        self.assertIn(("Ultra Rare", 900, 1, "ブラック・マジシャン"), got[1])

    def test_a_card_that_isnt_manga_style_is_as_it_was(self):
        cards = {"YAC1-JP001": ["Exodia the Obliterator", ["Ultra Rare (Overframe)", "Prismatic Secret Rare (Overframe)"]]}
        got = self.build(cards, self.read_items(OVERFRAME))["001"]
        self.assertEqual([r for r, *_ in got[1]], ["Ultra Rare (Overframe)", "Prismatic Secret Rare (Overframe)"])
        self.assertEqual(got[1][0][1], 380)


class ReadAgain(unittest.TestCase):
    """A set read before the versions were told apart is read again, once."""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        patch = mock.patch.object(m, "CACHE", self.dir)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.sets = {"jp": [{"prefix": "YAC1", "date": "2026-09-26"}, {"prefix": "OLD1", "date": "2025-03-01"}, {"prefix": "RD/KP01", "date": "2026-09-01", "rush": True}], "kr": []}

    def put(self, kind, prefix, value):
        m.write_json(m.cache_path(kind, "jp-%s.json" % m.safe_name(prefix)), value)

    def meta(self):
        return {"jp|%s|%s" % (p, k): "2026-10-16" for p in ("YAC1", "OLD1", "RD/KP01") for k in ("list", "price")}

    def test_a_recent_set_read_before_is_read_again(self):
        self.put("lists", "YAC1", {"cards": {}, "ov": 1})
        self.put("prices", "YAC1", {"items": {"YAC1-JP071|Ultra Rare": {"v": 2}}})
        meta = self.meta()
        m.reread_old(self.sets, meta)
        self.assertNotIn("jp|YAC1|list", meta)
        self.assertNotIn("jp|YAC1|price", meta)

    def test_once_read_with_the_versions_it_is_left_alone(self):
        self.put("lists", "YAC1", {"cards": {}, "ov": 1, "mg": 1})
        self.put("prices", "YAC1", {"items": {"YAC1-JP071|" + UR_MONO: {"v": 2}}, "mg": 1})
        meta = self.meta()
        m.reread_old(self.sets, meta)
        self.assertIn("jp|YAC1|list", meta)
        self.assertIn("jp|YAC1|price", meta)

    def test_a_set_from_before_manga_style_isnt_read_again_for_it(self):
        self.put("lists", "OLD1", {"cards": {}, "ov": 1})
        self.put("prices", "OLD1", {"items": {"OLD1-JP001|Ultra Rare": {"v": 2}}})
        meta = self.meta()
        m.reread_old(self.sets, meta)
        self.assertIn("jp|OLD1|list", meta)
        self.assertIn("jp|OLD1|price", meta)

    def test_a_set_never_read_has_nothing_to_forget(self):
        meta = self.meta()
        m.reread_old(self.sets, meta)
        self.assertEqual(sorted(meta), sorted(self.meta()))

    def test_the_overframe_reread_is_as_it_was(self):
        self.put("lists", "OLD1", {"cards": {}})
        meta = self.meta()
        m.reread_old(self.sets, meta)
        self.assertNotIn("jp|OLD1|list", meta)


if __name__ == "__main__":
    unittest.main()
