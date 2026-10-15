"""check_site.py: the look-over before publishing."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import check_site  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)


def prices_js(n, generated="2026-10-12T04:00:00+00:00"):
    data = {"format": 4, "generated": generated, "groups": [], "products": [[i, 0] for i in range(n)]}
    return "/* test */\nwindow.TCG_DATA = " + json.dumps(data) + ";\n"


class CheckSite(unittest.TestCase):
    def setUp(self):
        self.site = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.site, "icons"))
        for name in ("index.html", "app.css", "app.js", "config.js", "manifest.webmanifest", "sw.js"):
            shutil.copy(os.path.join(ROOT, name), self.site)
        for icon in os.listdir(os.path.join(ROOT, "icons")):
            shutil.copy(os.path.join(ROOT, "icons", icon), os.path.join(self.site, "icons"))
        self.write("tcgplayer-data.js", prices_js(5000))
        self.counts = os.path.join(self.site, "..", "counts-%d.json" % id(self))

    def tearDown(self):
        shutil.rmtree(self.site, ignore_errors=True)
        if os.path.exists(self.counts):
            os.remove(self.counts)

    def write(self, name, text):
        with open(os.path.join(self.site, name), "w", encoding="utf-8") as f:
            f.write(text)

    def test_a_good_site_passes(self):
        fails, warns, counts = check_site.run(self.site, now=NOW)
        self.assertEqual(fails, [])
        self.assertEqual(counts["products"], 5000)

    def test_missing_program_stops_it(self):
        os.remove(os.path.join(self.site, "app.js"))
        fails, _, _ = check_site.run(self.site, now=NOW)
        self.assertTrue(any("app.js" in f for f in fails))

    def test_typing_error_in_program_stops_it(self):
        self.write("app.js", "function (((")
        fails, _, _ = check_site.run(self.site, now=NOW)
        self.assertTrue(any("app.js has an error" in f for f in fails), fails)

    def test_missing_prices_stops_it(self):
        os.remove(os.path.join(self.site, "tcgplayer-data.js"))
        fails, _, _ = check_site.run(self.site, now=NOW)
        self.assertTrue(any("no prices" in f for f in fails))

    def test_unreadable_prices_stops_it(self):
        self.write("tcgplayer-data.js", "window.TCG_DATA = {oops")
        fails, _, _ = check_site.run(self.site, now=NOW)
        self.assertTrue(any("can't be read" in f for f in fails))

    def test_tiny_prices_file_stops_it(self):
        self.write("tcgplayer-data.js", prices_js(20))
        fails, _, _ = check_site.run(self.site, now=NOW)
        self.assertTrue(any("only 20 products" in f for f in fails))

    def test_big_drop_stops_it_but_small_drop_does_not(self):
        with open(self.counts, "w") as f:
            json.dump({"products": 8000}, f)
        self.write("tcgplayer-data.js", prices_js(5000))   # 37% fewer
        fails, _, _ = check_site.run(self.site, self.counts, now=NOW)
        self.assertTrue(any("down from 8000" in f for f in fails), fails)
        self.write("tcgplayer-data.js", prices_js(7000))   # 12% fewer
        fails, _, _ = check_site.run(self.site, self.counts, now=NOW)
        self.assertEqual(fails, [])

    def test_old_prices_only_warn(self):
        old = (NOW - timedelta(days=6)).isoformat()
        self.write("tcgplayer-data.js", prices_js(5000, old))
        fails, warns, _ = check_site.run(self.site, now=NOW)
        self.assertEqual(fails, [])
        self.assertTrue(any("days old" in w for w in warns))

    def test_counts_kept_only_when_all_is_well(self):
        check_site.run(self.site, self.counts, save=True, now=NOW)
        with open(self.counts) as f:
            self.assertEqual(json.load(f)["products"], 5000)
        self.write("tcgplayer-data.js", prices_js(10))
        check_site.run(self.site, self.counts, save=True, now=NOW)
        with open(self.counts) as f:
            self.assertEqual(json.load(f)["products"], 5000)   # the bad run didn't overwrite the good counts

    def test_broken_extra_file_only_warns(self):
        self.write("banlist.js", "window.CARDVAULT_BANLIST = {nope")
        fails, warns, _ = check_site.run(self.site, now=NOW)
        self.assertEqual(fails, [])
        self.assertTrue(any("banlist.js" in w for w in warns))

    def test_ocg_card_drop_only_warns(self):
        with open(self.counts, "w") as f:
            json.dump({"products": 5000, "ocgCards": 1000}, f)
        cards = {"jp": [["AAA", "Set", [["x"]] * 300]], "kr": []}
        self.write("ocg-cards.js", "window.OCG_CARDS = " + json.dumps(cards) + ";")
        fails, warns, _ = check_site.run(self.site, self.counts, now=NOW)
        self.assertEqual(fails, [])
        self.assertTrue(any("ocg-cards.js" in w for w in warns))


if __name__ == "__main__":
    unittest.main()
