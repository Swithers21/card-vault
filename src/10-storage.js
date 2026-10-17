  /* ======================= Storage ======================= */
  function upgradeRecord(r) {
    if (!r || typeof r !== "object" || !r.name) return null;
    const n = v => (v === "" || v == null) ? null : num(v);
    const out = {
      id: r.id || newId(),
      productId: idOrNull(r.productId),
      sku: r.sku ? String(r.sku) : null,
      name: String(r.name),
      productName: String(r.productName || r.name),
      setName: String(r.setName || ""),
      number: String(r.number || ""),
      rarity: String(r.rarity || ""),
      edition: String(r.edition || ""),
      condition: String(r.condition || "Near Mint"),
      language: String(r.language || "English"),
      qty: posInt(r.qty) || 1,
      paid: n(r.paid), manualPrice: n(r.manualPrice), jp: n(r.jp), kr: n(r.kr),
      customImage: safeImg(r.customImage) || null,
      snap: r.snap && typeof r.snap === "object" ? {market: n(r.snap.market), low: n(r.snap.low), date: r.snap.date || null} : null,
      location: String(r.location || "").trim(),
      grade: normalizeGrade(r.grade),
      sealed: !!r.sealed,
      g10: n(r.g10),   // your own PSA 10 value for this card, if you entered one
      grading: normGrading(r.grading),   // at a grading company: {company, sent, order, cost, level, days, raw}
      gradeResult: normGradeResult(r.gradeResult),   // how its grading went, once it was back
      notes: String(r.notes || ""),
      sell: normSell(r.sell),       // on your sell list: {price: your asking price each (or null), qty: how many (null: all), since}
      photos: normPhotos(r.photos), // your own photos of this copy, kept in your Google Drive: [{id, side, at}]
      added: r.added || new Date().toISOString(),
      mod: modTime(r.mod)
    };
    // The PriceCharting item you matched it with yourself (its id), or "none": it isn't on PriceCharting
    const pcId = String(r.pcId || "");
    if (/^(none|\d{1,12})$/.test(pcId) && !out.sealed) out.pcId = pcId;
    // A Japanese or Korean sealed product bought from a shop in the Market (Yugi-Market, Bunjang) keeps which product it
    // is (ref), where to see it (link) and the price it had when added: its value follows the shop's price from then on.
    if (r.sealed && r.ref && !out.productId) {
      out.ref = String(r.ref).slice(0, 300);
      out.shop = String(r.shop || "").slice(0, 60);
      out.link = /^https:\/\/[^\s"'<>]+$/i.test(String(r.link || "")) ? String(r.link) : "";
      const sp = n(r.shopPrice);
      out.shopPrice = sp != null && sp > 0 ? sp : null;
    }
    return out;
  }
  function normSell(x) {
    if (!x || typeof x !== "object") return null;
    const price = num(x.price);
    return {price: price != null && price >= 0 ? round2(price) : null, qty: posInt(x.qty) || null, since: String(x.since || "") || new Date().toISOString()};
  }
  const PHOTO_SIDES = ["front", "back"];
  function normPhotos(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const p of list) {
      if (!p || typeof p !== "object" || !/^[A-Za-z0-9_-]{10,200}$/.test(String(p.id || ""))) continue;
      const side = PHOTO_SIDES.includes(p.side) ? p.side : "front";
      if (out.some(x => x.side === side)) continue;   // (one of each side)
      out.push({id: String(p.id), side, at: String(p.at || "")});
    }
    return out.length ? out : null;
  }
  // A box or pack you opened: what it was, what you paid, and the cards that came out (as they were when added; the
  // cards also went into your collection). Their value now is worked out from today's prices.
  function upgradeOpening(o) {
    if (!o || typeof o !== "object" || !String(o.name || "").trim()) return null;
    const n = v => (v === "" || v == null) ? null : num(v);
    const pulls = (Array.isArray(o.pulls) ? o.pulls : []).filter(x => x && typeof x === "object" && x.name).map(x => ({
      name: String(x.name), productId: idOrNull(x.productId), number: String(x.number || ""), rarity: String(x.rarity || ""), setName: String(x.setName || ""),
      edition: String(x.edition || ""), condition: String(x.condition || "Near Mint"), language: String(x.language || "English"), qty: posInt(x.qty) || 1,
      value: n(x.value), image: safeImg(x.image) || ""}));
    return {id: o.id || newId(), date: parseDay(o.date) ? String(o.date) : localDay(new Date()), name: String(o.name).trim(), productId: idOrNull(o.productId),
      setName: String(o.setName || ""), kind: String(o.kind || ""), packs: posInt(o.packs) || null, cost: n(o.cost), notes: String(o.notes || ""),
      pulls, added: o.added || new Date().toISOString(), mod: modTime(o.mod)};
  }
  const modTime = v => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  function normalizeGrade(g) {
    if (!g || typeof g !== "object" || !String(g.company || "").trim()) return null;
    return {company: String(g.company).trim(), grade: String(g.grade || "").trim(), cert: String(g.cert || "").trim(),
      value: (g.value === "" || g.value == null) ? null : num(g.value)};
  }
  const gradeLabel = g => g ? (g.company + (g.grade ? " " + g.grade : "")).trim() : "";
  // Want list entries are cards, or sealed products: kind "box", "pack" or "sealed" (decks, tins, collections...).
  // Ones added from a shop in the Market (Yugi-Market, Bunjang) keep where they're from: ref (which product), a link,
  // a photo and the shop's price when added.
  const WANT_KINDS = ["card", "box", "pack", "sealed"];
  function upgradeWant(w) {
    if (!w || typeof w !== "object" || !w.name) return null;
    const out = {id: w.id || newId(), productId: idOrNull(w.productId), name: String(w.name), productName: String(w.productName || w.name),
      setName: String(w.setName || ""), number: String(w.number || ""), rarity: String(w.rarity || ""),
      edition: String(w.edition || "Any"), target: (w.target === "" || w.target == null) ? null : num(w.target),
      qty: posInt(w.qty) || 1, notes: String(w.notes || ""), added: w.added || new Date().toISOString(), mod: modTime(w.mod)};
    if (WANT_KINDS.includes(w.kind) && w.kind !== "card") out.kind = w.kind;
    if (w.ref) {
      out.ref = String(w.ref).slice(0, 300);
      out.shop = String(w.shop || "").slice(0, 60);
      out.link = /^https:\/\/[^\s"'<>]+$/i.test(String(w.link || "")) ? String(w.link) : "";
      out.image = safeImg(w.image);
      const sp = (w.shopPrice === "" || w.shopPrice == null) ? null : num(w.shopPrice);
      out.shopPrice = sp != null && sp > 0 ? sp : null;
    }
    return out;
  }
  function upgradeDeck(k) {
    if (!k || typeof k !== "object" || !String(k.text || "").trim()) return null;
    return {id: k.id || newId(), name: String(k.name || "Untitled deck").trim() || "Untitled deck", text: String(k.text), updated: k.updated || new Date().toISOString(),
      mod: modTime(k.mod)};
  }
  function upgradeSale(x) {
    if (!x || typeof x !== "object" || !x.name) return null;
    const n = v => (v === "" || v == null) ? null : num(v);
    return {id: x.id || newId(), date: parseDay(x.date) ? x.date : localDay(new Date()), qty: posInt(x.qty) || 1, price: n(x.price) || 0,
      fees: n(x.fees) || 0, notes: String(x.notes || ""), name: String(x.name), productId: idOrNull(x.productId), number: String(x.number || ""),
      setName: String(x.setName || ""), rarity: String(x.rarity || ""), edition: String(x.edition || ""), condition: String(x.condition || ""),
      language: String(x.language || ""), grade: normalizeGrade(x.grade), paid: n(x.paid), market: n(x.market), image: safeImg(x.image),
      record: x.record && typeof x.record === "object" ? x.record : null, traded: !!x.traded, mod: modTime(x.mod)};
  }
  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  let loadProblem = false;  // the saved collection couldn't be read; a copy was kept aside
  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { storageOK = false; }
    try {
      const arr = raw ? JSON.parse(raw) : [];
      collection = Array.isArray(arr) ? arr.map(upgradeRecord).filter(Boolean) : [];
    } catch (e) {
      // Don't let a later save (or the backup file) overwrite it with an empty collection.
      loadProblem = true;
      collection = [];
      try { localStorage.setItem(STORE_KEY + ".unreadable-" + Date.now(), raw); } catch (e2) { /* no room for the copy */ }
    }
    try {
      const w = readJSON(WANTS_KEY, []);
      wants = Array.isArray(w) ? w.map(upgradeWant).filter(Boolean) : [];
      const dk = readJSON(DECKS_KEY, []);
      decks = Array.isArray(dk) ? dk.map(upgradeDeck).filter(Boolean) : [];
      const sl = readJSON(SALES_KEY, []);
      sales = Array.isArray(sl) ? sl.map(upgradeSale).filter(Boolean) : [];
      const op = readJSON(OPENINGS_KEY, []);
      openings = Array.isArray(op) ? op.map(upgradeOpening).filter(Boolean) : [];
      const h = readJSON(HISTORY_KEY, []);
      valueHistory = Array.isArray(h) ? h.filter(p => p && parseDay(p.d) && isFinite(p.v)) : [];
      deleted = cleanDeleted(readJSON(DELETED_KEY, {}));
      const s = readJSON(SETTINGS_KEY, {});
      if (s && typeof s === "object") settings = Object.assign(settings, s);
      settings.condPct = Object.assign({}, DEFAULT_COND_PCT, s && s.condPct);
      settings.gradePct = Object.assign({}, DEFAULT_GRADE_PCT, s && s.gradePct);
      if (!TABS.includes(settings.tab)) settings.tab = "collection";
      if (!PERIODS.some(p => p[0] === settings.histPeriod)) settings.histPeriod = "m7";
      if (settings.sort) {  // settings saved by the first version of this sort menu
        const old = {"price-desc": ["price", "desc"], "price-asc": ["price", "asc"], "name": ["name", "asc"], "set": ["set", "asc"],
          "number": ["number", "asc"], "added": ["added", "desc"]}[settings.sort];
        if (old) { settings.sortField = old[0]; settings.sortDir = old[1]; }
        delete settings.sort;
      }
      if (!SORT_FIELDS[settings.sortField]) settings.sortField = "price";
      if (settings.sortDir !== "asc" && settings.sortDir !== "desc") settings.sortDir = SORT_FIELDS[settings.sortField].def;
    } catch (e) {
      storageOK = false;
    }
    rebuildPrints();
  }

  /* ----- change tracking, for syncing devices through the backup file ----- */
  const listOf = k => k === "collection" ? collection : k === "wants" ? wants : k === "decks" ? decks : k === "openings" ? openings : sales;
  function setListOf(k, list) { if (k === "collection") collection = list; else if (k === "wants") wants = list; else if (k === "decks") decks = list; else if (k === "openings") openings = list; else sales = list; }
  const upgradeOf = k => k === "collection" ? upgradeRecord : k === "wants" ? upgradeWant : k === "decks" ? upgradeDeck : k === "openings" ? upgradeOpening : upgradeSale;
  const printOf = x => JSON.stringify(x, (key, v) => key === "mod" ? undefined : v);
  function hashText(t) {   // FNV-1a, as a short id
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  const sharedPrint = () => JSON.stringify(SHARED_SETTINGS.map(k => settings[k]));
  // Deletions are remembered for a little over a year.
  function cleanDeleted(d) {
    const out = {collection: {}, wants: {}, decks: {}, sales: {}, openings: {}};
    const oldest = Date.now() - 400 * 86400000;
    if (d && typeof d === "object") {
      for (const k of SYNC_KINDS) {
        const src = d[k];
        if (!src || typeof src !== "object") continue;
        for (const [id, t] of Object.entries(src)) { const n = modTime(t); if (n > oldest) out[k][id] = n; }
      }
    }
    return out;
  }
  function rebuildPrints() {
    prints = {shared: sharedPrint()};
    for (const k of SYNC_KINDS) prints[k] = new Map(listOf(k).map(x => [x.id, {p: printOf(x), mod: x.mod || 0}]));
  }
  // At every save: entries that are new or changed get the time; ones that disappeared are noted as deleted.
  function stampChanges() {
    if (!prints) { rebuildPrints(); return; }
    const now = Date.now();
    for (const k of SYNC_KINDS) {
      const old = prints[k], next = new Map(), gone = deleted[k];
      for (const x of listOf(k)) {
        const p = printOf(x), was = old.get(x.id);
        // (a change here always counts as newer than the version it started from, even if clocks disagree)
        if (!was || was.p !== p) { x.mod = Math.max(now, (x.mod || 0) + 1, was ? was.mod + 1 : 0, (gone[x.id] || 0) + 1); delete gone[x.id]; }
        next.set(x.id, {p, mod: x.mod || 0});
      }
      for (const [id, was] of old) if (!next.has(id)) gone[id] = Math.max(now, (was.mod || 0) + 1, gone[id] || 0);
      prints[k] = next;
    }
    const sp = sharedPrint();
    if (sp !== prints.shared) { settings.sharedMod = Math.max(now, (settings.sharedMod || 0) + 1); prints.shared = sp; }
  }
  // Combines a backup file written by another device (or this one) with what's here. Each card, want, deck and
  // sale keeps whichever version changed last; deleted on either side stays deleted unless changed again later.
  // Every device applies the same rules, so they all end up with the same result.
  // Returns what changed here, and whether the file is missing something from here ("behind").
  // opts.fileWins: the first time this computer and the file are put together ("Combine both"): wherever both have
  // the same card, want, deck or sale, the file's version is kept, and the file's deletions apply here.
  function mergeBackup(data, opts) {
    const fileWins = !!(opts && opts.fileWins);
    deleted = cleanDeleted(deleted);   // (the same 400-day limit as the file's, so both sides compare alike)
    // changed: something you'd see changed here; touched: only bookkeeping (dates, deletions, older price history) to save
    const res = {changed: false, touched: false, behind: false, counts: {}, removedIds: new Set(), settings: false};
    const theirDeleted = cleanDeleted(data.deleted);
    for (const k of SYNC_KINDS) {
      const c = res.counts[k] = {added: 0, changed: 0, removed: 0};
      // (a backup from before decks and sales existed says nothing about them)
      if (!Array.isArray(data[k])) { if (listOf(k).length || Object.keys(deleted[k]).length) res.behind = true; continue; }
      // (an entry without an id, from a hand-made file, gets one from its contents, so it isn't added again every time)
      const theirs = data[k].map(x => upgradeOf(k)(x && typeof x === "object" && !x.id ? Object.assign({}, x, {id: "h" + hashText(JSON.stringify(x))}) : x)).filter(Boolean);
      const gone = deleted[k], theirGone = theirDeleted[k];
      // Joining a file for the first time: deletions made here before then are about this computer's own old
      // copies, not about the file's cards.
      if (fileWins) for (const r of theirs) if (gone[r.id] != null && theirGone[r.id] == null) { delete gone[r.id]; res.touched = true; }
      for (const [id, t] of Object.entries(theirGone)) if (!(gone[id] >= t)) { gone[id] = t; res.touched = true; }
      for (const [id, t] of Object.entries(gone)) if (!(theirGone[id] >= t)) res.behind = true;
      const list = listOf(k).slice();
      const byId = new Map(list.map(x => [x.id, x]));
      const theirIds = new Set();
      for (const r of theirs) {
        theirIds.add(r.id);
        const mine = byId.get(r.id);
        if (!mine) {
          if (gone[r.id] != null && gone[r.id] >= r.mod) continue;
          list.push(r); byId.set(r.id, r); c.added++;
          continue;
        }
        const pm = printOf(mine), pr = printOf(r);
        if (pm === pr) { if (r.mod > mine.mod || fileWins) { if (mine.mod !== r.mod) { mine.mod = r.mod; res.touched = true; } } else if (mine.mod > r.mod) res.behind = true; continue; }
        // (same time on both: the fuller one, since an older Card Vault leaves out fields it doesn't know, like a
        // want list box's shop and link; else either, the same on every device)
        const fuller = Object.keys(r).length - Object.keys(mine).length;
        if (fileWins || r.mod > mine.mod || (r.mod === mine.mod && (fuller > 0 || (fuller === 0 && pr > pm)))) {
          // updated in place, so a form that's open on it keeps working
          for (const key of Object.keys(mine)) delete mine[key];
          Object.assign(mine, r);
          c.changed++;
        } else {
          res.behind = true;
        }
      }
      const kept = list.filter(x => {
        if (gone[x.id] != null && (gone[x.id] >= x.mod || (fileWins && theirGone[x.id] != null && !theirIds.has(x.id)))) { c.removed++; res.removedIds.add(x.id); return false; }
        if (!theirIds.has(x.id)) res.behind = true;
        return true;
      });
      if (c.added || c.changed || c.removed) { setListOf(k, kept); res.changed = true; }
    }
    const ds = data.settings && typeof data.settings === "object" ? data.settings : null;
    const theirMod = ds ? modTime(ds.sharedMod) : 0, myMod = modTime(settings.sharedMod);
    const theirShared = ds ? JSON.stringify(SHARED_SETTINGS.map(k => k === "condPct" ? Object.assign({}, DEFAULT_COND_PCT, ds.condPct) : ds[k])) : "";
    if (ds && (fileWins || theirMod > myMod || (theirMod === myMod && theirShared > sharedPrint()))) {
      const before = sharedPrint();
      applySharedSettings(ds);
      settings.sharedMod = Math.max(theirMod, fileWins ? myMod : 0);
      if (sharedPrint() !== before) { res.settings = true; res.changed = true; }
    } else if (myMod > theirMod || (ds && theirShared !== sharedPrint())) {
      res.behind = true;
    }
    // Set goals go one by one (the latest change to each goal wins), so goals added on two devices both stay
    if (ds && Array.isArray(ds.setGoals)) {
      const m = mergeGoals(settings.setGoals, ds.setGoals, fileWins);
      if (m.changed) { settings.setGoals = m.list; res.goals = true; res.changed = true; }
      if (m.behind) res.behind = true;
    } else if (ds && cleanGoals(settings.setGoals).length) res.behind = true;
    if (Array.isArray(data.valueHistory)) {
      const merged = mergeHistory(valueHistory, data.valueHistory);
      if (merged.length !== valueHistory.length) { valueHistory = merged; res.touched = true; }
    }
    return res;
  }
  function applySharedSettings(ds) {
    if (typeof ds.condAdjust === "boolean") settings.condAdjust = ds.condAdjust;
    if (ds.condPct && typeof ds.condPct === "object") settings.condPct = Object.assign({}, DEFAULT_COND_PCT, ds.condPct);
    if (typeof ds.alertsOn === "boolean") settings.alertsOn = ds.alertsOn;
    if (num(ds.alertMinDollar) != null) settings.alertMinDollar = num(ds.alertMinDollar);
    if (num(ds.alertMinPct) != null) settings.alertMinPct = num(ds.alertMinPct);
    if (num(ds.psa10Mult) != null) settings.psa10Mult = num(ds.psa10Mult);
    if (num(ds.psa10Floor) != null) settings.psa10Floor = num(ds.psa10Floor);
    if (ds.gradePct && typeof ds.gradePct === "object") settings.gradePct = Object.assign({}, DEFAULT_GRADE_PCT, ds.gradePct);
    if (typeof ds.pcToken === "string") settings.pcToken = ds.pcToken;
    if (num(ds.gradingCost) != null) settings.gradingCost = num(ds.gradingCost);
    if (num(ds.gradingMin) != null) settings.gradingMin = num(ds.gradingMin);
    if (ds.gradingFees && typeof ds.gradingFees === "object") settings.gradingFees = cleanGradingFees(ds.gradingFees);
    if (typeof ds.gradingCo === "string" && ds.gradingCo) settings.gradingCo = ds.gradingCo;
    if (typeof ds.ntfyTopic === "string") settings.ntfyTopic = ds.ntfyTopic;
    if (typeof ds.siteUrl === "string") settings.siteUrl = ds.siteUrl;
    if (num(ds.sellFeePct) != null) settings.sellFeePct = Math.min(Math.max(num(ds.sellFeePct), 0), 60);
    if (num(ds.sellFeeFlat) != null) settings.sellFeeFlat = Math.min(Math.max(num(ds.sellFeeFlat), 0), 50);
    if ("cloudAlerts" in ds) settings.cloudAlerts = cleanCloudAlerts(ds.cloudAlerts);
  }
  function mergeSummary(res) {
    const names = {collection: "collection", wants: "want list", decks: "decks", sales: "sales", openings: "openings"};
    const parts = [];
    for (const k of SYNC_KINDS) {
      const c = res.counts[k];
      if (!c) continue;
      const bits = [c.added ? c.added + " added" : "", c.changed ? c.changed + " changed" : "", c.removed ? c.removed + " removed" : ""].filter(Boolean);
      if (bits.length) parts.push(names[k] + ": " + bits.join(", "));
    }
    if (res.settings) parts.push("card-value settings");
    if (res.goals) parts.push("set goals");
    return parts.join("; ");
  }
  // ----- The safety check: changes from another device that would take away many cards (10 or more, after
  // anything they add), 5 or more want-list cards, or your whole want list wait for your OK instead of going
  // through by themselves. That's what a wrong or out-of-date backup file looks like (the October 2026 loss).
  const HOLD_CARDS = 10, HOLD_WANTS = 5;
  const cardTotal = list => list.reduce((s, r) => s + (num(r.qty) || 0), 0);
  // What combining with this file would do here, worked out on a copy (nothing here changes).
  function dryMerge(data) {
    const keep = {collection, wants, decks, sales, openings, deleted, settings, valueHistory};
    const copy = v => JSON.parse(JSON.stringify(v));
    try {
      collection = copy(collection); wants = copy(wants); decks = copy(decks); sales = copy(sales); openings = copy(openings); deleted = copy(deleted); settings = copy(settings);
      const res = mergeBackup(data, {});
      return {res, cards: cardTotal(collection), wants: wants.length, qty: new Map(collection.map(r => [r.id, num(r.qty) || 0]))};
    } finally {
      ({collection, wants, decks, sales, openings, deleted, settings, valueHistory} = keep);
    }
  }
  // null when the file's changes can go ahead; else what they'd take away here, for the question: cards removed,
  // and cards whose quantity would go down (an old copy brought back on another device looks like that).
  // Approved removals and drops ("Remove them here too") don't ask again.
  function holdFor(data) {
    if (!data || !hasLocalData()) return null;
    const after = dryMerge(data), res = after.res;
    const ok = sync.okRemove || new Set();
    const removed = {collection: collection.filter(r => res.removedIds.has(r.id) && !ok.has(r.id)), wants: wants.filter(w => res.removedIds.has(w.id) && !ok.has(w.id))};
    const reduced = collection.filter(r => after.qty.has(r.id) && after.qty.get(r.id) < (num(r.qty) || 0) && !ok.has(r.id + "@" + after.qty.get(r.id)))
      .map(r => ({r, to: after.qty.get(r.id)}));
    if (!removed.collection.length && !removed.wants.length && !reduced.length) return null;
    // (what this would take away that you haven't already said yes to, but never more than the net loss: a card
    // replaced by another one, or merged into another line, isn't a loss)
    const asked = cardTotal(removed.collection) + reduced.reduce((t, x) => t + (num(x.r.qty) || 0) - x.to, 0);
    const lostCards = Math.max(0, Math.min(cardTotal(collection) - after.cards, asked));
    const lostWants = Math.max(0, Math.min(wants.length - after.wants, removed.wants.length));
    const allWants = wants.length >= 2 && after.wants === 0 && removed.wants.length > 0;
    if (!(lostCards >= HOLD_CARDS || lostWants >= HOLD_WANTS || allWants)) return null;
    // when each was deleted or changed on the other device, so "Keep them" can make this device's newer than that
    const theirGone = cleanDeleted(data.deleted), when = {};
    for (const k of ["collection", "wants"]) for (const x of removed[k]) when[x.id] = theirGone[k][x.id] || 0;
    const theirMod = new Map((Array.isArray(data.collection) ? data.collection : []).filter(x => x && x.id).map(x => [x.id, modTime(x.mod)]));
    for (const x of reduced) when[x.r.id] = theirMod.get(x.r.id) || 0;
    return {removed, reduced, lostCards, lostWants, allWants, when,
      savedOn: typeof data.savedOn === "string" ? data.savedOn.slice(0, 80) : "", savedAt: data.savedAt || ""};
  }
  // "Remove them here too": these removals and drops go through (and only these: a later, bigger one asks again).
  async function holdApply() {
    const info = backup.holdInfo;
    if (!info || backup.state !== "hold") return;
    sync.okRemove = new Set([...(sync.okRemove || []), ...info.removed.collection.map(r => r.id), ...info.removed.wants.map(w => w.id),
      ...(info.reduced || []).map(x => x.r.id + "@" + x.to)]);
    backup.state = "active"; backup.holdInfo = null;
    renderBackupBanner(); refreshBackupSection();
    if (await writeBackup({manual: true})) toast("Done: " + HERE + " matches your other devices again.");
  }
  // "Keep them": they stay here as they are, and are saved back to the file, newer than the other device's change, so
  // your other devices get them back too.
  async function holdKeep() {
    const info = backup.holdInfo;
    if (!info || backup.state !== "hold") return;
    const now = Date.now();
    const bump = (k, id) => {
      const live = listOf(k).find(y => y.id === id);
      if (!live) return;
      live.mod = Math.max(now, (live.mod || 0) + 1, (info.when[id] || 0) + 1, (deleted[k][id] || 0) + 1);
      delete deleted[k][id];
    };
    for (const k of ["collection", "wants"]) for (const x of info.removed[k]) bump(k, x.id);
    for (const x of info.reduced || []) bump("collection", x.r.id);
    rebuildPrints();
    save({quiet: true, noBackup: true});
    backup.state = "active"; backup.holdInfo = null;
    renderBackupBanner(); refreshBackupSection();
    if (await writeBackup({manual: true})) toast("Kept them. Your other devices get them back the next time they sync.");
  }
  function holdTextHTML() {
    const info = backup.holdInfo || {};
    const from = info.savedOn ? esc(info.savedOn) : "another device";
    const when = parseDate(info.savedAt);
    const names = (info.removed ? info.removed.collection.map(r => r.name + (r.number ? " (" + r.number + ")" : "") + (r.qty > 1 ? " ×" + r.qty : ""))
      .concat((info.reduced || []).map(x => x.r.name + (x.r.number ? " (" + x.r.number + ")" : "") + ": ×" + x.r.qty + " would become ×" + x.to))
      .concat(info.removed.wants.map(w => w.name + " (want list)")) : []);
    return "The last save to your backup " + (onDriveNow() ? "in Google Drive" : "file") + " came from <b>" + from + "</b>" + (when ? " (" + esc(fmtDateTime(when)) + ")" : "") +
      ", and syncing with it would remove " + esc(holdWhat(info)) + " here. If you didn't do that, it's probably an old or wrong copy: choose Keep them. " +
      "Nothing syncs until you choose." +
      (names.length ? '<details class="hold-list"><summary>Show them (' + names.length + ")</summary><ul>" + names.slice(0, 200).map(n => "<li>" + esc(n) + "</li>").join("") +
        (names.length > 200 ? "<li>…and " + (names.length - 200) + " more</li>" : "") + "</ul></details>" : "");
  }
  const onDriveNow = () => !!(backup.handle && backup.handle.kind === "gdrive");
  // What this device is called in "came from …": the name you gave it in Settings, or what it is.
  function deviceLabel(auto) {   // (auto: what it is, ignoring the name you gave it)
    const own = String(settings.deviceName || "").trim();
    if (own && !auto) return own.slice(0, 60);
    const ua = navigator.userAgent || "", touch = (navigator.maxTouchPoints || 0) > 1;
    const kind = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch) ? "iPad" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
      : /Windows/.test(ua) ? "Windows PC" : /CrOS/.test(ua) ? "Chromebook" : /Macintosh|Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux computer" : "computer";
    return kind + (SITE ? ", website" : ", Card Vault file");
  }
  // Saves the collection, want list and value history (and settings). Every data change
  // goes through here, which also keeps the value history current and triggers a backup.
  // {quiet: true} is for housekeeping (a new value-history point) that isn't a change you made.
  // {noBackup: true}: changes that came from the backup file itself.
  function save(opts) {
    if (!(opts && opts.quiet)) {
      settings.lastChangeAt = new Date().toISOString();
      // An older Undo would also roll back this newer change, so it stops being offered.
      document.querySelectorAll("#toasts .toast.has-action").forEach(t => t.remove());
    }
    stampChanges();
    recordValueHistory();
    const write = () => {
      try {
        localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
        localStorage.setItem(STORE_KEY, JSON.stringify(collection));
        localStorage.setItem(WANTS_KEY, JSON.stringify(wants));
        localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
        localStorage.setItem(SALES_KEY, JSON.stringify(sales));
        localStorage.setItem(OPENINGS_KEY, JSON.stringify(openings));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(valueHistory));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        return true;
      } catch (e) {
        return false;
      }
    };
    let ok = write();
    if (!ok) {
      // Out of room: the photo-lookup cache is only a convenience, so drop it and try again.
      try { [YUGI_CACHE_KEY, OCG_CACHE_KEY, OCG_KEPT_KEY, PC_CACHE_KEY, "cardvault.v2.ygocards", "cardvault.v2.ygoarch"].forEach(k => localStorage.removeItem(k)); yugi.cache = {}; ocg.cache = {}; ocg.kept = null; pc.cache = {}; } catch (e) { /* ignore */ }
      ok = write();
    }
    storageOK = ok;
    if (ok) loadProblem = false;
    else toast("Couldn't save: this browser blocked or ran out of storage for Card Vault. Use Export CSV to keep a copy.", {kind: "error", sticky: true});
    if (!(opts && opts.noBackup)) scheduleBackup();  // the backup file still gets the change
    return ok;
  }
  // Settings-only changes (sort order, view...) don't need a backup.
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { storageOK = false; }
  }

