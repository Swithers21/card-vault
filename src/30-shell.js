  /* ======================= Rendering ======================= */
  // Copies beyond 3 of the same card (every printing counts toward the 3, graded cards don't),
  // keeping your 3 most valuable copies. Returns record id -> number of extra copies.
  function extrasMap() {
    const groups = new Map();
    // (a Rush Duel card is another game's card, with a 3-copy limit of its own)
    for (const r of collection) if (!r.grade && !r.sealed) pushMap(groups, (isRushNo(r.number) ? "rush|" : "") + lookupName(r.name).toLowerCase(), r);
    const extra = new Map();
    for (const list of groups.values()) {
      if (list.reduce((s, r) => s + r.qty, 0) <= 3) continue;
      let keep = 3;
      const byValue = list.slice().sort((a, b) => {
        const va = marketValue(a).unit, vb = marketValue(b).unit;
        return (vb == null ? -1 : vb) - (va == null ? -1 : va) || String(a.added).localeCompare(String(b.added));
      });
      for (const r of byValue) {
        const kept = Math.min(keep, r.qty);
        keep -= kept;
        if (r.qty > kept) extra.set(r.id, r.qty - kept);
      }
    }
    return extra;
  }
  function visibleRecords() {
    const q = filters.q.trim().toLowerCase();
    const extras = filters.show === "extras" ? extrasMap() : null;
    const show = r => !filters.show ||
      (filters.show === "extras" && extras.has(r.id)) ||
      (filters.show === "graded" && !!r.grade) ||
      (filters.show === "played" && !r.grade && !r.sealed && r.condition !== "Near Mint" && r.condition !== SEALED_COND) ||
      (filters.show === "sealedcards" && isSealedCard(r)) ||
      (filters.show === "manual" && !r.productId && !r.ref) ||
      (filters.show === "rush" && !r.sealed && isRushNo(r.number)) ||
      (filters.show === "overframe" && isOverframeRec(r)) ||
      (filters.show === "manga" && isMangaRec(r)) ||
      (filters.show === "selling" && !!r.sell) ||
      (filters.show === "sealed" && r.sealed) ||
      (filters.show === "cards" && !r.sealed);
    const list = collection.filter(r =>
      (!filters.set || r.setName === filters.set) &&
      (!filters.rarity || r.rarity === filters.rarity) &&
      (!filters.edition || r.edition === filters.edition) &&
      (!filters.language || r.language === filters.language) &&
      (!filters.location || (filters.location === NO_LOCATION ? !r.location : r.location === filters.location)) &&
      show(r) &&
      (!q || (r.name + " " + r.productName + " " + r.number + " " + r.setName + " " + r.location + " " + r.notes + " " + r.rarity + (isRushNo(r.number) ? " rush duel" : "") + (isOverframeRec(r) ? " overframe over frame extended art" : "") + (isMangaRec(r) ? " manga style" + (mangaOf(r.rarity) === "Color" ? " colour" : " black and white") : "") + (r.sealed ? " sealed " + r.language : isSealedCard(r) ? " sealed still sealed" : "") + (r.sell ? " selling sell list" : "")).toLowerCase().includes(q)));
    return sortRecords(list);
  }
  function sortRecords(list) {
    const field = SORT_FIELDS[settings.sortField] ? settings.sortField : "price";
    const dir = settings.sortDir === "asc" ? 1 : -1;
    const byStr = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, {numeric: true, sensitivity: "base"});
    const tie = (a, b) => byStr(a.name, b.name) || byStr(a.number, b.number);
    // Cards with no value for the chosen category (no price, no set...) always go last.
    const blanksLast = (va, vb) => (va == null) - (vb == null);
    let key, compare;
    switch (field) {
      case "price": key = r => unitValue(r); break;
      case "total": key = r => { const u = unitValue(r); return u == null ? null : u * (settings.gradedView && !r.grade ? 1 : r.qty); }; break;
      case "name": key = r => r.name || null; compare = byStr; break;
      case "set": key = r => r.setName || null; compare = byStr; break;
      case "number": key = r => r.number || null; compare = byStr; break;
      case "language": key = r => r.language || null; compare = byStr; break;
      case "rarity": key = r => r.rarity ? rarityRank(r.rarity) : null; break;
      case "edition": key = r => r.edition in PRINTING_RANK ? PRINTING_RANK[r.edition] : (r.edition ? -1 : null); break;
      case "condition": key = r => r.condition in CONDITION_RANK ? CONDITION_RANK[r.condition] : 0; break;
      case "qty": key = r => r.qty; break;
      case "location": key = r => r.location || null; compare = byStr; break;
      case "added": key = r => r.added || null; compare = byStr; break;
    }
    compare = compare || ((a, b) => a - b);
    return list.map(r => ({r, k: key(r)})).sort((a, b) =>
      blanksLast(a.k, b.k) ||
      (a.k == null ? 0 : dir * compare(a.k, b.k)) ||
      (field === "rarity" ? byStr(a.r.rarity, b.r.rarity) : 0) ||
      (field === "set" ? byStr(a.r.number, b.r.number) : 0) ||
      tie(a.r, b.r)).map(x => x.r);
  }
  const filtersActive = () => !!(filters.q.trim() || filters.set || filters.rarity || filters.edition || filters.language ||
    filters.location || filters.show);
  function clearFilters() {
    filters.q = filters.set = filters.rarity = filters.edition = filters.language = filters.location = filters.show = "";
    $("q").value = "";
  }

  function render() {
    // (a redraw while you're typing a deck list, say when prices arrive in the background, keeps what's in the boxes)
    if (settings.tab === "decks" && deckDraft && $("deckText")) { deckDraft.text = $("deckText").value; deckDraft.name = $("deckName").value.trim(); }
    renderDataStatus();
    renderBackupBanner();
    renderWantBanner();
    renderChangeBanner();
    renderGradingBanner();
    renderSummary();
    renderTabs();
    renderFilterOptions();
    renderPanel();
    renderBulkBar();
    checkGoalsDone();
  }
  function syncBanners() {
    const any = Array.from($("banners").children).some(b => !b.hidden);
    $("banners").hidden = !any;
  }

  /* ======================= Tabs ======================= */
  function renderTabs() {
    document.body.dataset.tab = settings.tab;   // (the full showcase is on the Collection tab; other tabs get one line)
    TABS.forEach(t => {
      const on = settings.tab === t;
      $("tab-" + t).setAttribute("aria-selected", String(on));
      $("tab-" + t).tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    });
    const hits = wants.filter(w => wantStatus(w).hit).length;
    $("wantCount").textContent = wants.length ? String(wants.length) : "";
    $("wantCount").title = hits ? wantCount(hits) + " at or below your target price" : "";
    $("tab-wants").setAttribute("aria-label", "Want list" + (wants.length ? ", " + wantCount(wants.length) : "") +
      (hits ? ", " + hits + " at or below your target price" : ""));
  }
  function setTab(tab, focus) {
    if (!TABS.includes(tab)) tab = "collection";
    settings.tab = tab;
    saveSettings();
    syncTabHash();
    if (tab !== "collection") armBack();
    renderTabs();
    renderWantBanner();
    renderChangeBanner();
    renderSummary();
    renderPanel();
    renderBulkBar();
    if (window.scrollY > 0 && window.matchMedia && window.matchMedia("(max-width:640px)").matches) window.scrollTo(0, 0);
    if (focus) $("tab-" + tab).focus();
  }
  function renderPanel() {
    if (settings.tab === "history") renderInsights();
    else if (settings.tab === "sets") renderSets();
    else if (settings.tab === "wants") renderWants();
    else if (settings.tab === "decks") renderDecks();
    else if (settings.tab === "sales") renderSalesTab();
    else if (settings.tab === "market") renderMarket();
    else if (settings.tab === "search") renderSearch();
    else { renderGoalsBar(); renderCollection(); }
  }

  function renderDataStatus() {
    const pill = $("dataPill"), text = $("dataPillText"), banner = $("banner");
    if (!catalog && SITE) {
      pill.className = "data-pill off";
      text.textContent = "TCGplayer data not loaded";
      banner.hidden = false;
      banner.innerHTML = "<strong>TCGplayer's card list didn't load.</strong> Check your internet connection and reload the page. " +
        "If it keeps happening, the daily price update on GitHub may need a look (see \"If prices stop updating\" in SETUP.md, in your card-vault repository on GitHub).";
      syncBanners();
      return;
    }
    if (!catalog) {
      pill.className = "data-pill off";
      text.textContent = "TCGplayer data not loaded";
      banner.hidden = false;
      banner.innerHTML = "<strong>Set up TCGplayer prices and card lookup (one time, takes a few minutes).</strong>" +
        "<ol><li>In the Card Vault folder, double-click <b>Update TCGplayer Data</b>. If Windows says it protected your PC, click <b>More info</b>, then <b>Run anyway</b>.</li>" +
        "<li>Wait until the black window says <b>Done</b>. If Python isn't installed yet, the window walks you through it.</li>" +
        "<li>Come back here and press <b>F5</b>.</li></ol>" +
        "<p class=\"small\" style=\"margin:8px 0 0\">Until then you can still import your TCGplayer CSV: photos show from each card's Product ID, and prices come from the file.</p>";
      syncBanners();
      return;
    }
    const age = daysOld(catalog.generated);
    pill.className = "data-pill" + (age != null && age > 3 ? " warn" : "");
    text.textContent = "TCGplayer prices from " + fmtDate(catalog.generated);
    if (age != null && age > 3) {
      banner.hidden = false;
      banner.innerHTML = "<strong>Your TCGplayer prices are " + plural(age, "day") + " old.</strong> " + (SITE
        ? "They normally update every evening. Reload the page; if they're still old, the daily price update on GitHub may have stopped (see \"If prices stop updating\" in SETUP.md, in your card-vault repository on GitHub)."
        : "Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, then press <b>F5</b> here." +
          " To have Windows do this every day, double-click <b>Turn On Daily Updates</b> once.");
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
    }
    syncBanners();
  }

  // The updater also writes a tiny tcgplayer-data-version.js. Checking it now and then lets an open
  // Card Vault notice new prices (say, from the daily update) without reloading the big data file.
  let versionCheckAt = 0;
  function checkForNewData(force) {
    if (!force && Date.now() - versionCheckAt < 5 * 60000) return;
    versionCheckAt = Date.now();
    const old = document.getElementById("versionScript");
    if (old) old.remove();
    const s = document.createElement("script");
    s.id = "versionScript";
    s.src = "tcgplayer-data-version.js?t=" + Date.now();
    s.onload = () => {
      const v = window.TCG_DATA_VERSION;
      if (!v || !v.builtAt || (catalog && v.builtAt === catalog.builtAt)) return;
      if (catalog && catalog.builtAt && v.builtAt < catalog.builtAt) return;
      loadNewData(v);
    };
    s.onerror = () => s.remove();
    document.head.appendChild(s);
  }
  // Settings > "Check for new prices now": looks right away, loads what's newer, reads the Japanese, Korean and Rush Duel
  // list again (trying again if it had failed), and says in a few words what it found.
  async function checkPricesNow() {
    const parts = [];
    ocgCd.failed = 0; ocgMk.failed = 0;
    const v = await new Promise(resolve => {
      const s = document.createElement("script");
      s.src = "tcgplayer-data-version.js?t=" + Date.now();
      s.onload = () => { const got = window.TCG_DATA_VERSION; s.remove(); resolve(got || null); };
      s.onerror = () => { s.remove(); resolve(null); };
      document.head.appendChild(s);
    });
    if (!v || !v.builtAt) parts.push("Couldn't look for new TCGplayer prices (the update file didn't load: check the connection).");
    else if (catalog && catalog.builtAt && v.builtAt <= catalog.builtAt) parts.push("TCGplayer prices are up to date (from " + fmtDate(catalog.generated) + ").");
    else {
      dataLoad.tries = 0;
      clearTimeout(dataLoad.timer);
      await loadNewData(v, true);
      parts.push(catalog && catalog.builtAt >= v.builtAt ? "New TCGplayer prices loaded (from " + fmtDate(catalog.generated) + ")."
        : "The website has newer TCGplayer prices (" + fmtDate(parseDate(v.generated)) + ") but they didn't load. Try again in a minute.");
    }
    if (ocgCardsURL()) await loadOcgCards(true);
    parts.push("Japanese, Korean and Rush Duel prices: " + ocgListStatus() + ".");
    renderSoon();
    return parts.join(" ");
  }
  // (only if the new prices couldn't be loaded in place: then a reload does it)
  function showDataBanner(v) {
    const when = parseDate(v.generated);
    const b = $("updateBanner");
    b.hidden = false;
    b.innerHTML = "<strong>" + (catalog ? "New TCGplayer prices are ready" : "TCGplayer data is ready") + "</strong>" +
      (when ? " (from " + esc(fmtDate(when)) + ")." : ".") +
      '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="reload">Load them now</button></div>';
    syncBanners();
  }

  // New prices are put in place as they arrive: no reload and nothing to tap. If you're in the middle of something
  // (a card's details, a form, typing), they wait until you're done, so nothing moves under your finger.
  const dataLoad = {raw: null, loading: false, tries: 0, timer: null, version: ""};
  function viewBusy() {
    if (!$("drawer").hidden || !$("importModal").hidden || scan) return true;
    // (typing somewhere that's redrawn, like a deck list; the search boxes at the top and in Card search aren't, so they don't count)
    const a = document.activeElement;
    return !!(a && a !== document.body && a.id !== "q" && a.id !== "csQ" && a.id !== "csSetFind" && a.matches &&
      a.matches("textarea, select, [contenteditable=true], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=file])"));
  }
  function readDataText(text) {
    const at = text.indexOf("window.TCG_DATA");
    if (at < 0) return null;
    let body = text.slice(text.indexOf("=", at) + 1).trim();
    if (body.endsWith(";")) body = body.slice(0, -1);
    return JSON.parse(body);
  }
  function fetchData() {
    // (on the website: without the browser's saved copy; the offline copy, sw.js, is replaced along the way)
    if (/^https?:$/.test(location.protocol)) {
      return fetch("tcgplayer-data.js", {cache: "no-store"}).then(res => {
        if (!res.ok) throw new Error("TCGplayer data: " + res.status);
        return res.text();
      }).then(readDataText);
    }
    // Card Vault.html opened from this computer: the browser won't read files here, but it runs scripts.
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "tcgplayer-data.js?t=" + Date.now();
      s.onload = () => { const raw = window.TCG_DATA; window.TCG_DATA = null; s.remove(); resolve(raw); };
      s.onerror = () => { s.remove(); reject(new Error("TCGplayer data didn't load")); };
      document.head.appendChild(s);
    });
  }
  async function loadNewData(v, now) {
    if (dataLoad.loading || dataLoad.raw) return;
    if (dataLoad.version !== v.builtAt) { dataLoad.version = v.builtAt; dataLoad.tries = 0; }
    if (dataLoad.tries > 3) { showDataBanner(v); return; }   // (gave up on this one: the banner's reload does it)
    dataLoad.loading = true;
    let raw = null;
    try { raw = await fetchData(); } catch (e) { raw = null; }
    dataLoad.loading = false;
    const newer = !!(raw && Array.isArray(raw.products) && raw.products.length &&
      (!catalog || !catalog.builtAt || String(raw.builtAt || raw.generated || "") > catalog.builtAt));
    if (!newer) {
      // An older copy came back: the website was still being updated, or a slow connection got the saved copy
      // (which is replaced meanwhile). Try again in a couple of minutes; after a few tries, offer a reload.
      clearTimeout(dataLoad.timer);
      if (++dataLoad.tries <= 3) dataLoad.timer = setTimeout(() => checkForNewData(true), 2 * 60000);
      else showDataBanner(v);
      return;
    }
    dataLoad.tries = 0;
    dataLoad.raw = raw;
    applyNewData(now);
  }
  // now: someone asked for it (Settings > Check for new prices now), so it doesn't wait for a quiet moment
  function applyNewData(now) {
    if (!dataLoad.raw) return;
    clearTimeout(dataLoad.timer);
    if (now !== true && viewBusy()) { dataLoad.timer = setTimeout(applyNewData, 15000); return; }
    let next = null;
    try { next = buildCatalog(dataLoad.raw); } catch (e) { next = null; }
    dataLoad.raw = null;
    if (!next) return;
    const had = !!catalog;
    catalog = next;   // (lookups made from the old prices, like the sets list and the Market tab, are kept on it and go with it)
    setsCache = null;
    histFiles.clear();
    ocgMk.data = null;   // (rebuilt the same evening: read again when next shown)
    // The Japanese, Korean and Rush Duel prices come from the same nightly run: read that list again too, keeping the
    // old one on screen until the new one is here (Rush Duel prices come from it alone).
    if (ocgCd.data) loadOcgCards(true);
    $("updateBanner").hidden = true;
    $("updateBanner").innerHTML = "";
    const linked = autoLink();
    if (linked) save(); else if (recordValueHistory()) save({quiet: true});
    schedulePhoneCopy(true);
    // (what a deck would cost, and the deck ideas, were worked out with the old prices)
    if (deckResult && deckDraft && deckDraft.text.trim() && !looksLikeIds(deckDraft.text)) deckResult = checkDeck(parseDeckText(deckDraft.text));
    if (ideas.result && !ideas.busy) runDeckIdeas();
    render();
    toast((had ? "New TCGplayer prices are in" : "TCGplayer data loaded") + (catalog.generated ? " (from " + fmtDate(catalog.generated) + ")" : "") + "." +
      (linked ? " Linked " + plural(linked, "card") + " to TCGplayer printings by card number." : ""));
  }

  function renderSummary() {
    document.querySelectorAll("#valueMode button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.mode === "graded") === !!settings.gradedView)));
    $("basis").disabled = !!settings.gradedView;
    changeMemo = null;
    if (settings.gradedView) { renderGradedSummary(); setHeroChange(""); syncValueBar(); return; }
    const t = totals(collection);
    const basisPaid = settings.basis === "paid";
    const adjusted = !basisPaid && settings.condAdjust && collection.some(r => marketValue(r).factor < 1);
    // (the part in brackets is left off on a phone)
    $("valueLabel").innerHTML = "Collection value " + '<span class="value-basis">' + (basisPaid ? "(what you paid)"
      : "(TCGplayer market" + (adjusted ? ", adjusted for condition" : "") + ")") + "</span>";
    $("totalValue").textContent = usd(t.value) || "$0.00";
    const parts = [];
    if (filters.show === "extras" && settings.tab === "collection") {
      const extras = extrasMap();
      let n = 0, v = 0;
      for (const r of visibleRecords()) { const x = extras.get(r.id) || 0; n += x; const u = unitValue(r); if (u != null) v += u * x; }
      parts.push("Extras: " + plural(n, "card") + " worth " + usd(v) + " (copies beyond 3 of a card, keeping your 3 most valuable)");
    } else if (filtersActive() && settings.tab === "collection") {
      const vt = totals(visibleRecords());
      parts.push("Shown now: " + usd(vt.value) + " across " + plural(vt.cards, "card"));
    }
    if (t.unpriced) parts.push(plural(t.unpriced, "card") + " without a " + (basisPaid ? "price paid" : "price") + " counted as $0");
    $("valueSub").textContent = parts.join(". ");

    let facts = '<div class="fact"><b>' + t.cards.toLocaleString() + '</b><span>cards</span></div>' +
      '<div class="fact"><b>' + collection.length.toLocaleString() + '</b><span>different ' + (collection.some(r => r.sealed) ? "items" : "printings") + "</span></div>";
    if (!basisPaid && catalog && catalog.refDays.m1) {
      const ch = periodChange("m1");
      if (ch.covered) facts += '<div class="fact fact-chg"><b>' + changeHTML(ch.diff, ch.pct, true) + '</b><span>since ' +
        esc(fmtShortDate(parseDay(catalog.refDays.m1))) + " prices</span></div>";
    }
    if (t.paidCards) {
      const gain = t.paidMarket - t.paid;
      facts += '<div class="fact"><b>' + usd(t.paid) + '</b><span>paid (for ' + plural(t.paidCards, "card") + ')</span></div>' +
        '<div class="fact"><b>' + changeHTML(gain, null, true) + '</b><span>gain vs. market</span></div>';
    }
    const sealedList = collection.filter(r => r.sealed);
    if (sealedList.length) {
      const st = totals(sealedList);
      facts += '<div class="fact"><b>' + esc(usd(st.value) || "$0.00") + '</b><span>in sealed products (' + st.cards.toLocaleString() + ")</span></div>";
    }
    if (t.jp) facts += '<div class="fact"><b>' + fmtJPY.format(t.jp) + '</b><span>Japan prices</span></div>';
    if (t.kr) facts += '<div class="fact"><b>' + fmtKRW.format(t.kr) + '</b><span>Korea prices</span></div>';
    $("facts").innerHTML = facts;

    const top = collection.filter(r => unitValue(r) != null)
      .sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 5);
    $("topCards").innerHTML = handHTML(top, "Your most valuable cards");
    setHeroChange(heroChangeHTML());
    syncValueBar();
    setHeroArt(top[0]);
  }
  // The most valuable cards fanned out like a hand: the top one in the middle, then right, left, right, left;
  // each with a price sticker. (On a phone, only the top three.)
  // The most valuable card's artwork, blurred into a glow behind the collection's value.
  function setHeroArt(r) {
    const pics = r && !r.sealed ? recordPics(r, "in_400x400").list || [] : [];
    const url = pics.map(u => String(u || "").replace(/^~/, "")).find(u => /^https:\/\/[^"'()\\\s]+$/.test(u)) || "";
    $("summary").style.setProperty("--hero-art", url ? 'url("' + url + '")' : "none");
  }
  function handHTML(top, label) {
    if (!top.length) return "";
    return '<div class="top-cards-label">' + esc(label) + '</div><div class="fan">' + top.map((r, i) => {
      const slot = i % 2 ? Math.ceil(i / 2) : -Math.ceil(i / 2);
      return '<button type="button" class="mini" data-open="' + esc(r.id) + '" style="--slot:' + slot + ";--rank:" + i + '" title="' + esc(r.name) + '">' +
        '<span class="sleeve' + (r.sealed ? " boxed" : "") + '"' + foilAttr(r.rarity, r.sealed) + ">" + imgTag(recordPics(r, "in_400x400"), r.name) + "</span><em>" + esc(usd(unitValue(r))) + "</em></button>";
    }).join("") + "</div>";
  }

  // The PSA 10 view of the summary: one gem-mint copy of each printing.
  function renderGradedSummary() {
    const g = gradedTotals(collection);
    $("valueLabel").innerHTML = 'PSA 10 value <span class="value-basis">(one copy of each printing)</span>';
    $("totalValue").textContent = usd(g.value) || "$0.00";
    const parts = [];
    if (filtersActive() && settings.tab === "collection") { const v = gradedTotals(visibleRecords()); parts.push("Shown now: " + usd(v.value) + " for " + plural(v.copies, "copy", "copies")); }
    if (g.est) parts.push(plural(g.est, "card") + " estimated from the raw price" + (pcOn() ? "" : " (add a PriceCharting key in Settings for real graded prices)"));
    if (g.unpriced) parts.push(plural(g.unpriced, "card") + " without a price counted as $0");
    $("valueSub").textContent = parts.join(". ");
    const graded = collection.filter(r => r.grade);
    const gt = graded.reduce((acc, r) => { const gv = gradedValue(r); if (gv) acc.v += gv.unit * r.qty; acc.n += r.qty; return acc; }, {v: 0, n: 0});
    const cur = totals(collection, r => marketValue(r).unit);
    let facts = '<div class="fact"><b>' + g.copies.toLocaleString() + '</b><span>copies counted</span></div>' +
      '<div class="fact"><b>' + esc(usd(cur.value) || "$0.00") + '</b><span>current value (all copies)</span></div>';
    if (gt.n) facts += '<div class="fact"><b>' + esc(usd(gt.v)) + '</b><span>your ' + plural(gt.n, "graded card") + "</span></div>";
    if (pcOn()) {
      const known = collection.filter(r => !r.sealed && pcKnown(r)).length, total = collection.filter(r => !r.sealed).length;
      facts += '<div class="fact"><b>' + known + " of " + total + '</b><span>priced by PriceCharting' + (pc.refreshing ? " (checking…)" : "") + "</span></div>";
    }
    $("facts").innerHTML = facts;
    const top = collection.filter(r => unitValue(r) != null).sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 5);
    $("topCards").innerHTML = handHTML(top, "Most valuable as PSA 10");
    setHeroArt(top[0]);
  }
  function renderFilterOptions() {
    const distinct = key => Array.from(new Set(collection.map(r => r[key]).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    const fill = (el, list, blank, value) => {
      if (value && !list.includes(value)) value = "";
      el.innerHTML = options(list, value, blank);
      el.value = value;
      return value;
    };
    filters.set = fill($("fSet"), distinct("setName"), "All sets", filters.set);
    filters.rarity = fill($("fRarity"), distinct("rarity"), "All rarities", filters.rarity);
    filters.edition = fill($("fEdition"), distinct("edition"), "All printings", filters.edition);
    filters.language = fill($("fLang"), distinct("language"), "All languages", filters.language);
    const locs = allLocations();
    $("fLocation").hidden = !locs.length;
    if (!locs.length) filters.location = "";
    if (filters.location && filters.location !== NO_LOCATION && !locs.includes(filters.location)) filters.location = "";
    $("fLocation").innerHTML = '<option value="">All locations</option>' + locs.map(l => '<option value="' + esc(l) + '">' + esc(l) + "</option>").join("") +
      (collection.some(r => !r.location) ? '<option value="' + NO_LOCATION + '">No location</option>' : "");
    $("fLocation").value = filters.location;
    $("locationList").innerHTML = locs.map(l => '<option value="' + esc(l) + '"></option>').join("");
    $("fShow").value = filters.show;
    $("copyTrade").hidden = filters.show !== "extras";
    $("shareTrade").hidden = filters.show !== "extras";
    $("sortField").innerHTML = Object.keys(SORT_FIELDS).filter(k => k !== "location" || locs.length || settings.sortField === "location")
      .map(k => '<option value="' + k + '"' + (k === settings.sortField ? " selected" : "") + ">" + esc(SORT_FIELDS[k].label) + "</option>").join("");
    updateSortDirButton();
    $("basis").value = settings.basis;
    document.querySelectorAll("#viewSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === settings.view)));
  }

  function updateSortDirButton() {
    const text = SORT_FIELDS[settings.sortField][settings.sortDir];
    $("sortDirText").textContent = text;
    $("sortDir").setAttribute("aria-label", "Order: " + text + ". Select to reverse.");
    $("sortDir").title = "Reverse the order";
  }
  function setSort(field) {
    if (settings.sortField === field) settings.sortDir = settings.sortDir === "asc" ? "desc" : "asc";
    else { settings.sortField = field; settings.sortDir = SORT_FIELDS[field].def; }
    saveSettings();
    $("sortField").value = settings.sortField;
    updateSortDirButton();
    renderCollection();
  }

  function renderCollection() {
    const main = $("collection");
    syncFiltersButton();
    if (!collection.length) {
      main.innerHTML = '<div class="empty"><h2>Your binder is empty</h2>' +
        "<p>Import the CSV you exported from TCGplayer, or add cards one at a time by the number printed under the artwork.</p>" +
        '<div class="actions"><button class="btn btn-primary" type="button" data-action="import">Import TCGplayer CSV</button>' +
        '<button class="btn" type="button" data-action="add">Add a card</button></div></div>';
      $("shown").textContent = "";
      return;
    }
    const list = visibleRecords();
    $("shown").textContent = filtersActive() ? "Showing " + list.length + " of " + collection.length : plural(collection.length, "printing");
    const need = photoCandidates();
    const hushed = new Set(settings.photoNoticeSeen || []);   // ("Not now": it comes back only for cards added since)
    const photoNotice = need.length && !yugiBatch.running && need.some(r => !hushed.has(r.id)) ? '<div class="notice" style="margin:0 0 16px"><strong>' + plural(need.length, "card") +
      " added manually " + (need.length === 1 ? "has" : "have") + " no photo.</strong> Card Vault can look for " + (need.length === 1 ? "it" : "them") +
      " on Yugipedia by card number (Japanese and Korean prints included) and use the closest match." +
      '<br><button class="btn btn-small" type="button" data-action="find-photos">Find photos</button> ' +
      '<button class="btn btn-small" type="button" data-action="hide-photo-notice">Not now</button></div>' : "";
    if (!list.length) {
      main.innerHTML = photoNotice + '<div class="empty"><h2>No matches</h2><p>' + (filters.show === "extras" && !filtersActiveExceptShow()
        ? "You don't have more than 3 copies of any card." : "Nothing in your collection matches these filters.") + "</p>" +
        '<div class="actions"><button class="btn" type="button" data-action="clear-filters">Clear filters</button></div></div>';
      return;
    }
    const extras = filters.show === "extras" ? extrasMap() : null;
    main.innerHTML = photoNotice + (settings.view === "list" ? listHTML(list, extras) : '<div class="binder">' + list.map(r => tileHTML(r, extras)).join("") + "</div>");
    const all = $("selectAllShown");
    if (all) {
      const n = list.filter(r => selected.has(r.id)).length;
      all.checked = n > 0 && n === list.length;
      all.indeterminate = n > 0 && n < list.length;
    }
  }

  const filtersActiveExceptShow = () => !!(filters.q.trim() || filters.set || filters.rarity || filters.edition || filters.language || filters.location);
  function priceHTML(r, extra) {
    const u = unitValue(r);
    if (settings.gradedView) {
      if (u == null) return '<span class="tile-price none">' + (r.sealed ? "Sealed" : "No price yet") + "</span>";
      const gv = gradedValue(r);
      return '<span class="tile-price">' + esc(usd(u)) + '<span class="gv">' + esc(gv.grade ? gv.grade : "PSA 10") + (gradedShort(gv) ? ", " + gradedShort(gv) : "") + "</span>" +
        (r.grade && r.qty > 1 ? "<small>" + esc(usd(u * r.qty)) + " for " + r.qty + "</small>" : "") + "</span>";
    }
    if (u == null) return '<span class="tile-price none">' + (settings.basis === "paid" ? "No price paid" : "No price yet") + "</span>";
    const note = extra ? "<small>" + esc(usd(u * extra)) + " extra</small>" : r.qty > 1 ? "<small>" + esc(usd(u * r.qty)) + " for " + r.qty + "</small>" : "";
    return '<span class="tile-price">' + esc(usd(u)) + note + "</span>";
  }
  // Rare cards catch the light like their foil (CSS: .sleeve[data-foil]).
  function foilFor(rarity, sealed) {
    const x = String(rarity || "").toLowerCase();
    if (sealed || !x) return "";
    if (/starfoil|shatterfoil|mosaic/.test(x)) return "super";
    if (/gold|premium/.test(x)) return "ultra";
    if (/rush rare/.test(x)) return "secret";   // (Rush Duel's Rush Rare and Over Rush Rare)
    if (/secret|prismatic|quarter century|starlight|ghost|ultimate|collector|platinum|20th|10000|pharaoh|holographic|parallel/.test(x)) return "secret";
    if (/ultra/.test(x)) return "ultra";
    if (/super/.test(x)) return "super";
    return "";
  }
  const foilAttr = (rarity, sealed) => { const f = foilFor(rarity, sealed); return f ? ' data-foil="' + f + '"' : ""; };
  function tileHTML(r, extras) {
    const sel = selected.has(r.id);
    const extra = extras ? extras.get(r.id) || 0 : 0;
    return '<article class="tile' + (sel ? " is-selected" : "") + '" data-card="' + esc(r.id) + '">' +
      '<div class="tile-art"><span class="sleeve' + (r.sealed ? " boxed" : "") + '"' + foilAttr(r.rarity, r.sealed) + ' data-open="' + esc(r.id) + '">' + imgTag(recordPics(r, "in_400x400"), r.name) + "</span>" +
      '<label class="tile-check"><input type="checkbox" class="check" data-select="' + esc(r.id) + '"' + (sel ? " checked" : "") +
      ' aria-label="Select ' + esc(r.name) + '"></label>' +
      (r.qty > 1 ? '<span class="tile-qty" title="' + r.qty + ' copies">&times;' + r.qty + "</span>" : "") + "</div>" +
      '<button type="button" class="tile-open" data-open="' + esc(r.id) + '"' + (r.location ? ' title="Location: ' + esc(r.location) + '"' : "") + ">" +
      '<span class="tile-name">' + esc(r.name) + "</span>" +
      (r.sealed ? '<span class="tile-meta" title="' + esc(r.setName) + '">' + esc(r.setName || "Sealed product") + "</span>" +
        '<span class="tile-meta">Sealed product' + (r.language && r.language !== "English" ? " · " + esc(r.language) : "") + "</span></button>"
      : '<span class="tile-meta">' + esc(r.number || "No card number") + "</span>" +
        '<span class="tile-meta" title="' + esc(r.rarity) + '">' + esc(r.rarity || " ") + "</span></button>") +
      '<div class="tile-foot"><span class="badges">' + (r.sealed ? '<span class="ed ed-sealed">Sealed</span>' : editionBadge(r.edition) + sealedCardBadge(r) + rushBadge(r.number) + overframeBadge(r) + mangaBadge(r)) + gradeBadge(r.grade) +
      (r.grading ? '<span class="ed ed-away' + (expectedBack(r.grading) && expectedBack(r.grading).late ? " ed-late" : "") + '">At ' + esc(r.grading.company) + (expectedBack(r.grading) && expectedBack(r.grading).late ? ", late" : "") + "</span>" : "") +
      (extra ? '<span class="ed ed-extra">' + extra + " extra</span>" : "") + (r.sell ? '<span class="ed ed-sell">Selling</span>' : "") + "</span>" + priceHTML(r, extra) + "</div></article>";
  }
  const settingsGradedNote = r => { if (!settings.gradedView) return ""; const gv = gradedValue(r); return gv ? '<span class="cell-gv">' + esc(gv.grade || "PSA 10") + (gradedShort(gv) ? ", " + gradedShort(gv) : "") + "</span>" : ""; };
  function listHTML(list, extras) {
    const showLoc = collection.some(r => r.location);
    const cols = [["name", "Card"], ["set", "Set"], ["rarity", "Rarity"], ["edition", "Printing"], ["condition", "Condition"],
      ["language", "Language"]].concat(showLoc ? [["location", "Location"]] : [], [["qty", "Qty", true], ["price", settings.gradedView ? "Graded" : "Price", true], ["total", settings.gradedView ? "Counted" : "Total", true]]);
    return '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th class="c-check"><input type="checkbox" class="check" id="selectAllShown" aria-label="Select all shown"></th>' +
      '<th class="c-thumb"><span class="sr">Image</span></th>' +
      cols.map(([field, label, numeric]) => {
        const active = settings.sortField === field;
        return "<th" + (numeric ? ' class="num"' : "") + ' aria-sort="' + (active ? (settings.sortDir === "asc" ? "ascending" : "descending") : "none") + '">' +
          '<button type="button" class="th-sort' + (active ? " active" : "") + '" data-sort="' + field + '" title="Sort by ' +
          esc(SORT_FIELDS[field].label.toLowerCase()) + (active ? " (select again to reverse)" : "") + '">' + esc(label) +
          (active ? '<span class="th-arrow" aria-hidden="true">' + (settings.sortDir === "asc" ? "&#9650;" : "&#9660;") + "</span>" : "") + "</button></th>";
      }).join("") + "</tr></thead><tbody>" +
      list.map(r => {
        const u = unitValue(r), sel = selected.has(r.id);
        const extra = extras ? extras.get(r.id) || 0 : 0;
        return '<tr data-row="' + esc(r.id) + '"' + (sel ? ' class="is-selected"' : "") + ">" +
          '<td class="c-check"><input type="checkbox" class="check" data-select="' + esc(r.id) + '"' + (sel ? " checked" : "") +
          ' aria-label="Select ' + esc(r.name) + '"></td>' +
          '<td class="c-thumb"><span class="sleeve' + (r.sealed ? " boxed" : "") + '">' + imgTag(recordPics(r, "200w"), r.name) + "</span></td>" +
          '<td><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' + esc(r.number) + (isRushNo(r.number) && !r.sealed ? " · Rush Duel" : "") + (r.sell ? " · Selling" : "") + "</span></td>" +
          "<td>" + esc(r.setName) + "</td><td>" + esc(r.rarity) + "</td><td>" + esc(r.edition) + "</td><td>" +
          (r.grade ? esc(gradeLabel(r.grade)) + '<span class="cell-sub">graded</span>' : esc(r.condition)) +
          "</td><td>" + esc(r.language) + "</td>" + (showLoc ? "<td>" + esc(r.location) + "</td>" : "") +
          '<td class="num">' + r.qty + (extra ? '<span class="cell-sub">' + extra + " extra</span>" : "") +
          '</td><td class="num">' + esc(u == null ? "" : usd(u)) + (settingsGradedNote(r)) +
          '</td><td class="num">' + esc(u == null ? "" : usd(u * (settings.gradedView && !r.grade ? 1 : r.qty))) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // On a phone the filters fold away behind one button, which says how many are on.
  function syncFiltersButton() {
    const n = ["fSet", "fRarity", "fEdition", "fLang", "fLocation", "fShow"].filter(id => $(id).value).length;
    $("filtersCount").textContent = n ? String(n) : "";
    $("filtersBtn").classList.toggle("on", n > 0);
  }
  function setSelectMode(on) {
    selectMode = on;
    document.body.classList.toggle("select-mode", on);
    $("selectBtn").setAttribute("aria-pressed", String(on));
    $("selectBtn").textContent = on ? "Done" : "Select";
  }
  function renderBulkBar() {
    for (const id of Array.from(selected)) if (!collection.some(r => r.id === id)) selected.delete(id);
    $("bulkbar").hidden = selected.size === 0 || settings.tab !== "collection";
    $("bulkCount").textContent = selected.size;
    document.body.classList.toggle("selecting", selected.size > 0);
  }
  function setSelected(id, on) {
    if (on) selected.add(id); else selected.delete(id);
    syncSelectionUI();
  }
  // Update checkboxes in place (no redraw), so focus stays put and photos don't reload.
  function syncSelectionUI() {
    document.querySelectorAll("#collection [data-select]").forEach(box => {
      const on = selected.has(box.dataset.select);
      box.checked = on;
      const holder = box.closest(".tile, tr");
      if (holder) holder.classList.toggle("is-selected", on);
    });
    const all = $("selectAllShown");
    if (all) {
      const list = visibleRecords();
      const n = list.filter(r => selected.has(r.id)).length;
      all.checked = n > 0 && n === list.length;
      all.indeterminate = n > 0 && n < list.length;
    }
    renderBulkBar();
  }

  /* ======================= Toasts ======================= */
  function toast(message, opts) {
    opts = opts || {};
    // Only the latest action can be undone: an older "Undo" would silently roll back later changes too.
    if (opts.action) document.querySelectorAll("#toasts .toast.has-action").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = "toast" + (opts.kind === "error" ? " error" : "") + (opts.action ? " has-action" : "");
    el.setAttribute("role", opts.kind === "error" ? "alert" : "status");
    el.innerHTML = "<span>" + esc(message) + "</span>" + (opts.action ? '<button type="button">' + esc(opts.action) + "</button>" : "");
    const close = () => el.remove();
    if (opts.action) el.querySelector("button").addEventListener("click", () => { close(); opts.onAction(); });
    $("toasts").appendChild(el);
    if (!opts.sticky) setTimeout(close, opts.duration || (opts.action ? 9000 : 5000));
    else el.addEventListener("click", close);
    return el;
  }

  /* ======================= Drawer ======================= */
  // While the Add / Settings panel or the import window is open, the page behind it can't be tabbed into (or read by a
  // screen reader as if it were reachable): Tab stays inside the open window.
  function syncBackdrop() {
    const app = document.querySelector(".app");
    if (app) app.inert = !$("drawer").hidden || !$("importModal").hidden;
  }
  function openDrawer(title, html) {
    stopScanner();
    armBack();
    $("drawer").classList.remove("wide");
    if ($("drawer").hidden) lastFocus = document.activeElement;
    $("drawerTitle").textContent = title;
    $("drawerBody").innerHTML = html;
    $("drawerBody").scrollTop = 0;
    $("drawer").hidden = false;
    $("scrim").hidden = false;
    syncBackdrop();
    document.body.classList.add("no-scroll");
    const first = $("drawerBody").querySelector("[autofocus]") || $("drawerClose");
    setTimeout(() => first.focus(), 20);
  }
  function closeDrawer() {
    stopScanner();
    $("drawer").hidden = true;
    syncBackdrop();
    if ($("importModal").hidden) { $("scrim").hidden = true; document.body.classList.remove("no-scroll"); }
    drawerCtx = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    if (dataLoad.raw) setTimeout(applyNewData, 400);   // new prices that waited for this
  }

  /* ----- add a card: search ----- */
  // opts.want: pick a card for the want list instead of the collection.
  function openAdd(opts) {
    opts = opts || {};
    drawerCtx = {mode: "search", replaceId: opts.replaceId || null, want: !!opts.want};
    openDrawer(opts.replaceId ? "Change printing" : opts.want ? "Add to want list" : "Add a card",
      '<form id="lookupForm" autocomplete="off">' +
      '<label class="field"><span>Card number</span></label>' +
      '<div class="lookup-row"><input class="input" id="lookupNumber" autofocus placeholder="e.g. MAMO-EN040" value="' + esc(opts.number || "") + '" aria-label="Card number">' +
      '<button class="btn btn-primary" type="submit">Find</button></div>' +
      '<p class="hint">It\'s printed just under the artwork, on the right side of the card. Japanese and Korean numbers work too, Rush Duel\'s included (like RD/KP25-JP001).</p></form>' +
      '<div class="lookup-alt"><button type="button" class="link-btn" id="goName">Search by name instead</button>' +
      (opts.want ? '<button type="button" class="link-btn" id="goSealedWant">Add a sealed product instead (box, pack, tin, deck…)</button>' : "") +
      (opts.replaceId || opts.want ? "" : '<button type="button" class="link-btn" id="goBatch">Add several cards at once</button>' +
        '<button type="button" class="link-btn" id="goScan">Scan with camera</button>' +
        '<button type="button" class="link-btn" id="goSealed">Add a sealed product (box, pack, tin, deck…)</button>' +
        '<button type="button" class="link-btn" id="goManual">Add manually (not on TCGplayer)</button>') + "</div>" +
      '<div id="lookupOut"></div>');
    $("lookupForm").addEventListener("submit", e => { e.preventDefault(); runNumberLookup($("lookupNumber").value); });
    $("goName").addEventListener("click", () => openNameSearch(opts.replaceId, opts.want));
    if ($("goManual")) $("goManual").addEventListener("click", () => openManual({}));
    if ($("goScan")) $("goScan").addEventListener("click", () => openScanner());
    if ($("goBatch")) $("goBatch").addEventListener("click", () => openBatch({opening: null}));
    if ($("goSealed")) $("goSealed").addEventListener("click", () => openSealedSearch());
    if ($("goSealedWant")) $("goSealedWant").addEventListener("click", () => openSealedSearch("", {want: true}));
    if (opts.number) runNumberLookup(opts.number);
  }

  function noCatalogNotice() {
    if (SITE) return '<div class="notice"><strong>Card lookup needs TCGplayer\'s card list, which didn\'t load.</strong> Check your internet connection and reload the page. Meanwhile you can add the card manually.</div>';
    return '<div class="notice"><strong>Card lookup needs TCGplayer\'s card list.</strong> Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, wait for "Done", then press F5 here. Meanwhile you can add the card manually.</div>';
  }

  function runNumberLookup(value) {
    const out = $("lookupOut");
    const q = normNumber(value);
    if (!q) { out.innerHTML = '<div class="notice">Type the card number first, for example MAMO-EN040.</div>'; return; }
    const ocgM = ocgKey(ocgRegion(q));
    if (!catalog && ocgM && !(drawerCtx && (drawerCtx.want || drawerCtx.replaceId))) { showOcgLookup(out, q, ocgM); return; }
    if (!catalog) { out.innerHTML = noCatalogNotice(); return; }
    const found = findByNumber(q);
    if (found.length) {
      out.innerHTML = '<p class="results-head">' + (found.length === 1
        ? "1 printing on TCGplayer has this number. Pick it to continue."
        : found.length + " printings on TCGplayer have this number. Pick the one that matches your card (compare the photo, set and rarity).") +
        "</p>" + resultsHTML(found);
      wireResults(out, found);
      return;
    }
    const region = ocgM || q.match(/^([A-Z0-9]+)-(JP|JA|KR|AE|TC|SC)([A-Z]?\d+)$/);
    if (region && (region[2] === "JP" || region[2] === "KR") && !(drawerCtx && (drawerCtx.want || drawerCtx.replaceId))) { showOcgLookup(out, q, region); return; }
    // (Rush Duel cards have no English printings to point to)
    const rush = isRushNo(q);
    if (region && region[2] !== "AE" && drawerCtx && drawerCtx.want) {
      out.innerHTML = '<div class="notice"><strong>TCGplayer only sells English cards, so ' + esc(q) + " isn't in its catalog.</strong> " + (rush
        ? "To want a Rush Duel card, find it in Card search (type its number there) or the Market (Japanese or Korean, Rush Duel only) and press Want."
        : "The want list tracks TCGplayer prices, so look up the English printing instead: " + esc(region[1] + "-EN" + region[3]) + ".") + "</div>";
      return;
    }
    if (region && region[2] !== "AE") {
      const en = region[1] + "-EN" + region[3];
      const lang = OCG_REGIONS[region[2]];
      out.innerHTML = '<div class="notice"><strong>TCGplayer only sells English cards, so ' + esc(q) + " isn't in its catalog.</strong> " +
        "You can add it manually." + (rush ? "" : " To fill in the name for you, Card Vault can look up the English printing with the same number, if one exists.") +
        "<br>" + (rush ? "" : '<button class="btn btn-small" type="button" id="tryEnglish">Look up ' + esc(en) + "</button> ") +
        '<button class="btn btn-small" type="button" id="manualOcg">Add manually</button></div><div id="enOut"></div>';
      $("manualOcg").addEventListener("click", () => openManual({number: q, language: lang}));
      if (!rush) $("tryEnglish").addEventListener("click", () => {
        const list = findByNumber(en);
        const enOut = $("enOut");
        if (!list.length) { enOut.innerHTML = '<div class="notice">No English printing uses ' + esc(en) + ". Add the card manually instead.</div>"; return; }
        enOut.innerHTML = '<p class="results-head">English printing with the same number, for reference. Picking it fills in the name and rarity; your card stays ' + esc(lang) + ".</p>" + resultsHTML(list);
        wireResults(enOut, list, p => openManual({number: q, language: lang, name: cleanName(p.name, p.rarity), rarity: p.rarity, setName: p.group.name}));
      });
      return;
    }
    out.innerHTML = '<div class="notice"><strong>No TCGplayer printing has the number ' + esc(q) + ".</strong> Check the number on the card (letters like O and 0 are easy to mix up), search by name, or add it manually.</div>";
  }

  function pricesSummary(p) {
    const parts = printingsFor(p).filter(k => k !== "Normal" || Object.keys(p.prices).length === 1).map(k => {
      const s = p.prices[k];
      const v = s.market != null ? s.market : s.low;
      return v == null ? null : esc(k === "Normal" ? "" : k.replace(" Edition", " Ed.")) + " " + esc(usd(v));
    }).filter(Boolean);
    return parts.length ? parts.join("<br>") : '<span class="small">No recent sales</span>';
  }
  function resultsHTML(list) {
    return '<div class="results">' + list.map((p, i) =>
      '<button type="button" class="result" data-idx="' + i + '">' +
      '<span class="sleeve">' + imgTag(productPics(p, "in_400x400"), p.name) + "</span>" +
      '<span class="result-name">' + esc(cleanName(p.name, p.rarity)) + "</span>" +
      '<span class="result-meta">' + esc(p.group.name) + "</span>" +
      '<span class="result-meta">' + esc(p.number) + ", " + esc(p.rarity || "rarity unknown") + "</span>" +
      '<span class="result-price">' + pricesSummary(p) + "</span></button>").join("") + "</div>";
  }
  function wireResults(container, list, onPick) {
    container.querySelectorAll(".result[data-idx]").forEach(btn => btn.addEventListener("click", () => {
      const p = list[+btn.dataset.idx];
      if (onPick) onPick(p); else openPickedForm(p);
    }));
  }

  function openNameSearch(replaceId, want) {
    drawerCtx = {mode: "name", replaceId: replaceId || null, want: !!want};
    openDrawer(replaceId ? "Change printing" : want ? "Add to want list" : "Add a card",
      '<label class="field"><span>Card name</span><input class="input" id="nameQuery" autofocus placeholder="e.g. Dark Magician" autocomplete="off"></label>' +
      '<div class="lookup-alt"><button type="button" class="link-btn" id="goNumber">Search by card number instead</button></div><div id="nameOut"></div>');
    $("goNumber").addEventListener("click", () => openAdd({replaceId, want}));
    let timer = null;
    const run = () => {
      const out = $("nameOut");
      if (!catalog) { out.innerHTML = noCatalogNotice(); return; }
      const q = $("nameQuery").value;
      if (q.trim().length < 2) { out.innerHTML = ""; return; }
      const res = searchByName(q, 60);
      const ocgHits = want || replaceId ? [] : ocgNameHits(q, 12);
      if (!res.items.length && !ocgHits.length) { out.innerHTML = '<div class="notice">No TCGplayer card name contains "' + esc(q.trim()) + '".' + (ocgCd.data ? " No Japanese or Korean card either." : "") + "</div>"; return; }
      out.innerHTML = (res.items.length ? '<p class="results-head">' + (res.more ? "First 60 of " + res.total.toLocaleString() + " printings. Add more of the name to narrow it down." : plural(res.items.length, "printing") + " found.") + "</p>" + resultsHTML(res.items) : "") +
        (ocgHits.length ? '<p class="results-head">Japanese and Korean printings' + (res.items.length ? "" : ' (no English printing has this name)') + '.</p><div class="results">' +
          ocgHits.map((c, i) => { const priced = c.rows.filter(x => x.local > 0); const row = priced.length ? priced.reduce((a, b) => (b.local < a.local ? b : a)) : c.rows[0] || {local: 0, img: "", rarity: ""}; const mkSet = ocgFindSet(c.set.id);
            return '<button type="button" class="result" data-ocg-idx="' + i + '"><span class="sleeve"' + foilAttr(row.rarity) + ">" + imgTag({list: [row.img].concat(namePics(c.name, "in_400x400", row.rarity).list)}, c.name) + "</span>" +
              '<span class="result-name">' + esc(c.name) + '</span><span class="result-meta">' + esc(mkSet ? mkSet.name : c.set.prefix) + ", " + esc(ocgLangOf(c.region, c.number)) + "</span>" +
              '<span class="result-meta">' + esc(c.number) + (c.rows.length > 1 ? ", " + c.rows.length + " rarities" : ", " + esc(row.rarity || "rarity not stated")) + "</span>" +
              '<span class="result-price">' + (row.local ? ocgMoneyHTML(row.local, c.region) + (c.rows.length > 1 ? ' <span class="small">and up</span>' : "") : '<span class="small">No price</span>') + "</span></button>"; }).join("") + "</div>" : "");
      wireResults(out, res.items);
      out.querySelectorAll("[data-ocg-idx]").forEach(btn => btn.addEventListener("click", () => { const c = ocgHits[+btn.dataset.ocgIdx]; const m = ocgKey(ocgRegion(c.number)); if (!m) return; out.innerHTML = ""; showOcgFromList(out, c, m, {}); if (out.scrollIntoView) out.scrollIntoView({block: "start"}); }));
    };
    if (!want && !replaceId) ocgCardsReady();
    $("nameQuery").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  }

  /* ----- shared form pieces ----- */
  // What you already have of the card (or product) being added, by place: "You already have 3: Binder 1 ×2 · No location ×1".
  // Tapping a place puts it in the form's location field (locId), to keep the new copies with the others. match(r) says
  // which entries count; graded copies and ones away at a grader count too.
  function ownedWhereHTML(match, locId) {
    const mine = collection.filter(match);
    if (!mine.length) return "";
    const by = new Map();
    for (const r of mine) by.set(r.location || "", (by.get(r.location || "") || 0) + r.qty);
    const total = mine.reduce((t, r) => t + r.qty, 0);
    const places = Array.from(by.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return '<div class="owned-where" id="' + locId + 'Owned"><span>You already have <b>' + total + "</b>" + (places.length === 1 && !places[0][0] ? ", in no location." : places.length === 1 ? " in" : ":") + "</span>" +
      (places.length === 1 && !places[0][0] ? "" : places.map(([loc, n]) => '<button type="button" class="chip" data-loc-pick="' + esc(loc) + '" data-loc-field="' + locId + '" title="Put the new ' +
        (total === 1 ? "copy" : "copies") + ' here too">' + esc(locName(loc)) + " ×" + n + "</button>").join("")) + "</div>";
  }
  function wireOwnedWhere(root) {
    (root || $("drawerBody")).querySelectorAll("[data-loc-pick]").forEach(b => b.addEventListener("click", () => {
      const f = $(b.dataset.locField);
      if (f) { f.value = b.dataset.locPick; f.dispatchEvent(new Event("input", {bubbles: true})); }
    }));
  }
  function locationFieldHTML(id, value) {
    return '<label class="field"><span>Location (optional): binder, box or deck</span><input class="input" id="' + id +
      '" list="locationList" autocomplete="off" placeholder="e.g. Binder 1" value="' + esc(value || "") + '"></label>';
  }
  function gradeFieldsHTML(prefix, g) {
    g = g || {};
    return '<details class="more"' + (g.company ? " open" : "") + "><summary>" + (g.company ? "Graded card" : "Graded card? (PSA, BGS, CGC…)") + "</summary>" +
      '<div class="stack" style="margin-top:10px">' +
      '<div class="grid-2"><label class="field"><span>Graded by</span><select class="input" id="' + prefix + 'Company">' +
      options(GRADERS, g.company || "", "Not graded") + "</select></label>" +
      '<label class="field"><span>Grade</span><input class="input" id="' + prefix + 'Grade" placeholder="e.g. 10 or 9.5" value="' + esc(g.grade || "") + '"></label></div>' +
      '<div class="grid-2"><label class="field"><span>Certification number</span><input class="input" id="' + prefix + 'Cert" value="' + esc(g.cert || "") + '"></label>' +
      '<label class="field"><span>Graded value per card (US$)</span><input class="input" id="' + prefix + 'GValue" type="number" min="0" step="0.01" value="' +
      (g.value == null ? "" : g.value) + '"></label></div>' +
      '<p class="hint" style="margin:0">TCGplayer\'s prices are for ungraded cards, so a graded card counts at the value you enter here. Leave it empty to use the ungraded price.</p>' +
      "</div></details>";
  }
  function readGradeFields(prefix) {
    const company = $(prefix + "Company").value;
    return company ? normalizeGrade({company, grade: $(prefix + "Grade").value, cert: $(prefix + "Cert").value, value: $(prefix + "GValue").value}) : null;
  }
  const pickedHeadHTML = (p, backLabel) =>
    '<div class="picked"><span class="sleeve' + (p.sealed ? " boxed" : "") + '">' + imgTag(productPics(p, "in_400x400"), p.name, true) + "</span><div>" +
    "<h3>" + esc(p.sealed ? p.name : cleanName(p.name, p.rarity)) + "</h3><p>" + esc(p.group.name) + "</p>" +
    "<p>" + (p.sealed ? esc(KIND_ONE[mkKind(p.name)] || "Sealed product") : esc(p.number) + ", " + esc(p.rarity)) + "</p>" +
    (backLabel ? '<p style="margin-top:8px"><button type="button" class="link-btn" id="backToSearch">' + esc(backLabel) + "</button></p>" : "") + "</div></div>";
  // "Lightly Played at 85% (Settings): $17.91" when played copies are valued below market.
  function condNote(market, condition) {
    if (market == null || !settings.condAdjust) return "";
    const pct = num(settings.condPct[condition]);
    if (pct == null || pct === 100) return "";
    return '<br><span class="small">' + esc(condition) + " at " + pct + "% (see Settings): " + esc(usd(round2(market * pct / 100))) + "</span>";
  }
  function periodLabel(key) {
    const day = catalog && catalog.refDays[key];
    return day ? "Since " + fmtShortDate(parseDay(day)) : "";
  }
  const sinceLabel = key => periodLabel(key).replace(/^Since/, "since");

  /* ----- add a card: the chosen printing ----- */
  // opts.fromWant: the want-list entry this card came from (it's removed once the card is added).
  function openPickedForm(p, opts) {
    opts = opts || {};
    if (drawerCtx && drawerCtx.mode === "scan") opts.fromScan = true;
    const replacing = drawerCtx && drawerCtx.replaceId ? collection.find(r => r.id === drawerCtx.replaceId) : null;
    if (!replacing && drawerCtx && drawerCtx.want) return openWantForm(p);
    const want = opts.fromWant ? wants.find(w => w.id === opts.fromWant) : null;
    const available = printingsFor(p).filter(k => k !== "Normal");
    const preferred = opts.edition || (replacing && replacing.edition);
    const defaultEd = preferred && available.includes(preferred) ? preferred : (available[0] || (Object.keys(p.prices).length ? "No edition mark" : "1st Edition"));
    drawerCtx = {mode: "picked", product: p, replaceId: replacing ? replacing.id : null, fromWant: want ? want.id : null};
    const last = settings.lastAdd || {};   // (the condition and place of the last card you added are filled in again)
    const v = replacing || {condition: CONDITIONS.includes(last.condition) ? last.condition : "Near Mint", language: "English", qty: want ? want.qty : 1};
    openDrawer(replacing ? "Change printing" : "Add a card",
      pickedHeadHTML(p, want ? "" : "Pick a different printing") +
      (want ? '<div class="notice" style="margin:0 0 14px">From your want list. Adding it to your collection takes it off the want list.</div>' : "") +
      (replacing ? "" : ownedWhereHTML(r => r.productId === p.id, "fLoc")) +
      '<form id="pickedForm" class="stack">' +
      '<div class="grid-2"><label class="field"><span>Printing</span><select class="input" id="fEd">' + options(available.concat(PRINTINGS), defaultEd) + "</select></label>" +
      '<label class="field"><span>Condition</span><select class="input" id="fCond">' + options(CARD_CONDITIONS, v.condition) + "</select></label></div>" +
      sealedCardCheckHTML("fSealedCard", v.condition === SEALED_COND) +
      '<div class="price-line" id="pickedPrice"></div>' +
      '<div class="grid-2"><label class="field"><span>Language</span><select class="input" id="fLanguage">' + options(LANGUAGES, v.language) + "</select></label>" +
      '<label class="field"><span>Quantity</span><input class="input" id="fQty" type="number" min="1" step="1" value="' + (v.qty || 1) + '"></label></div>' +
      (replacing ? "" :
        '<div class="grid-2"><label class="field"><span>Price you paid, each (optional)</span><input class="input" id="fPaid" type="number" min="0" step="0.01" placeholder="$"></label>' +
        '<label class="field"><span>Notes (optional)</span><input class="input" id="fNotes" type="text" value="' + esc(want ? want.notes : "") + '"></label></div>' +
        locationFieldHTML("fLoc", last.location || "") + gradeFieldsHTML("f", null)) +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">' + (replacing ? "Use this printing" : "Add to collection") + "</button>" +
      (replacing || want ? "" : '<button class="btn" type="button" id="toWant">Add to want list instead</button>') + "</div></form>");
    const updatePrice = () => {
      const ed = $("fEd").value;
      const sub = catalogPrice(p, ed);
      const exact = p.prices[ed] || (ed === "No edition mark" && p.prices.Normal);
      let html;
      if (sub && (sub.market != null || sub.low != null)) {
        const price = firstPrice(sub);
        html = "TCGplayer " + (sub.market != null ? "market price" : "lowest listing") + (exact ? " for " + esc(ed) : "") + ": <b>" +
          esc(usd(price)) + "</b>" +
          (catalog.generated ? ' <span class="small">(' + esc(fmtDate(catalog.generated)) + ")</span>" : "");
        if (!exact) html += '<br><span class="small">TCGplayer only lists this printing as ' + esc(Object.keys(p.prices)[0]) + ", so that price is used.</span>";
        html += condNote(price, $("fCond").value);
      } else {
        html = '<span class="small">TCGplayer has no recent sales for this printing' + (Object.keys(p.prices).length ? " in " + esc(ed) : "") + ".</span>";
      }
      $("pickedPrice").innerHTML = html;
    };
    $("fEd").addEventListener("change", updatePrice);
    $("fCond").addEventListener("change", updatePrice);
    wireSealedCard("fSealedCard", "fCond");
    wireOwnedWhere();
    updatePrice();
    if ($("backToSearch")) $("backToSearch").addEventListener("click", () => openAdd({number: p.number, replaceId: replacing ? replacing.id : null}));
    if ($("toWant")) $("toWant").addEventListener("click", () => openWantForm(p, null, {edition: $("fEd").value, notes: $("fNotes").value.trim()}));
    $("pickedForm").addEventListener("submit", e => {
      e.preventDefault();
      const f = {edition: $("fEd").value, condition: $("fCond").value, language: $("fLanguage").value, qty: posInt($("fQty").value) || 1};
      if (replacing) {
        const cur = collection.find(x => x.id === replacing.id);
        if (!cur) { closeDrawer(); toast("That card isn't in your collection anymore, so nothing was saved.", {kind: "error"}); return; }
        Object.assign(cur, {productId: p.id, productName: p.name, name: cleanName(p.name, p.rarity), setName: p.group.name,
          number: p.number, rarity: p.rarity, customImage: null, snap: snapFromCatalog(p, f.edition)}, f);
        save(); render(); closeDrawer();
        toast("Updated to " + p.group.name + ", " + p.number + ".");
        return;
      }
      const rec = upgradeRecord({id: newId(), productId: p.id, name: cleanName(p.name, p.rarity), productName: p.name,
        setName: p.group.name, number: p.number, rarity: p.rarity, edition: f.edition, condition: f.condition,
        language: f.language, qty: f.qty, paid: num($("fPaid").value), notes: $("fNotes").value.trim(),
        location: $("fLoc").value, grade: readGradeFields("f"), snap: snapFromCatalog(p, f.edition), added: new Date().toISOString()});
      const res = addOrMerge(rec);
      settings.lastAdd = {condition: f.condition, location: $("fLoc").value.trim()};
      const stillWanted = want && want.qty > f.qty;
      if (stillWanted) want.qty -= f.qty;
      else if (want) wants = wants.filter(w => w.id !== want.id);
      const fromScan = opts.fromScan;
      save(); render(); closeDrawer();
      if (want) toast("Added " + rec.name + (stillWanted ? ". You still want " + want.qty + " more." : " and took it off your want list."));
      else toast(res.merged ? "Added. You now have " + res.record.qty + " of " + rec.name + " (" + rec.edition + ", " + rec.condition + ")." : "Added " + rec.name + ".",
        fromScan ? {action: "Scan another", onAction: () => openScanner()} : {action: "Add another", onAction: () => openAdd()});
    });
  }

  /* ----- want list: add or edit one card ----- */
  // pre.query: the sealed-product search it came from
  function openWantForm(p, existing, pre) {
    pre = pre || {};
    const sealed = !!p.sealed;
    const available = sealed ? [] : printingsFor(p).filter(k => k !== "Normal");
    const w = existing || {edition: pre.edition && available.includes(pre.edition) ? pre.edition : "Any", target: null, notes: pre.notes || "", qty: pre.qty || 1};
    drawerCtx = {mode: "want", product: p, wantId: existing ? existing.id : null};
    const edOpts = ["Any"].concat(available);
    if (w.edition && !edOpts.includes(w.edition)) edOpts.push(w.edition);
    const owned = collection.filter(r => r.productId === p.id).reduce((s, r) => s + r.qty, 0);
    const targetField = '<label class="field"><span>Your target price (optional)</span><input class="input" id="wTarget" type="number" min="0" step="0.01" placeholder="$" value="' +
      (w.target == null ? "" : w.target) + '"></label>';
    const qtyField = '<label class="field"><span>How many you want</span><input class="input" id="wQty" type="number" min="1" step="1" value="' + (w.qty || 1) + '"></label>';
    const notesField = '<label class="field"><span>Notes (optional)</span><input class="input" id="wNotes" value="' + esc(w.notes || "") + '"></label>';
    openDrawer(existing ? (sealed ? "Want list item" : "Want list card") : "Add to want list",
      pickedHeadHTML(p, existing ? "" : sealed ? "Pick a different product" : "Pick a different printing") +
      '<form id="wantForm" class="stack">' +
      (sealed
        ? '<input type="hidden" id="wEd" value="Any"><div class="grid-2">' + targetField + qtyField + "</div>" + '<div class="price-line" id="wantPrice"></div>' + notesField
        : '<div class="grid-2"><label class="field"><span>Printing you want</span><select class="input" id="wEd">' +
          edOpts.map(k => '<option value="' + esc(k) + '"' + (k === w.edition ? " selected" : "") + ">" + esc(k === "Any" ? "Any printing (cheapest)" : k) + "</option>").join("") +
          "</select></label>" + targetField + "</div>" +
          '<div class="price-line" id="wantPrice"></div>' +
          '<div class="grid-2">' + qtyField + notesField + "</div>") +
      '<p class="hint" style="margin:0">Card Vault flags ' + (sealed ? "it" : "the card") + " when TCGplayer's market price is at or below your target." +
      (owned ? " You already have " + (sealed ? owned : plural(owned, "copy", "copies") + " of this printing") + "." : "") + "</p>" +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">' + (existing ? "Save" : "Add to want list") + "</button>" +
      (existing ? '<button class="btn" type="button" id="wGot">I got it</button><span class="spacer"></span><button class="btn btn-danger" type="button" id="wRemove">Remove</button>' : "") +
      "</div></form>");
    const update = () => {
      const ed = $("wEd").value;
      const price = wantPrice({productId: p.id, edition: ed});
      const target = num($("wTarget").value);
      let html = price == null ? '<span class="small">TCGplayer has no recent price for ' + (sealed ? "this product" : ed === "Any" ? "this card" : "this printing") + ".</span>"
        : "TCGplayer market price" + (sealed ? "" : ed === "Any" ? " (cheapest printing)" : " for " + esc(ed)) + ": <b>" + esc(usd(price)) + "</b>";
      if (price != null && target != null) {
        html += "<br>" + (price <= target ? '<span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>At or below your target</span>'
          : '<span class="small">' + esc(usd(price - target)) + " above your target</span>");
      }
      $("wantPrice").innerHTML = html;
    };
    $("wEd").addEventListener("change", update);
    $("wTarget").addEventListener("input", update);
    update();
    if ($("backToSearch")) $("backToSearch").addEventListener("click", () => sealed ? openSealedSearch(pre.query || "", {want: true}) : openAdd({number: p.number, want: true}));
    if ($("wGot")) $("wGot").addEventListener("click", () => gotWant(existing.id));
    if ($("wRemove")) $("wRemove").addEventListener("click", () => removeWant(existing.id));
    const shownWant = formValues("wantForm");
    $("wantForm").addEventListener("submit", e => {
      e.preventDefault();
      const fields = {edition: $("wEd").value, target: num($("wTarget").value), notes: $("wNotes").value.trim(), qty: posInt($("wQty").value) || 1};
      if (existing) {
        const cur = wants.find(x => x.id === existing.id);
        if (!cur) { closeDrawer(); toast("That isn't on your want list anymore, so nothing was saved.", {kind: "error"}); return; }
        const now = formValues("wantForm");
        if (now.wEd !== shownWant.wEd) cur.edition = fields.edition;
        if (now.wTarget !== shownWant.wTarget) cur.target = fields.target;
        if (now.wNotes !== shownWant.wNotes) cur.notes = fields.notes;
        if (now.wQty !== shownWant.wQty) cur.qty = fields.qty;
        save(); render(); closeDrawer();
        toast("Saved " + cur.name + ".");
        return;
      }
      const base = wantFromProduct(p), name = base.name;
      const res = addWant(Object.assign(base, fields));
      save(); render(); closeDrawer();
      toast(res.merged ? name + " was already on your want list, so it was updated." : "Added " + name + " to your want list.",
        settings.tab === "wants" ? {} : {action: "Show want list", onAction: () => setTab("wants")});
    });
  }

  /* ----- sealed products ----- */
  // Booster boxes and packs, tins, structure decks... anything TCGplayer lists in a set without a card number.
  function searchSealed(q, limit) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!catalog || !words.length) return {items: [], more: false, total: 0};
    const hits = catalog.products.filter(p => {
      if (!p.sealed) return false;
      const hay = p.nameLower + " " + p.group.name.toLowerCase() + " " + String(p.group.abbr || "").toLowerCase();
      return words.every(w => hay.includes(w));
    });
    hits.sort((a, b) => (b.group.published || "").localeCompare(a.group.published || "") || a.name.localeCompare(b.name));
    return {items: hits.slice(0, limit), more: hits.length > limit, total: hits.length};
  }
  function sealedResultsHTML(list) {
    return '<div class="results">' + list.map((p, i) => {
      const v = firstPrice(catalogPrice(p, ""));
      return '<button type="button" class="result" data-idx="' + i + '">' +
        '<span class="sleeve boxed">' + imgTag(productPics(p, "in_400x400"), p.name) + "</span>" +
        '<span class="result-name">' + esc(p.name) + "</span>" +
        '<span class="result-meta">' + esc(p.group.name) + "</span>" +
        '<span class="result-price">' + (v == null ? '<span class="small">No recent sales</span>' : esc(usd(v))) + "</span></button>";
    }).join("") + "</div>";
  }
  // opts.want: for the want list. opts.lang: "English" (TCGplayer), "Japanese" (Yugi-Market) or "Korean" (Bunjang's boxes)
  const SEALED_LANGS = ["English", "Japanese", "Korean"];
  function shopSealedResultsHTML(list) {
    return '<div class="results">' + list.map((it, i) =>
      '<button type="button" class="result" data-idx="' + i + '">' +
        '<span class="sleeve boxed">' + imgTag(it.pics, it.name) + "</span>" +
        '<span class="result-name">' + esc(it.name) + "</span>" +
        '<span class="result-meta">' + esc([it.setName, WANT_ONE[it.kind]].filter(Boolean).join(" · ")) + "</span>" +
        '<span class="result-price">' + (it.price == null ? '<span class="small">No price yet</span>' : esc(usd(it.price)) + (it.soldOut ? ' <span class="small">sold out</span>' : "")) + "</span></button>"
    ).join("") + "</div>";
  }
  function openSealedSearch(q, opts) {
    const forWant = !!(opts && opts.want);
    const lang = SEALED_LANGS.includes(opts && opts.lang) ? opts.lang : "English";
    drawerCtx = {mode: "sealed-search", want: forWant, lang};
    const hints = {
      English: "Booster boxes and packs, tins, structure decks, collections: anything TCGplayer sells sealed. Type a few words of the name or the set.",
      Japanese: "Japanese booster boxes, packs and decks, priced from Yugi-Market. Type a few words of the name or the set's code (like DBVS or RC04).",
      Korean: "Korean booster boxes, priced from the unopened boxes listed on Bunjang. Type a few words of the set's name."};
    openDrawer(forWant ? "Add to want list" : "Add a sealed product",
      '<div class="seg" role="group" aria-label="Language" id="sealedLang" style="margin-bottom:12px">' + SEALED_LANGS.map(l => '<button type="button" data-slang="' + l + '" aria-pressed="' + (l === lang) + '">' + l + "</button>").join("") + "</div>" +
      '<label class="field"><span>Product name or set</span><input class="input" id="sealedQuery" autofocus autocomplete="off" placeholder="' +
        (lang === "English" ? "e.g. Rarity Collection booster box" : lang === "Japanese" ? "e.g. Duelist Nexus box" : "e.g. Rage of the Abyss") + '" value="' + esc(q || "") + '"></label>' +
      '<p class="hint">' + hints[lang] + "</p>" +
      '<div class="lookup-alt"><button type="button" class="link-btn" id="goCards">Add a card instead</button>' +
      (forWant ? "" : '<button type="button" class="link-btn" id="goSealedManual">Not sold sealed anywhere here (an OTS pack, a video game pack…)? Add it by hand</button>') + '</div><div id="sealedOut"></div>');
    $("goCards").addEventListener("click", () => openAdd({want: forWant}));
    if ($("goSealedManual")) $("goSealedManual").addEventListener("click", () => openManual({sealed: true, language: lang, name: $("sealedQuery").value.trim()}));
    $("sealedLang").querySelectorAll("[data-slang]").forEach(b => b.addEventListener("click", () => openSealedSearch($("sealedQuery").value, {want: forWant, lang: b.dataset.slang})));
    let timer = null;
    const run = () => {
      const out = $("sealedOut");
      if (!out) return;
      const text = $("sealedQuery").value;
      if (lang !== "English") {
        // the shop's list is read first (a few seconds, the first time)
        if (lang === "Japanese" && !ymk.list) {
          if (ymk.failed && Date.now() - ymk.failed < 10 * 60000) { out.innerHTML = '<div class="notice">Couldn\'t reach Yugi-Market for its list right now. Try again in a few minutes.</div>'; return; }
          out.innerHTML = '<p class="small">Reading Yugi-Market\'s list…</p>';
          loadYugiMarket().then(() => { if (drawerCtx && drawerCtx.mode === "sealed-search" && drawerCtx.lang === lang) run(); });
          return;
        }
        if (!ocgMk.data) {
          if (!ocgMk.loading && !ocgMk.failed && ocgMarketURL()) loadOcgMarket();
          // (the sets' names come with the Market's list: a Japanese search waits for it when it's on its way)
          if (lang === "Japanese" && ocgMk.loading) { out.innerHTML = '<p class="small">Reading the sets\' names…</p>'; ocgMk.loading.then(() => { if (drawerCtx && drawerCtx.mode === "sealed-search" && drawerCtx.lang === lang) run(); }); return; }
          if (lang === "Korean") {
            if (ocgMk.failed || !ocgMarketURL()) { out.innerHTML = '<div class="notice">Couldn\'t load the Korean box prices right now. Try again in a few minutes.</div>'; return; }
            out.innerHTML = '<p class="small">Reading the Korean box prices…</p>';
            if (ocgMk.loading) ocgMk.loading.then(() => { if (drawerCtx && drawerCtx.mode === "sealed-search" && drawerCtx.lang === lang) run(); });
            return;
          }
        }
        if (text.trim().length < 2) { out.innerHTML = ""; return; }
        const res = searchShopSealed(lang, text, 60);
        if (!res.items.length) {
          out.innerHTML = '<div class="notice">No ' + lang + ' sealed product matches "' + esc(text.trim()) + '". Try fewer words, or the set\'s name.' +
            (lang === "Japanese" ? ' Only products Yugi-Market lists are here; <a target="_blank" rel="noopener" href="https://yugi-market.com/search?q=' + encodeURIComponent(text.trim()) + '">search Yugi-Market</a>.' : "") + "</div>";
          return;
        }
        out.innerHTML = '<p class="results-head">' + (res.more ? "First 60 of " + res.total.toLocaleString() + " products. Add more words to narrow it down." : plural(res.items.length, "product") + " found.") + "</p>" + shopSealedResultsHTML(res.items);
        out.querySelectorAll(".result").forEach(btn => btn.addEventListener("click", () => {
          const it = res.items[+btn.dataset.idx], query = $("sealedQuery").value;
          if (forWant) { (lang === "Japanese" ? ymWant : krBoxWant)(it.src); closeDrawer(); }
          else openShopSealedForm(it, {query});
        }));
        return;
      }
      if (!catalog) { out.innerHTML = noCatalogNotice(); return; }
      if (text.trim().length < 2) { out.innerHTML = ""; return; }
      const res = searchSealed(text, 60);
      if (!res.items.length) {
        out.innerHTML = '<div class="notice">No sealed product on TCGplayer matches "' + esc(text.trim()) + '". Try fewer words, or the set\'s name.' +
          (catalog.products.some(p => p.sealed) ? "" : " (The price data doesn't include sealed products yet: they arrive with the next daily update.)") + "</div>";
        return;
      }
      out.innerHTML = '<p class="results-head">' + (res.more ? "First 60 of " + res.total.toLocaleString() + " products. Add more words to narrow it down." : plural(res.items.length, "product") + " found.") + "</p>" + sealedResultsHTML(res.items);
      out.querySelectorAll(".result").forEach(btn => btn.addEventListener("click", () => {
        const p = res.items[+btn.dataset.idx], query = $("sealedQuery").value;
        if (forWant) openWantForm(p, null, {query}); else openSealedForm(p, query);
      }));
    };
    $("sealedQuery").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 220); });
    if (lang === "Japanese" && !ymk.list) loadYugiMarket();
    if (lang === "Korean" && !ocgMk.data && !ocgMk.loading && ocgMarketURL()) loadOcgMarket();
    if (q) run();
  }
  // opts.fromWant: the want-list entry this product came from (it's taken off once the product is added)
  function openSealedForm(p, query, opts) {
    const want = opts && opts.fromWant ? wants.find(w => w.id === opts.fromWant) : null;
    drawerCtx = {mode: "sealed", product: p};
    const v = firstPrice(catalogPrice(p, ""));
    openDrawer("Add a sealed product",
      '<div class="picked"><span class="sleeve boxed">' + imgTag(productPics(p, "in_400x400"), p.name, true) + "</span><div>" +
      "<h3>" + esc(p.name) + "</h3><p>" + esc(p.group.name) + "</p>" +
      (want ? "" : '<p style="margin-top:8px"><button type="button" class="link-btn" id="backToSearch">Pick a different product</button></p>') + "</div></div>" +
      (want ? fromWantNotice : "") +
      ownedWhereHTML(r => r.productId === p.id, "sLocS") +
      '<form id="sealedForm" class="stack">' +
      '<div class="price-line">' + (v == null ? '<span class="small">TCGplayer has no recent sales for this product.</span>'
        : "TCGplayer market price: <b>" + esc(usd(v)) + "</b>" + (catalog && catalog.generated ? ' <span class="small">(' + esc(fmtDate(catalog.generated)) + ")</span>" : "")) + "</div>" +
      '<div class="grid-2"><label class="field"><span>Quantity</span><input class="input" id="sQtyS" type="number" min="1" step="1" value="' + (want ? want.qty : 1) + '"></label>' +
      '<label class="field"><span>Price you paid, each (optional)</span><input class="input" id="sPaidS" type="number" min="0" step="0.01" placeholder="$"></label></div>' +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="sNotesS"></label>' +
      locationFieldHTML("sLocS", "") +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Add to collection</button></div></form>');
    if ($("backToSearch")) $("backToSearch").addEventListener("click", () => openSealedSearch(query));
    wireOwnedWhere();
    $("sealedForm").addEventListener("submit", e => {
      e.preventDefault();
      const rec = upgradeRecord({id: newId(), productId: p.id, sealed: true, name: p.name, productName: p.name, setName: p.group.name,
        number: "", rarity: "", edition: "", condition: "Sealed", language: "English", qty: posInt($("sQtyS").value) || 1,
        paid: num($("sPaidS").value), notes: $("sNotesS").value.trim(), location: $("sLocS").value, snap: snapFromCatalog(p, ""),
        added: new Date().toISOString()});
      const res = addOrMerge(rec);
      const took = want ? tookWant(want.id, rec.qty) : "";
      save(); render(); closeDrawer();
      if (want) { toast("Added " + rec.name + took); return; }
      toast(res.merged ? "Added. You now have " + res.record.qty + " of " + rec.name + "." : "Added " + rec.name + ".",
        {action: "Add another", onAction: () => openSealedSearch()});
    });
  }
  // A Japanese or Korean sealed product from a shop (Yugi-Market, Bunjang): chosen in the sealed search, in the Market, or
  // from the want list ("I got it", opts.fromWant). It goes in the collection valued at the shop's price, which it follows
  // from then on; a value of your own is only kept if you enter one.
  function openShopSealedForm(it, opts) {
    opts = opts || {};
    const want = opts.fromWant ? wants.find(w => w.id === opts.fromWant) : null;
    drawerCtx = {mode: "shop-sealed", item: it};
    const price = it.price, src = it.shop || "the shop";
    openDrawer("Add a sealed product",
      '<div class="picked"><span class="sleeve boxed">' + imgTag(it.pics, it.name, true) + "</span><div>" +
      "<h3>" + esc(it.name) + "</h3><p>" + esc(it.setName) + "</p><p>" + esc(WANT_ONE[it.kind] + ", " + it.language) + "</p>" +
      (want ? "" : '<p style="margin-top:8px"><button type="button" class="link-btn" id="backToSearch">Pick a different product</button></p>') + "</div></div>" +
      (want ? fromWantNotice : "") +
      (it.ref ? ownedWhereHTML(r => r.sealed && r.ref === it.ref, "gLoc") : "") +
      '<form id="shopSealedForm" class="stack">' +
      '<div class="price-line">' + (price != null ? esc(src) + " price: <b>" + esc(usd(price)) + "</b>" + (it.soldOut ? ' <span class="small">(sold out right now)</span>' : "") : '<span class="small">No price yet.</span>') + "</div>" +
      '<div class="grid-2"><label class="field"><span>Quantity</span><input class="input" id="gQty" type="number" min="1" step="1" value="' + (want ? want.qty || 1 : 1) + '"></label>' +
      '<label class="field"><span>Price you paid, each (optional)</span><input class="input" id="gPaid" type="number" min="0" step="0.01" placeholder="$"></label></div>' +
      (it.ref ? '<label class="field"><span>Value each in US$ (optional)</span><input class="input" id="gValue" type="number" min="0" step="0.01" placeholder="' +
        (price != null ? esc(price.toFixed(2)) : "$") + '"></label>' +
        '<p class="hint" style="margin:-6px 0 0">Left empty, its value follows the ' + esc(src) + " price and moves when that does. Enter a value only to fix it yourself.</p>"
        : '<label class="field"><span>Value each in US$ (optional)</span><input class="input" id="gValue" type="number" min="0" step="0.01" placeholder="' + (price != null ? esc(price.toFixed(2)) : "$") + '"></label>') +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="gNotes" value="' + esc(want && !/^(japanese|korean)$/i.test(want.notes) ? want.notes || "" : "") + '"></label>' +
      locationFieldHTML("gLoc", "") +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Add to collection</button></div></form>');
    if ($("backToSearch")) $("backToSearch").addEventListener("click", () => openSealedSearch(opts.query || "", {lang: it.language}));
    wireOwnedWhere();
    $("shopSealedForm").addEventListener("submit", e => {
      e.preventDefault();
      const cur = want ? wants.find(x => x.id === want.id) : null;
      if (want && !cur) { closeDrawer(); toast("That isn't on your want list anymore, so nothing was added.", {kind: "error"}); return; }
      const value = num($("gValue").value);
      const rec = upgradeRecord({id: newId(), productId: null, sealed: true, name: it.name, productName: it.name, setName: it.setName,
        number: "", rarity: "", edition: "", condition: "Sealed", language: it.language, qty: posInt($("gQty").value) || 1,
        paid: num($("gPaid").value), manualPrice: it.ref ? value : value != null ? value : price, customImage: it.image || null,
        ref: it.ref || null, shop: it.shop, link: it.link, shopPrice: price,
        notes: $("gNotes").value.trim(), location: $("gLoc").value, added: new Date().toISOString()});
      const res = addOrMerge(rec);
      const took = cur ? tookWant(cur.id, rec.qty) : "";
      shopPricesReady();
      keepShopPrices();
      save(); render(); closeDrawer();
      if (cur) { toast("Added " + rec.name + took); return; }
      toast(res.merged ? "Added. You now have " + res.record.qty + " of " + rec.name + "." : "Added " + rec.name + ".",
        {action: "Add another", onAction: () => openSealedSearch("", {lang: it.language})});
    });
  }
  // "I got it" for a Japanese or Korean sealed product on the want list
  function openShopGotForm(w) { openShopSealedForm(wantItem(w), {fromWant: w.id}); }

  /* ----- add manually ----- */
  function manualLinks(name, number) {
    const q = encodeURIComponent((name || "").trim());
    const qn = encodeURIComponent(((number || "") + " " + (name || "")).trim());
    if (!q && !qn) return "";
    return '<div class="links" style="justify-content:flex-start;margin:4px 0 0">' +
      '<a target="_blank" rel="noopener" href="https://auctions.yahoo.co.jp/search/search?p=' + qn + '">Yahoo! Auctions Japan</a>' +
      '<a target="_blank" rel="noopener" href="https://search.shopping.naver.com/search/all?query=' + qn + '">Naver Shopping (Korea)</a>' +
      '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + qn + '">eBay</a></div>';
  }
  const isRegionNumber = n => /^(RD\/)?[A-Z0-9]+-(JP|JA|KR|AE|TC|SC)[A-Z]?\d+$/.test(normNumber(n));
  // pre.sealed: a sealed product (box, pack, tin, deck…) that no shop lists, kept at your own value
  function openManual(pre) {
    drawerCtx = {mode: "manual"};
    const rarities = allRarities();
    openDrawer("Add manually",
      (pre.fromWant ? fromWantNotice : '<p class="small" style="margin:0 0 14px">For Japanese and Korean cards, or anything TCGplayer doesn\'t list. Only the name is required.</p>') +
      '<form id="manualForm" class="stack' + (pre.sealed ? " m-sealed" : "") + '">' +
      '<label class="check-row" style="margin:0 0 4px"><input type="checkbox" class="check" id="mSealed"' + (pre.sealed ? " checked" : "") + '> <span>This is a sealed product (a box, pack, tin or deck, not a card)</span></label>' +
      '<label class="field"><span><span class="m-card-word">Card</span><span class="m-sealed-word">Product</span> name</span><input class="input" id="mName" required autofocus value="' + esc(pre.name || "") + '"></label>' +
      '<div class="grid-2"><label class="field m-card"><span>Card number</span><input class="input" id="mNumber" value="' + esc(pre.number || "") + '" style="text-transform:uppercase"></label>' +
      '<label class="field"><span>Set</span><input class="input" id="mSet" value="' + esc(pre.setName || "") + '"></label></div>' +
      '<div class="grid-2 m-card"><label class="field"><span>Rarity</span><select class="input" id="mRarity">' + options(rarities, pre.rarity || "", "Choose rarity") + "</select></label>" +
      '<label class="field"><span>Printing</span><select class="input" id="mEd">' + options(PRINTINGS, pre.edition || (pre.language === "Japanese" ? "No edition mark" : "1st Edition")) + "</select></label></div>" +
      '<div class="grid-2"><label class="field m-card"><span>Condition</span><select class="input" id="mCond">' + options(CARD_CONDITIONS, "Near Mint") + "</select></label>" +
      '<label class="field"><span>Language</span><select class="input" id="mLang">' + options(LANGUAGES, pre.language || "English") + "</select></label></div>" +
      '<div class="m-card">' + sealedCardCheckHTML("mSealedCard", false) + "</div>" +
      '<div class="grid-2"><label class="field"><span>Quantity</span><input class="input" id="mQty" type="number" min="1" step="1" value="1"></label>' +
      '<label class="field"><span>Value <span class="m-card-word">per card</span><span class="m-sealed-word">each</span> in US$ (your estimate)</span><input class="input" id="mValue" type="number" min="0" step="0.01"></label></div>' +
      '<p class="hint m-sealed-word" style="margin:-6px 0 0">No shop Card Vault reads sells this sealed, so it has no price of its own: the value you enter here is what it counts for (you can change it under Edit anytime).</p>' +
      '<div class="grid-2 m-card"><label class="field"><span>Japan price (¥)</span><input class="input" id="mJp" type="number" min="0" step="1"></label>' +
      '<label class="field"><span>Korea price (₩)</span><input class="input" id="mKr" type="number" min="0" step="1"></label></div>' +
      '<div id="mLinks"></div><div id="mOwnedBox"></div>' +
      '<div class="field"><span>Photo (optional)</span>' +
      '<div class="lookup-row"><input class="input" id="mImage" type="url" placeholder="Paste a photo link, or find one" aria-label="Photo link" style="text-transform:none">' +
      '<button class="btn m-card" type="button" id="mFind">Find photos</button></div>' +
      '<p class="hint m-card">Find photos looks up the card number on Yugipedia, including Japanese and Korean prints.</p><div id="mYugi" class="yugi"></div></div>' +
      '<div class="grid-2"><label class="field"><span>Price you paid, each (optional)</span><input class="input" id="mPaid" type="number" min="0" step="0.01"></label>' +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="mNotes"></label></div>' +
      locationFieldHTML("mLoc", "") + '<div class="m-card">' + gradeFieldsHTML("m", null) + "</div>" +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Add to collection</button></div></form>');
    const fromWant = pre.fromWant ? wants.find(w => w.id === pre.fromWant) : null;
    if (fromWant) $("mQty").value = String(fromWant.qty || 1);
    const isSealed = () => $("mSealed").checked;
    wireSealedCard("mSealedCard", "mCond");
    $("mSealed").addEventListener("change", () => { $("manualForm").classList.toggle("m-sealed", isSealed()); refreshLinks(); });
    const refreshOwned = () => {
      const number = isSealed() ? "" : normNumber($("mNumber").value), name = $("mName").value.trim().toLowerCase();
      const box = $("mOwnedBox");
      if (!box) return;
      box.innerHTML = !number && !name ? "" : ownedWhereHTML(r => !!r.sealed === isSealed() && (number ? normNumber(r.number) === number : r.name.trim().toLowerCase() === name), "mLoc");
      wireOwnedWhere(box);
    };
    const refreshLinks = () => { $("mLinks").innerHTML = isSealed() ? "" : manualLinks($("mName").value, $("mNumber").value); refreshOwned(); };
    $("mName").addEventListener("input", refreshLinks);
    $("mNumber").addEventListener("input", refreshLinks);
    refreshLinks();
    const find = () => showYugiPicker($("mYugi"), $("mNumber").value, $("mName").value, $("mRarity").value, url => { $("mImage").value = url; });
    $("mFind").addEventListener("click", find);
    if (pre.number && isRegionNumber(pre.number) && !pre.sealed) find();
    $("manualForm").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("mName").value.trim();
      if (!name) return;
      const image = $("mImage").value.trim();
      if (image && !safeImg(image)) { toast("The image link must start with http:// or https://.", {kind: "error"}); return; }
      const sealed = isSealed();
      const rec = upgradeRecord(sealed
        ? {id: newId(), productId: null, sealed: true, name, productName: name, setName: $("mSet").value.trim(), number: "", rarity: "", edition: "", condition: "Sealed",
          language: $("mLang").value, qty: posInt($("mQty").value) || 1, manualPrice: num($("mValue").value), customImage: image, paid: num($("mPaid").value),
          notes: $("mNotes").value.trim(), location: $("mLoc").value, added: new Date().toISOString()}
        : {id: newId(), productId: null, name, productName: name, setName: $("mSet").value.trim(),
          number: normNumber($("mNumber").value), rarity: $("mRarity").value, edition: $("mEd").value, condition: $("mCond").value,
          language: $("mLang").value, qty: posInt($("mQty").value) || 1, manualPrice: num($("mValue").value),
          jp: num($("mJp").value), kr: num($("mKr").value), customImage: image, paid: num($("mPaid").value),
          notes: $("mNotes").value.trim(), location: $("mLoc").value, grade: readGradeFields("m"), added: new Date().toISOString()});
      const res = addOrMerge(rec);
      const took = pre.fromWant ? tookWant(pre.fromWant, rec.qty) : "";
      save(); render(); closeDrawer();
      if (took) { toast("Added " + name + took); return; }
      toast(res.merged ? "Added. You now have " + res.record.qty + " of " + name + "." : "Added " + name + ".");
    });
  }
  function allRarities() {
    const extra = new Set();
    if (catalog) catalog.rarities.forEach(r => extra.add(r));
    collection.forEach(r => r.rarity && extra.add(r.rarity));
    BASE_RARITIES.forEach(r => extra.delete(r));
    return BASE_RARITIES.concat(Array.from(extra).sort());
  }

  /* ----- details & edit ----- */
  // Where your other copies of the same card (same TCGplayer printing, or same number and name) are kept.
  function otherCopiesHTML(r) {
    const others = collection.filter(x => x !== r && (r.productId ? x.productId === r.productId
      : !x.productId && !!r.number && normNumber(x.number) === normNumber(r.number) && x.name.toLowerCase() === r.name.toLowerCase()));
    if (!others.length) return "";
    const diff = x => [x.edition !== r.edition ? x.edition : "", gradeLabel(x.grade) !== gradeLabel(r.grade) ? gradeLabel(x.grade) || "ungraded" : "",
      x.condition !== r.condition && !x.grade ? x.condition : "", x.language !== r.language ? x.language : ""].filter(Boolean).join(", ");
    return '<p class="other-copies">You also have ' + others.map(x => '<button type="button" class="link-btn" data-other="' + esc(x.id) + '">' +
      esc(x.qty + " " + (x.location ? "in " + x.location : "with no location")) + "</button>" + (diff(x) ? " (" + esc(diff(x)) + ")" : "")).join(", ") + ".</p>";
  }
  // A Japanese or Korean card's price: from BIGWEB or Bunjang, or yours.
  function ocgPriceHTML(r) {
    const pi = priceInfo(r), op = ocgPrice(r), g = ocgRegion(r.number), fp = ocgFilePrice(r);
    const fx = fxNow();
    let html = "";
    if (op && !op.none) {
      html += "<p>" + esc(op.src) + ": <b>" + esc(fmtLocal(op.local, op.cur)) + "</b>" + (op.usd != null ? " ≈ <b>" + esc(usd(op.usd)) + "</b>" : "") +
        ' <span class="small">(' + esc(r.rarity || "") + (r.rarity ? ", " : "") + esc(op.note) + ")</span></p>" +
        (fp && !fp.none ? ocgChangesHTML(fp.row, "Price change") : "");
    } else if (op && op.none && fp && fp.none && !fp.row && fp.card && fp.card.rows.some(x => mangaOf(x.rarity))) {
      // (a Manga-Style card entered with no version, or a plain rarity: there is no one price to show for it)
      html += '<p class="small">This card comes in separate versions, each with its own price. Change its rarity (Edit) to the one you have:</p><ul class="small">' +
        fp.card.rows.map(x => "<li>" + esc(x.rarity) + ": " + (x.local ? esc(fmtLocal(x.local, OCG_CUR[fp.card.region])) + (ocgUSD(x.local, fp.card.region) != null ? " ≈ " + esc(usd(ocgUSD(x.local, fp.card.region))) : "") : "no price") + "</li>").join("") + "</ul>";
    } else if (op && op.none) {
      html += '<p class="small">' + esc(op.src) + " has no price for " + esc(r.rarity || "this card") + (op.note ? " (" + esc(op.note) + ")" : "") + ".</p>";
    } else if (!ocgLiveOK(g)) {
      html += '<p class="small">' + (ocgCd.data ? "Card Vault's daily list has no Fullahead price for this card yet." : ocgCd.loading ? "Loading Card Vault's daily list…" : "Card Vault's daily list didn't load, so there's no Fullahead price right now.") + "</p>";
    } else {
      html += '<p class="small">Checking ' + esc(ocgSrc(g.region, g.code)) + "…</p>";
    }
    const mine = g.region === "JP" ? r.jp : r.kr;
    if (pi.from === "manual") html += '<p class="price-yours">Your estimate, <b>' + esc(usd(pi.unit)) + '</b>, is used while no shop price is found.</p>';
    else if (pi.from === "local") html += '<p class="price-yours">Your price, <b>' + esc(fmtLocal(pi.local, pi.cur)) + " ≈ " + esc(usd(pi.unit)) + "</b>, is used while no shop price is found.</p>";
    else if (pi.from === "ocg" && !pi.kept && (r.manualPrice != null || mine != null)) html += '<p class="small">The price above is used' +
      (r.manualPrice != null ? ", not your estimate of " + esc(usd(r.manualPrice)) : ", not the " + esc(fmtLocal(mine, g.region === "JP" ? "JPY" : "KRW")) + " you entered") + ".</p>";
    if (pi.from === "ocg" && !pi.kept && marketValue(r).factor != null && marketValue(r).factor !== 1) html += '<p class="price-yours">Your copy: <b>' + esc(usd(marketValue(r).unit)) +
      '</b> <span class="small">(' + esc(r.condition) + " at " + Math.round(marketValue(r).factor * 100) + "% of that price, see Settings)</span></p>";
    const when = op && op.at ? (op.file ? "From Card Vault's daily price list, " + fmtDate(new Date(op.at)) : "Checked " + fmtDateTime(new Date(op.at))) : "";
    const shop = ocgSrc(g.region, g.code);
    html += '<p class="small"><a href="' + esc(ocgShopURL(g.region, g.code)) + '" target="_blank" rel="noopener">' + esc(shop) + "</a>" + esc(ocgShopAbout(g.region, g.code).slice(shop.length)) +
      (when ? " " + esc(when) + "." : "") + (fx ? " US$ at " + esc(fx.JPY.toFixed(1)) + " yen and " + esc(Math.round(fx.KRW).toLocaleString()) + " won to the dollar." : "") +
      (ocgLiveOK(g) ? ' <button type="button" class="link-btn" id="ocgCheck">Check again now</button>' : "") + "</p>";
    return html;
  }
  // What this card is worth graded: PriceCharting's prices by grade, or the estimate, plus your own graded copy.
  function gradedBoxHTML(r) {
    const ten = psa10Value(r), p = pcKnown(r);
    let html = "";
    if (p) {
      const rows = [["10", "PSA 10"], ["9.5", "Grade 9.5"], ["9", "Grade 9"], ["8", "Grade 8"], ["7", "Grade 7"], ["bgs10", "BGS 10"], ["cgc10", "CGC 10"], ["sgc10", "SGC 10"]].filter(([k]) => p[k] != null);
      html += '<table class="price-table"><thead><tr><th>Grade</th><th class="num">Sold for</th></tr></thead><tbody>' +
        '<tr><td>Ungraded</td><td class="num">' + esc(p.raw == null ? "" : usd(p.raw)) + "</td></tr>" +
        rows.map(([k, label]) => '<tr' + (k === "10" ? ' class="mine"' : "") + "><td>" + label + '</td><td class="num">' + esc(usd(p[k])) + "</td></tr>").join("") + "</tbody></table>" +
        '<p class="small">PriceCharting (eBay sales' + (p.vol ? ", about " + plural(Math.round(p.vol), "sale") + " a year" : "") + '): <a href="' + esc("https://www.pricecharting.com/game/" + encodeURIComponent(p.id)) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a>.</p>";
    } else if (ten && ten.from === "estimate") {
      html += "<p>PSA 10, rough estimate: <b>" + esc(usd(ten.unit)) + '</b> <span class="small">(raw ' + esc(usd(ten.raw)) + " × " + esc(num(settings.psa10Mult) == null ? 4 : settings.psa10Mult) + " + " +
        esc(usd(num(settings.psa10Floor) == null ? 25 : settings.psa10Floor)) + ", see Settings)</span></p>" +
        '<p class="small">' + (!pcOn() ? "For real graded prices, add a PriceCharting key in Settings."
          : pcBad() ? "PriceCharting didn't accept your key (Settings)."
          : r.language === "Korean" ? "PriceCharting doesn't list Korean cards."
          : r.pcId === "none" ? 'You marked it as not on PriceCharting. <button type="button" class="link-btn" data-pc-fix="' + esc(r.id) + '">Look again</button>'
          : 'PriceCharting has no match for this card yet. <button type="button" class="link-btn" data-pc-fix="' + esc(r.id) + '">Find it on PriceCharting</button>') + "</p>";
    } else if (!ten) {
      html += '<p class="small">No price to estimate from yet.</p>';
    }
    if (ten && ten.from === "yours") html += '<p class="price-yours">Your PSA 10 value: <b>' + esc(usd(ten.unit)) + "</b></p>";
    if (r.grade) {
      const gv = gradedValue(r);
      if (gv) html += '<p class="price-yours">Your ' + esc(gradeLabel(r.grade)) + " copy: <b>" + esc(usd(gv.unit)) + "</b> " +
        '<span class="small">(' + (gv.from === "yours" ? "the graded value you entered" : gv.from === "pricecharting" ? "PriceCharting, this grade" :
          gv.share != null ? Math.round(gv.share * 100) + "% of the PSA 10 value, see Settings" : "estimate") + ")</span></p>";
    }
    return html;
  }
  function openDetails(id, opts) {
    opts = opts || {};
    let r = collection.find(x => x.id === id);
    if (!r) return;
    drawerCtx = {mode: "details", id};
    const product = catalog && r.productId ? catalog.byId.get(r.productId) : null;
    const pi = priceInfo(r);
    const mv = marketValue(r);
    const bigPics = recordPics(r, "in_1000x1000"), big = firstPhoto(bigPics);
    const q = encodeURIComponent((r.number + " " + lookupName(r.name)).trim());
    let links = "";
    if (r.productId) links += '<a target="_blank" rel="noopener" href="' + esc(tcgPage(r.productId)) + '">View on TCGplayer</a>';
    if (r.sealed) links += '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(r.name) + '">eBay</a>';
    else links += '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + q + (r.edition === "1st Edition" ? "+1st" : "") + '">eBay</a>' +
      '<a target="_blank" rel="noopener" href="https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=' + encodeURIComponent(lookupName(r.name)) + '">Cardmarket</a>' +
      '<a target="_blank" rel="noopener" href="https://auctions.yahoo.co.jp/search/search?p=' + encodeURIComponent(lookupName(r.name)) + '">Yahoo! Auctions JP</a>' +
      '<a target="_blank" rel="noopener" href="https://search.shopping.naver.com/search/all?query=' + encodeURIComponent(lookupName(r.name)) + '">Naver (Korea)</a>';

    let priceSection = '<div class="section"><h3>TCGplayer price</h3>';
    if (r.sealed && product && Object.keys(product.prices).length) {
      const sub = catalogPrice(product, "");
      priceSection += sub ? '<table class="price-table"><thead><tr><th>Sealed</th><th class="num">Market</th><th class="num">Lowest listing</th></tr></thead><tbody>' +
        '<tr class="mine"><td>Yours</td><td class="num">' + esc(sub.market == null ? "no sales" : usd(sub.market)) + '</td><td class="num">' + esc(sub.low == null ? "" : usd(sub.low)) +
        "</td></tr></tbody></table>" : "";
      const changes = sub && sub.market != null ? PERIODS.filter(([k]) => sub[k] != null).map(([k]) =>
        "<span>" + esc(periodLabel(k)) + ": " + changeHTML(sub.market - sub[k], sub[k] > 0 ? (sub.market - sub[k]) / sub[k] : null, true) + "</span>") : [];
      if (changes.length) priceSection += '<div class="changes" aria-label="Market price change">' + changes.join("") + "</div>";
      priceSection += '<p class="small">From TCGplayer, ' + esc(fmtDate(catalog.generated)) + ".</p>";
    } else if (product && Object.keys(product.prices).length) {
      priceSection += '<table class="price-table"><thead><tr><th>Printing</th><th class="num">Market</th><th class="num">Lowest listing</th></tr></thead><tbody>' +
        printingsFor(product).map(k => {
          const s = product.prices[k];
          const mine = k === r.edition || (Object.keys(product.prices).length === 1);
          return "<tr" + (mine ? ' class="mine"' : "") + "><td>" + esc(k) + (mine ? " (yours)" : "") + '</td><td class="num">' +
            esc(s.market == null ? "no sales" : usd(s.market)) + '</td><td class="num">' + esc(s.low == null ? "" : usd(s.low)) + "</td></tr>";
        }).join("") + "</tbody></table>";
      const sub = catalogPrice(product, r.edition);
      const changes = sub && sub.market != null ? PERIODS.filter(([k]) => sub[k] != null).map(([k]) =>
        "<span>" + esc(periodLabel(k)) + ": " + changeHTML(sub.market - sub[k], sub[k] > 0 ? (sub.market - sub[k]) / sub[k] : null, true) + "</span>") : [];
      if (changes.length) priceSection += '<div class="changes" aria-label="Market price change for your printing">' + changes.join("") + "</div>";
      priceSection += '<p class="small">From TCGplayer, ' + esc(fmtDate(catalog.generated)) + ". Market price is what the card has recently sold for.</p>";
    } else if (r.sealed && r.ref) {
      // a Japanese or Korean box from a shop: the shop's price, which it follows
      const live = shopWantLive(r), shopName = r.shop || "Shop";
      priceSection = '<div class="section"><h3>' + esc(shopName) + " price</h3>" +
        (pi.from === "manual" ? "<p>" + esc(usd(pi.unit)) + ' <span class="small">(the value you entered' + (live != null ? "; " + esc(shopName) + "'s price now is " + esc(usd(live)) : "") +
          "). Clear it below to follow the shop's price.)</span></p>"
          : pi.unit != null ? "<p>" + esc(usd(pi.unit)) + ' <span class="small">' + (pi.kept ? "(as of last time: " + esc(shopName) + " can't be reached right now, or no longer lists it)"
            : pi.soldOut ? "(sold out at " + esc(shopName) + " right now)" : "(" + esc(shopName) + "'s price now)") + "</span></p>"
          : '<p class="small">' + esc(shopName) + " has no price for it yet.</p>") +
        (r.link ? '<p class="small"><a target="_blank" rel="noopener" href="' + esc(r.link) + '">See it at ' + esc(shopName) + "</a></p>" : "");
    } else if (isOcg(r)) {
      priceSection = '<div class="section"><h3>' + esc(ocgLangOf(ocgRegion(r.number).region, r.number)) + ' price</h3><div id="ocgPrice">' + ocgPriceHTML(r) + "</div>";
    } else if (pi.from === "saved") {
      priceSection += "<p>" + esc(usd(pi.unit)) + ' <span class="small">from your CSV' + (pi.date ? ", " + esc(fmtDate(pi.date)) : "") + ".</span></p>" +
        (r.productId && !SITE ? '<p class="small">Run Update TCGplayer Data for today\'s price.</p>' : "");
    } else if (pi.from === "manual") {
      priceSection += "<p>" + esc(usd(pi.unit)) + ' <span class="small">(your estimate)</span></p>';
    } else {
      priceSection += '<p class="small">' + (r.productId ? "No recent TCGplayer sales for this printing." : "This card isn't linked to a TCGplayer printing, so enter your own estimate below.") + "</p>";
    }
    if (r.grade) {
      priceSection += '<p class="price-yours">' + (r.grade.value != null
        ? "Your " + esc(gradeLabel(r.grade)) + " copy: <b>" + esc(usd(r.grade.value)) + '</b> <span class="small">(the graded value you entered)</span>'
        : '<span class="small">Graded ' + esc(gradeLabel(r.grade)) + ". Enter its graded value below; until then it counts at the ungraded price.</span>") + "</p>";
    } else if (mv.factor != null && mv.factor !== 1) {
      priceSection += '<p class="price-yours">Your copy: <b>' + esc(usd(mv.unit)) + '</b> <span class="small">(' + esc(r.condition) + " at " +
        Math.round(mv.factor * 100) + "% of market. You can change the percentages in Settings.)</span></p>";
    }
    priceSection += (r.sealed ? "" : '<div id="otherMarkets"><button type="button" class="btn btn-small" id="otherBtn">Check other markets</button></div>') + "</div>" +
      ((product && SITE) || (isOcg(r) && ocgHistoryBase()) ? '<div class="section"><h3>Price over time</h3><div id="cardHist" class="card-hist"><p class="small">Loading…</p></div></div>' : "") +
      (r.sealed ? "" : '<div class="section"><h3>Graded value</h3><div id="gradedBox">' + gradedBoxHTML(r) + "</div></div>" +
        '<div class="section" id="gradeItSec"><h3>' + (r.grading ? "At the grader" : r.grade ? "Graded" : "Get it graded") + '</h3><div id="gradeIt">' +
        gradeItHTML(r, opts.grading === "back" ? "back" : opts.grading === "sent" ? "sent" : "") + "</div></div>");

    const photoOpen = r.customImage || (!r.productId && !r.customImage);
    const cardOnly = html => r.sealed ? "" : html;
    openDrawer(r.sealed ? "Sealed product" : "Card details",
      '<a href="' + esc(big || "#") + '" target="_blank" rel="noopener" class="detail-img" title="Open full-size image"' + (big ? "" : ' onclick="return false"') + ">" +
      '<span class="sleeve' + (r.sealed ? " boxed" : "") + '"' + foilAttr(r.rarity, r.sealed) + ">" + imgTag(bigPics, r.name, true) + "</span></a>" +
      '<h3 class="detail-title">' + esc(r.name) + "</h3>" +
      '<p class="detail-sub">' + esc(r.setName || "Set unknown") + "<br>" + (r.sealed ? "Sealed product" : esc(r.number || "No card number") + (r.rarity ? ", " + esc(r.rarity) : "")) +
      "<br>" + (r.location ? "Kept in " + esc(r.location) : "No location") + ' · <button type="button" class="link-btn" id="moveTop">Move</button></p>' + otherCopiesHTML(r) +
      '<div class="links">' + links + "</div>" + '<div id="themeLinks">' + themeLinksHTML(r) + "</div>" + priceSection + photoSectionHTML(r) +
      '<div class="section" id="sellSec"><h3>Selling</h3><div id="sellBox">' + sellBoxHTML(r) + "</div></div>" +
      '<div class="section"><h3>' + (r.sealed ? "Yours" : "Your copy") + '</h3><form id="editForm" class="stack">' +
      cardOnly('<div class="grid-2"><label class="field"><span>Printing</span><select class="input" id="eEd">' +
      options((product ? printingsFor(product).filter(k => k !== "Normal") : []).concat(PRINTINGS), r.edition) + "</select></label>" +
      '<label class="field"><span>Condition</span><select class="input" id="eCond">' + options(CARD_CONDITIONS, r.condition) + "</select></label></div>" +
      sealedCardCheckHTML("eSealedCard", isSealedCard(r))) +
      '<div class="grid-2">' + cardOnly('<label class="field"><span>Language</span><select class="input" id="eLang">' + options(LANGUAGES, r.language) + "</select></label>") +
      '<label class="field"><span>Quantity</span><input class="input" id="eQty" type="number" min="1" step="1" value="' + r.qty + '"></label>' +
      (r.sealed ? '<label class="field"><span>Price you paid, each</span><input class="input" id="ePaid" type="number" min="0" step="0.01" value="' + (r.paid == null ? "" : r.paid) + '"></label>' : "") + "</div>" +
      cardOnly('<div class="grid-2"><label class="field"><span>Rarity</span><select class="input" id="eRarity">' + options(allRarities(), r.rarity, "Unknown") + "</select></label>" +
      '<label class="field"><span>Price you paid, each</span><input class="input" id="ePaid" type="number" min="0" step="0.01" value="' + (r.paid == null ? "" : r.paid) + '"></label></div>' +
      '<div class="grid-2"><label class="field"><span>Japan price (¥)</span><input class="input" id="eJp" type="number" min="0" step="1" value="' + (r.jp == null ? "" : r.jp) + '"></label>' +
      '<label class="field"><span>Korea price (₩)</span><input class="input" id="eKr" type="number" min="0" step="1" value="' + (r.kr == null ? "" : r.kr) + '"></label></div>') +
      (r.productId ? "" : '<label class="field"><span>' + (r.ref ? "Your own value each in US$ (empty: follows " + esc(r.shop || "the shop") + "'s price)" : "Value per card in US$ (your estimate)") + '</span><input class="input" id="eValue" type="number" min="0" step="0.01" value="' + (r.manualPrice == null ? "" : r.manualPrice) + '"></label>') +
      cardOnly('<label class="field"><span>PSA 10 value, if you know it (US$; shown in the PSA 10 view)</span><input class="input" id="eG10" type="number" min="0" step="0.01" placeholder="' +
        esc((psa10Value(r) && psa10Value(r).from !== "yours") ? "now " + usd(psa10Value(r).unit) + (psa10Value(r).from === "estimate" ? " (estimate)" : "") : "") + '" value="' + (r.g10 == null ? "" : r.g10) + '"></label>') +
      locationFieldHTML("eLoc", r.location) +
      '<label class="field"><span>Notes</span><textarea class="input" id="eNotes">' + esc(r.notes) + "</textarea></label>" +
      cardOnly(gradeFieldsHTML("e", r.grade)) +
      '<details class="more"' + (photoOpen ? " open" : "") + "><summary>" + (r.productId ? "Use my own photo instead" : "Photo") + "</summary>" +
      '<label class="field" style="margin-top:10px"><span>Image link (leave empty to use ' + (r.productId ? "TCGplayer's photo" : "no image") + ")</span>" +
      '<input class="input" id="eImage" type="url" placeholder="https://" value="' + esc(r.customImage || "") + '"></label>' +
      (!r.productId && !r.sealed && (r.number || r.name) ? '<button class="btn btn-small" type="button" id="eFind" style="margin-top:8px">Find photos on Yugipedia</button><div id="eYugi" class="yugi"></div>' : "") +
      "</details>" +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Save changes</button>' +
      (r.number ? '<button class="btn" type="button" id="changePrinting">Change printing</button>' : "") +
      '<button class="btn" type="button" id="moveBtn">Move…</button>' +
      '<button class="btn" type="button" id="soldBtn">Sold…</button>' +
      '<span class="spacer"></span><button class="btn btn-danger" type="button" id="deleteOne">Delete</button></div></form></div>');

    if ($("otherBtn")) $("otherBtn").addEventListener("click", () => loadOtherMarkets(r));
    wireGradeIt(r.id);
    wireSellBox(r.id);
    wirePhotos(r.id);
    if (opts.sell && $("sellSec") && $("sellSec").scrollIntoView) $("sellSec").scrollIntoView({block: "start"});
    if (opts.grading && $("gradeItSec") && $("gradeItSec").scrollIntoView) $("gradeItSec").scrollIntoView({block: "start"});
    if (!r.sealed && !th.data) loadThemes().then(() => { if (drawerCtx && drawerCtx.id === id && $("themeLinks")) $("themeLinks").innerHTML = themeLinksHTML(collection.find(x => x.id === id)); });
    if (product && SITE) loadCardHistory(r, product);
    else if (isOcg(r) && ocgHistoryBase()) loadOcgHistory(r);
    if (!r.sealed && pcOn() && !pcBad() && normNumber(r.number)) {
      const h = pcCache()[pcKey(r)];
      if (!h || Date.now() - h.t > PC_TTL) pcLookup(r).then(() => { const cur = collection.find(x => x.id === id); if (cur && drawerCtx && drawerCtx.id === id && $("gradedBox")) { $("gradedBox").innerHTML = gradedBoxHTML(cur); if (settings.gradedView) renderSoon(); } }).catch(() => {});
    }
    if ($("changePrinting")) $("changePrinting").addEventListener("click", () => openAdd({number: r.number, replaceId: r.id}));
    if ($("eFind")) $("eFind").addEventListener("click", () => showYugiPicker($("eYugi"), r.number, r.name, $("eRarity").value, url => { $("eImage").value = url; }));
    $("deleteOne").addEventListener("click", () => deleteRecords([r.id]));
    if (isOcg(r)) {
      const g = ocgRegion(r.number);
      const refresh = async fresh => {
        const box = () => drawerCtx && drawerCtx.id === id ? $("ocgPrice") : null;
        try {
          await fxRates();
          if (!ocgLiveOK(g)) await loadOcgCardsSoft();   // (Fullahead: the daily list only)
          else if (g.region === "JP") await bigwebFor(g.code, fresh); else await bunjangFor(g.code, fresh);
          await ocgCard(g.code).catch(() => null);
        } catch (e) { const cur0 = collection.find(x => x.id === id); if (cur0 && box()) { box().innerHTML = ocgPriceHTML(cur0) + '<p class="small">Couldn\'t check right now (it needs an internet connection).</p>'; wireOcgRefresh(); } return; }
        const cur = collection.find(x => x.id === id);
        if (cur && box()) { box().innerHTML = ocgPriceHTML(cur); wireOcgRefresh(); }
        renderSoon();
      };
      const wireOcgRefresh = () => { const b = $("ocgCheck"); if (b) b.addEventListener("click", () => { b.disabled = true; b.textContent = "Checking…"; refresh(true); }); };
      wireOcgRefresh();
      const key = (g.region === "JP" ? "bw|" : "bj|") + g.code, hit = ocgCache()[key], fp = ocgFilePrice(r);
      if (!ocgLiveOK(g)) { if (!ocgCd.data) refresh(false); }   // (once the daily list is here, its price shows)
      else if ((!hit || Date.now() - hit.t > OCG_TTL) && !(fp && !fp.none)) refresh(false);   // (the daily list covers it: the shop isn't asked by itself)
    }
    $("soldBtn").addEventListener("click", () => openSoldForm(r.id));
    ["moveBtn", "moveTop"].forEach(b => $(b).addEventListener("click", () => openMove([r.id], {back: r.id})));
    $("drawerBody").querySelectorAll("[data-other]").forEach(b => b.addEventListener("click", () => openDetails(b.dataset.other)));
    // Only what you change in the form is saved, so a change that arrives from another computer
    // while the form is open (say, a copy sold there) isn't overwritten.
    wireSealedCard("eSealedCard", "eCond");
    const shown = formValues("editForm");
    $("editForm").addEventListener("submit", e => {
      e.preventDefault();
      const image = $("eImage").value.trim();
      if (image && !safeImg(image)) { toast("The image link must start with http:// or https://.", {kind: "error"}); return; }
      const cur = collection.find(x => x.id === id);
      if (!cur) { closeDrawer(); toast("That card isn't in your collection anymore, so nothing was saved.", {kind: "error"}); return; }
      r = cur;
      const now = formValues("editForm");
      const edited = (...ids) => ids.some(k => now[k] !== shown[k]);
      if (edited("eEd")) r.edition = $("eEd").value;
      if (edited("eCond")) r.condition = $("eCond").value;
      if (edited("eLang")) r.language = $("eLang").value;
      if (edited("eQty")) r.qty = posInt($("eQty").value) || 1;
      if (edited("eRarity")) r.rarity = $("eRarity").value;
      if (edited("ePaid")) r.paid = num($("ePaid").value);
      if (edited("eJp")) r.jp = num($("eJp").value);
      if (edited("eKr")) r.kr = num($("eKr").value);
      if ($("eValue") && edited("eValue")) r.manualPrice = num($("eValue").value);
      if ($("eG10") && edited("eG10")) r.g10 = num($("eG10").value);
      if (edited("eLoc")) r.location = $("eLoc").value.trim();
      if (edited("eNotes")) r.notes = $("eNotes").value.trim();
      if (edited("eCompany", "eGrade", "eCert", "eGValue")) r.grade = readGradeFields("e");
      if (edited("eImage")) r.customImage = image || null;
      save(); render(); closeDrawer();
      toast("Saved " + r.name + ".");
    });
  }

  // The values of a form's fields, by id.
  function formValues(formId) {
    const out = {};
    const form = $(formId);
    if (form) form.querySelectorAll("input[id], select[id], textarea[id]").forEach(el => { out[el.id] = el.type === "checkbox" ? String(el.checked) : el.value; });
    return out;
  }
  async function loadOtherMarkets(r) {
    const box = $("otherMarkets");
    box.innerHTML = '<p class="small">Checking YGOPRODeck…</p>';
    try {
      const res = await fetch(YGOPRODECK + "/cardinfo.php?name=" + encodeURIComponent(lookupName(r.name)));
      const json = await res.json().catch(() => null);
      const card = json && json.data && json.data[0];
      if (!res.ok || !card) throw new Error("not found");
      const p = (card.card_prices || [])[0] || {};
      const row = (label, v, fmt) => { const n = num(v); return n ? "<tr><td>" + label + '</td><td class="num">' + esc(fmt.format(n)) + "</td></tr>" : ""; };
      const rows = row("Cardmarket", p.cardmarket_price, fmtEUR) + row("eBay", p.ebay_price, fmtUSD) +
        row("Amazon", p.amazon_price, fmtUSD) + row("CoolStuffInc", p.coolstuffinc_price, fmtUSD);
      box.innerHTML = rows ? '<table class="price-table" style="margin-top:6px"><tbody>' + rows + "</tbody></table>" +
        '<p class="small">Cheapest copy of <em>any</em> printing of this card on each site, from YGOPRODeck. It can be far below a rare printing\'s value, so it isn\'t used in your totals.</p>'
        : '<p class="small">YGOPRODeck has no other-market prices for this card.</p>';
    } catch (e) {
      box.innerHTML = '<p class="small">Couldn\'t get other-market prices for "' + esc(lookupName(r.name)) + '" (offline, or YGOPRODeck doesn\'t list that name). The links above search each site directly.</p>';
    }
  }

