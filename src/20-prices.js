  /* ======================= TCGplayer catalog ======================= */
  function pushMap(map, key, value) {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(value); else map.set(key, [value]);
  }
  function buildCatalog(raw) {
    if (!raw || !Array.isArray(raw.products) || !raw.products.length) return null;
    const groups = (raw.groups || []).map(g => ({id: g[0], name: g[1] || "", abbr: g[2] || "", published: g[3] || ""}));
    const rarities = raw.rarities || [];
    const subtypes = raw.subtypes || [];
    const byId = new Map();
    const products = new Array(raw.products.length);
    // Format 2 adds the market price on three earlier days to each price entry: [subtype, market, low, m1, m7, m30].
    const stride = raw.format >= 2 ? 6 : 3;
    const val = v => (typeof v === "number" && isFinite(v)) ? v : null;
    for (let i = 0; i < raw.products.length; i++) {
      const row = raw.products[i];
      const prices = {};
      const pr = row[5] || [];
      for (let j = 0; j + stride - 1 < pr.length; j += stride) {
        const st = subtypes[pr[j]];
        if (!st) continue;
        const e = {market: val(pr[j + 1]), low: val(pr[j + 2])};
        if (stride === 6) { e.m1 = val(pr[j + 3]); e.m7 = val(pr[j + 4]); e.m30 = val(pr[j + 5]); }
        prices[st] = e;
      }
      const p = {id: row[0], group: groups[row[1]] || {id: null, name: "", published: ""}, name: row[2] || "", number: row[3] || "",
        rarity: rarities[row[4]] || "", prices, sealed: row[6] === 1};
      if (row[7] === 1) p.noImg = true;   // (format 4) TCGplayer has no photo of it
      p.nameLower = p.name.toLowerCase();
      products[i] = p;
      byId.set(p.id, p);
    }
    rarities.forEach(r => r && rarityLookup.add(r.toLowerCase()));
    const generated = parseDate(raw.generated);
    const h = raw.history || {};
    const day = s => parseDay(s) ? s : null;
    const cat = {generated, builtAt: raw.builtAt || raw.generated || "", groups, products, byId,
      rarities: rarities.filter(Boolean),
      // The TCGplayer price day (UTC, like the updater's snapshot names) and the days the older prices are from.
      priceDay: generated ? utcDay(generated) : null,
      refDays: {m1: day(h.d1), m7: day(h.d7), m30: day(h.d30)}};
    // (by card number, and by number loosely: worked out the first time something looks a number up, not while opening)
    let numbers = null;
    const byNumbers = () => {
      if (!numbers) {
        numbers = {byNumber: new Map(), byLoose: new Map()};
        for (const p of products) { pushMap(numbers.byNumber, normNumber(p.number), p); pushMap(numbers.byLoose, looseNumber(p.number), p); }
      }
      return numbers;
    };
    Object.defineProperty(cat, "byNumber", {get: () => byNumbers().byNumber, enumerable: true});
    Object.defineProperty(cat, "byLoose", {get: () => byNumbers().byLoose, enumerable: true});
    return cat;
  }
  function productsByGroup() {
    if (!catalog.byGroup) {
      catalog.byGroup = new Map();
      for (const p of catalog.products) pushMap(catalog.byGroup, p.group.id, p);
    }
    return catalog.byGroup;
  }
  const sortPrintings = list => list.slice().sort((a, b) =>
    (b.group.published || "").localeCompare(a.group.published || "") || a.name.localeCompare(b.name));
  function findByNumber(q) {
    if (!catalog || !q) return [];
    const exact = catalog.byNumber.get(normNumber(q));
    if (exact && exact.length) return sortPrintings(exact);
    return sortPrintings(catalog.byLoose.get(looseNumber(q)) || []);
  }
  function searchByName(q, limit) {
    const needle = String(q || "").trim().toLowerCase();
    if (!catalog || needle.length < 2) return {items: [], more: false};
    const starts = [], contains = [];
    for (const p of catalog.products) {
      if (p.sealed) continue;
      const at = p.nameLower.indexOf(needle);
      if (at === 0) starts.push(p); else if (at > 0) contains.push(p);
    }
    const all = starts.concat(contains);
    return {items: all.slice(0, limit), more: all.length > limit, total: all.length};
  }
  const EDITION_ORDER = ["1st Edition", "Unlimited", "Limited"];
  function printingsFor(product) {
    const keys = Object.keys(product.prices);
    return keys.sort((a, b) => {
      const ia = EDITION_ORDER.indexOf(a), ib = EDITION_ORDER.indexOf(b);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.localeCompare(b);
    });
  }
  function catalogPrice(product, edition) {
    if (!product) return null;
    const keys = Object.keys(product.prices);
    if (!keys.length) return null;
    let sub = product.prices[edition];
    if (!sub && edition === "No edition mark") sub = product.prices.Normal;
    if (!sub && keys.length === 1) sub = product.prices[keys[0]];
    if (!sub && product.sealed) sub = product.prices.Normal || product.prices[keys[0]];
    return sub || null;
  }

  /* ======================= Prices & totals ======================= */
  function priceInfo(r) {
    if (catalog && r.productId) {
      const sub = catalogPrice(catalog.byId.get(r.productId), r.edition);
      if (sub && (sub.market != null || sub.low != null)) {
        return {unit: sub.market != null ? sub.market : sub.low, kind: sub.market != null ? "market" : "low", from: "tcgplayer"};
      }
    }
    if (r.snap && (r.snap.market != null || r.snap.low != null)) {
      return {unit: r.snap.market != null ? r.snap.market : r.snap.low, kind: r.snap.market != null ? "market" : "low",
        from: "saved", date: parseDate(r.snap.date)};
    }
    // A Japanese or Korean sealed product from a shop (Yugi-Market, Bunjang): the shop's price now, like TCGplayer's for an
    // English one; the last price seen while the shop can't be reached; your own value if you entered one.
    if (r.sealed && r.ref) {
      if (r.manualPrice != null) return {unit: r.manualPrice, kind: "estimate", from: "manual"};
      const live = shopWantLive(r);
      if (live != null) return {unit: live, kind: "market", from: "shop", src: r.shop, link: r.link, soldOut: shopWantSoldOut(r)};
      const kept = shopKept()[r.ref], last = kept && kept.usd > 0 ? kept.usd : r.shopPrice;
      if (last != null) return {unit: last, kind: "market", from: "shop", src: r.shop, link: r.link, note: "as of last time", kept: true};
    }
    // Japanese and Korean cards: BIGWEB's or Bunjang's price (in US$) when there is one, like TCGplayer's for English
    // cards; your own estimate or ¥/₩ price only while there isn't.
    const g = isOcg(r) ? ocgRegion(r.number) : null;
    if (g) {
      const op = ocgPrice(r);
      if (op && op.usd != null) return {unit: op.usd, kind: "market", from: "ocg", local: op.local, cur: op.cur, src: op.src, note: op.note, at: op.at, url: op.url};
      // today's list hasn't come in yet (the first moments after opening): the price it gave last time stands in for it
      const kept = ocgKeptPrice(r, g);
      if (kept) return {unit: kept.usd, kind: "market", from: "ocg", src: kept.src, note: "as of last time", at: kept.at, kept: true};
    }
    if (r.manualPrice != null) return {unit: r.manualPrice, kind: "estimate", from: "manual"};
    if (g) {
      const cur = g.region === "JP" ? "JPY" : "KRW", mine = g.region === "JP" ? r.jp : r.kr;
      const u = mine != null ? toUSD(mine, cur) : null;
      if (u != null) return {unit: u, kind: "estimate", from: "local", local: mine, cur};
    }
    return {unit: null};
  }
  // TCGplayer's market price reflects Near Mint copies; played copies are valued at a share of it.
  function conditionFactor(r) {
    if (!settings.condAdjust || r.grade) return 1;
    const pct = num(settings.condPct[r.condition]);
    return pct == null ? 1 : Math.min(Math.max(pct, 0), 1000) / 100;
  }
  // What one copy is worth: the graded value you entered, else TCGplayer's market price adjusted for
  // condition, else a saved or estimated price. Prices from a TCGplayer CSV are already for that
  // exact condition, and your own estimates are used as-is, so only live TCGplayer prices get adjusted.
  function marketValue(r) {
    if (r.grade && r.grade.value != null) return {unit: r.grade.value, kind: "graded", from: "graded", raw: r.grade.value, factor: 1};
    const pi = priceInfo(r);
    if (pi.unit == null) return pi;
    const f = pi.from === "tcgplayer" || pi.from === "ocg" ? conditionFactor(r) : 1;
    return Object.assign({}, pi, {raw: pi.unit, factor: f, unit: f === 1 ? pi.unit : round2(pi.unit * f)});
  }
  function unitValue(r) {
    if (settings.gradedView) { const gv = gradedValue(r); return gv ? gv.unit : null; }
    return settings.basis === "paid" ? (r.paid != null ? r.paid : null) : marketValue(r).unit;
  }
  // How this copy's value moved since an earlier TCGplayer price day (ref: m1, m7 or m30).
  function changeFor(r, ref) {
    if (r.grade && r.grade.value != null) return null;
    if (isOcg(r)) return ocgChangeFor(r, ref);
    if (!catalog || !r.productId) return null;
    const sub = catalogPrice(catalog.byId.get(r.productId), r.edition);
    if (!sub || sub.market == null || sub[ref] == null) return null;
    const f = conditionFactor(r);
    const now = sub.market * f, then = sub[ref] * f;
    return {now, then, diff: now - then, pct: then > 0 ? (now - then) / then : null, marketNow: sub.market, marketThen: sub[ref]};
  }
  function periodChange(ref, list) {
    let now = 0, then = 0, covered = 0;
    const movers = [];
    for (const r of list || collection) {
      const ch = changeFor(r, ref);
      if (!ch) continue;
      now += ch.now * r.qty;
      then += ch.then * r.qty;
      covered += r.qty;
      if (Math.abs(ch.diff) >= 0.005) movers.push({r, ch, total: ch.diff * r.qty});
    }
    return {diff: now - then, pct: then > 0 ? (now - then) / then : null, covered, movers};
  }
  // valueOf: how one copy is valued (what the collection shows, unless told otherwise).
  function totals(list, valueOf) {
    valueOf = valueOf || unitValue;
    let value = 0, cards = 0, unpriced = 0, paid = 0, paidMarket = 0, paidCards = 0, jp = 0, kr = 0;
    for (const r of list) {
      const u = valueOf(r);
      cards += r.qty;
      if (u == null) unpriced += r.qty; else value += u * r.qty;
      if (r.paid != null) {
        paid += r.paid * r.qty;
        paidCards += r.qty;
        const m = marketValue(r).unit;
        if (m != null) paidMarket += m * r.qty;
      }
      if (r.jp != null) jp += r.jp * r.qty;
      if (r.kr != null) kr += r.kr * r.qty;
    }
    return {value, cards, unpriced, paid, paidMarket, paidCards, jp, kr};
  }

  /* ======================= Records ======================= */
  // Copies merge only when everything about them matches, including where they're kept and any grading.
  function recordKey(r) {
    const base = r.productId
      ? ["p", r.productId, r.edition, r.condition, r.language]
      : r.ref ? ["s", r.ref, r.manualPrice == null ? "" : r.manualPrice, r.condition, r.language]   // (a shop's sealed product: its own value is part of what it is)
      : ["n", normNumber(r.number), r.name.toLowerCase(), r.rarity, r.edition, r.condition, r.language];
    return base.concat([(r.location || "").toLowerCase(),
      r.grade ? [r.grade.company, r.grade.grade, r.grade.cert].join("/").toLowerCase() : "",
      r.grading ? "away:" + r.id : ""]).join("|");   // (a copy at the grader stays on its own line)
  }
  // (one collator for every sort of names: "Binder 2" before "Binder 10")
  const NATURAL = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
  const allLocations = () => Array.from(new Set(collection.map(r => r.location).filter(Boolean))).sort(NATURAL.compare);

  /* ======================= Value history ======================= */
  // One point per TCGplayer price day: the collection's market value (condition-adjusted) and card count.
  function recordValueHistory() {
    if (!catalog || !catalog.priceDay) return false;
    if (!collection.length && !valueHistory.length) return false;
    let v = 0, c = 0;
    for (const r of collection) {
      const u = marketValue(r).unit;
      if (u != null) v += u * r.qty;
      c += r.qty;
    }
    v = round2(v);
    const day = catalog.priceDay;
    const last = valueHistory[valueHistory.length - 1];
    if (last && last.d === day) {
      if (last.v === v && last.c === c) return false;
      last.v = v; last.c = c;
    } else if (last && last.d > day) {
      return false;  // an older price file than one already recorded: leave the history alone
    } else {
      valueHistory.push({d: day, v, c});
      if (valueHistory.length > 1100) valueHistory.splice(0, valueHistory.length - 1100);
    }
    return true;
  }
  // The collection's value on an earlier price day, for the cards you have now (cards with no older price count as unchanged).
  function collectionValueAt(ref) {
    let value = 0, covered = 0, priced = 0, cards = 0;
    for (const r of collection) {
      const u = marketValue(r).unit;
      cards += r.qty;
      if (u == null) continue;
      priced += r.qty;
      const ch = changeFor(r, ref);
      if (ch) { value += ch.then * r.qty; covered += r.qty; } else value += u * r.qty;
    }
    return {value, cards, coverage: priced ? covered / priced : 0};
  }
  // Recorded points, plus estimates for the updater's comparison days before recording began.
  function historySeries() {
    const pts = valueHistory.map(p => ({d: p.d, date: parseDay(p.d), v: p.v, c: p.c}));
    if (catalog && collection.length) {
      const first = pts.length ? pts[0].d : null;
      for (const [key] of PERIODS) {
        const day = catalog.refDays[key];
        if (!day || (first && day >= first) || pts.some(p => p.d === day)) continue;
        const est = collectionValueAt(key);
        if (est.coverage >= 0.5) pts.push({d: day, date: parseDay(day), v: round2(est.value), c: est.cards, est: true});
      }
    }
    return pts.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  }
  /* ----- Photos ----- */
  // Every photo slot gets a list to try in order: the item's own photo, then stand-ins (marked with "~"): another
  // printing of the same card; for a sealed product, a similar one from the same set (the 1st Edition box for an
  // Unlimited one, the booster box for a case) or, for a Field Center Token, its card; then, on the website, a copy of
  // the card's picture kept with the site (for cards TCGplayer has no photo of yet). If none loads, imgTag's error
  // handler draws a card or box with the name. The price data marks the products TCGplayer has no photo of (noImg).
  const hasPhoto = p => !!p && p.noImg !== true;
  const HOSTED_PICS = (() => { try { return SITE ? new URL("card-images/", location.href).href : ""; } catch (e) { return ""; } })();
  const hostedPhoto = key => HOSTED_PICS && key ? "~" + HOSTED_PICS + key + ".jpg" : "";
  const isHostedPhoto = u => !!HOSTED_PICS && String(u).startsWith(HOSTED_PICS) && /^[a-z0-9]{1,150}\.jpg$/.test(String(u).slice(HOSTED_PICS.length));
  // A card's plain name, without TCGplayer's tags however many ("X (Starlight Rare) (Extended Art)" is X), as a key.
  const plainName = n => { let s = String(n || "").trim(), t; while ((t = lookupName(s)) !== s) s = t; return s; };
  const photoKey = n => plainName(n).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  function photosByName() {
    if (!catalog.byPhoto) {
      catalog.byPhoto = new Map();
      for (const p of catalog.products) if (!p.sealed) pushMap(catalog.byPhoto, photoKey(p.name), p);
    }
    return catalog.byPhoto;
  }
  const KIND_ONE = {pack: "Booster pack", box: "Booster box", case: "Case", structure: "Structure Deck", se: "Special Edition",
    de: "Deluxe Edition", tin: "Tin", boxset: "Box set", starter: "Starter deck", other: "Sealed product"};
  // Products a sealed product's photo can stand in for, closest first.
  const KIND_NEAR = {case: ["box", "pack"], box: ["case", "pack"], pack: ["box"], se: ["pack", "box"], de: ["box", "pack"], tin: ["pack"]};
  const anyPrintingPhoto = key => !!catalog && (photosByName().get(key) || []).some(hasPhoto);
  // The same card's other printings with a TCGplayer photo, the same rarity first.
  function printingPhotos(key, rarity, exceptId, size, max) {
    if (!catalog || !key) return [];
    const r = String(rarity || "").toLowerCase();
    const same = q => q.rarity.toLowerCase() === r ? 1 : 0;
    return (photosByName().get(key) || []).filter(q => q.id !== exceptId && hasPhoto(q))
      .sort((a, b) => same(b) - same(a)).slice(0, max || 2).map(q => "~" + tcgImg(q.id, size));
  }
  // The card a token names: "Field Center Token: Dracotail Urgula", "Token: Kaiba & Blue-Eyes Ultimate Dragon",
  // 'Token: Kite and "Number 62: Galaxy-Eyes Prime Photon Dragon"'. Its photo, if any printing has one.
  function tokenCardPhotos(name, size) {
    const m = /token:\s*(.+)$/i.exec(name || "");
    if (!m) return [];
    const quoted = /"([^"]+)"/.exec(m[1]), parts = m[1].split(/\s+(?:&|and)\s+/i);
    for (const card of [quoted && quoted[1], parts.length > 1 && parts.slice(1).join(" & "), m[1]]) {
      const got = card ? printingPhotos(photoKey(card), "", 0, size, 1) : [];
      if (got.length) return got;
    }
    return [];
  }
  // The same product in another print run: "[Unlimited]" for "[1st Edition]", "(2020 Date Reprint)" for the original.
  const sealedKey = n => photoKey(String(n || "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " "));
  function sealedByName() {
    if (!catalog.bySealed) {
      catalog.bySealed = new Map();
      for (const p of catalog.products) if (p.sealed) pushMap(catalog.bySealed, sealedKey(p.name), p);
    }
    return catalog.bySealed;
  }
  function sealedPhotos(p, size) {
    const sameGroup = q => q.group.id === p.group.id ? 1 : 0;
    const out = (sealedByName().get(sealedKey(p.name)) || []).filter(q => q.id !== p.id && hasPhoto(q))
      .sort((a, b) => sameGroup(b) - sameGroup(a)).slice(0, 2).map(q => "~" + tcgImg(q.id, size));
    out.push(...tokenCardPhotos(p.name, size));
    // an oversized card or other single-card item named after its card ("Winged Kuriboh LV10")
    if (!out.length && mkKind(p.name) === "other") out.push(...printingPhotos(photoKey(p.name), "", 0, size, 1));
    const near = [mkKind(p.name)].concat(KIND_NEAR[mkKind(p.name)] || []);
    if (near[0] === "other") return out;
    const words = new Set(p.nameLower.split(/[^a-z0-9]+/));
    const shared = q => q.nameLower.split(/[^a-z0-9]+/).filter(w => words.has(w)).length;
    const rank = q => near.indexOf(mkKind(q.name));
    const list = (productsByGroup().get(p.group.id) || []).filter(q => q.sealed && q.id !== p.id && hasPhoto(q) && rank(q) >= 0)
      .sort((a, b) => rank(a) - rank(b) || shared(b) - shared(a));
    return Array.from(new Set(out.concat(list.slice(0, 3).map(q => "~" + tcgImg(q.id, size))))).slice(0, 3);
  }
  // The set's most valuable card with a photo, for the middle of a drawn box.
  function setArt(groupId) {
    if (!catalog || groupId == null) return "";
    const memo = catalog.setArt || (catalog.setArt = new Map());
    if (!memo.has(groupId)) {
      let best = 0, top = -1;
      for (const q of productsByGroup().get(groupId) || []) {
        if (q.sealed || !hasPhoto(q)) continue;
        let v = 0;
        for (const ed in q.prices) v = Math.max(v, q.prices[ed].market || 0);
        if (v > top) { top = v; best = q.id; }
      }
      memo.set(groupId, best);
    }
    return memo.get(groupId) ? tcgImg(memo.get(groupId), "200w") : "";
  }
  function productPics(p, size) {
    if (!p) return {list: []};
    const list = hasPhoto(p) ? [tcgImg(p.id, size)] : [];
    if (p.sealed) {
      const kind = mkKind(p.name);
      return {list: list.concat(sealedPhotos(p, size)), sub: [KIND_ONE[kind], p.group.abbr].filter(Boolean).join(" · "), art: kind === "other" ? "" : setArt(p.group.id)};
    }
    const key = photoKey(p.name);
    list.push(...printingPhotos(key, p.rarity, p.id, size, 2));
    if (!anyPrintingPhoto(key)) list.push(...tokenCardPhotos(p.name, size), hostedPhoto(key));
    return {list, sub: [p.number, p.rarity].filter(Boolean).join(" · ")};
  }
  function recordPics(r, size) {
    const own = safeImg(r.customImage);
    const p = r.productId && catalog ? catalog.byId.get(r.productId) : null;
    // (a card in another language: its own language's print before TCGplayer's English photo)
    if (p) { const pp = productPics(p, size), lp = printPicOf(r); return {list: [own, lp && lp.u ? lp.u : ""].concat(pp.list), sub: pp.sub, art: pp.art}; }
    if (r.sealed && r.ref) return shopSealedPics(r, own);
    // (a photo kept from BIGWEB, whose server may not answer, after the list's own: the website's copy of the scan)
    const shopOwn = /^https:\/\/image\.bigweb\.co\.jp\//.test(own);
    const list = shopOwn ? [ocgImage(r), own, r.productId ? tcgImg(r.productId, size) : ""] : [own, r.productId ? tcgImg(r.productId, size) : "", ocgImage(r)];
    if (!r.sealed) {
      const key = photoKey(r.name);
      list.push(...printingPhotos(key, r.rarity, 0, size, 2));
      if (!anyPrintingPhoto(key)) list.push(hostedPhoto(key));
    }
    return {list, sub: r.sealed ? "Sealed product" : [r.number, r.rarity].filter(Boolean).join(" · ")};
  }
  // A sale keeps the photo it had when sold; the product's photos (or the card's) back it up.
  function salePics(x) {
    const p = x.productId && catalog ? catalog.byId.get(x.productId) : null;
    return {list: [x.image].concat(p ? productPics(p, "200w").list : x.record && x.record.sealed ? [] : namePics(x.name, "200w", x.rarity).list),
      sub: p ? productPics(p, "200w").sub : ""};
  }
  // A card known only by name (a want without a printing, a deck list line): any printing's photo is its photo.
  function namePics(name, size, rarity) {
    const key = photoKey(name);
    const list = printingPhotos(key, rarity, 0, size, 2);
    if (list.length) list[0] = list[0].slice(1);
    const hosted = anyPrintingPhoto(key) ? "" : hostedPhoto(key);
    if (hosted) list.push(list.length ? hosted : hosted.slice(1));
    return {list};
  }
  // The first photo that works outside this page (the phone copy, a sale's record, a printed report).
  const firstPhoto = pics => (pics.list || []).map(u => String(u || "").replace(/^~/, "")).find(u => /^(https?:|data:image\/)/i.test(u)) || "";
  const imageFor = (r, size) => firstPhoto(recordPics(r, size));
  function snapFromCatalog(product, edition) {
    const sub = catalogPrice(product, edition);
    return sub ? {market: sub.market, low: sub.low, date: catalog && catalog.generated ? catalog.generated.toISOString() : new Date().toISOString()} : null;
  }
  function addOrMerge(rec) {
    lastAddAt = Date.now();   // (a set goal finished just now gets a message)
    const key = recordKey(rec);
    const existing = collection.find(r => recordKey(r) === key);
    if (existing) {
      existing.qty += rec.qty;
      if (rec.paid != null && existing.paid == null) existing.paid = rec.paid;
      if (rec.notes && !existing.notes) existing.notes = rec.notes;
      return {merged: true, record: existing};
    }
    collection.push(rec);
    return {merged: false, record: rec};
  }
  // Records added by hand (no TCGplayer product yet) get linked automatically when
  // their card number and rarity point to exactly one English TCGplayer printing.
  function autoLink() {
    if (!catalog) return 0;
    let linked = 0;
    for (const r of collection) {
      if (r.productId || !r.number || r.language !== "English" || r.customImage) continue;
      let cands = catalog.byNumber.get(normNumber(r.number)) || [];
      if (cands.length > 1 && r.rarity) cands = cands.filter(p => p.rarity.toLowerCase() === r.rarity.toLowerCase());
      if (cands.length === 1) {
        const p = cands[0];
        r.productId = p.id;
        r.productName = p.name;
        if (!r.setName) r.setName = p.group.name;
        if (!r.rarity) r.rarity = p.rarity;
        linked++;
      }
    }
    return linked;
  }

