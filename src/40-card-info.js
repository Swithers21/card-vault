  /* ======================= Photos from Yugipedia ======================= */
  const yugi = {queue: Promise.resolve(), last: 0, cache: null};
  const YUGI_TTL = 30 * 86400000;
  // ("|2": lookups made before the gallery was read in full are not reused)
  const yugiKey = (number, name) => normNumber(number) + "|" + String(name || "").trim().toLowerCase() + "|2";
  function yugiCache() {
    if (!yugi.cache) {
      const c = bigGet(YUGI_CACHE_KEY, {});
      yugi.cache = c && typeof c === "object" && !Array.isArray(c) ? c : {};
    }
    return yugi.cache;
  }
  // "Nothing found" is remembered for 2 weeks, found photos for 30 days.
  function yugiCacheGet(key, fresh) {
    const hit = yugiCache()[key];
    if (!hit) return null;
    const empty = !hit.title || !hit.images || !hit.images.length;
    if (fresh && empty) return null;
    return Date.now() - hit.t < (empty ? 14 * 86400000 : YUGI_TTL) ? hit : null;
  }
  function yugiCachePut(key, value) {
    const c = yugiCache();
    c[key] = value;
    const keys = Object.keys(c);
    if (keys.length > 300) keys.sort((a, b) => c[a].t - c[b].t).slice(0, keys.length - 300).forEach(k => delete c[k]);
    bigSet(YUGI_CACHE_KEY, c);
  }
  // Yugipedia asks API users for at most one request per second, so requests wait their turn.
  function yugiFetch(params) {
    const url = "https://yugipedia.com/api.php?" + new URLSearchParams(Object.assign({format: "json", formatversion: "2", origin: "*"}, params)).toString();
    const pause = () => {
      const wait = yugi.last + 1100 - Date.now();
      return wait > 0 ? new Promise(r => setTimeout(r, wait)) : Promise.resolve();
    };
    const run = async () => {
      await pause();
      yugi.last = Date.now();
      const get = headers => {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
        const init = headers ? {headers} : {};
        if (ctl) init.signal = ctl.signal;
        return fetch(url, init).finally(() => clearTimeout(timer));
      };
      let res;
      try {
        res = await get({"Api-User-Agent": "CardVault/2.1 (personal Yu-Gi-Oh! collection tracker)"});
      } catch (e) {
        // Some networks block the extra header's permission check; the plain request usually still works.
        await pause();
        yugi.last = Date.now();
        res = await get(null);
      }
      if (!res.ok) throw new Error("Yugipedia answered " + res.status);
      const json = await res.json();
      if (json && json.error) throw new Error(String(json.error.info || json.error.code || "Yugipedia error"));
      return json;
    };
    const p = yugi.queue.then(run, run);
    yugi.queue = p.catch(() => {});
    return p;
  }
  const pagesOf = json => {
    const pg = json && json.query && json.query.pages;
    return Array.isArray(pg) ? pg : pg ? Object.values(pg) : [];
  };
  function resolveYugiTitle(json, tries) {
    const q = (json && json.query) || {};
    const normalized = new Map((q.normalized || []).map(n => [n.from, n.to]));
    const redirects = new Map((q.redirects || []).map(r => [r.from, r.to]));
    const exists = new Set(pagesOf(json).filter(p => p && !("missing" in p) && !("invalid" in p)).map(p => p.title));
    for (const t of tries) {
      let title = normalized.get(t) || t;
      title = redirects.get(title) || title;
      if (exists.has(title)) return title;
    }
    return null;
  }
  // Finds the card on Yugipedia by its number (then the English number in the same spot, then its name)
  // and lists the photos in the card's gallery. Results are remembered for 30 days.
  async function findYugiImages(number, name, fresh) {
    number = normNumber(number);
    name = String(name || "").trim();
    const key = yugiKey(number, name);
    const hit = yugiCacheGet(key, fresh);
    if (hit) return hit;
    const m = number.match(/^([A-Z0-9]+)-([A-Z]{2})([A-Z]?\d+)$/);
    const tries = [];
    if (number) tries.push(number);
    if (m && m[2] !== "EN" && YUGI_REGIONS[m[2]]) tries.push(m[1] + "-EN" + m[3]);
    if (name && !/[|#<>[\]{}]/.test(name)) {
      // (a Rush Duel card's page is "Name (Rush Duel)" when an OCG card has the name: that one first)
      if (isRushNo(number) && !/\(Rush Duel\)$/.test(name)) tries.push(name + " (Rush Duel)");
      tries.push(name);
    }
    if (!tries.length) return {t: Date.now(), title: null, images: []};
    const title = resolveYugiTitle(await yugiFetch({action: "query", titles: tries.join("|"), redirects: "1"}), tries);
    let images = [];
    if (title) {
      // The gallery's file names first (a popular card's gallery has hundreds, over several pages), then the photo
      // links of the 50 most relevant to this card number: Yugipedia gives links for only the first few dozen files
      // of a list, which for a big gallery would leave out everything past the letter C.
      const files = [];
      let cont = null;
      for (let page = 0; page < 4; page++) {
        const g = await yugiFetch(Object.assign({action: "query", generator: "images", titles: "Card Gallery:" + title, gimlimit: "500"}, cont || {}));
        for (const p of pagesOf(g)) if (p && p.title) files.push({file: String(p.title).replace(/^File:/, "")});
        cont = g && g.continue && g.continue.gimcontinue ? {gimcontinue: g.continue.gimcontinue} : null;
        if (!cont) break;
      }
      const rk = rankYugiImages(files, number, "");
      const want = rk.exact.concat(rk.near, rk.other).slice(0, 50);
      if (want.length) {
        const info = await yugiFetch({action: "query", titles: want.map(im => "File:" + im.file).join("|"), prop: "imageinfo", iiprop: "url", iiurlwidth: "400"});
        const thumbs = new Map(pagesOf(info).filter(p => p && p.imageinfo && p.imageinfo[0]).map(p => [String(p.title || "").replace(/^File:/, ""), safeImg(p.imageinfo[0].thumburl || p.imageinfo[0].url)]));
        images = want.map(im => ({file: im.file, thumb: thumbs.get(im.file) || ""})).filter(im => im.thumb);
      }
    }
    const result = {t: Date.now(), title, images};
    yugiCachePut(key, result);
    return result;
  }
  // "WheelSynchron-DUNE-JP-C.png" -> {set: "DUNE", region: "JP", rarity: "C", extra: []}
  function parseYugiFile(file) {
    const parts = String(file).replace(/\.[A-Za-z0-9]+$/, "").split("-");
    for (let i = 2; i < parts.length; i++) {
      if (YUGI_REGIONS[parts[i]]) return {set: parts[i - 1].toUpperCase(), region: parts[i], rarity: parts[i + 1] || "", extra: parts.slice(i + 2)};
    }
    return null;
  }
  // Sorts a gallery into this exact printing, the same set in other languages, and everything else.
  function rankYugiImages(images, number, rarity) {
    // (a Rush Duel number's scans are named like the others', without the RD/: ...-KP25-JP-UR.png)
    const m = normNumber(number).replace(/^RD\//, "").match(/^([A-Z0-9]+)-([A-Z]{2})?([A-Z]?\d+)$/);
    const set = m ? m[1] : "";
    const region = m && m[2] && YUGI_REGIONS[m[2]] ? m[2] : "";
    const plain = String(rarity || "").replace(/\s*\(overframe\)$/i, "").replace(MANGA_SUFFIX, ""), code = Object.keys(YUGI_RARITY).find(k => YUGI_RARITY[k] === plain) || "";
    const wantEA = /\(overframe\)|grand master/i.test(String(rarity || "")), ea = x => (x.extra || []).includes("EA");
    // (a Manga-Style version's scan is named ...-MangaStyle-Monochrome / -MangaStyle-Color: that version's first, and
    // for any other printing the Manga-Style scans last)
    const mangaWant = mangaOf(rarity), isManga = x => (x.extra || []).includes("MangaStyle");
    const mangaMatch = x => isManga(x) && (x.extra || []).includes(mangaWant === "Color" ? "Color" : "Monochrome");
    const exact = [], near = [], other = [];
    for (const im of images || []) {
      const f = parseYugiFile(im.file);
      // Video-game renders and artwork crops aren't photos of real cards.
      if (!f || [f.rarity].concat(f.extra).some(x => /^(VG|NC|artwork)$/i.test(x))) continue;
      const item = Object.assign({}, im, f);
      if (set && f.set === set && (!region || f.region === region)) exact.push(item);
      else if (set && f.set === set) near.push(item);
      else other.push(item);
    }
    const order = YUGI_FALLBACK[region] || ["EN", "NA", "EU", "AE", "JP", "KR"];
    const regionRank = r => r === region ? -1 : (order.indexOf(r) < 0 ? 99 : order.indexOf(r));
    // (the rarity's scan first; an Overframe printing's extended art, "-EA", or the usual art for the others)
    const better = (a, b) => (mangaWant ? mangaMatch(b) - mangaMatch(a) : isManga(a) - isManga(b)) ||
      (b.rarity === code) - (a.rarity === code) || (rarity ? (ea(b) === wantEA) - (ea(a) === wantEA) : 0) || (a.rarity === "OP") - (b.rarity === "OP");
    exact.sort((a, b) => better(a, b) || regionRank(a.region) - regionRank(b.region));
    near.sort((a, b) => regionRank(a.region) - regionRank(b.region) || better(a, b));
    other.sort((a, b) => regionRank(a.region) - regionRank(b.region) || better(a, b));
    return {exact, near, other, set, region, mangaMatch: mangaWant ? mangaMatch : null};
  }
  function yugiLabel(im) {
    const ed = im.extra.find(x => /^(1E|LE)$/.test(x));
    return [im.set, YUGI_REGIONS[im.region] || im.region, YUGI_RARITY[im.rarity] || im.rarity, ed === "1E" ? "1st Ed." : ed === "LE" ? "Limited" : "",
      im.extra.includes("EA") ? "Overframe" : "", im.extra.includes("MangaStyle") ? (im.extra.includes("Color") ? "Manga colour" : "Manga B&W") : ""]
      .filter(Boolean).join(" · ");
  }
  // Yugipedia's scan of this exact print among a card's gallery (as ranked by rankYugiImages): the same set and language;
  // a Manga-Style version's own scan, never the other version's, and for any other print never a Manga-Style one (an
  // Overframe print's extended art first). null when Yugipedia has none yet.
  function yugiPrintPick(rk, rarity) {
    if (mangaOf(rarity)) return rk.exact.find(rk.mangaMatch) || null;
    return rk.exact.find(x => !(x.extra || []).includes("MangaStyle")) || null;
  }
  async function yugiPrintPhoto(number, name, rarity) {
    const res = await findYugiImages(number, name);
    const pick = yugiPrintPick(rankYugiImages(res.images, number, rarity), rarity);
    return pick ? pick.thumb : null;
  }
  const yugiMangaPhoto = (number, name, rarity) => mangaOf(rarity) ? yugiPrintPhoto(number, name, rarity) : Promise.resolve(null);
  // A card from TCGplayer in another language: that language's print (LOB-EN001 in French is LOB-FR001 on Yugipedia).
  const LANG_REGION = {Japanese: "JP", Korean: "KR", French: "FR", German: "DE", Italian: "IT", Spanish: "SP", Portuguese: "PT"};
  function langNumber(number, language) {
    const code = LANG_REGION[language], m = normNumber(number).match(/^([A-Z0-9]+)-(?:[A-Z]{1,2})?(\d+[A-Z]?)$/);
    return code && m ? m[1] + "-" + code + m[2] : "";
  }
  // Those photos are kept on this device ({u: the photo, "" when Yugipedia had none, asked again after two weeks; t}),
  // under TCGplayer's (which stays the photo when there's none); a photo you chose yourself always comes first.
  const PRINT_PICS_KEY = "cardvault.v2.printpics";
  const printPics = {map: null};
  function printPicMap() {
    if (!printPics.map) { const c = readJSON(PRINT_PICS_KEY, {}); printPics.map = c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
    return printPics.map;
  }
  const printPicKey = r => r.productId + "|" + r.language + "|" + String(r.rarity || "").toLowerCase();
  function printPicOf(r) {
    if (!r || !r.productId || r.sealed || r.language === "English" || !LANG_REGION[r.language]) return null;
    const e = printPicMap()[printPicKey(r)];
    return e && typeof e === "object" ? e : null;
  }
  function printPicPut(r, url) {
    const m = printPicMap();
    m[printPicKey(r)] = {u: safeImg(url) || "", t: Date.now()};
    const keys = Object.keys(m);
    if (keys.length > 3000) keys.sort((a, b) => (m[a].t || 0) - (m[b].t || 0)).slice(0, keys.length - 3000).forEach(k => delete m[k]);
    try { localStorage.setItem(PRINT_PICS_KEY, JSON.stringify(m)); } catch (e) { /* optional */ }
  }
  // The nightly job's copy of Yugipedia's scan of a print, on the website (card-scans/)
  const isScanURL = u => /\/card-scans\/[a-z0-9_.-]+\.(jpg|png|gif|webp)$/.test(String(u || ""));
  // Your cards get a photo of their own print, quietly, a few seconds after opening, one Yugipedia request a second (up
  // to 80 cards an opening; the rest the next time): Japanese and Korean cards whose list and shop have no photo that
  // loads (BIGWEB's doesn't from outside Japan), Manga-Style ones their version's, and cards from TCGplayer in another
  // language that language's print. A photo you chose yourself is left alone.
  const printFill = {running: false, done: new Set()};
  const mangaFill = printFill;
  const shopPhoto = u => !u || /^https:\/\/image\.bigweb\.co\.jp\//.test(String(u));
  const PRINT_FILL_MAX = 80;
  async function fillPrintPhotos() {
    if (printFill.running) return 0;
    const fresh = r => !printFill.done.has(r.id);
    const ocgList = collection.filter(r => fresh(r) && isOcg(r) && !r.sealed && shopPhoto(r.customImage) && !isScanURL(ocgImage(r)) && ocgRegion(r.number))
      .sort((a, b) => !!isMangaRec(b) - !!isMangaRec(a));
    const langList = collection.filter(r => fresh(r) && r.productId && !r.sealed && !safeImg(r.customImage) && langNumber(r.number, r.language) &&
      (e => !e || (!e.u && Date.now() - (e.t || 0) > 14 * 86400000))(printPicOf(r)));
    if (!ocgList.length && !langList.length) return 0;
    printFill.running = true;
    let found = 0, kept = 0, asked = 0;
    try {
      for (const r of ocgList) {
        if (asked++ >= PRINT_FILL_MAX) break;
        printFill.done.add(r.id);
        let pick = null;
        try { pick = await yugiPrintPhoto(r.number, lookupName(r.name), r.rarity); } catch (e) { return found; }   // (Yugipedia can't be reached: next time)
        if (pick && collection.includes(r) && shopPhoto(r.customImage)) { r.customImage = pick; found++; }
      }
      for (const r of langList) {
        if (asked++ >= PRINT_FILL_MAX) break;
        printFill.done.add(r.id);
        let pick = null;
        try { pick = await yugiPrintPhoto(langNumber(r.number, r.language), lookupName(r.name), r.rarity); } catch (e) { return found + kept; }
        printPicPut(r, pick);
        if (pick) kept++;
      }
    } finally {
      printFill.running = false;
      if (found) save({quiet: true});
      if (found || kept) render();
    }
    return found + kept;
  }
  const fillMangaPhotos = fillPrintPhotos;
  async function showYugiPicker(box, number, name, rarity, onPick) {
    number = normNumber(number);
    name = String(name || "").trim();
    if (!number && !name) { box.innerHTML = '<p class="hint">Type the card number or name first.</p>'; return; }
    box.innerHTML = '<p class="hint" role="status">Looking on Yugipedia…</p>';
    let res;
    try { res = await findYugiImages(number, name, true); } catch (e) {
      if (box.isConnected) box.innerHTML = '<p class="hint">Couldn\'t reach Yugipedia right now. Check your internet connection and try again, or paste a photo link.</p>';
      return;
    }
    if (!box.isConnected) return;
    if (!res.title) {
      box.innerHTML = '<p class="hint">Yugipedia has no card with the number ' + esc(number || "(none)") + (name ? ' or the name "' + esc(name) + '"' : "") +
        ". Check the number, or paste a photo link.</p>";
      return;
    }
    const rk = rankYugiImages(res.images, number, rarity);
    const where = [rk.set, YUGI_REGIONS[rk.region]].filter(Boolean).join(", ");
    const groups = [];
    if (rk.exact.length) groups.push(["This printing (" + (where || res.title) + ")", rk.exact]);
    if (rk.near.length) groups.push([rk.exact.length ? "Same set, other languages" : "No photo of " + (where || "this printing") + " yet. The same set in other languages:", rk.near]);
    if (rk.other.length) groups.push([(rk.exact.length || rk.near.length ? "Other printings of " : "No photo from " + (rk.set || "this set") + " yet. Other printings of ") + res.title, rk.other.slice(0, 24)]);
    if (!groups.length) { box.innerHTML = '<p class="hint">Yugipedia has no card photos for ' + esc(res.title) + " yet.</p>"; return; }
    const all = [];
    box.innerHTML = groups.map(([label, list]) => '<p class="yugi-head">' + esc(label) + '</p><div class="yugi-grid">' + list.map(im => {
      all.push(im);
      return '<button type="button" class="yugi-pick" aria-pressed="false" data-yugi="' + (all.length - 1) + '"><span class="sleeve">' +
        imgTag(im.thumb, res.title) + "</span><span>" + esc(yugiLabel(im)) + "</span></button>";
    }).join("") + "</div>").join("") +
      '<p class="hint">Photos from <a href="https://yugipedia.com/wiki/Card_Gallery:' + encodeURIComponent(res.title.replace(/ /g, "_")) +
      '" target="_blank" rel="noopener">Yugipedia\'s gallery for ' + esc(res.title) + "</a>. Pick one, then save the card to keep it.</p>";
    box.querySelectorAll("[data-yugi]").forEach(btn => btn.addEventListener("click", () => {
      box.querySelectorAll("[data-yugi]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
      onPick(all[+btn.dataset.yugi].thumb);
    }));
  }
  // Cards added by hand with a card number and no photo, not looked up in the last 30 days.
  const yugiBatch = {running: false, done: 0, total: 0};
  function photoCandidates() {
    return collection.filter(r => !r.productId && !r.customImage && /^(RD\/)?[A-Z0-9]+-[A-Z0-9]+$/.test(normNumber(r.number)) &&
      !yugiCacheGet(yugiKey(r.number, r.name)));
  }
  async function findPhotosBatch() {
    const list = photoCandidates();
    if (!list.length || yugiBatch.running) return;
    Object.assign(yugiBatch, {running: true, done: 0, total: list.length});
    renderCollection();
    const status = toast("Looking for photos on Yugipedia: 0 of " + list.length + "…", {sticky: true});
    let found = 0, failed = false;
    for (const r of list) {
      try {
        const res = await findYugiImages(r.number, r.name);
        const rk = rankYugiImages(res.images, r.number, r.rarity);
        const pick = rk.exact[0] || rk.near[0];
        if (pick && !r.customImage && collection.includes(r)) { r.customImage = pick.thumb; found++; save(); }
      } catch (e) { failed = true; break; }
      yugiBatch.done++;
      const span = status.querySelector("span");
      if (span) span.textContent = "Looking for photos on Yugipedia: " + yugiBatch.done + " of " + list.length + "…";
    }
    status.remove();
    yugiBatch.running = false;
    render();
    if (failed && !found) toast("Couldn't reach Yugipedia. Check your internet connection and try again.", {kind: "error"});
    else toast("Found photos for " + found + " of " + plural(list.length, "card") + "." +
      (found < list.length ? " For the rest, open the card and paste a photo link, or pick from other printings." : ""));
  }

  /* ======================= Japanese and Korean cards ======================= */
  // Card numbers like DUNE-JP004 (Japanese) and DUNE-KR004 (Korean). Yugipedia knows the card, its set and
  // rarities; BIGWEB, a big Japanese card shop, has Japanese prices and photos; Bunjang, a Korean marketplace, has
  // asking prices for Korean cards. They're read straight from this browser, for your own cards, at most once a day.
  const OCG_CACHE_KEY = "cardvault.v2.ocg";
  const OCG_KEPT_KEY = "cardvault.v2.ocgKept";
  const FX_KEY = "cardvault.v2.fx";
  const OCG_TTL = 20 * 3600000;        // prices: about once a day
  const OCG_CARD_TTL = 30 * 86400000;  // card names and rarities
  const ocg = {cache: null, kept: null, queue: Promise.resolve(), last: 0, refreshing: false, timer: null};
  // A Japanese or Korean card number: DUNE-JP004, DUNE-KR004, LOB-K025 (Korean sets up to the late 2000s), Rush Duel's
  // RD/KP25-JP001 and RD/KP25-KR001, and, once the daily list is here, the older Japanese forms it knows (LB-35,
  // 302-001...). region is "JP" or "KR".
  // ocgKey(m): what showOcgLookup and friends get: [code, set, region, tail].
  const ocgRegion = number => {
    const n = normNumber(number), m = n.match(/^((?:RD\/)?[A-Z0-9]+)-(JP|KR|K)([A-Z]?\d+)$/);
    if (m) return {set: m[1], region: m[2] === "K" ? "KR" : m[2], tail: m[3], code: m[0], old: m[2] === "K"};
    const card = ocgCd.data ? ocgCd.data.byNumber.get(n) : null;
    return card ? {set: card.set.prefix, region: card.region === "jp" ? "JP" : "KR", tail: n.slice(card.set.prefix.length + 1), code: n, old: true} : null;
  };
  const ocgKey = g => g ? [g.code, g.set, g.region, g.tail] : null;
  const isOcg = r => !r.productId && !r.sealed && !!ocgRegion(r.number);
  // Rush Duel: its own game, with its own sets and numbers (they start with RD/), in the same Japanese and Korean lists
  // as the other cards. BIGWEB doesn't sell Rush Duel singles, so the Japanese ones are priced from Fullahead, a
  // Japanese card shop, by the nightly update (its prices can't be read from this browser); Korean ones from Bunjang.
  const isRushNo = x => /^RD\//.test(normNumber(x));   // (a card number or a set code)
  const FULLAHEAD_RD = "https://fullahead-yugi.com/shopbrand/yugi-rd/";
  const ocgSrc = (region, code) => region === "jp" || region === "JP" ? (isRushNo(code) ? "Fullahead" : "BIGWEB") : "Bunjang";
  // (Bunjang's sellers often leave out the RD/, so the search is for the rest of the number)
  const bunjangQ = code => normNumber(code).replace(/^RD\//, "");
  const bunjangSearchURL = code => "https://m.bunjang.co.kr/search/products?q=" + encodeURIComponent(bunjangQ(code));
  const ocgShopURL = (region, code) => region === "jp" || region === "JP" ? (isRushNo(code) ? FULLAHEAD_RD : "https://bigweb.co.jp/") : bunjangSearchURL(code);
  // Can this browser ask the shop itself? Not Fullahead (Japanese Rush Duel): only the nightly update reads it.
  const ocgLiveOK = g => !(g.region === "JP" && isRushNo(g.code));
  // "Japanese", "Korean Rush Duel"...
  const ocgLangOf = (region, code) => (region === "jp" || region === "JP" ? "Japanese" : "Korean") + (isRushNo(code) ? " Rush Duel" : "");
  // A Japanese card's stock: BIGWEB says how many; Fullahead says how many only when a few are left
  const jpStockNote = (stock, code) => isRushNo(code) ? (stock >= 10 ? "in stock" : stock + " left") : plural(stock, "copy", "copies") + " in stock";
  // What the daily list's prices for a card are, in a few words
  const ocgListSource = (region, code) => region === "jp" || region === "JP" ? ocgSrc("jp", code) + " prices and photos"
    : "Bunjang sales, or asking prices before a card has sold twice; the photos are the Japanese prints";
  // The shop, for the line under a price
  const ocgShopAbout = (region, code) => region === "jp" || region === "JP"
    ? (isRushNo(code) ? "Fullahead is a Japanese card shop; this is its selling price, checked once a day by Card Vault's nightly update."
      : "BIGWEB is a large Japanese card shop; this is its selling price for a copy in stock.")
    : "Bunjang is a Korean marketplace; this is what the card sold for there lately, or the middle of what sellers ask, so treat it as a rough guide.";
  const rushBadge = number =>isRushNo(number) ? '<span class="ed ed-rush" title="Rush Duel card">Rush Duel</span>' : "";
  function ocgCache() {
    if (!ocg.cache) { const c = bigGet(OCG_CACHE_KEY, {}); ocg.cache = c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
    return ocg.cache;
  }
  // The prices the daily list gave last time, kept on this device (US$ before any condition adjustment, by card number
  // and rarity). Until today's list has come in, they stand in for it, so the collection's total is right from the first
  // moment instead of counting those cards as $0 for a blink.
  function ocgKept() {
    if (!ocg.kept) { const k = readJSON(OCG_KEPT_KEY, {}); ocg.kept = k && typeof k === "object" && !Array.isArray(k) ? k : {}; }
    return ocg.kept;
  }
  const ocgKeptKey = (r, g) => g.code + "|" + (r.rarity || "");
  function ocgKeptPrice(r, g) {
    // (the list is here and decides; or it couldn't be read, now or earlier, and nothing stands in for it; or there is nowhere to read it from)
    if (ocgCd.data || ocgCd.failed || ocgCd.gaveUp || !ocgCardsURL()) return null;
    const k = ocgKept()[ocgKeptKey(r, g)];
    return k && typeof k.usd === "number" && k.usd >= 0 ? k : null;
  }
  // (called whenever the list comes in: what it priced your cards at, for next time)
  function keepOcgPrices() {
    const next = {};
    for (const r of collection) {
      const g = isOcg(r) ? ocgRegion(r.number) : null;
      const fp = g ? ocgFilePrice(r) : null;
      if (fp && !fp.none && fp.usd != null) next[ocgKeptKey(r, g)] = {usd: fp.usd, src: fp.src, at: fp.at};
    }
    const text = JSON.stringify(next);
    if (text === JSON.stringify(ocgKept())) return;
    ocg.kept = next;
    try { localStorage.setItem(OCG_KEPT_KEY, text); } catch (e) { /* optional */ }
  }
  function ocgPut(key, value) {
    const c = ocgCache();
    c[key] = value;
    const keys = Object.keys(c);
    if (keys.length > 1500) keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, keys.length - 1500).forEach(k => delete c[k]);
    bigSet(OCG_CACHE_KEY, c);
  }
  // One request at a time, at most one every 1.2 seconds: these shops aren't ours to load up.
  function politeJSON(url, gap) {
    const run = async () => {
      const wait = ocg.last + (gap == null ? 1200 : gap) - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      ocg.last = Date.now();
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
      try {
        const res = await fetch(url, ctl ? {signal: ctl.signal} : {});
        if (!res.ok) throw new Error(new URL(url).hostname + " answered " + res.status);
        return await res.json();
      } finally { clearTimeout(timer); }
    };
    const p = ocg.queue.then(run, run);
    ocg.queue = p.catch(() => {});
    return p;
  }

  /* ----- exchange rates (US$ per yen and won) ----- */
  function fxNow() { const c = readJSON(FX_KEY, null); return c && c.JPY > 0 && c.KRW > 0 ? c : null; }
  async function fxRates(force) {
    const c = fxNow();
    if (!force && c && Date.now() - c.t < 12 * 3600000) return c;
    const keep = v => { try { localStorage.setItem(FX_KEY, JSON.stringify(v)); } catch (e) { /* optional */ } return v; };
    try {
      const j = await politeJSON("https://api.frankfurter.dev/v1/latest?from=USD&to=JPY,KRW", 0);
      if (j && j.rates && j.rates.JPY > 0 && j.rates.KRW > 0) return keep({t: Date.now(), JPY: j.rates.JPY, KRW: j.rates.KRW, date: j.date || "", src: "European Central Bank, via Frankfurter"});
    } catch (e) { /* try the other source */ }
    try {
      const j = await politeJSON("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json", 0);
      if (j && j.usd && j.usd.jpy > 0 && j.usd.krw > 0) return keep({t: Date.now(), JPY: j.usd.jpy, KRW: j.usd.krw, date: j.date || "", src: "fawazahmed0 currency API"});
    } catch (e) { /* keep the last rates */ }
    return c;
  }
  const toUSD = (amount, cur) => { const fx = fxNow(); const rate = fx && (cur === "JPY" ? fx.JPY : fx.KRW); return amount != null && rate > 0 ? round2(amount / rate) : null; };
  const fmtLocal = (amount, cur) => amount == null ? "" : (cur === "JPY" ? fmtJPY : fmtKRW).format(amount);

  /* ----- the card: name, set and rarities, from Yugipedia ----- */
  const sameRarity = (a, b) => String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "") === String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  async function ocgCard(code, fresh) {
    code = normNumber(code);
    const key = "card|" + code, hit = ocgCache()[key];
    if (hit && !fresh && Date.now() - hit.t < (hit.card ? OCG_CARD_TTL : 7 * 86400000)) return hit.card;
    const json = await yugiFetch({action: "ask", query: "[[Card number::" + code + "]]|?Card number|?Rarity|?Set contains|limit=20"});
    const raw = json && json.query && json.query.results;
    const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.keys(raw).map(k => Object.assign({fulltext: k}, raw[k])) : [];
    let card = null;
    for (const row of rows) {
      const po = (row && row.printouts) || {};
      if (!(po["Card number"] || []).some(n => normNumber(n) === code)) continue;
      const page = ((po["Set contains"] || [])[0] || {}).fulltext;
      if (!page) continue;
      // (a Rush Duel card's page is "Dark Magician (Rush Duel)" when another card has the name: the name is without it)
      const name = String(page).replace(/\s*\(Rush Duel\)$/, "");
      const set = (String(row.fulltext || "").match(/^Set Card Lists:(.+?) \((?:OCG|TCG)-[A-Z]+\)/) || [])[1] || "";
      if (!card) card = {code, name, page, setName: "", sets: [], rarities: []};
      if (set && !card.sets.includes(set)) card.sets.push(set);
      for (const r of po.Rarity || []) { const rn = r && (r.fulltext || r); if (rn && !card.rarities.some(x => sameRarity(x, rn))) card.rarities.push(String(rn)); }
    }
    if (card) card.setName = card.sets.find(x => !/bonus/i.test(x)) || card.sets[0] || "";
    ocgPut(key, {t: Date.now(), card});
    return card;
  }

  /* ----- Japanese prices and photos: BIGWEB ----- */
  // BIGWEB names rarities in Japanese; the more specific names come first.
  const JA_RARITY = [[/グランドマスター/, "Grand Master Rare"], [/クォーターセンチュリー/, "Quarter Century Secret Rare"], [/プリズマティック/, "Prismatic Secret Rare"],
    [/エクストラシークレット/, "Extra Secret Rare"], [/20th/i, "20th Secret Rare"], [/ホログラフィック|ホロ/, "Holographic Rare"],
    [/アルティメット|レリーフ/, "Ultimate Rare"], [/コレクターズ/, "Collector's Rare"], [/ゴールドシークレット/, "Gold Secret Rare"],
    [/プレミアムゴールド/, "Premium Gold Rare"], [/ゴールド/, "Gold Rare"], [/ミレニアム/, "Millennium Rare"],
    [/シークレットパラレル/, "Secret Parallel Rare"], [/ウルトラパラレル/, "Ultra Parallel Rare"], [/スーパーパラレル/, "Super Parallel Rare"],
    [/ノーマルパラレル/, "Normal Parallel Rare"], [/ノーマルレア/, "Normal Rare"], [/シークレット/, "Secret Rare"], [/ウルトラ/, "Ultra Rare"],
    [/スーパー/, "Super Rare"], [/ノーマル/, "Common"], [/レア/, "Rare"]];
  // (BIGWEB's Overframe ones: "【オーバーフレーム】ウルトラレア" is "Ultra Rare (Overframe)")
  const withOverframe = (name, yes) => yes && name && !/\(overframe\)|grand master|rush/i.test(name) ? name + OVERFRAME : name;
  // (and BIGWEB's Manga-Style cards, a listing per version: "ブラック・マジシャン【モノクロ】" is the monochrome one, "…【カラー版】" the colour one)
  const JA_MANGA = [[/【\s*モノクロ\s*】/, MANGA_MONO], [/【\s*カラー(?:版)?\s*】/, MANGA_COLOR]];
  const withManga = (rarity, name) => { const hit = JA_MANGA.find(([re]) => re.test(String(name || ""))); return hit && rarity ? rarity.replace(MANGA_SUFFIX, "") + hit[1] : rarity; };
  const mangaFree = name => String(name || "").replace(/\s*【\s*(?:モノクロ|カラー版?)\s*】\s*/g, " ").trim();
  const jaRarity = web => { const t = String(web || ""), hit = JA_RARITY.find(([re]) => re.test(t)); return hit ? withOverframe(hit[1], /オーバーフレーム/.test(t)) : t; };
  async function bigwebFor(code, fresh) {
    code = normNumber(code);
    const key = "bw|" + code, hit = ocgCache()[key];
    if (hit && !fresh && Date.now() - hit.t < OCG_TTL) return hit;
    const j = await politeJSON("https://api.bigweb.co.jp/products?game_id=9&name=" + encodeURIComponent(code));
    const now = Date.now();
    const items = (j && Array.isArray(j.items) ? j.items : []).filter(it => it && normNumber(it.fname) === code).map(it => {
      const x = {rarity: withManga(jaRarity(it.rarity && it.rarity.web), it.name), ja: String((it.rarity && it.rarity.web) || ""), name: mangaFree(it.name),
        price: num(it.price) || 0, stock: num(it.stock_count) || 0, cond: String((it.condition && it.condition.web) || ""), image: safeImg(it.image) || ""};
      if (x.price > 0 && x.stock > 0) x.at = now;
      else {   // sold out now: remember the last price seen
        const old = ((hit && hit.items) || []).find(o => o.rarity === x.rarity && o.cond === x.cond && (o.at || o.lastAt));
        if (old) { x.last = old.at ? old.price : old.last; x.lastAt = old.at || old.lastAt; }
      }
      return x;
    });
    const out = {t: now, items};
    ocgPut(key, out);
    return out;
  }
  // The price for one rarity: the standard copies ("プレイ用") in stock first, then any undamaged copy in stock,
  // then the last price seen before it sold out.
  function bigwebPick(items, rarity) {
    let list = (items || []).filter(it => !rarity || sameRarity(it.rarity, rarity));
    // (a plain rarity the card has only as Overframe: BIGWEB's Overframe copies; an Overframe one BIGWEB doesn't tell
    // apart: its plain copies)
    if (rarity && !list.length) { const hit = matchRarity(items || [], rarity, it => it.rarity); if (hit) list = (items || []).filter(it => it.rarity === hit.rarity); }
    if (!rarity && new Set(list.map(it => it.rarity)).size > 1) return null;   // which rarity is yours?
    if (!list.length) return null;
    const inStock = list.filter(it => it.price > 0 && it.stock > 0);
    const min = l => l.reduce((a, b) => (b.price < a.price ? b : a));
    const pick = inStock.filter(it => /プレイ用/.test(it.cond)).length ? min(inStock.filter(it => /プレイ用/.test(it.cond)))
      : inStock.filter(it => !/傷|キズ|難/.test(it.cond)).length ? min(inStock.filter(it => !/傷|キズ|難/.test(it.cond)))
      : inStock.length ? min(inStock) : null;
    if (pick) return {price: pick.price, stock: pick.stock, image: pick.image, name: pick.name, note: plural(pick.stock, "copy", "copies") + " in stock"};
    const last = list.filter(it => it.last > 0).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))[0];
    const img = (list.find(it => it.image) || {}).image || "";
    if (last) return {price: last.last, stock: 0, image: last.image || img, name: last.name, note: "sold out; last seen " + fmtShortDate(new Date(last.lastAt))};
    return {price: null, stock: 0, image: img, name: list[0].name, note: "sold out"};
  }

  /* ----- Korean prices: Bunjang asking prices ----- */
  const KO_RARITY = [[/오버\s*러시|(^|[^A-Z])ORR(?![A-Z])/i, "Over Rush Rare"], [/골드\s*러시|(^|[^A-Z])GRR(?![A-Z])/i, "Gold Rush Rare"],
    [/러시\s*레어|(^|[^A-Z])RR(?![A-Z])/i, "Rush Rare"],   // (Rush Duel's own, first; "러시듀얼" itself is the game's name)
    [/그랜드\s*마스터|그마레|(^|[^A-Z])GMR(?![A-Z])/i, "Grand Master Rare"],
    [/쿼터\s*센[츄추]리|쿼센|QCSE|QCSR|QC\s*시크|QC\s*SE|25th/i, "Quarter Century Secret Rare"],
    [/프리즈?[매마]틱|프시크|프싴|(^|[^A-Z])PSE(?![A-Z])/i, "Prismatic Secret Rare"], [/엑스트라\s*시크|엑시크|(^|[^A-Z])EXSE(?![A-Z])/i, "Extra Secret Rare"],
    [/20th|20\s*시크/i, "20th Secret Rare"], [/홀로그래픽|홀로/, "Holographic Rare"], [/얼티(밋|메이트)?|얼레|(^|[^A-Z])UL(?![A-Z])/i, "Ultimate Rare"],
    [/컬렉터즈|콜렉터즈|컬렉|컬레|(^|[^A-Z])CR(?![A-Z])/i, "Collector's Rare"], [/골드\s*시크/, "Gold Secret Rare"], [/골드/, "Gold Rare"],
    [/밀레니엄/, "Millennium Rare"], [/노[멀말]\s*패러렐|노패/, "Normal Parallel Rare"], [/울트라\s*패러렐|울패/, "Ultra Parallel Rare"],
    [/시크릿|시크|(^|[^A-Z])(SE|SCR)(?![A-Z])/i, "Secret Rare"], [/울트라|울레|(^|[^A-Z])UR(?![A-Z])/i, "Ultra Rare"],
    [/슈퍼|슈레|(^|[^A-Z])SR(?![A-Z])/i, "Super Rare"], [/노[멀말]/, "Common"], [/레어|(^|[^A-Z])R(?![A-Z0-9])/i, "Rare"]];
  // (the card code itself is taken out first: "SR01-KR001" isn't a Super Rare)
  const koRarity = (title, code) => { const t = String(title || "").replace(/(RD\s*\/\s*)?[A-Z0-9]{2,5}\s*-?\s*(KR|JP)\s*[A-Z]?\d{3}/gi, " "); const hit = KO_RARITY.find(([re]) => re.test(t)); return hit ? withOverframe(hit[1], /오버\s*프레임|오버\s*(울레|울트라|프시크|프싴|프리즘)/.test(t)) : ""; };
  const median = list => { const a = list.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2)) : null; };
  async function bunjangFor(code, fresh) {
    code = normNumber(code);
    const key = "bj|" + code, hit = ocgCache()[key];
    if (hit && !fresh && Date.now() - hit.t < OCG_TTL) return hit;
    // (Bunjang's website's own search, since October 2026: 60 listings a page; ads among them are left out)
    // ("status=SOLD_OUT" brings the listings that sold along with the ones for sale)
    const j = await politeJSON("https://api.bunjang.co.kr/api/search/v8/web/search?policyKey=mw.product.keyword&q=" + encodeURIComponent(bunjangQ(code)) + "&size=60&status=SOLD_OUT", 1500);
    const sr = j && j.data && j.data.responses && j.data.responses.mainGrid && j.data.responses.mainGrid.searchResponse;
    const flat = bunjangQ(code).replace(/-/g, "");   // (a Rush Duel card's RD/ is often left out: it's matched without it)
    // Listings for this exact card number, not "wanted" posts or bundles of several cards.
    const list = (sr && Array.isArray(sr.data) ? sr.data : []).filter(x => x && x.type === "PRODUCT" && !x.ad)
      .map(x => ({name: String(x.name || ""), price: num(x.price), sold: String(x.status || "").toUpperCase() === "SOLD_OUT", day: String(x.updatedAt || "").slice(0, 10)}))
      .filter(x => x.price >= 100 && x.price <= 50000000 && x.name.toUpperCase().replace(/[\s\-_.\/]/g, "").includes(flat) &&
        !/삽니다|구매합니다|구합니다|구해요|매입|일괄|묶음/.test(x.name));
    // Sales in the last 120 days count; once a card sold twice, what it sold for is its price, else what sellers ask
    const groups = {}, recent = localDay(new Date(Date.now() - 120 * 86400000));
    for (const x of list) {
      if (x.sold && !(x.day >= recent)) continue;
      const k = koRarity(x.name, code) || "?", gr = groups[k] = groups[k] || {ask: [], sold: [], last: ""};
      if (x.sold) { gr.sold.push(x.price); if (x.day > gr.last) gr.last = x.day; } else gr.ask.push(x.price);
    }
    const byRarity = {};
    for (const [k, gr] of Object.entries(groups)) {
      const ask = gr.ask.length ? median(gr.ask) : null, sold = gr.sold.length ? median(gr.sold) : null;
      byRarity[k] = {median: gr.sold.length >= 2 ? sold : ask != null ? ask : sold, n: gr.ask.length, ask, sold, sales: gr.sold.length, last: gr.last};
    }
    const out = {t: Date.now(), byRarity, n: list.filter(x => !x.sold).length};
    ocgPut(key, out);
    return out;
  }
  function bunjangPick(entry, rarity, onlyRarity) {
    if (!entry || !entry.byRarity) return null;
    const keys = Object.keys(entry.byRarity);
    const k = keys.find(x => x !== "?" && sameRarity(x, rarity)) || (rarity ? matchRarity(keys.filter(x => x !== "?"), rarity) : null) ||
      ((!rarity || onlyRarity) && keys.length === 1 ? keys[0] : (onlyRarity && entry.byRarity["?"] ? "?" : null));
    return k ? entry.byRarity[k] : null;
  }

  /* ----- a card's price, photo and source ----- */
  const ocgTwin = g => g.set + "-JP" + g.tail;   // the Japanese print with the same number (same artwork)
  // The daily list's price and a live check from this browser: the newer one that has a price.
  function ocgPrice(r) {
    const g = isOcg(r) ? ocgRegion(r.number) : null;
    if (!g) return null;
    const file = ocgFilePrice(r), live = ocgLivePrice(r, g);
    const has = x => x && !x.none;
    if (has(file) && has(live)) return live.at > file.at ? live : file;
    return has(file) ? file : has(live) ? live : file || live;
  }
  function ocgLivePrice(r, g) {
    const cardHit = ocgCache()["card|" + g.code];
    const only = !!(cardHit && cardHit.card && cardHit.card.rarities.length === 1);
    if (!ocgLiveOK(g)) return null;   // (Fullahead: the daily list only)
    if (g.region === "JP") {
      const e = ocgCache()["bw|" + g.code];
      const pick = e && bigwebPick(e.items, r.rarity || (only ? cardHit.card.rarities[0] : ""));
      if (!pick || pick.price == null) return e ? {none: true, src: "BIGWEB", at: e.t, note: pick ? pick.note : ""} : null;
      return {local: pick.price, cur: "JPY", usd: toUSD(pick.price, "JPY"), src: "BIGWEB", note: pick.note, at: e.t, url: "https://bigweb.co.jp/"};
    }
    const e = ocgCache()["bj|" + g.code];
    const b = e && bunjangPick(e, r.rarity, only);
    if (!b) return e ? {none: true, src: "Bunjang", at: e.t, note: e.n ? "no listing for this rarity" : "no listings"} : null;
    return {local: b.median, cur: "KRW", usd: toUSD(b.median, "KRW"), src: "Bunjang", note: krNote(b), at: e.t,
      url: bunjangSearchURL(g.code)};
  }
  function ocgImage(r) {
    const g = isOcg(r) ? ocgRegion(r.number) : null;
    if (!g) return "";
    // (a Korean card: its row's photo, which is the Japanese print's, else the Japanese print's own)
    const cards = [ocgCardAt(g.code), g.region === "KR" ? ocgCardAt(ocgTwin(g)) : null].filter(Boolean);
    for (const card of cards) { const row = ocgRowFor(card, r.rarity); if (row && row.img) return row.img; }
    for (const card of cards) { const any = card.rows.find(x => x.img); if (any) return any.img; }
    const e = ocgCache()["bw|" + (g.region === "JP" ? g.code : ocgTwin(g))];
    const pick = e && (bigwebPick(e.items, r.rarity) || (e.items || []).find(it => it.image));
    return (pick && pick.image) || "";
  }
  // Brings the prices of your Japanese and Korean cards up to date (once a day), and the photo of the Japanese print
  // for Korean cards without one. Runs quietly in the background.
  // The daily list covers most of them; the shops are only asked about cards it doesn't have a price for.
  async function refreshOcgPrices(force) {
    if (ocg.refreshing) return 0;
    const codes = new Map();
    for (const r of collection) if (isOcg(r)) { const g = ocgRegion(r.number); codes.set(g.code, {g, needsPhoto: (codes.get(g.code) || {}).needsPhoto || !safeImg(r.customImage)}); }
    for (const w of wants) if (isOcg(w) && !w.ref && !codes.has(ocgRegion(w.number).code)) codes.set(ocgRegion(w.number).code, {g: ocgRegion(w.number), needsPhoto: false});
    if (!codes.size) return 0;
    ocg.refreshing = true;
    let fetched = 0;
    try {
      await loadOcgCardsSoft();
      await fxRates();
      for (const {g, needsPhoto} of codes.values()) {
        const stale = key => { const h = ocgCache()[key]; return force || !h || Date.now() - h.t > OCG_TTL; };
        const listed = r => { const f = ocgFilePrice(r); return f && !f.none; };
        const covered = !force && collection.concat(wants).filter(r => !r.productId && !r.ref && normNumber(r.number) === g.code).every(listed);
        const photoListed = !!(ocgCardAt(g.code) && ocgCardAt(g.code).rows.some(x => x.img));
        try {
          // (Rush Duel: BIGWEB doesn't sell it, and Fullahead is read by the nightly update only)
          if (g.region === "JP" && !isRushNo(g.code) && !covered && stale("bw|" + g.code)) { await bigwebFor(g.code, true); fetched++; }
          if (g.region === "KR" && !covered && stale("bj|" + g.code)) { await bunjangFor(g.code, true); fetched++; }
          if (g.region === "KR" && !isRushNo(g.code) && needsPhoto && !photoListed && !ocgCache()["bw|" + ocgTwin(g)]) { await bigwebFor(ocgTwin(g)); fetched++; }
        } catch (e) {
          if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        }
        if (fetched && fetched % 8 === 0) renderSoon();
      }
    } finally { ocg.refreshing = false; }
    if (fetched) renderSoon();
    return fetched;
  }
  // (ms: how long to wait for more to come in first; the default gathers a burst of price lookups into one redraw)
  function renderSoon(ms) {
    clearTimeout(ocg.timer);
    ocg.timer = setTimeout(() => { if (recordValueHistory()) save({quiet: true, noBackup: true}); render(); }, ms == null ? 400 : ms);
  }

  /* ----- adding a Japanese or Korean card by its number ----- */
  // opts.search: shown in Card search (adding is optional there)
  // opts.live: ask Yugipedia and the shops now, instead of Card Vault's daily list
  async function showOcgLookup(out, code, m, opts) {
    const inOut = sel => out.querySelector(sel);   // (its buttons, not ones with the same id in a drawer)
    const lang = OCG_REGIONS[m[2]];
    opts = opts || {};
    if (!opts.live) {
      if (!ocgCd.data && ocgCardsURL() && !(ocgCd.failed && Date.now() - ocgCd.failed < 10 * 60000)) {
        out.innerHTML = '<p class="hint" role="status">Loading the Japanese and Korean card list…</p>';
        await loadOcgCardsSoft();
        if (!out.isConnected) return;
      }
      const card = ocgCardAt(code);
      if (card && card.rows.length) { showOcgFromList(out, card, m, opts); return; }
    }
    out.innerHTML = '<p class="hint" role="status">Looking up ' + esc(code) + " (" + esc(lang) + ")…</p>";
    let card = null, failed = false;
    try { card = await ocgCard(code); } catch (e) { failed = true; }
    if (!out.isConnected) return;
    const rush = isRushNo(code);
    const fallback = why => {
      const en = m[1] + "-EN" + m[3];
      // (Rush Duel cards have no English printings to borrow the name from)
      out.innerHTML = '<div class="notice"><strong>' + why + "</strong> You can add it manually." + (rush ? "" : " To fill in the name for you, Card Vault can look up the English printing with the same number, if one exists.") +
        "<br>" + (rush ? "" : '<button class="btn btn-small" type="button" id="tryEnglish">Look up ' + esc(en) + "</button> ") + '<button class="btn btn-small" type="button" id="manualOcg">Add manually</button></div><div id="enOut"></div>';
      inOut("#manualOcg").addEventListener("click", () => openManual({number: code, language: lang}));
      if (!rush) inOut("#tryEnglish").addEventListener("click", () => {
        const list = catalog ? findByNumber(en) : [];
        const enOut = inOut("#enOut");
        if (!list.length) { enOut.innerHTML = '<div class="notice">No English printing uses ' + esc(en) + ". Add the card manually instead.</div>"; return; }
        enOut.innerHTML = '<p class="results-head">English printing with the same number, for reference. Picking it fills in the name and rarity; your card stays ' + esc(lang) + ".</p>" + resultsHTML(list);
        wireResults(enOut, list, p => openManual({number: code, language: lang, name: cleanName(p.name, p.rarity), rarity: p.rarity, setName: p.group.name}));
      });
    };
    if (!card) { fallback(failed ? "Couldn't reach Yugipedia to look up " + esc(code) + " (it needs an internet connection)." : "Yugipedia doesn't list " + esc(code) + " yet."); return; }
    out.innerHTML = '<p class="hint" role="status">Found ' + esc(card.name) + ". Getting prices and photos…</p>";
    let bw = null, bj = null;
    await fxRates().catch(() => null);
    // (BIGWEB has no Rush Duel singles: a Korean Rush Duel card's backup photo is the Japanese print's from the daily list)
    if (!rush) { try { bw = await bigwebFor(m[2] === "JP" ? code : ocgTwin({set: m[1], tail: m[3]})); } catch (e) { bw = null; } }
    if (m[2] === "KR") { try { bj = await bunjangFor(code); } catch (e) { bj = null; } }
    if (!out.isConnected) return;
    const twin = rush && m[2] === "KR" ? ocgCardAt(ocgTwin({set: m[1], tail: m[3]})) : null;
    const rarities = card.rarities.length ? card.rarities : [""];
    const choices = rarities.map(rar => {
      const pick = bw ? bigwebPick(bw.items, rar) : null;
      let price = null;
      if (m[2] === "JP" && pick && pick.price != null) price = {local: pick.price, cur: "JPY", src: "BIGWEB", note: pick.note};
      const b = m[2] === "KR" ? bunjangPick(bj, rar, rarities.length === 1) : null;
      if (b) price = {local: b.median, cur: "KRW", src: "Bunjang", note: (+b.sales || 0) >= 2 ? plural(+b.sales, "sale") : plural(b.n, "listing")};
      const tw = twin ? ocgRowFor(twin, rar) || twin.rows.find(x => x.img) : null;
      return {rarity: rar, image: "", backup: pick ? pick.image : tw ? tw.img || "" : "", ja: pick ? pick.name : "", price};
    });
    // Photos: Yugipedia's scan of this printing (or the closest one), with BIGWEB's photo as the backup.
    try {
      const res = await findYugiImages(code, card.page || card.name);
      for (const c of choices) { const rk = rankYugiImages(res.images, code, c.rarity); const im = rk.exact[0] || rk.near[0]; if (im) c.image = im.thumb; }
    } catch (e) { /* BIGWEB's photo then */ }
    for (const c of choices) if (!c.image) { c.image = c.backup; c.backup = ""; }
    if (!out.isConnected) return;
    const priceText = pr => pr ? esc(fmtLocal(pr.local, pr.cur)) + (toUSD(pr.local, pr.cur) != null ? " ≈ " + esc(usd(toUSD(pr.local, pr.cur))) : "") +
      '<br><span class="small">' + esc(pr.src) + ", " + esc(pr.note) + "</span>" : '<span class="small">No price found</span>';
    out.innerHTML = '<p class="results-head">' + esc(card.name) + (card.setName ? ", " + esc(card.setName) : "") + " (" + esc(lang) + "). " +
      (opts && opts.search ? (choices.length > 1 ? "It was printed in " + choices.length + " rarities. Pick one to add it to your collection." : "Pick it to add it to your collection.")
        : choices.length > 1 ? "It was printed in " + choices.length + " rarities: pick yours." : "Pick it to continue.") + "</p>" +
      '<div class="results">' + choices.map((c, i) => '<button type="button" class="result" data-idx="' + i + '">' +
        '<span class="sleeve">' + imgTag({list: [c.image, c.backup].concat(namePics(card.name, "in_400x400").list)}, card.name) + "</span>" +
        '<span class="result-name">' + esc(card.name) + "</span>" + (c.ja ? '<span class="result-meta">' + esc(c.ja) + "</span>" : "") +
        '<span class="result-meta">' + esc(code) + ", " + esc(c.rarity || "rarity unknown") + "</span>" +
        '<span class="result-price">' + priceText(c.price) + "</span></button>").join("") + "</div>" +
      '<p class="small">Card details and photos from Yugipedia. ' + (m[2] === "JP" ? (rush ? "Japanese Rush Duel prices come from Fullahead (a Japanese card shop) with Card Vault's daily list, which doesn't have this card yet."
        : "Prices from BIGWEB (Japan).") : "Prices are from Bunjang (Korea): what it sold for once it sold twice lately, else asking prices; a missing Korean photo shows the Japanese print.") +
      ' <button type="button" class="link-btn" id="manualOcg">Add it manually instead</button></p>';
    inOut("#manualOcg").addEventListener("click", () => openManual({number: code, language: lang, name: card.name, setName: card.setName}));
    out.querySelectorAll(".result").forEach(btn => btn.addEventListener("click", () => openOcgForm(card, lang, choices[+btn.dataset.idx])));
  }
  // The card as the daily list has it: every rarity with its price and photo, right away.
  function showOcgFromList(out, card, m, opts) {
    const lang = OCG_REGIONS[m[2]], region = card.region, mkSet = ocgFindSet(card.set.id), code = card.number;
    const info = {code, name: card.name, setName: mkSet ? mkSet.name : "", sets: [], rarities: card.rows.map(x => x.rarity).filter(Boolean)};
    const choices = card.rows.map(row => ({rarity: row.rarity, image: row.img, backup: "", ja: row.ja, row,
      price: row.local ? {local: row.local, cur: OCG_CUR[region], src: ocgSrc(region, code), note: rowNote(row)} : null}));
    const priceText = pr => pr ? esc(fmtLocal(pr.local, pr.cur)) + (ocgUSD(pr.local, region) != null ? " ≈ " + esc(usd(ocgUSD(pr.local, region))) : "") +
      '<br><span class="small">' + esc(pr.src) + ", " + esc(pr.note) + "</span>" : '<span class="small">No price' + (region === "jp" ? " (sold out)" : " (no listings)") + "</span>";
    out.innerHTML = '<p class="results-head">' + esc(card.name) + (info.setName ? ", " + esc(info.setName) : "") + " (" + esc(lang) + "). " +
      (opts && opts.search ? (choices.length > 1 ? "It was printed in " + choices.length + " rarities. Pick one to add it to your collection." : "Pick it to add it to your collection.")
        : choices.length > 1 ? "It was printed in " + choices.length + " rarities: pick yours." : "Pick it to continue.") + "</p>" +
      '<div class="results">' + choices.map((c, i) => '<button type="button" class="result" data-idx="' + i + '">' +
        '<span class="sleeve"' + foilAttr(c.rarity) + ">" + imgTag({list: [c.image].concat(namePics(card.name, "in_400x400", c.rarity).list)}, card.name) + "</span>" +
        '<span class="result-name">' + esc(card.name) + "</span>" + (c.ja ? '<span class="result-meta">' + esc(c.ja) + "</span>" : "") +
        '<span class="result-meta">' + esc(code) + ", " + esc(c.rarity || "rarity not stated") + "</span>" +
        '<span class="result-price">' + priceText(c.price) + ocgOneChangeHTML(c.row) + "</span></button>").join("") + "</div>" +
      '<p class="small">From Card Vault\'s daily ' + esc(ocgLangOf(region, code)) + " price list (" + esc(ocgListSource(region, code)) + "), " + esc(ocgListDate()) + ". " +
      (ocgLiveOK({region: m[2], code}) ? '<button type="button" class="link-btn" id="ocgLive">Ask the shop now</button> ' : "") +
      '<button type="button" class="link-btn" id="manualOcg">Add it manually instead</button></p>';
    out.querySelector("#manualOcg").addEventListener("click", () => openManual({number: code, language: lang, name: card.name, setName: info.setName}));
    if (out.querySelector("#ocgLive")) out.querySelector("#ocgLive").addEventListener("click", () => showOcgLookup(out, code, m, Object.assign({}, opts, {live: true})));
    out.querySelectorAll(".result").forEach(btn => btn.addEventListener("click", () => openOcgForm(info, lang, choices[+btn.dataset.idx])));
    // Each print with no picture of its own here yet (the website's copy of its scan): Yugipedia's scan of it, once it's
    // here (BIGWEB's photo may not load); a Manga-Style version's own scan
    if (choices.some(c => !isScanURL(c.image))) {
      findYugiImages(code, card.name).then(res => {
        choices.forEach((c, i) => {
          if (isScanURL(c.image)) return;
          const pick = yugiPrintPick(rankYugiImages(res.images, code, c.rarity), c.rarity);
          if (!pick) return;
          c.yugi = pick.thumb;
          const img = out.querySelector('.result[data-idx="' + i + '"] .sleeve');
          if (img) img.innerHTML = imgTag({list: [pick.thumb, c.image]}, card.name);
        });
      }).catch(() => {});
    }
  }
  // opts.fromWant: the want-list entry this card came from (it's taken off once the card is added)
  function openOcgForm(card, lang, choice, opts) {
    opts = opts || {};
    drawerCtx = {mode: "ocg"};
    const pr = choice.price;
    const want = opts.fromWant ? wants.find(w => w.id === opts.fromWant) : null;
    openDrawer("Add a card",
      '<div class="picked"><span class="sleeve">' + imgTag({list: [choice.yugi, choice.image, choice.backup].concat(namePics(card.name, "in_400x400").list)}, card.name, true) + "</span><div>" +
      "<h3>" + esc(card.name) + "</h3>" + (choice.ja ? "<p>" + esc(choice.ja) + "</p>" : "") + "<p>" + esc(card.setName || "") + "</p><p>" + esc(card.code) + ", " +
      esc(choice.rarity || "rarity unknown") + "</p><p>" + esc(lang) + "</p>" +
      (want ? "" : '<p style="margin-top:8px"><button type="button" class="link-btn" id="backToSearch">Pick a different rarity</button></p>') + "</div></div>" +
      (want ? fromWantNotice : "") +
      ownedWhereHTML(r => !r.productId && !r.sealed && normNumber(r.number) === normNumber(card.code), "oLoc") +
      '<form id="ocgForm" class="stack">' +
      '<div class="price-line">' + (pr ? esc(pr.src) + ": <b>" + esc(fmtLocal(pr.local, pr.cur)) + "</b>" + (toUSD(pr.local, pr.cur) != null ? " ≈ <b>" + esc(usd(toUSD(pr.local, pr.cur))) + "</b>" : "") +
        ' <span class="small">(' + esc(pr.note) + ")</span>" : '<span class="small">No price found yet. Card Vault checks again every day; you can also enter your own estimate later.</span>') + "</div>" +
      '<div class="grid-2"><label class="field"><span>Printing</span><select class="input" id="oEd">' + options(PRINTINGS, "No edition mark") + "</select></label>" +
      '<label class="field"><span>Condition</span><select class="input" id="oCond">' + options(CARD_CONDITIONS, "Near Mint") + "</select></label></div>" +
      sealedCardCheckHTML("oSealedCard", false) +
      '<div class="grid-2"><label class="field"><span>Quantity</span><input class="input" id="oQty" type="number" min="1" step="1" value="1"></label>' +
      '<label class="field"><span>Price you paid, each (optional)</span><input class="input" id="oPaid" type="number" min="0" step="0.01" placeholder="$"></label></div>' +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="oNotes"></label>' +
      locationFieldHTML("oLoc", "") + gradeFieldsHTML("o", null) +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Add to collection</button></div></form>');
    if (want) $("oQty").value = String(want.qty || 1);
    wireSealedCard("oSealedCard", "oCond");
    wireOwnedWhere();
    if ($("backToSearch")) $("backToSearch").addEventListener("click", () => openAdd({number: card.code}));
    $("ocgForm").addEventListener("submit", e => {
      e.preventDefault();
      const rec = upgradeRecord({id: newId(), productId: null, name: card.name, productName: card.name, setName: card.setName, number: card.code,
        rarity: choice.rarity, edition: $("oEd").value, condition: $("oCond").value, language: lang, qty: posInt($("oQty").value) || 1,
        customImage: choice.yugi || choice.image || null, paid: num($("oPaid").value), notes: $("oNotes").value.trim(), location: $("oLoc").value,
        grade: readGradeFields("o"), added: new Date().toISOString()});
      const res = addOrMerge(rec);
      const took = want ? tookWant(want.id, rec.qty) : "";
      save(); render(); closeDrawer();
      if (!choice.yugi && !isScanURL(choice.image)) fillPrintPhotos();   // (its print's scan, when the pick screen hadn't got it yet)
      if (want) { toast("Added " + rec.name + " (" + rec.number + ")" + took); return; }
      toast(res.merged ? "Added. You now have " + res.record.qty + " of " + rec.name + " (" + rec.number + ")." : "Added " + rec.name + " (" + rec.number + ").",
        {action: "Add another", onAction: () => openAdd()});
    });
  }

  /* ======================= Graded values (PSA 10 and your own grades) ======================= */
  // "PSA 10 value" shows what one gem-mint copy of each card would be worth. Real graded prices come from
  // PriceCharting (eBay sales), looked up from this browser with your own PriceCharting key and kept private here.
  // Without a key, it's an estimate from the raw market price, which you can tune in Settings, and any PSA 10
  // values you enter on a card yourself.
  const PC_CACHE_KEY = "cardvault.v2.pricecharting";
  const PC_TTL = 24 * 3600000;
  const pc = {cache: null, queue: Promise.resolve(), last: 0, refreshing: false, bad: false};
  function pcCache() {
    if (!pc.cache) { const c = bigGet(PC_CACHE_KEY, {}); pc.cache = c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
    return pc.cache;
  }
  function pcPut(key, value) {
    const c = pcCache();
    c[key] = value;
    const keys = Object.keys(c);
    if (keys.length > 3000) keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, keys.length - 3000).forEach(k => delete c[k]);
    bigSet(PC_CACHE_KEY, c);
  }
  const pcKey = r => r.productId ? "p|" + r.productId + "|" + (r.edition || "") : "n|" + normNumber(r.number) + "|" + lookupName(r.name).toLowerCase() + "|" + (r.edition || "") + (mangaOf(r.rarity) ? "|" + r.rarity.toLowerCase() : "");
  const cents = v => { const n = num(v); return n != null && n > 0 ? round2(n / 100) : null; };
  // PriceCharting's price fields for trading cards (their documentation): ungraded, then each grade.
  const PC_FIELDS = {raw: "loose-price", "7": "cib-price", "8": "new-price", "9": "graded-price", "9.5": "box-only-price", "10": "manual-only-price",
    bgs10: "bgs-10-price", cgc10: "condition-17-price", sgc10: "condition-18-price"};
  // "Yubel [1st Edition] PTDN-EN006" -> which printing that PriceCharting item is
  const pcEdition = name => /\[1st Edition\]/i.test(name) ? "1st Edition" : /\[Limited Edition\]/i.test(name) ? "Limited" : "";
  const pcVariant = name => (String(name).match(/\[([^\]]+)\]/g) || []).filter(t => !/edition/i.test(t)).join(" ");
  function pcFetch(path) {
    const run = async () => {
      const wait = pc.last + 1100 - Date.now();   // their limit: one call a second
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      pc.last = Date.now();
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
      let res;
      try { res = await fetch("https://www.pricecharting.com/api/" + path + "&t=" + encodeURIComponent(settings.pcToken || ""), ctl ? {signal: ctl.signal} : {}); }
      finally { clearTimeout(timer); }
      let json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (json && /token/i.test(String(json["error-message"] || json.error || ""))) { pc.bad = settings.pcToken; throw named("TokenError", "PriceCharting didn't accept the key"); }
      if (!res.ok || !json || json.status === "error") throw new Error("PriceCharting answered " + (json && json["error-message"] ? json["error-message"] : res.status));
      return json;
    };
    const p = pc.queue.then(run, run);
    pc.queue = p.catch(() => {});
    return p;
  }
  // The names PriceCharting could give a rarity of yours: its own, and where PriceCharting words it differently.
  // "Ultra Rare (Overframe)" is just "[Overframe]" there, and its other Overframe rarities put the word first
  // ("Overframe Prismatic Secret Rare"). Prismatic Collector's / Ultimate Rare are deliberately NOT mapped to
  // PriceCharting's "Collector's Rare" / "Ultimate Rare": their own ids don't line up with TCGplayer's, so a match
  // could show another card's price.
  function pcRarityNames(rarity) {
    const text = String(rarity || "").trim(), names = [text];
    const m = text.match(/^(.*?)\s*\(overframe\)$/i);
    const base = m ? m[1].trim() : /^grand master rare$/i.test(text) ? text : "";
    if (base) { names.push("Overframe " + base); if (/^ultra rare$/i.test(base)) names.push("Overframe"); }
    // (a Manga-Style card is "[Manga Color]" or "[Manga Monochrome]" there, whichever of its two rarities)
    if (mangaOf(text)) names.push("Manga " + mangaOf(text));
    return names;
  }
  const pcMine = (list, r) => { const wants = pcRarityNames(r.rarity); return list.filter(it => { const v = pcVariant(it["product-name"]).replace(/[[\]]/g, ""); return v && r.rarity && wants.some(w => sameRarity(v, w)); }); };
  // Which of PriceCharting's items is this card? The card number must be in the name, the printing tag must match
  // (no tag means Unlimited), and the TCGplayer id settles it when PriceCharting has one.
  function pcMatch(items, r) {
    const number = normNumber(r.number);
    if (!number) return null;
    const wantEd = r.edition === "1st Edition" || r.edition === "Limited" ? r.edition : "";
    let list = (items || []).filter(it => it && /yu-?gi-?oh/i.test(String(it["console-name"] || "")) && normNumber(String(it["product-name"] || "")).includes(number));
    if (!list.length) return null;
    // A variant in brackets ([Starlight Rare], [Misprint]...) is a different item: only the one that is your rarity,
    // else the plain item.
    const mine = pcMine(list, r);
    const plain = list.filter(it => !pcVariant(it["product-name"]));
    list = mine.length ? mine : plain;
    if (!list.length) return null;
    const byId = r.productId ? list.filter(it => +it["tcg-id"] === r.productId) : [];
    if (byId.length) list = byId;
    const eds = list.map(it => pcEdition(it["product-name"]));
    const exact = list.filter((it, i) => eds[i] === wantEd);
    if (exact.length) return exact[0];
    if (list.length === 1 && eds[0] === "") return list[0];   // PriceCharting doesn't split this card by printing
    return null;
  }
  // In plain words, why pcMatch found nothing for this card (shown in Settings > "Cards with no match").
  function pcWhy(items, r) {
    if (r.language === "Korean") return "PriceCharting doesn't list Korean cards.";
    const number = normNumber(r.number);
    const ygo = (items || []).filter(it => it && /yu-?gi-?oh/i.test(String(it["console-name"] || "")));
    const list = ygo.filter(it => normNumber(String(it["product-name"] || "")).includes(number));
    if (!list.length) {
      const near = ygo[0];
      return "PriceCharting has no card numbered " + r.number + (near ? " (the closest it found is " + String(near["product-name"] || "").slice(0, 70) + ", " + String(near["console-name"] || "").replace(/^yu-?gi-?oh\s*/i, "") + ")" : "") + ".";
    }
    const mine = pcMine(list, r), plain = list.filter(it => !pcVariant(it["product-name"]));
    if (!mine.length && !plain.length) {
      const seen = [...new Set(list.map(it => pcVariant(it["product-name"]).replace(/[[\]]/g, "")).filter(Boolean))];
      return "It has this card number but not as " + (r.rarity || "your rarity") + ". It lists: " + seen.slice(0, 8).join(", ") + (seen.length > 8 ? ", …" : "") + ".";
    }
    const want = r.edition === "1st Edition" || r.edition === "Limited" ? r.edition : "Unlimited";
    const have = [...new Set((mine.length ? mine : plain).map(it => pcEdition(it["product-name"]) || "Unlimited"))];
    return have.includes(want) ? "PriceCharting has several listings for it and none stands out as yours." : "PriceCharting has it only as " + have.join(" and ") + ", not " + want + ".";
  }
  function pcPrices(it) {
    const out = {id: it.id, name: String(it["product-name"] || ""), set: String(it["console-name"] || ""), vol: num(it["sales-volume"]) || 0};
    for (const [k, f] of Object.entries(PC_FIELDS)) out[k] = cents(it[f]);
    return out;
  }
  // Cards PriceCharting is never asked about: Korean ones (it doesn't list Korean cards) and ones you marked as not on
  // it. The PriceCharting item you picked for a card yourself (r.pcId) is used as it is.
  const pcSkip = r => r.language === "Korean" || r.pcId === "none";
  async function pcLookup(r, fresh) {
    if (pcSkip(r)) return null;
    const key = pcKey(r), hit = pcCache()[key];
    if (hit && !fresh && Date.now() - hit.t < (hit.p ? PC_TTL : 3 * 86400000)) return hit.p;
    if (r.pcId) {
      const it = await pcFetch("product?id=" + encodeURIComponent(r.pcId));
      const p = it && it["product-name"] ? pcPrices(it) : null;
      pcPut(key, p ? {t: Date.now(), p} : {t: Date.now(), p: null, why: "The PriceCharting item you picked for it couldn't be read. Pick it again."});
      return p;
    }
    const q = (lookupName(r.name) + " " + (r.number || "")).trim();
    const json = await pcFetch("products?q=" + encodeURIComponent(q));
    let it = pcMatch(json.products, r);
    // (the search list may carry no prices: fetch the item itself)
    if (it && it[PC_FIELDS["10"]] === undefined && it[PC_FIELDS.raw] === undefined && it.id) it = await pcFetch("product?id=" + encodeURIComponent(it.id));
    const p = it ? pcPrices(it) : null;
    pcPut(key, p ? {t: Date.now(), p} : {t: Date.now(), p, why: pcWhy(json.products, r)});
    return p;
  }
  // The cards PriceCharting was asked about and had no match for, with the reason kept when it was asked.
  function pcMisses() {
    return collection.filter(r => !r.sealed && normNumber(r.number) && !pcSkip(r)).map(r => ({r, h: pcCache()[pcKey(r)]})).filter(x => x.h && !x.h.p).map(x => ({r: x.r, why: x.h.why || ""}));
  }
  // The ones PriceCharting isn't asked about, for Settings
  function pcSkipped() {
    const cards = collection.filter(r => !r.sealed && normNumber(r.number));
    return {korean: cards.filter(r => r.language === "Korean"), marked: cards.filter(r => r.language !== "Korean" && r.pcId === "none")};
  }
  // PriceCharting's Yu-Gi-Oh! items for some words (the picker's search)
  async function pcSearch(q) {
    const json = await pcFetch("products?q=" + encodeURIComponent(String(q || "").trim()));
    return (json.products || []).filter(it => it && it.id && /yu-?gi-?oh/i.test(String(it["console-name"] || "")));
  }
  // The PriceCharting item for a card, picked by you (it = PriceCharting's item), or "none": it isn't on PriceCharting.
  // Every entry of the same printing gets it (they're priced as one), kept with your cards (so on your other devices
  // too) and used from then on instead of searching.
  async function pcChoose(r, it) {
    const key = pcKey(r), same = collection.filter(x => !x.sealed && pcKey(x) === key);
    if (it === "none") {
      for (const x of same) x.pcId = "none";
      pcPut(key, {t: Date.now(), p: null, why: "none"});
      save();
      return null;
    }
    let item = it;
    if (item[PC_FIELDS["10"]] === undefined && item[PC_FIELDS.raw] === undefined) item = await pcFetch("product?id=" + encodeURIComponent(it.id));
    for (const x of same) x.pcId = String(it.id);
    const p = pcPrices(item);
    pcPut(key, {t: Date.now(), p});
    save();
    return p;
  }
  // "Ask again": cards you marked as not on PriceCharting are looked for again
  function pcUnmark(list) {
    for (const r of list) {
      if (r.pcId !== "none") continue;
      delete r.pcId;
      const h = pcCache()[pcKey(r)];
      if (h && !h.p) pcPut(pcKey(r), {t: 0, p: null});
    }
    save();
  }
  // Matching a card with PriceCharting yourself: its search results for the card (or words you type), "This is my card"
  // on the right one, or "It isn't on PriceCharting". opts.back: "settings" or a card's id, where to go afterwards.
  function openPcPick(id, opts) {
    opts = opts || {};
    const r = collection.find(x => x.id === id);
    if (!r) return;
    drawerCtx = {mode: "pc-pick", id};
    const h = pcCache()[pcKey(r)];
    const why = h && h.why && h.why !== "none" ? h.why : "";
    const back = () => { if (opts.back === "settings") openSettings({section: "graded"}); else openDetails(r.id); };
    openDrawer("Match on PriceCharting",
      '<div class="picked"><span class="sleeve"' + foilAttr(r.rarity) + ">" + imgTag(recordPics(r, "in_400x400"), r.name, true) + "</span><div>" +
      "<h3>" + esc(r.name) + "</h3><p>" + esc([r.number, r.rarity].filter(Boolean).join(" · ")) + "</p><p>" + esc([r.edition, r.language].filter(Boolean).join(" · ")) + "</p></div></div>" +
      (why ? '<p class="small" style="margin:0 0 12px">' + esc(why) + "</p>" : "") +
      '<form id="pcPickForm" class="lookup-row" style="margin:0 0 6px"><input class="input" id="pcQ" aria-label="Search PriceCharting" value="' + esc((lookupName(r.name) + " " + (r.number || "")).trim()) + '">' +
      '<button class="btn" type="submit">Search</button></form>' +
      '<p class="hint" style="margin:0 0 12px">Pick the item that is your card: same card number, same rarity (in brackets) and printing (1st Edition, or no mark for Unlimited). Fewer words find more.</p>' +
      '<div id="pcOut"><p class="small">Asking PriceCharting…</p></div>' +
      '<div class="form-actions"><button class="btn" type="button" id="pcNone">It isn\'t on PriceCharting</button><span class="spacer"></span>' +
      '<button class="link-btn" type="button" id="pcBack">' + (opts.back === "settings" ? "Back to Settings" : "Back to the card") + "</button></div>");
    $("pcBack").addEventListener("click", back);
    $("pcNone").addEventListener("click", () => {
      pcChoose(r, "none").then(() => { toast(r.name + " won't be looked for on PriceCharting; it uses your own PSA 10 value or the estimate."); back(); });
    });
    let items = [];
    const run = () => {
      const out = $("pcOut");
      if (!out) return;
      out.innerHTML = '<p class="small">Asking PriceCharting…</p>';
      pcSearch($("pcQ").value).then(list => {
        if (!$("pcOut")) return;
        items = list;
        const number = normNumber(r.number);
        // (the ones with your card number first)
        const sorted = list.map((it, i) => ({it, i, same: normNumber(String(it["product-name"] || "")).includes(number)})).sort((a, b) => b.same - a.same);
        out.innerHTML = !list.length ? '<div class="notice">PriceCharting found nothing for those words. Try fewer, like just the card number.</div>'
          : '<div class="pc-results">' + sorted.map(({it, i, same}) => {
            const raw = cents(it[PC_FIELDS.raw]), ten = cents(it[PC_FIELDS["10"]]);
            return '<div class="pc-item' + (same ? " same" : "") + '"><div><b>' + esc(it["product-name"]) + "</b>" +
              '<span class="small">' + esc(String(it["console-name"] || "").replace(/^yu-?gi-?oh!?\s*/i, "")) + (same ? " · your card number" : "") + "</span>" +
              '<span class="small">' + [raw != null ? "Ungraded " + esc(usd(raw)) : "", ten != null ? "PSA 10 " + esc(usd(ten)) : ""].filter(Boolean).join(" · ") + "</span></div>" +
              '<button class="btn btn-small" type="button" data-pc-pick="' + i + '">This is my card</button></div>';
          }).join("") + "</div>";
        out.querySelectorAll("[data-pc-pick]").forEach(b => b.addEventListener("click", () => {
          b.disabled = true;
          const it = items[+b.dataset.pcPick];
          pcChoose(r, it).then(p => {
            toast("Matched with PriceCharting: " + String(it["product-name"] || "") + (p && p["10"] != null ? ". PSA 10: " + usd(p["10"]) + "." : "."));
            if (settings.gradedView) renderSoon();
            back();
          }, e => { b.disabled = false; toast(e && e.name === "TokenError" ? "PriceCharting didn't accept your key (Settings)." : "Couldn't reach PriceCharting. Try again.", {kind: "error"}); });
        }));
      }, e => {
        if ($("pcOut")) $("pcOut").innerHTML = '<div class="notice">' + (e && e.name === "TokenError" ? "PriceCharting didn't accept your key (Settings)." : "Couldn't reach PriceCharting right now. Try again in a moment.") + "</div>";
      });
    };
    $("pcPickForm").addEventListener("submit", e => { e.preventDefault(); run(); });
    run();
  }
  const pcKnown = r => { const h = pcCache()[pcKey(r)]; return h && h.p ? h.p : null; };
  const pcOn = () => !!(settings.pcToken && settings.pcToken.trim());
  const pcBad = () => !!pc.bad && pc.bad === settings.pcToken;   // (a key that was refused; a new key starts over)
  async function refreshGradedPrices(force) {
    if (!pcOn() || pc.refreshing || pcBad()) return 0;
    const list = collection.filter(r => !r.sealed && normNumber(r.number) && !pcSkip(r)).filter(r => { const h = pcCache()[pcKey(r)]; return force || !h || Date.now() - h.t > (h.p ? PC_TTL : 3 * 86400000) || (!h.p && h.why === undefined); });   // (a miss kept before reasons were noted is asked again once)
    if (!list.length) return 0;
    pc.refreshing = true;
    let done = 0;
    try {
      const seen = new Set();
      for (const r of list) {
        if (seen.has(pcKey(r))) continue;
        seen.add(pcKey(r));
        try { await pcLookup(r, true); done++; }
        catch (e) { if (e && e.name === "TokenError") break; if (typeof navigator !== "undefined" && navigator.onLine === false) break; }
        if (done % 10 === 0 && settings.gradedView) renderSoon();
      }
    } finally { pc.refreshing = false; }
    if (done && settings.gradedView) renderSoon();
    return done;
  }
  // The share of a PSA 10 price that another grade gets (Settings), e.g. "9.5" -> 50%.
  function gradeShare(grade) {
    const g = num(String(grade || "").replace(/[^0-9.]/g, ""));
    if (g == null) return null;
    const key = g >= 10 ? "10" : g >= 9.5 ? "9.5" : g >= 9 ? "9" : g >= 8 ? "8" : g >= 7 ? "7" : "6";
    const pct = num(settings.gradePct[key]);
    return (pct == null ? DEFAULT_GRADE_PCT[key] : pct) / 100;
  }
  // The raw (Near Mint) market price, before any condition adjustment.
  const rawMarket = r => { const pi = priceInfo(r); return pi.unit != null && pi.from !== "manual" ? pi.unit : (r.manualPrice != null ? r.manualPrice : null); };
  // What one PSA 10 copy of this card is worth: your own figure, PriceCharting's, or an estimate.
  function psa10Value(r) {
    if (r.sealed) return null;
    if (r.g10 != null) return {unit: r.g10, from: "yours"};
    const p = pcKnown(r);
    if (p && p["10"] != null) return {unit: p["10"], from: "pricecharting", vol: p.vol, pc: p};
    const raw = rawMarket(r);
    if (raw == null) return null;
    const mult = num(settings.psa10Mult), floor = num(settings.psa10Floor);
    return {unit: round2(raw * (mult == null ? 4 : mult) + (floor == null ? 25 : floor)), from: "estimate", raw};
  }
  // The value of one copy as graded: cards you had graded count at their grade (the value you entered, else
  // PriceCharting's price for that grade, else a share of the PSA 10 value); the rest as PSA 10.
  function gradedValue(r) {
    if (r.sealed) return null;
    if (r.grade) {
      if (r.grade.value != null) return {unit: r.grade.value, from: "yours", grade: gradeLabel(r.grade)};
      const p = pcKnown(r), g = num(String(r.grade.grade || "").replace(/[^0-9.]/g, ""));
      const co = String(r.grade.company || "").toUpperCase();
      if (p && g != null) {
        const key = g >= 10 ? (co === "BGS" ? "bgs10" : co === "CGC" ? "cgc10" : co === "SGC" ? "sgc10" : "10") : g >= 9.5 ? "9.5" : g >= 9 ? "9" : g >= 8 ? "8" : g >= 7 ? "7" : null;
        if (key && p[key] != null) return {unit: p[key], from: "pricecharting", grade: gradeLabel(r.grade), vol: p.vol};
      }
      const ten = psa10Value(r), share = gradeShare(r.grade.grade);
      if (ten && share != null) return {unit: round2(ten.unit * share), from: ten.from === "pricecharting" ? "share" : "estimate", grade: gradeLabel(r.grade), share};
      return ten ? Object.assign({}, ten, {grade: gradeLabel(r.grade)}) : null;
    }
    return psa10Value(r);
  }
  // In the PSA 10 view: one copy of each printing (graded copies you own count as they are), so you see what a
  // gem-mint set of your collection would be worth.
  function gradedTotals(list) {
    let value = 0, copies = 0, unpriced = 0, est = 0;
    const seen = new Set();
    for (const r of list) {
      if (r.sealed) continue;
      const n = r.grade ? r.qty : 1;
      if (!r.grade) { const k = printingKey(r); if (seen.has(k)) continue; seen.add(k); }
      const gv = gradedValue(r);
      copies += n;
      if (!gv) unpriced += n; else { value += gv.unit * n; if (gv.from === "estimate") est += n; }
    }
    return {value, copies, unpriced, est};
  }
  const gradedShort = gv => !gv ? "" : gv.from === "estimate" ? "est." : gv.from === "yours" ? "yours" : gv.from === "share" ? "est." : "";

