"""The nightly job that gives the Market's Japanese and Korean chase cards a picture of their own print (card_scans.py).

Run against a pretend Yugipedia shaped like the real one: the ask query that names a set's list page ("Set Card
Lists:Original Artwork Collection (OCG-JP)#..."), the gallery's file list (prop=images, in pages) and wiki text
("YAC1-JP001; Exodia the Obliterator; Ultra Rare"), file addresses (prop=imageinfo) and the pictures themselves.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.parse
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import card_scans as cs  # noqa: E402

try:
    from PIL import Image
except ImportError:     # pragma: no cover
    Image = None

BIGWEB = "https://image.bigweb.co.jp/new/imgc/035/869/3586905.jpg"
FULLAHEAD = "https://makeshop-multi-images.akamaized.net/fullyugi/itemimages/0000000880303_WxcOdOo.jpg"


def png(color=(200, 30, 30, 255), size=(421, 614)):
    if Image is None:
        return b"\x89PNG\r\n\x1a\n" + b"0" * 64
    out = io.BytesIO()
    Image.new("RGBA", size, color).save(out, "PNG")
    return out.getvalue()


def market(jp=None, kr=None):
    """ocg-market.js rows: [prefix, name, date, line, cards, chase, local, box]; chase: [number, name, rarity, price, stock, img]."""
    return {"generated": "2026-10-17T00:00:00+00:00", "fx": {"JPY": 150, "KRW": 1400},
            "jp": jp if jp is not None else [
                ["YAC1", "Original Artwork Collection", "2026-09-26", "boxed", 100, [
                    ["YAC1-JP085", "Jinzo", "Ultra Rare (Manga Monochrome)", 480, 1, BIGWEB],
                    ["YAC1-JP085", "Jinzo", "Ultra Rare (Manga Color)", 680, 1, BIGWEB],
                    ["YAC1-JP085", "Jinzo", "Secret Rare (Manga Color)", 1380, 1, BIGWEB],
                    ["YAC1-JP001", "Exodia the Obliterator", "Prismatic Secret Rare (Overframe)", 9000, 1, BIGWEB],
                    ["YAC1-JP002", "完璧な蛾", "Ultra Rare", 500, 1, ""],
                    ["YAC1-JP070", "Max Metalmorph", "Super Rare", 100, 1, FULLAHEAD]], "", None],
                ["OLD1", "Old Set", "2004-01-01", "core", 50, [["OLD1-JP001", "Old Card", "Rare", 100, 1, BIGWEB]], "", None]],
            "kr": kr if kr is not None else [
                ["YAC1", "Original Artwork Collection", "2026-10-01", "boxed", 100, [
                    ["YAC1-KR085", "Jinzo", "Ultra Rare (Manga Monochrome)", 9000, 3, BIGWEB],
                    ["YAC1-KR070", "Max Metalmorph", "Super Rare", 2000, 3, ""]], "", [84000, 6]]]}


def cards_list():
    """ocg-cards.js: names, rar, and per set [[tail, nameIdx, [[rarIdx, yen, stock, img, ...]]]]."""
    rar = ["Ultra Rare (Manga Monochrome)", "Ultra Rare (Manga Color)", "Secret Rare (Manga Color)", "Prismatic Secret Rare (Overframe)", "Ultra Rare", "Super Rare"]
    return {"generated": "2026-10-17T00:00:00+00:00", "fx": {}, "names": ["Jinzo", "Exodia the Obliterator", "Max Metalmorph"], "rar": rar, "ja": [""],
            "jp": [["YAC1", ["", "", ""], [["085", 0, [[0, 480, 1, 3586905, 0, 0, 0, 0], [1, 680, 1, 3586906, 0, 0, 0, 0], [2, 1380, 1, 0, 0, 0, 0, 0]]],
                                           ["001", 1, [[3, 9000, 1, 0, 0, 0, 0, 0]]], ["070", 2, [[5, 100, 1, FULLAHEAD, 0, 0, 0, 0]]]]]],
            "kr": [["YAC1", ["", "", ""], [["085", 0, [[0, 9000, 3, 0, 0, 0, 0]]]]]]}


# The galleries Yugipedia has (file names as the real ones are written)
JP_GALLERY = ["JinzoYAC1-JP-UR-MangaStyle-Monochrome-x.png",   # (a broken name: skipped)
              "Jinzo-YAC1-JP-UR-MangaStyle-Monochrome.png", "Jinzo-YAC1-JP-UR-MangaStyle-Color.png", "Jinzo-YAC1-JP-ScR-MangaStyle-Monochrome.png",
              "ExodiatheObliterator-YAC1-JP-UR.png", "ExodiatheObliterator-YAC1-JP-PScR-EA.png", "ExodiatheObliterator-YAC1-JP-PScR.png",
              "PerfectEclosionPerfectlyUltimateGreatMoth-YAC1-JP-UR.png", "MaxMetalmorph-YAC1-JP-SR.png", "Back-JP.png", "Jinzo-YAC1-JP-UR-VG.png"]
JP_WIKITEXT = "{{Set gallery|rarity=Super Rare|\nYAC1-JP001; Exodia the Obliterator; Ultra Rare\nYAC1-JP002; Perfect Eclosion - Perfectly Ultimate Great Moth; Ultra Rare\nYAC1-JP070; Max Metalmorph\n}}"
KR_GALLERY = ["MaxMetalmorph-YAC1-KR-SR.png"]     # (no Korean scan of Jinzo: the Japanese print's stands in)


class FakeYugipedia:
    def __init__(self):
        self.lists = {"YAC1-JP": "Set Card Lists:Original Artwork Collection (OCG-JP)", "YAC1-KR": "Set Card Lists:Original Artwork Collection (OCG-KR)"}
        self.galleries = {"Set Card Galleries:Original Artwork Collection (OCG-JP)": (JP_GALLERY, JP_WIKITEXT),
                          "Set Card Galleries:Original Artwork Collection (OCG-KR)": (KR_GALLERY, "")}
        self.calls = []
        self.down = False
        self.pictures = 0

    def fetch(self, web, url, pause, accept="application/json", limit=0):
        web.requests += 1
        self.calls.append(url)
        if self.down:
            web.streak += 1
            raise IOError("network")
        u = urllib.parse.urlsplit(url)
        if u.netloc == "ms.yugipedia.com":
            self.pictures += 1
            return png(), "image/png"
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if q.get("action") == "ask":
            number = q["query"].split("::")[1].split("]]")[0]
            title = next((t for k, t in self.lists.items() if number.startswith(k)), None)
            res = {title + "#abc": {"printouts": {"Card number": [number]}}, "Yu-Gi-Oh! Card Database": {"printouts": {}}} if title else []
            return json.dumps({"query": {"results": res}}).encode(), "application/json"
        if q.get("prop") == "images":
            files, _ = self.galleries.get(q["titles"], ([], ""))
            # (in pages of 4, like a big gallery's)
            start = int(q.get("imcontinue", "0"))
            page = files[start:start + 4]
            j = {"query": {"pages": [{"title": q["titles"], "images": [{"title": "File:" + f} for f in page]}]}}
            if start + 4 < len(files):
                j["continue"] = {"imcontinue": str(start + 4), "continue": "||"}
            return json.dumps(j).encode(), "application/json"
        if q.get("prop") == "revisions":
            _, text = self.galleries.get(q["titles"], ([], ""))
            return json.dumps({"query": {"pages": [{"title": q["titles"], "revisions": [{"slots": {"main": {"content": text}}}]}]}}).encode(), "application/json"
        if q.get("prop") == "imageinfo":
            titles = q["titles"].split("|")
            return json.dumps({"query": {"pages": [{"title": t, "imageinfo": [{"thumburl": "https://ms.yugipedia.com/thumb/x/" + t[5:] + "/200px-" + t[5:],
                                                                                 "url": "https://ms.yugipedia.com/" + t[5:]}]} for t in titles]}}).encode(), "application/json"
        raise AssertionError("unexpected request " + url)


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.market = os.path.join(self.dir, "ocg-market.js")
        self.cards = os.path.join(self.dir, "ocg-cards.js")
        self.out = os.path.join(self.dir, "card-scans")
        self.tcg = os.path.join(self.dir, "tcgplayer-data.js")
        self.write(self.market, "OCG_MARKET", market())
        self.write(self.cards, "OCG_CARDS", cards_list())
        self.yp = FakeYugipedia()
        real = cs.Web.fetch
        cs.Web.fetch = lambda web, url, pause, accept="application/json", limit=3_000_000: self.yp.fetch(web, url, pause, accept, limit)
        self.addCleanup(setattr, cs.Web, "fetch", real)
        self.quiet = []
        real_say = cs.say
        cs.say = self.quiet.append
        self.addCleanup(setattr, cs, "say", real_say)

    def write(self, path, name, data):
        with open(path, "w", encoding="utf-8") as f:
            f.write("/* Card Vault: test. */\nwindow." + name + " = " + json.dumps(data) + ";\n")

    def run_job(self, **kw):
        return cs.run(self.market, self.cards, self.out, self.tcg, **kw)

    def market_now(self):
        return cs.read_js(self.market, "OCG_MARKET")[1]

    def chase(self, region="jp", prefix="YAC1"):
        s = next(x for x in self.market_now()[region] if x[0] == prefix)
        return {(c[0], c[2]): c[5] for c in s[5]}

    def index(self):
        with open(os.path.join(self.out, "index.json")) as f:
            return json.load(f)


class Matching(unittest.TestCase):
    def files(self, names):
        return [f for f in (cs.parse_file("File:" + n) for n in names) if f]

    def test_a_file_name_is_read_into_its_parts(self):
        f = cs.parse_file("File:DarkMagician-YAC1-JP-UR-MangaStyle-Monochrome.png")
        self.assertEqual((f["name"], f["set"], f["region"], f["rarity"], f["extra"]), ("darkmagician", "YAC1", "JP", "UR", ["MangaStyle", "Monochrome"]))
        self.assertEqual(cs.parse_file("File:HarpieLady-RDKP25-JP-FORR.png")["set"], "RDKP25")
        self.assertIsNone(cs.parse_file("File:Back-JP.png"))
        self.assertIsNone(cs.parse_file("File:Jinzo-YAC1-JP-UR-VG.png"))          # (a video-game render)
        self.assertIsNone(cs.parse_file("File:Some-picture.svg"))

    def test_names_are_compared_the_way_file_names_spell_them(self):
        self.assertEqual(cs.loose('Penalty Game "GREED, the Illusion of Avarice"'), "penaltygamegreedtheillusionofavarice")
        self.assertEqual(cs.loose("Winged Dragon, Guardian of the Fortress #1"), "wingeddragonguardianofthefortress1")
        self.assertEqual(cs.loose("Cú Chulainn the Awakened"), "cuchulainntheawakened")

    def test_a_manga_version_gets_its_own_version_and_never_the_other(self):
        files = self.files(JP_GALLERY)
        self.assertEqual(cs.best_file(files, "Jinzo", "JP", "Ultra Rare (Manga Color)")["file"], "Jinzo-YAC1-JP-UR-MangaStyle-Color.png")
        self.assertEqual(cs.best_file(files, "Jinzo", "JP", "Secret Rare (Manga Monochrome)")["file"], "Jinzo-YAC1-JP-ScR-MangaStyle-Monochrome.png")
        # (no Secret Rare colour scan: the colour Ultra Rare's, the same artwork; never the black-and-white one)
        self.assertEqual(cs.best_file(files, "Jinzo", "JP", "Secret Rare (Manga Color)")["file"], "Jinzo-YAC1-JP-UR-MangaStyle-Color.png")
        only_mono = self.files(["Jinzo-YAC1-JP-UR-MangaStyle-Monochrome.png"])
        self.assertIsNone(cs.best_file(only_mono, "Jinzo", "JP", "Ultra Rare (Manga Color)"))
        self.assertIsNone(cs.best_file(only_mono, "Jinzo", "JP", "Ultra Rare"))          # (a plain print isn't the manga one)

    def test_an_overframe_print_gets_its_extended_art_else_its_usual_art(self):
        files = self.files(JP_GALLERY)
        self.assertEqual(cs.best_file(files, "Exodia the Obliterator", "JP", "Prismatic Secret Rare (Overframe)")["file"], "ExodiatheObliterator-YAC1-JP-PScR-EA.png")
        self.assertEqual(cs.best_file(files, "Exodia the Obliterator", "JP", "Prismatic Secret Rare")["file"], "ExodiatheObliterator-YAC1-JP-PScR.png")
        self.assertEqual(cs.best_file(self.files(["ExodiatheObliterator-YAC1-JP-UR.png"]), "Exodia the Obliterator", "JP", "Prismatic Secret Rare (Overframe)")["file"],
                         "ExodiatheObliterator-YAC1-JP-UR.png")

    def test_the_language_must_match(self):
        files = self.files(["MaxMetalmorph-YAC1-KR-SR.png"])
        self.assertIsNone(cs.best_file(files, "Max Metalmorph", "JP", "Super Rare"))
        self.assertIsNotNone(cs.best_file(files, "Max Metalmorph", "KR", "Super Rare"))

    def test_an_official_image_is_used_only_when_there_is_no_scan(self):
        files = self.files(["Jinzo-AB12-JP-OP.png", "Jinzo-AB12-JP-UR.png"])
        self.assertEqual(cs.best_file(files, "Jinzo", "JP", "Super Rare")["file"], "Jinzo-AB12-JP-UR.png")

    def test_the_gallery_text_gives_english_names_by_number(self):
        names = cs.gallery_names(JP_WIKITEXT + "\nRD/KP25-JPS00; Exalted Celestial (Rush Duel); Ultra Rare\n307-001; Giga Gagagigo; Common")
        self.assertEqual(names["YAC1-JP002"], "Perfect Eclosion - Perfectly Ultimate Great Moth")
        self.assertEqual(names["RD/KP25-JPS00"], "Exalted Celestial")
        self.assertEqual(names["307-001"], "Giga Gagagigo")
        self.assertNotIn("{{SET GALLERY|RARITY=SUPER RARE|", names)


class Job(Base):
    def test_the_cards_with_no_photo_that_loads_get_their_print_and_the_files_point_at_it(self):
        self.assertEqual(self.run_job(), 0)
        ch = self.chase()
        self.assertEqual(ch[("YAC1-JP085", "Ultra Rare (Manga Monochrome)")], "scan:jp-yac1-jp085-ultra-rare-manga-monochrome.jpg" if Image else
                         "scan:jp-yac1-jp085-ultra-rare-manga-monochrome.png")
        self.assertTrue(ch[("YAC1-JP085", "Ultra Rare (Manga Color)")].startswith("scan:jp-yac1-jp085-ultra-rare-manga-color."))
        self.assertTrue(ch[("YAC1-JP001", "Prismatic Secret Rare (Overframe)")].startswith("scan:"))
        # (a Japanese-only name in Card Vault's list: found by its number in the gallery's text)
        self.assertTrue(ch[("YAC1-JP002", "Ultra Rare")].startswith("scan:"))
        # (Fullahead's photo loads: left as it is)
        self.assertEqual(ch[("YAC1-JP070", "Super Rare")], FULLAHEAD)
        idx = self.index()
        self.assertEqual(idx["scans"]["yac1-jp085|ultra rare (manga color)".upper().split("|")[0] + "|ultra rare (manga color)"]["src"], "Jinzo-YAC1-JP-UR-MangaStyle-Color.png")
        for v in idx["scans"].values():
            self.assertTrue(os.path.isfile(os.path.join(self.out, v["f"])))
        # the card list's rows with the same print point at it too; a BIGWEB-only row that has none keeps its photo
        cards = cs.read_js(self.cards, "OCG_CARDS")[1]
        rows = cards["jp"][0][2]
        self.assertTrue(str(rows[0][2][0][3]).startswith("scan:jp-yac1-jp085-ultra-rare-manga-monochrome."))
        self.assertTrue(str(rows[1][2][0][3]).startswith("scan:"))
        self.assertEqual(rows[2][2][0][3], FULLAHEAD)

    @unittest.skipIf(Image is None, "Pillow isn't installed")
    def test_the_pictures_are_small_jpegs(self):
        self.run_job()
        f = self.index()["scans"]["YAC1-JP085|ultra rare (manga monochrome)"]["f"]
        with Image.open(os.path.join(self.out, f)) as im:
            self.assertEqual((im.format, im.width), ("JPEG", cs.WIDTH))
        self.assertLess(os.path.getsize(os.path.join(self.out, f)), 30_000)

    def test_a_korean_print_with_no_scan_of_its_own_gets_the_japanese_prints(self):
        self.run_job()
        kr = self.chase("kr")
        self.assertTrue(kr[("YAC1-KR085", "Ultra Rare (Manga Monochrome)")].startswith("scan:"))
        self.assertTrue(kr[("YAC1-KR070", "Super Rare")].startswith("scan:kr-yac1-kr070-super-rare."))
        idx = self.index()
        self.assertEqual(idx["scans"]["YAC1-KR085|ultra rare (manga monochrome)"]["f"], idx["scans"]["YAC1-JP085|ultra rare (manga monochrome)"]["f"])

    def test_a_scan_kept_for_one_print_is_not_downloaded_again_for_another(self):
        self.run_job(max_downloads=1)
        self.run_job()
        idx = self.index()
        files = [v["f"] for k, v in idx["scans"].items() if k.endswith("|ultra rare (manga monochrome)")]
        self.assertEqual(len(files), 2)
        self.assertEqual(len(set(files)), 1)
        self.assertEqual(self.yp.pictures, len({v["src"] for v in idx["scans"].values()}))

    def test_a_card_yugipedia_has_no_scan_of_is_asked_again_only_after_two_weeks(self):
        self.run_job()
        self.assertIn("OLD1-JP001|rare", self.index()["miss"])
        calls = len(self.yp.calls)
        self.run_job()
        self.assertEqual(len(self.yp.calls), calls, "nothing new to look for, so nothing was asked")
        idx = self.index()
        idx["miss"]["OLD1-JP001|rare"] = (date.today() - timedelta(days=15)).isoformat()
        with open(os.path.join(self.out, "index.json"), "w") as f:
            json.dump(idx, f)
        self.run_job()
        self.assertGreater(len(self.yp.calls), calls)

    def test_a_picture_is_never_downloaded_twice(self):
        self.run_job()
        pictures = self.yp.pictures
        self.write(self.market, "OCG_MARKET", market())       # (tomorrow's list from ocg_market.py: BIGWEB links again)
        self.write(self.cards, "OCG_CARDS", cards_list())
        self.run_job()
        self.assertEqual(self.yp.pictures, pictures)
        self.assertTrue(self.chase()[("YAC1-JP085", "Ultra Rare (Manga Monochrome)")].startswith("scan:"))

    def test_a_lost_picture_is_fetched_again(self):
        self.run_job()
        f = self.index()["scans"]["YAC1-JP085|ultra rare (manga monochrome)"]["f"]
        os.remove(os.path.join(self.out, f))
        pictures = self.yp.pictures
        self.write(self.market, "OCG_MARKET", market())
        self.run_job()
        self.assertGreater(self.yp.pictures, pictures)
        self.assertTrue(os.path.isfile(os.path.join(self.out, f)))

    def test_the_number_a_run_downloads_is_capped_and_the_rest_come_next_time(self):
        self.run_job(max_downloads=2)
        self.assertLessEqual(self.yp.pictures, 2)
        self.assertIn("the rest wait for the next run", self.quiet[-1])
        self.run_job()
        self.assertTrue(all(v.startswith("scan:") or v == FULLAHEAD for k, v in self.chase().items()))

    def test_the_cards_with_no_photo_at_all_come_first(self):
        # TCGplayer has a photo of Exodia's English print, none of Jinzo's: Jinzo's come first
        with open(self.tcg, "w") as f:
            f.write("window.TCG_DATA = " + json.dumps({"products": [[1, 0, "Exodia the Obliterator", "X-EN001", 0, [], 0]]}) + ";")
        todo = cs.targets(self.market_now(), {"scans": {}, "miss": {}}, cs.tcg_photo_names(self.tcg))
        names = [c[1] for _, _, _, c in todo]
        self.assertLess(names.index("Jinzo"), names.index("Exodia the Obliterator"))
        # (and newer sets first within that)
        self.assertLess(names.index("Jinzo"), names.index("Old Card"))

    def test_yugipedia_being_down_leaves_the_files_as_they_were_and_working(self):
        self.yp.down = True
        self.assertEqual(self.run_job(), 0)
        self.assertEqual(self.chase()[("YAC1-JP085", "Ultra Rare (Manga Monochrome)")], BIGWEB)
        self.assertIn("didn't answer", self.quiet[-1])
        self.assertEqual(cs.read_js(self.cards, "OCG_CARDS")[1]["names"][0], "Jinzo")

    def test_unused_pictures_are_removed(self):
        self.run_job()
        stray = os.path.join(self.out, "jp-gone-card.jpg")
        open(stray, "wb").write(b"x")
        self.run_job()
        self.assertFalse(os.path.exists(stray))

    def test_no_list_yet_does_nothing(self):
        os.remove(self.market)
        self.assertEqual(self.run_job(), 0)


if __name__ == "__main__":
    unittest.main()
