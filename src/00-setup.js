/* Card Vault's program, built from the files in src/ by build_app.py. Edit those, not this file, then run: python build_app.py */
(function () {
  "use strict";

  /* ======================= Constants ======================= */
  const STORE_KEY = "cardvault.v2.collection";
  const SETTINGS_KEY = "cardvault.v2.settings";
  const WANTS_KEY = "cardvault.v2.wants";
  const DECKS_KEY = "cardvault.v2.decks";
  const SALES_KEY = "cardvault.v2.sales";
  const OPENINGS_KEY = "cardvault.v2.openings";
  const DELETED_KEY = "cardvault.v2.deleted";   // what was deleted, and when (for syncing through the backup file)
  // The Card Vault website (config.js) syncs through Google Drive instead of a file on this computer.
  const SITE = window.CARDVAULT_SITE && typeof window.CARDVAULT_SITE === "object" ? window.CARDVAULT_SITE : null;
  const HERE = SITE ? "this device" : "this computer";
  const GET_DATA = SITE ? "Reload the page (it needs an internet connection)." : "Double-click Update TCGplayer Data, then press F5.";
  if (SITE) document.documentElement.classList.add("site");
  const DRIVE = !!(SITE && SITE.googleClientId && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)));
  const CARD_IDS_KEY = "cardvault.v2.cardids";   // Konami card IDs (from deck files) -> card names
  const HISTORY_KEY = "cardvault.v2.valueHistory";
  const YUGI_CACHE_KEY = "cardvault.v2.yugipedia";
  const GRADERS = ["PSA", "BGS", "CGC", "SGC", "TAG", "Other"];
  // Rough starting points for what a played copy sells for, as a share of TCGplayer's market price.
  const DEFAULT_COND_PCT = {"Near Mint": 100, "Lightly Played": 85, "Moderately Played": 70, "Heavily Played": 50, "Damaged": 30};
  const YGOPRODECK = "https://db.ygoprodeck.com/api/v7";
  const PRINTINGS = ["1st Edition", "Unlimited", "Limited", "No edition mark"];
  const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
  // A single card still in its original pack or sleeve (a promo, a Lost Art card…): its condition is "Sealed". It is
  // still a card (number, rarity, prices, grading), unlike a sealed product (a box, a pack), which is r.sealed.
  const SEALED_COND = "Sealed";
  const CARD_CONDITIONS = CONDITIONS.concat(SEALED_COND);
  const isSealedCard = r => !!r && !r.sealed && r.condition === SEALED_COND;
  const sealedCardBadge = r => isSealedCard(r) ? '<span class="ed ed-sealed">Sealed</span>' : "";
  const LANGUAGES = ["English", "Japanese", "Korean", "French", "German", "Italian", "Spanish", "Portuguese",
    "Chinese (Simplified)", "Chinese (Traditional)"];
  const BASE_RARITIES = ["Common / Short Print", "Common", "Short Print", "Super Short Print", "Rare", "Super Rare",
    "Ultra Rare", "Secret Rare", "Ultimate Rare", "Ghost Rare", "Gold Rare", "Gold Secret Rare", "Premium Gold Rare",
    "Ghost/Gold Rare", "Platinum Rare", "Platinum Secret Rare", "Prismatic Secret Rare", "Prismatic Ultimate Rare",
    "Prismatic Collector's Rare", "Quarter Century Secret Rare", "Starlight Rare", "Collector's Rare", "Starfoil Rare",
    "Shatterfoil Rare", "Mosaic Rare", "Ultra Rare (Pharaoh's Rare)", "Duel Terminal Normal Parallel Rare",
    "Duel Terminal Rare Parallel Rare", "Duel Terminal Super Parallel Rare", "Duel Terminal Ultra Parallel Rare",
    "Normal Parallel Rare", "Super Parallel Rare", "Ultra Parallel Rare", "Extra Secret Rare", "20th Secret Rare",
    "10000 Secret Rare", "Millennium Rare", "Millennium Secret Rare", "Millennium Ultra Rare", "Millennium Gold Rare",
    "Holographic Rare", "Grand Master Rare", "Ultra Rare (Overframe)", "Prismatic Secret Rare (Overframe)",
    "Ultra Rare (Manga Monochrome)", "Ultra Rare (Manga Color)", "Secret Rare (Manga Monochrome)", "Secret Rare (Manga Color)",
    "Rush Rare", "Gold Rush Rare", "Over Rush Rare"];
  // Overframe ("extended art" on Yugipedia and TCGplayer): the artwork breaks out of its frame. It isn't a rarity, but an
  // Overframe Ultra Rare is another card to collect (and price) than the usual Ultra Rare with the same number, so
  // Japanese and Korean ones carry it in the rarity ("Ultra Rare (Overframe)"), as Card Vault's daily list does;
  // TCGplayer's English ones say "(Extended Art)" in their name. Grand Master Rares always are.
  const OVERFRAME = " (Overframe)";
  const isOverframe = r => /\(overframe\)|grand master/i.test(String((r && r.rarity) || "")) || /\((extended art|overframe)\)/i.test(String((r && (r.name + " " + (r.productName || ""))) || ""));
  // (a Japanese or Korean card of yours with a plain rarity the card has only as Overframe is one too)
  const isOverframeRec = r => !r.sealed && (isOverframe(r) || (!r.productId && !!r.rarity && /\(overframe\)/i.test(rowRarityOf(r.number, r.rarity) || "")));
  const overframeBadge = r => isOverframeRec(r) ? '<span class="ed ed-of" title="Overframe (extended art): the artwork breaks out of the frame">Overframe</span>' : "";
  // Manga-Style cards (Original Artwork Collection, YAC1-JP071 to 100): the same Ultra Rare or Secret Rare in a black-and-white
  // manga look and in colour, so a number has up to four printings, at four prices. The version is part of the rarity
  // ("Ultra Rare (Manga Monochrome)", "Secret Rare (Manga Color)"), as Card Vault's daily list names them.
  const MANGA_MONO = " (Manga Monochrome)", MANGA_COLOR = " (Manga Color)";
  const MANGA_SUFFIX = /\s*\(manga (monochrome|color)\)$/i;
  const mangaOf = rarity => { const m = String(rarity || "").match(MANGA_SUFFIX); return m ? (m[1].toLowerCase() === "color" ? "Color" : "Monochrome") : ""; };
  const isMangaRec = r => !r.sealed && !r.productId && !!mangaOf(r.rarity);
  const mangaBadge = r => isMangaRec(r) ? '<span class="ed ed-mg" title="Manga-Style card (Original Artwork Collection): ' + mangaOf(r.rarity).toLowerCase() + ' version">Manga ' + (mangaOf(r.rarity) === "Color" ? "color" : "mono") + "</span>" : "";
  // A rarity as the list names it: the same one, else the Overframe one when the card has only that (shops and older
  // entries say just "Prismatic Secret Rare" for Limit Over Collection's, which are all Overframe)
  // An Overframe rarity of a card the list (or shop) knows no Overframe printing of at all: its plain row, the only
  // price there is. Likewise a Manga-Style version of a card the list knows no versions of. A plain rarity of a card
  // that has only versions is no match: which version is yours isn't a guess to make.
  function matchRarity(list, rarity, name) {
    name = name || (x => x);
    const hit = list.find(x => sameRarity(name(x), rarity));
    if (hit || !rarity) return hit || null;
    if (MANGA_SUFFIX.test(rarity)) {
      if (list.some(x => MANGA_SUFFIX.test(name(x) || ""))) return null;
      return list.find(x => sameRarity(name(x), rarity.replace(MANGA_SUFFIX, ""))) || null;
    }
    if (/\(overframe\)$/i.test(rarity)) {
      if (list.some(x => /\(overframe\)$/i.test(name(x) || ""))) return null;
      return list.find(x => sameRarity(name(x), rarity.replace(/\s*\(overframe\)$/i, ""))) || null;
    }
    return list.find(x => sameRarity(name(x), rarity + OVERFRAME)) || null;
  }
  // Every sortable category, with direction labels that say what each order means.
  // "asc" always means the key goes up (A to Z, low to high, most common to rarest...).
  const SORT_FIELDS = {
    price: {label: "Price", asc: "Low to high", desc: "High to low", def: "desc"},
    total: {label: "Total value (price x quantity)", asc: "Low to high", desc: "High to low", def: "desc"},
    name: {label: "Name", asc: "A to Z", desc: "Z to A", def: "asc"},
    set: {label: "Set", asc: "A to Z", desc: "Z to A", def: "asc"},
    number: {label: "Card number", asc: "A to Z", desc: "Z to A", def: "asc"},
    rarity: {label: "Rarity", asc: "Most common first", desc: "Rarest first", def: "desc"},
    edition: {label: "Printing", asc: "1st Edition last", desc: "1st Edition first", def: "desc"},
    condition: {label: "Condition", asc: "Worst first", desc: "Best first", def: "desc"},
    language: {label: "Language", asc: "A to Z", desc: "Z to A", def: "asc"},
    qty: {label: "Quantity", asc: "Fewest first", desc: "Most first", def: "desc"},
    location: {label: "Location", asc: "A to Z", desc: "Z to A", def: "asc"},
    added: {label: "Date added", asc: "Oldest first", desc: "Newest first", def: "desc"}
  };
  // Price history comparisons, matching the older prices the updater saves with each card.
  const PERIODS = [["m1", "Last update"], ["m7", "7 days"], ["m30", "30 days"]];
  const TABS = ["collection", "search", "history", "sets", "wants", "decks", "sales", "market"];
  const NO_LOCATION = "__none__";
  const SHOW_LABELS = {extras: "Extras beyond 3", graded: "Graded cards", played: "Played condition", manual: "Added manually",
    sealed: "Sealed products", cards: "Single cards only"};
  // Yugipedia's photo file names end in a region and rarity code, e.g. WheelSynchron-DUNE-JP-C.png.
  const YUGI_RARITY = {C: "Common", R: "Rare", SR: "Super Rare", UR: "Ultra Rare", ScR: "Secret Rare", UtR: "Ultimate Rare",
    GR: "Ghost Rare", StR: "Starlight Rare", CR: "Collector's Rare", QCScR: "Quarter Century Secret Rare",
    PScR: "Prismatic Secret Rare", PlScR: "Platinum Secret Rare", PlR: "Platinum Rare", GUR: "Gold Rare",
    GScR: "Gold Secret Rare", PGR: "Premium Gold Rare", SP: "Short Print", SSP: "Super Short Print", SHR: "Shatterfoil Rare",
    SFR: "Starfoil Rare", MSR: "Mosaic Rare", NPR: "Normal Parallel Rare", SPR: "Super Parallel Rare",
    UPR: "Ultra Parallel Rare", EScR: "Extra Secret Rare", "20ScR": "20th Secret Rare", "10000ScR": "10000 Secret Rare",
    HGR: "Holographic Rare", MLR: "Millennium Rare", RR: "Rush Rare", GRR: "Gold Rush Rare", ORR: "Over Rush Rare", GMR: "Grand Master Rare", OP: "Official image"};
  const YUGI_REGIONS = {EN: "English", NA: "English", EU: "English", AE: "Asian English", JP: "Japanese", JA: "Japanese",
    KR: "Korean", TC: "Chinese (Traditional)", SC: "Chinese (Simplified)", FR: "French", DE: "German", IT: "Italian",
    PT: "Portuguese", SP: "Spanish"};
  // When a card's own region has no photo, the closest look-alike print comes first.
  const YUGI_FALLBACK = {KR: ["JP", "AE", "JA", "TC", "SC", "EN"], JP: ["JA", "AE", "KR", "TC", "SC", "EN"],
    JA: ["JP", "AE", "KR", "EN"], AE: ["EN", "JP", "KR"], TC: ["SC", "JP", "AE"], SC: ["TC", "JP", "AE"]};
  const PRINTING_RANK = {"1st Edition": 3, "Limited": 2, "Unlimited": 1, "No edition mark": 0};
  const CONDITION_RANK = {"Sealed": 6, "Near Mint": 5, "Lightly Played": 4, "Moderately Played": 3, "Heavily Played": 2, "Damaged": 1};
  // Rarity tiers, from common prints up to the rarest foils. Within a tier, rarities sort by name.
  function rarityRank(rarity) {
    const s = String(rarity || "").toLowerCase();
    if (!s) return -1;
    if (/quarter century|starlight|ghost|holographic|over rush/.test(s)) return 6;
    if (/rush rare/.test(s)) return 5;   // (Rush Duel's Rush Rare and Gold Rush Rare)
    if (/secret|ultimate|collector|millennium/.test(s)) return 5;
    if (/short print|common/.test(s)) return 1;
    if (/ultra|pharaoh|gold|platinum/.test(s)) return 4;
    if (/super/.test(s)) return 3;
    if (/rare|parallel|mosaic|shatterfoil|starfoil/.test(s)) return 2;
    return 0;
  }
  const OCG_REGIONS = {JP: "Japanese", JA: "Japanese", KR: "Korean", K: "Korean", AE: "English", TC: "Chinese (Traditional)", SC: "Chinese (Simplified)"};

  /* ======================= State ======================= */
  let collection = [];
  let wants = [];
  let decks = [];   // saved deck lists: [{id, name, text, updated}]
  let sales = [];   // cards you sold (see recordSale)
  let openings = [];   // boxes and packs you opened, with what you paid and what you pulled (see Openings)
  let valueHistory = [];   // [{d: "2026-09-25", v: 186.22, c: 37}] one point per TCGplayer price day
  // Syncing through the backup file: every card, want, deck and sale carries "mod" (when it last changed), and
  // deleted ones are remembered here by id, so a device can tell "deleted over there" from "not seen yet".
  const SYNC_KINDS = ["collection", "wants", "decks", "sales", "openings"];
  const SHARED_SETTINGS = ["condAdjust", "condPct", "alertsOn", "alertMinDollar", "alertMinPct", "psa10Mult", "psa10Floor", "gradePct", "pcToken",
    "gradingCost", "gradingMin", "gradingFees", "gradingCo", "ntfyTopic", "siteUrl", "sellFeePct", "sellFeeFlat", "cloudAlerts"];
  // Rough starting points for graded values when there's no real graded price: PSA 10 ≈ raw market × 4 + $25
  // (grading costs money and a gem-mint slab sells for more than raw), and other grades as a share of PSA 10.
  const DEFAULT_GRADE_PCT = {"10": 100, "9.5": 50, "9": 30, "8": 18, "7": 12, "6": 8};
  let deleted = {collection: {}, wants: {}, decks: {}, sales: {}, openings: {}};
  let prints = null;   // what each entry looked like at the last save, to notice what changed
  let settings = {view: "binder", sortField: "price", sortDir: "desc", basis: "market", tab: "collection",
    condAdjust: true, condPct: Object.assign({}, DEFAULT_COND_PCT), histPeriod: "m7", chartTable: false,
    setsMode: "number", setsSort: "complete", lastBackupAt: null, lastChangeAt: null, backupSnoozeUntil: 0,
    backupRemindDays: 7, wantAlertSeen: "", alertsOn: false, alertMinDollar: 5, alertMinPct: 10, salesYear: "", deckId: null,
    deckView: "check", mkView: "sets", mkLine: "", mkKind: "", mkSortSets: "newest", mkSortSealed: "deal", mkRegion: "en", mkLineOcg: "", mkKindOcg: "", mkGame: "", wantsView: "", wantsSort: "target", csSort: "best", csMode: "cards", csSetSort: "number", setGoals: [], goalsOpen: [], themeGoals: [], themesOpen: [], pcExportAt: "", moverBy: "usd", moverMin: 1,
    gradedView: false, psa10Mult: 4, psa10Floor: 25, gradePct: Object.assign({}, DEFAULT_GRADE_PCT), pcToken: "",
    insightView: "history", salesView: "trade", gradingCost: 30, gradingMin: 50, gradingFees: {}, gradingCo: "PSA", ntfyTopic: "", siteUrl: "", autoSignIn: true, deviceName: "",
    sellFeePct: 13, sellFeeFlat: 0.3, cloudAlerts: null, openingsOpen: [], watchView: "",
    photoNoticeSeen: [], pricesSeenDay: "", lastAdd: null, swipeCopies: true};
  const filters = {q: "", set: "", rarity: "", edition: "", language: "", location: "", show: ""};
  const selected = new Set();
  let selectMode = false;   // "Select" on: tapping a card ticks it instead of opening it (phones show no checkboxes otherwise)
  let catalog = null;
  let storageOK = true;
  let drawerCtx = null;
  let lastFocus = null;
  let pendingImport = null;
  let rarityLookup = new Set(BASE_RARITIES.map(r => r.toLowerCase()));
  const openSets = new Set();  // sets expanded on the Sets tab
  let setsQuery = "";

  /* ======================= Helpers ======================= */
  const $ = id => document.getElementById(id);
  // The "still sealed" box of an add or edit form, and keeping it in step with the condition list: ticking it sets the
  // condition to Sealed, unticking it goes back to the condition from before.
  const sealedCardCheckHTML = (id, checked) => '<label class="check-row sealed-check"><input type="checkbox" class="check" id="' + id + '"' + (checked ? " checked" : "") +
    '> <span>Still sealed (in its original pack or sleeve)</span></label>';
  function wireSealedCard(checkId, condId) {
    const box = $(checkId), sel = $(condId);
    if (!box || !sel) return;
    let before = sel.value === SEALED_COND ? "Near Mint" : sel.value;
    box.addEventListener("change", () => {
      if (box.checked) { if (sel.value !== SEALED_COND) before = sel.value; sel.value = SEALED_COND; } else sel.value = before;
      sel.dispatchEvent(new Event("change", {bubbles: true}));
    });
    sel.addEventListener("change", () => { box.checked = sel.value === SEALED_COND; if (sel.value !== SEALED_COND) before = sel.value; });
  }
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const fmtUSD = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
  const fmtEUR = new Intl.NumberFormat("en-US", {style: "currency", currency: "EUR"});
  const fmtJPY = new Intl.NumberFormat("en-US", {style: "currency", currency: "JPY", maximumFractionDigits: 0});
  const fmtKRW = new Intl.NumberFormat("en-US", {style: "currency", currency: "KRW", maximumFractionDigits: 0});
  const usd = v => (v == null || !isFinite(v)) ? "" : fmtUSD.format(v);

  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    const s = String(v).replace(/[^0-9.\-]/g, "");
    if (!s || s === "-" || s === ".") return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function posInt(v) { const n = num(v); return n != null && n > 0 ? Math.round(n) : 0; }
  function idOrNull(v) { const n = num(v); return n != null && n > 0 ? Math.round(n) : null; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function safeImg(u) { u = String(u || "").trim(); return /^(https?:\/\/|data:image\/)/i.test(u) ? u : ""; }
  const tcgImg = (pid, size) => "https://tcgplayer-cdn.tcgplayer.com/product/" + pid + "_" + (size || "in_400x400") + ".jpg";
  const tcgPage = pid => "https://www.tcgplayer.com/product/" + pid;

  function normNumber(s) {
    return String(s || "").toUpperCase().replace(/[‐-―]/g, "-").replace(/／/g, "/").replace(/\s+/g, "");
  }
  function looseNumber(s) {
    const n = normNumber(s).replace(/[^A-Z0-9]/g, "");
    const m = n.match(/^(.*?)(\d+)$/);
    return m ? m[1] + "#" + parseInt(m[2], 10) : n;
  }
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(String(s).replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
    return isNaN(d.getTime()) ? null : d;
  }
  // A calendar day like "2026-09-23" (no time) is that day wherever you are, not midnight UTC.
  function parseDay(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const utcDay = d => d ? d.toISOString().slice(0, 10) : null;
  const fmtDate = d => d ? d.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"}) : "";
  const fmtShortDate = d => d ? d.toLocaleDateString("en-US", {month: "short", day: "numeric"}) : "";
  const round2 = v => Math.round(v * 100) / 100;
  const pctText = p => (p == null || !isFinite(p)) ? "" : (p >= 0 ? "+" : "-") + Math.abs(p * 100).toFixed(1) + "%";
  // Gains and losses: the arrow carries the color, the number stays in normal text.
  // compact: "+$3.20 (1.7%)" instead of "Up $3.20 (1.7%)".
  function changeHTML(diff, pct, compact) {
    if (diff == null || !isFinite(diff)) return "";
    const flat = Math.abs(diff) < 0.005;
    const icon = flat ? '<span class="chg-icon flat" aria-hidden="true">&#9679;</span>' : diff > 0
      ? '<span class="chg-icon up" aria-hidden="true">&#9650;</span>' : '<span class="chg-icon down" aria-hidden="true">&#9660;</span>';
    const p = pct != null && isFinite(pct) ? " (" + pctText(pct).replace(/^[+-]/, "") + ")" : "";
    const word = flat ? "No change" : compact ? (diff > 0 ? "+" : "−") + fmtUSD.format(Math.abs(diff)) + p
      : (diff > 0 ? "Up " : "Down ") + fmtUSD.format(Math.abs(diff)) + p;
    return '<span class="chg">' + icon + "<span>" + esc(word) + "</span></span>";
  }
  const daysOld = d => d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null;
  const plural = (n, word, many) => n + " " + (n === 1 ? word : (many || word + "s"));
  const fmtDateTime = d => d ? d.toLocaleString("en-US", {month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"}) : "";
  const fmtTime = d => d ? d.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit", second: "2-digit"}) : "";
  const localDay = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const firstPrice = s => s ? (s.market != null ? s.market : s.low) : null;
  function download(blob, fileName) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // TCGplayer adds the rarity to a product's name when a set has the same card in
  // several rarities, e.g. "Dark Ruler No More (Secret Rare)". Show the plain name.
  // "Dark Magician (Ultra Rare)" -> "Dark Magician": a rarity in brackets at the end is left out, and others stay:
  // "Dark Magician, the Pharaoh's Servant (Starlight Rare) (Extended Art)" -> "... (Extended Art)"
  function cleanName(productName, rarity) {
    const s = String(productName || "").trim();
    let base = s, m;
    const groups = [];
    while (groups.length < 4 && (m = base.match(/^(.*\S)\s*\(([^()]*)\)$/))) { groups.unshift(m[2]); base = m[1].trim(); }
    const r = String(rarity || "").trim().toLowerCase();
    const kept = groups.filter(g => { const x = g.trim().toLowerCase(); return !(x && (x === r || rarityLookup.has(x))); });
    return kept.length === groups.length ? s : base + kept.map(g => " (" + g + ")").join("");
  }
  // (an Extended Art printing is the same card: grouped with it by name)
  const artless = name => String(name || "").replace(/\s*\((?:extended art|overframe)\)\s*$/i, "");
  // The card's own name: without the last bracket at the end, nor a rarity or "(Extended Art)" left before it
  // ("Black Luster Soldier (Starlight Rare) (Extended Art)" -> "Black Luster Soldier")
  const lookupName = name => {
    let s = String(name || "").replace(/\s*\([^()]*\)\s*$/, "").trim(), m;
    while ((m = s.match(/^(.*\S)\s*\(([^()]*)\)$/)) && (rarityLookup.has(m[2].trim().toLowerCase()) || /^(extended art|overframe)$/i.test(m[2].trim()))) s = m[1].trim();
    return s;
  };

  function normEdition(raw) {
    const s = String(raw || "").trim();
    const l = s.toLowerCase();
    if (!l) return "";
    if (/^(1st|first)/.test(l)) return "1st Edition";
    if (/^unl/.test(l)) return "Unlimited";
    if (/^lim/.test(l)) return "Limited";
    if (l === "normal" || l === "none" || /^no edition/.test(l)) return "No edition mark";
    return s;
  }
  const CONDITION_ALIASES = [["near mint", "Near Mint"], ["lightly played", "Lightly Played"],
    ["moderately played", "Moderately Played"], ["heavily played", "Heavily Played"], ["damaged", "Damaged"],
    ["nm", "Near Mint"], ["lp", "Lightly Played"], ["mp", "Moderately Played"], ["hp", "Heavily Played"], ["dmg", "Damaged"]];
  function parseCondition(raw) {
    const s = String(raw || "").trim();
    if (!s) return {condition: "Near Mint", edition: ""};
    const l = s.toLowerCase();
    for (const [alias, canon] of CONDITION_ALIASES) {
      if (l === alias || l.startsWith(alias + " ")) return {condition: canon, edition: normEdition(s.slice(alias.length))};
    }
    return {condition: s, edition: ""};
  }
  function normLanguage(raw) {
    const l = String(raw || "").trim().toLowerCase();
    if (!l) return "";
    const map = {en: "English", english: "English", jp: "Japanese", ja: "Japanese", japanese: "Japanese",
      kr: "Korean", ko: "Korean", korean: "Korean", fr: "French", french: "French", de: "German", german: "German",
      it: "Italian", italian: "Italian", es: "Spanish", sp: "Spanish", spanish: "Spanish", pt: "Portuguese",
      portuguese: "Portuguese"};
    return map[l] || String(raw).trim();
  }

  // src: a photo URL (alt: a second one to try if it doesn't load), or a photo list from productPics/recordPics/namePics:
  // {list: URLs to try in order (a "~" in front marks a stand-in photo), sub: a line for the drawn stand-in, art}.
  function imgTag(src, name, eager, alt) {
    const pics = src && typeof src === "object" ? src : {list: [src, alt]};
    const seen = new Set(), list = [];
    for (const u of pics.list || []) {
      const url = String(u || "").replace(/^~/, "").replace(/ /g, "%20");
      if (url && !seen.has(url)) { seen.add(url); list.push((String(u)[0] === "~" ? "~" : "") + url); }
    }
    if (!list.length) return placeholder(name, pics.sub, pics.art);
    const stand = list[0][0] === "~";
    return '<img src="' + esc(list[0].replace(/^~/, "")) + '" alt="' + esc(name) + '"' + (eager ? "" : ' loading="lazy"') +
      ' decoding="async" data-fallback="' + esc(name) + '"' + (pics.sub ? ' data-sub="' + esc(pics.sub) + '"' : "") + (pics.art ? ' data-art="' + esc(pics.art) + '"' : "") +
      (stand ? ' data-stand="1"' : "") + (list.length > 1 ? ' data-alt="' + esc(list.slice(1).join(" ")) + '"' : "") + ">";
  }
  // When there's no photo at all: a drawn card (or box, for sealed products) with the name, and for a sealed product
  // the set's top card in the middle.
  function placeholder(name, sub, art) {
    return '<span class="card-ph"><span class="ph-name">' + esc(name || "No photo") + '</span><span class="ph-mark">' +
      (art ? '<img class="ph-art" src="' + esc(art) + '" alt="" loading="lazy" decoding="async">' : "") + "</span>" +
      (sub ? '<span class="ph-sub">' + esc(sub) + "</span>" : "") + "</span>";
  }
  function editionBadge(ed) {
    if (!ed) return "";
    const cls = ed === "1st Edition" ? "ed ed-1st" : ed === "Limited" ? "ed ed-lim" : "ed";
    return '<span class="' + cls + '">' + esc(ed) + "</span>";
  }
  const gradeBadge = g => g ? '<span class="ed ed-grade" title="Graded' + (g.cert ? ", cert " + esc(g.cert) : "") + '">' + esc(gradeLabel(g)) + "</span>" : "";
  function options(list, current, blankLabel) {
    let html = blankLabel != null ? '<option value="">' + esc(blankLabel) + "</option>" : "";
    const seen = new Set();
    for (const v of list) {
      if (seen.has(v)) continue;
      seen.add(v);
      html += '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>";
    }
    if (current && !seen.has(current)) html += '<option value="' + esc(current) + '" selected>' + esc(current) + "</option>";
    return html;
  }

