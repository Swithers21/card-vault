"""Cleaning up "Cards with no match" for PriceCharting (Settings > Graded values).

Korean cards aren't asked about (PriceCharting doesn't list Korean cards) and are said apart from the real misses;
each real miss has "Find it": PriceCharting's search results for the card, "This is my card" on the right one (kept
with the cards, so every entry of that printing and every device uses it from then on, without searching), or "It isn't
on PriceCharting" (not asked again, listed apart, "Look for them again" undoes it). In a real browser against a
made-up PriceCharting shaped like its API (products?q=..., product?id=..., prices in cents).
"""
import json
import unittest
from urllib.parse import parse_qs, urlsplit

from test_sealed_app import SealedBase

PCR = "Amphibious Swarmship Amblowhale"
ITEMS = [
    {"id": "9001", "product-name": PCR + " [Quarter Century Secret Rare] RA04-EN077", "console-name": "YuGiOh Quarter Century Stampede", "loose-price": 1500, "manual-only-price": 9000},
    {"id": "9002", "product-name": PCR + " [Platinum Secret Rare] RA04-EN077", "console-name": "YuGiOh Quarter Century Stampede", "loose-price": 2500, "manual-only-price": 12000},
    {"id": "9003", "product-name": PCR + " [Collector's Rare] RA04-EN077", "console-name": "YuGiOh Quarter Century Stampede", "loose-price": 3100, "manual-only-price": 15500},
    {"id": "9004", "product-name": "Some Other Card RA04-EN078", "console-name": "YuGiOh Quarter Century Stampede", "loose-price": 100},
    {"id": "9005", "product-name": PCR + " Plush", "console-name": "Toys"}]


def card(rid, number="RA04-EN077", name=PCR, rarity="Prismatic Collector's Rare", language="English", edition="1st Edition", **more):
    r = {"id": rid, "productId": None, "name": name, "productName": name, "setName": "Quarter Century Stampede", "number": number, "rarity": rarity,
         "edition": edition, "language": language, "qty": 1, "quantity": 1, "condition": "Near Mint", "manualPrice": 20}
    r.update(more)
    return r


class PriceChartingAPI:
    def __init__(self):
        self.calls = []

    def __call__(self, url):
        u = urlsplit(url)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        self.calls.append((u.path.rsplit("/", 1)[-1], q.get("q") or q.get("id")))
        if u.path.endswith("/products"):
            words = q.get("q", "").lower().split()
            # (the search's answer has no prices, like PriceCharting's own list: they come with the item)
            found = [{k: v for k, v in it.items() if not k.endswith("-price")} for it in ITEMS if all(w in (it["product-name"] + " " + it["console-name"]).lower() for w in words)]
            return {"status": "success", "products": found}
        if u.path.endswith("/product"):
            it = next((x for x in ITEMS if x["id"] == q.get("id")), None)
            return dict(it, status="success") if it else {"status": "error", "error-message": "No such product"}
        return {"status": "error"}


