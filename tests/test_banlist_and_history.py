"""banlist.py's change finder and card_history.py's price history builder."""
import gzip
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import banlist  # noqa: E402
import card_history  # noqa: E402


class Banlist(unittest.TestCase):
    def test_changes(self):
        before = {"Pot of Greed": "Forbidden", "Raigeki": "Limited", "Gone Card": "Semi-Limited"}
        after = {"Pot of Greed": "Limited", "Raigeki": "Limited", "New Card": "Forbidden"}
        got = {(c["name"], c["was"], c["now"]) for c in banlist.compare("tcg", before, after, "2026-10-12")}
        self.assertEqual(got, {("Pot of Greed", "Forbidden", "Limited"), ("Gone Card", "Semi-Limited", ""), ("New Card", "", "Forbidden")})

    def test_nothing_changed(self):
        self.assertEqual(banlist.compare("ocg", {"A": "Limited"}, {"A": "Limited"}, "2026-10-12"), [])


class History(unittest.TestCase):
    def test_build_makes_a_series_per_card_with_gaps_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            for day, price in (("2026-10-10", 1.5), ("2026-10-12", 2.0)):
                with gzip.open(os.path.join(folder, day + ".json.gz"), "wt", encoding="utf-8") as f:
                    json.dump({"prices": {"Normal": {"111": price}}}, f)
            with gzip.open(os.path.join(folder, "2026-10-11.json.gz"), "wt", encoding="utf-8") as f:
                json.dump({"prices": {"Normal": {}}}, f)   # (nothing priced that day)
            data = {"groups": [[900, "Some Set"]], "products": [[111, 0]]}
            days, out = card_history.build(data, folder)
        self.assertEqual(days, ["2026-10-10", "2026-10-11", "2026-10-12"])
        self.assertEqual(out[900]["111"]["Normal"], [150, None, 200])

    def test_unreadable_snapshot_is_skipped(self):
        with tempfile.TemporaryDirectory() as folder:
            with open(os.path.join(folder, "2026-10-10.json.gz"), "wb") as f:
                f.write(b"not gzip")
            self.assertEqual(card_history.read_snapshot(folder, "2026-10-10"), {})


if __name__ == "__main__":
    unittest.main()
