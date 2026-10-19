"""The weekly list of which cards belong to which archetype or name (card_themes.py), for theme goals.

Against a pretend YGOPRODeck answer shaped like cardinfo.php?misc=yes (id, name, type, frameType, desc, archetype,
misc_info[0].formats / treated_as) and archetypes.php ([{"archetype_name": ...}]).
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import card_themes as ct  # noqa: E402


def c(name, desc="", arch=None, frame="effect", type_="Effect Monster", formats=("TCG", "OCG"), treated=None):
    misc = {"formats": list(formats)}
    if treated:
        misc["treated_as"] = treated
    out = {"id": abs(hash(name)) % 10 ** 8, "name": name, "type": type_, "frameType": frame, "desc": desc, "misc_info": [misc]}
    if arch:
        out["archetype"] = arch
    return out


CARDS = [
    c("El Shaddoll Winda", 'Must be Special Summoned with "Shaddoll Fusion".', arch="Shaddoll", frame="fusion", type_="Fusion Monster"),
    c("Shaddoll Dragon", 'If this card is sent to the GY by a card effect: You can target 1 Spell/Trap.', arch="Shaddoll"),
    c("Shaddoll Fusion", 'Fusion Summon 1 "Shaddoll" Fusion Monster.', arch="Shaddoll", frame="spell", type_="Spell Card"),
    c("Nephe Shaddoll Fusion", 'Fusion Summon 1 "Shaddoll" Fusion Monster.', frame="spell", type_="Spell Card"),        # (support: not in the archetype)
    c("Dark Magician Girl", "", arch="Dark Magician", frame="effect"),
    c("Toon Dark Magician Girl", "", arch="Toon", frame="effect"),
    c("Dark Magician Girl the Dragon Knight", '"Dark Magician Girl" + 1 Dragon monster', arch="Dark Magician", frame="fusion", type_="Fusion Monster"),
    c("Magician's Valkyria", 'This card is always treated as a "Dark Magician Girl" card.', frame="effect"),
    c("Dark Magic Twin Burst", 'Target 1 "Dark Magician Girl"... "Dark Magician" ... "Not A Card Name"', frame="spell", type_="Spell Card"),
    c("Harpie Lady 1", "", arch="Harpie", treated="Harpie Lady"),
    c("Harpie Lady", "", arch="Harpie"),
    dict(c("Dark Magician", "", arch="Dark Magician", frame="normal", type_="Normal Monster"), card_images=[{"id": 46986414}, {"id": 123456789}]),
    c("Skill Card Thing", "", frame="skill", type_="Skill Card"),
    c("Sheep Token", "", frame="token", type_="Token"),
    c("Rush Only Monster", "", formats=("Rush Duel",)),
    c("Master Duel Only", "", formats=("Master Duel",)),
]
ARCHETYPES = [{"archetype_name": a} for a in ("Shaddoll", "Dark Magician", "Toon", "Harpie", "Magician Girl")]


class Building(unittest.TestCase):
    def setUp(self):
        self.data = ct.build(CARDS, [a["archetype_name"] for a in ARCHETYPES])
        self.t = self.data["terms"]
        self.by = {x[0]: x for x in self.data["cards"]}

    def names(self, idxs):
        return [self.t[i] for i in idxs]

    def test_each_card_keeps_its_archetype(self):
        self.assertEqual(self.t[self.by["Shaddoll Dragon"][1]], "Shaddoll")
        self.assertEqual(self.by["Nephe Shaddoll Fusion"][1], -1)

    def test_the_names_its_text_quotes_are_the_ones_it_supports(self):
        self.assertEqual(self.names(self.by["Nephe Shaddoll Fusion"][2]), ["Shaddoll"])
        self.assertEqual(sorted(self.names(self.by["Dark Magic Twin Burst"][2])), ["Dark Magician", "Dark Magician Girl"])   # (not "Not A Card Name")
        self.assertEqual(self.names(self.by["El Shaddoll Winda"][2]), ["Shaddoll Fusion"])

    def test_always_treated_as_is_kept_apart(self):
        self.assertEqual(self.names(self.by["Magician's Valkyria"][3]), ["Dark Magician Girl"])
        self.assertEqual(self.by["Magician's Valkyria"][2], [])
        self.assertEqual(self.names(self.by["Harpie Lady 1"][3]), ["Harpie Lady"])     # (from misc_info.treated_as)

    def test_the_kinds(self):
        self.assertEqual([self.by[n][4] for n in ("Shaddoll Dragon", "El Shaddoll Winda", "Shaddoll Fusion")], ["m", "e", "s"])

    def test_skills_tokens_and_other_games_cards_are_left_out(self):
        for n in ("Skill Card Thing", "Sheep Token", "Rush Only Monster", "Master Duel Only"):
            self.assertNotIn(n, self.by)

    def test_every_archetype_is_listed(self):
        self.assertEqual(sorted(self.t[i] for i in self.data["arch"]), ["Dark Magician", "Harpie", "Magician Girl", "Shaddoll", "Toon"])


class Running(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        self.out = os.path.join(self.dir, "card-themes.js")
        self.calls = []
        self.down = False
        big = CARDS + [c("Filler %d" % i) for i in range(6000)]

        def fake(url, timeout=120):
            self.calls.append(url)
            if self.down:
                raise OSError("network")
            return {"data": big} if "cardinfo" in url else ARCHETYPES
        real = ct.get_json
        ct.get_json = fake
        self.addCleanup(setattr, ct, "get_json", real)
        real_say = ct.say
        self.said = []
        ct.say = self.said.append
        self.addCleanup(setattr, ct, "say", real_say)

    def test_it_writes_the_websites_file(self):
        ct.run(out_file=self.out)
        data = ct.read_existing(self.out)
        self.assertEqual(data["v"], ct.FORMAT)
        self.assertIn("El Shaddoll Winda", [x[0] for x in data["cards"]])
        with open(self.out, encoding="utf-8") as f:
            self.assertTrue(f.read().startswith("/* Card Vault"))

    def test_it_keeps_every_cards_id_and_its_other_artworks_ids(self):
        ct.run(out_file=self.out)
        with open(os.path.join(self.dir, "card-ids.json"), encoding="utf-8") as f:
            ids = json.load(f)["ids"]
        winda = next(c for c in CARDS if c["name"] == "El Shaddoll Winda")
        self.assertEqual(ids[str(winda["id"])], "El Shaddoll Winda")
        self.assertEqual(ids["123456789"], "Dark Magician")                 # (an alternate artwork's id)
        self.assertIn("Skill Card Thing", ids.values())                        # (Speed Duel decks list their Skill)

    def test_a_missing_ids_file_is_made_again_even_inside_the_week(self):
        ct.run(out_file=self.out)
        os.remove(os.path.join(self.dir, "card-ids.json"))
        n = len(self.calls)
        ct.run(out_file=self.out)
        self.assertGreater(len(self.calls), n)
        self.assertTrue(os.path.exists(os.path.join(self.dir, "card-ids.json")))

    def test_it_reads_again_only_once_a_week(self):
        ct.run(out_file=self.out)
        n = len(self.calls)
        ct.run(out_file=self.out)
        self.assertEqual(len(self.calls), n)
        data = ct.read_existing(self.out)
        data["generated"] = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        ct.write(self.out, data)
        ct.run(out_file=self.out)
        self.assertGreater(len(self.calls), n)

    def test_yugioh_down_or_a_short_answer_keeps_the_last_list(self):
        ct.run(out_file=self.out)
        before = open(self.out, encoding="utf-8").read()
        self.down = True
        self.assertEqual(ct.run(force=True, out_file=self.out), 0)
        self.assertEqual(open(self.out, encoding="utf-8").read(), before)
        self.assertIn("the last list stays", self.said[-1])
        self.down = False
        ct.get_json = lambda url, timeout=120: {"data": CARDS} if "cardinfo" in url else ARCHETYPES      # (only 12 cards: something's wrong)
        ct.run(force=True, out_file=self.out)
        self.assertEqual(open(self.out, encoding="utf-8").read(), before)


if __name__ == "__main__":
    unittest.main()