class PriceChartingFix(SealedBase):
    def go(self, records):
        self.pc = PriceChartingAPI()
        settings = json.dumps({"pcToken": "test-key", "tab": "collection"})
        return self.open(records, routes={"**/www.pricecharting.com/api/**": self.pc}, local={"cardvault.v2.settings": settings})

    def asked(self, number):
        return [c for c in self.pc.calls if c[1] and number.lower() in c[1].lower()]

    def checked(self, page):
        page.evaluate("window.CardVault.refreshGradedPrices(true)")
        page.wait_for_function("!window.CardVault.state().settings || true")
        page.wait_for_timeout(300)
        page.wait_for_function("window.CardVault.pcMisses().length + window.CardVault.state().collection.filter(r => window.CardVault.pcCache()[window.CardVault.pcKey(r)] && window.CardVault.pcCache()[window.CardVault.pcKey(r)].p).length >= 1", timeout=15000)

    def settings_note(self, page):
        page.evaluate("window.CardVault.openSettings({section: 'graded'})")
        page.wait_for_selector("#pcNote")
        return page.inner_text("#pcNote")

    def test_korean_cards_are_not_asked_about_and_are_said_apart(self):
        page = self.go([card("k", number="LOB-K030", name="Two-Mouth Darkruler", rarity="Common", language="Korean", edition="Unlimited"), card("a")])
        self.checked(page)
        self.assertEqual(self.asked("LOB-K030"), [])
        self.assertEqual([m for m in page.evaluate("window.CardVault.pcMisses().map(m => m.r.id)")], ["a"])
        note = self.settings_note(page)
        self.assertIn("Cards with no match (1)", note)
        self.assertIn("1 Korean card isn't looked for", note)
        self.assertIn("PriceCharting doesn't list Korean cards", note)

    def test_find_it_shows_what_pricecharting_has_and_your_pick_is_kept(self):
        page = self.go([card("a"), card("b", location="Binder 2")])
        self.checked(page)
        page.evaluate("window.CardVault.openSettings()")
        page.wait_for_selector("#pcNote summary")
        page.click("#pcNote summary")                                   # (the list opens)
        page.click("[data-pc-fix='a']")
        page.wait_for_selector(".pc-item")
        names = page.locator(".pc-item b").all_inner_texts()
        self.assertEqual(names[:3], [PCR + " [Quarter Century Secret Rare] RA04-EN077", PCR + " [Platinum Secret Rare] RA04-EN077", PCR + " [Collector's Rare] RA04-EN077"])
        self.assertNotIn(PCR + " Plush", names)                         # (not a Yu-Gi-Oh! item)
        page.locator(".pc-item", has_text="[Collector's Rare]").locator("button").click()   # (PriceCharting's name for it)
        page.wait_for_selector("#pcNote")                               # (back to Settings)
        self.assertEqual(page.evaluate("window.CardVault.state().collection.map(r => r.pcId)"), ["9003", "9003"])   # (both entries of the printing)
        self.assertEqual(page.evaluate("window.CardVault.pcMisses().length"), 0)
        self.assertEqual(page.evaluate("window.CardVault.pcKnown ? 1 : 1"), 1)
        self.assertEqual(page.evaluate("window.CardVault.psa10Value(window.CardVault.state().collection[0]).unit"), 155.0)
        self.assertNotIn("Cards with no match", page.inner_text("#pcNote"))
        # next time: the picked item itself, no search
        self.pc.calls.clear()
        page.reload()
        page.wait_for_function("typeof window.CardVault === 'object'")
        page.evaluate("window.CardVault.refreshGradedPrices(true)")
        page.wait_for_timeout(2500)
        self.assertEqual(self.pc.calls, [("product", "9003")])
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].pcId"), "9003")

    def test_other_words_can_be_searched(self):
        page = self.go([card("a")])
        self.checked(page)
        page.evaluate("window.CardVault.openPcPick('a', {})")
        page.wait_for_selector(".pc-item")
        page.fill("#pcQ", "RA04-EN078")
        page.click("#pcPickForm button[type=submit]")
        page.wait_for_function("document.querySelectorAll('.pc-item').length === 1")
        self.assertIn("Some Other Card", page.inner_text("#pcOut"))

    def test_it_isnt_on_pricecharting_stops_the_asking_and_can_be_undone(self):
        page = self.go([card("a", number="RD/ORP4-JP076", name="Over Rush Volcano", rarity="Over Rush Rare", language="Japanese", edition="No edition mark")])
        self.checked(page)
        page.evaluate("window.CardVault.openPcPick('a', {back: 'settings'})")
        page.wait_for_selector("#pcOut .notice, #pcOut .pc-item")     # (its search answered)
        page.click("#pcNone")
        page.wait_for_selector("#pcNote")
        self.assertEqual(page.evaluate("window.CardVault.state().collection[0].pcId"), "none")
        note = page.inner_text("#pcNote")
        self.assertNotIn("Cards with no match", note)
        self.assertIn("1 card you marked as not on PriceCharting (Over Rush Volcano)", note)
        self.pc.calls.clear()
        page.evaluate("window.CardVault.refreshGradedPrices(true)")
        page.wait_for_timeout(1500)
        self.assertEqual(self.pc.calls, [])
        # the card says so, with a way back
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#gradedBox")
        self.assertIn("You marked it as not on PriceCharting", page.inner_text("#gradedBox"))
        # "Look for them again"
        page.evaluate("window.CardVault.openSettings({section: 'graded'})")
        page.wait_for_selector("[data-pc-unmark]")
        page.click("[data-pc-unmark]")
        page.wait_for_function("!window.CardVault.state().collection[0].pcId", timeout=5000)
        page.wait_for_function("(() => { const v = window.CardVault; return v.pcMisses().length === 1; })()", timeout=10000)

    def test_a_cards_graded_value_has_find_it_too(self):
        page = self.go([card("a")])
        self.checked(page)
        page.evaluate("window.CardVault.openDetails('a')")
        page.wait_for_selector("#gradedBox [data-pc-fix]")
        page.click("#gradedBox [data-pc-fix]")
        page.wait_for_selector(".pc-item")
        page.locator(".pc-item", has_text="Platinum Secret Rare").locator("button").click()
        page.wait_for_selector("#gradedBox")                            # (back to the card)
        self.assertIn("PriceCharting", page.inner_text("#gradedBox"))
        self.assertIn("$120.00", page.inner_text("#gradedBox"))

    def test_the_pick_survives_a_backup_round_trip(self):
        page = self.go([card("a", pcId="9003"), card("n", number="X-EN001", pcId="none"), card("bad", number="X-EN002", pcId="drop table")])
        ids = page.evaluate("window.CardVault.state().collection.map(r => r.pcId || null)")
        self.assertEqual(ids, ["9003", "none", None])


def load_tests(loader, tests, pattern):
    return loader.loadTestsFromTestCase(PriceChartingFix)


if __name__ == "__main__":
    unittest.main()
