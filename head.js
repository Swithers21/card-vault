// Rush Duel cards (RD/KP25-JP001) and Overframe printings ("Ultra Rare (Overframe)") everywhere in the app, from Card
// Vault's daily list. Outside services are stand-ins.
const fs = require("fs");
const path = require("path");
const { JSDOM, ResourceLoader, VirtualConsole } = require("/tmp/cvtest/node_modules/jsdom");
const USER_CSV = fs.readFileSync("/tmp/cvtest/user_collection.csv", "utf8");
let failures = 0, passes = 0;
function check(cond, label) { if (cond) { passes++; console.log("PASS " + label); } else { failures++; console.log("FAIL " + label); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { for (let i = 0; i < (ms || 4000) / 25; i++) { if (fn()) return true; await sleep(25); } return fn(); };
class LocalLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) {
    const u = new URL(url);
    if (u.hostname === "localhost") { const file = path.join(this.dir, decodeURIComponent(u.pathname)); return fs.existsSync(file) ? Promise.resolve(fs.readFileSync(file)) : Promise.reject(new Error("404")); }
    return Promise.resolve(Buffer.from(""));
  }
}
const ok = body => ({ok: true, status: 200, json: async () => body, text: async () => typeof body === "string" ? body : JSON.stringify(body)});
const fail = status => ({ok: false, status, json: async () => null, text: async () => ""});

const FA = n => "https://makeshop-multi-images.akamaized.net/fullyugi/itemimages/" + n + ".jpg";
const OCG = {format: 1, generated: "2026-10-05T04:10:00Z", fx: {JPY: 150, KRW: 1300},
  jp: [["RD/KP25", "Deck Mod Pack: Rising of the Aurora", "2026-09-01", "core", 2, [["RD/KP25-JP001", "Aurora Dragon", "Over Rush Rare", 4800, 1, FA("A")]], "オーロラの目覚め"],
    ["LOCH", "Limit Over Collection: The Heroes", "2026-02-28", "side", 80, [["LOCH-JP001", "Dark Magician, the Pharaoh's Servant", "Prismatic Secret Rare (Overframe)", 29800, 1, ""],
      ["LOCH-JP001", "Dark Magician, the Pharaoh's Servant", "Ultra Rare (Overframe)", 5480, 1, ""]], "リミットオーバーコレクション"]],
  kr: [["RD/KP25", "Deck Mod Pack: Rising of the Aurora", "2026-10-01", "core", 1, [["RD/KP25-KR001", "Aurora Dragon", "Rush Rare", 13000, 2, "", 0, null, ""]], "", null]]};
const CARDS = {format: 1, generated: "2026-10-05T04:10:00Z", fx: {JPY: 150, KRW: 1300},
  names: ["Aurora Dragon", "Dark Magician", "Dark Magician, the Pharaoh's Servant", "Underworld Circle"], ja: ["オーロラ・ドラゴン", "ブラック・マジシャン", "王のしもべ―ブラック・マジシャン"],
  rar: ["Over Rush Rare", "Rush Rare", "Common", "Ultra Rare", "Ultra Rare (Overframe)", "Prismatic Secret Rare (Overframe)", "Secret Rare", "Grand Master Rare"],
  jp: [["RD/KP25", ["2026-10-04", "2026-09-28", "2026-09-05"], [["001", 0, [[0, 4800, 3, FA("A"), 4000, 0, 0, 0], [1, 900, 10, FA("B"), 0, 0, 0, 0]]], ["002", 1, [[2, 50, 10, FA("C"), 0, 0, 0, 1]]]]],
    ["LOCH", ["", "", ""], [["001", 2, [[3, 0, 0, 3528038, 0, 0, 0, 2], [4, 5480, 3, 3528042, 0, 0, 0, 2], [6, 380, 3, 3528056, 0, 0, 0, 2], [5, 29800, 3, 3527958, 0, 0, 0, 2, "Prismatic Secret Rare"], [7, 0, 0, 0, 0, 0, 0, 2]]],
      ["019", 3, [[3, 80, 3, 0, 0, 0, 0, 2]]]]]],
  kr: [["RD/KP25", ["", "", ""], [["001", 0, [[1, 13000, 2, 0, 12000, 0, 0]]]]]]};
const HIST_RD = {days: ["2026-09-05", "2026-10-04", "2026-10-05"], p: {"RD/KP25-JP001|Over Rush Rare": [3800, 4000, 4800]}};
const CALLS = [], QS = [];
async function loadApp(dir) {
  const html = fs.readFileSync(path.join(dir, "Card Vault.html"), "utf8");
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", e => { if (!/Not implemented|404|Could not load/.test(String(e.message))) errors.push(String(e.message) + " @ " + String((e.detail && e.detail.stack) || e.stack || "").split("\n").slice(0, 5).join(" / ")); });
  const dom = new JSDOM(html, {url: "http://localhost/Card%20Vault.html", runScripts: "dangerously", resources: new LocalLoader(dir), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.confirm = () => true;
      w.CARDVAULT_SITE = {googleClientId: ""};
      w.matchMedia = q => ({matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}});
      w.fetch = async url => {
        const u = new URL(url, "http://localhost/");
        CALLS.push(u.hostname + u.pathname);
        QS.push(u.hostname + u.pathname + u.search);
        if (u.hostname === "localhost" && u.pathname === "/ocg-market.js") return ok("window.OCG_MARKET = " + JSON.stringify(OCG) + ";");
        if (u.hostname === "localhost" && u.pathname === "/ocg-cards.js") return ok("window.OCG_CARDS = " + JSON.stringify(CARDS) + ";");
        if (u.hostname === "localhost" && u.pathname === "/ocg-history/jp-RD_KP25.json") return ok(HIST_RD);
        if (u.hostname === "yugipedia.com") return ok({query: {results: {}, pages: []}});
        if (u.hostname === "api.bigweb.co.jp") {
          const q = u.searchParams.get("name");
          const it = (web, price, stock) => ({fname: q, name: "カード", rarity: {web}, price, stock_count: stock, condition: {web: "プレイ用"}, image: "https://image.bigweb.co.jp/new/imgc/003/528/3528100.jpg"});
          return ok({success: true, items: q === "LOCH-JP005" ? [it("【オーバーフレーム】ウルトラレア", 1480, 3), it("ウルトラレア", 80, 3), it("プリズマティックシークレットレア", 5980, 2)] : []});
        }
        if (u.hostname === "api.bunjang.co.kr") {
          const q = u.searchParams.get("q");
          const row = (name, price) => ({type: "PRODUCT", ad: false, name, price: String(price), status: "SELLING", updatedAt: "2026-10-04T00:00:00Z"});
          const data = q === "KP25-KR009" ? [row("유희왕 러시듀얼 RD/KP25-KR009 러시레어", 5000), row("러시듀얼 KP25-KR009 러시 레어 오로라", 7000), row("러시듀얼 KP25-KR010 러시레어", 99000)] : [];
          return ok({data: {responses: {mainGrid: {searchResponse: {data, totalCount: data.length}}}}});
        }
        if (u.hostname === "api.frankfurter.dev") return ok({amount: 1, base: "USD", date: "2026-10-05", rates: {JPY: 150, KRW: 1300}});
        return fail(404);
      };
    }});
  const w = dom.window;
  for (let i = 0; i < 100 && !(w.CardVault && w.document.getElementById("dataPillText").textContent !== "Loading…"); i++) await sleep(50);
  await sleep(30);
  return {dom, w, d: w.document, errors};
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", {bubbles: true, cancelable: true}));
const type = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", {bubbles: true})); };
const change = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", {bubbles: true})); };
const text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
