  /* ======================= Card search tab ======================= */
  // What any card is worth, from the data Card Vault already has: TCGplayer's price for every printing (and how it
  // changed over the last day, week and month), the Market's Japanese and Korean prices, and for a Japanese or Korean
  // card number, the same Yugipedia/BIGWEB/Bunjang lookup as Add card.
  const cs = {q: "", open: new Set(), shut: new Set(), limit: 30, groups: new Map(), recent: null, set: null, setFind: "", setRarity: "", setShow: ""};
  const CS_SORTS = [["best", "Best match"], ["high", "Most valuable first"], ["low", "Cheapest first"], ["name", "Name"]];
  const CS_RECENT_KEY = "cardvault.v2.cardsearch";
  const csNorm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’"`]/g, "");
  const csPrinting = k => k === "Normal" ? "No edition mark" : k;
  // (worked out once per price list)
  function csHay(p) {
    if (!catalog.csHay) catalog.csHay = new Map();
    let h = catalog.csHay.get(p.id);
    if (h == null) { h = csNorm(p.name + " " + p.number + " " + p.group.name + " " + (p.group.abbr || "") + " " + p.rarity); catalog.csHay.set(p.id, h); }
    return h;
  }
  // Made ready in the background after Card Vault opens, a slice at a time so the screen stays responsive: the search
  // text of every printing, the sets list (for the set chips) and the cards by name. The first search is then quick.
  function warmSearch() {
    if (!catalog || catalog.csWarm) return;
    catalog.csWarm = true;
    const list = catalog.products;
    let i = 0;
    const step = deadline => {
      if (!catalog || catalog.products !== list) return;
      const room = deadline && deadline.timeRemaining ? Math.min(12, Math.max(4, deadline.timeRemaining())) : 12;
      const until = performance.now() + room;
      do csHay(list[i++]); while (i < list.length && performance.now() < until);
      if (i < list.length) { window.requestIdleCallback ? requestIdleCallback(step, {timeout: 1000}) : setTimeout(step, 16); return; }
      try { marketData(); csByName(""); } catch (e) { /* (made when first searched instead) */ }
    };
    step();
  }
  // Every English printing of a card, by its name
  function csByName(key) {
    if (!catalog.csNames) {
      catalog.csNames = new Map();
      for (const p of catalog.products) if (!p.sealed) pushMap(catalog.csNames, csNorm(artless(cleanName(p.name, p.rarity))), p);
    }
    return catalog.csNames.get(key) || [];
  }
  const csLooksLikeNumber = t => /^[A-Za-z0-9]{2,6}-[A-Za-z]{0,3}\d{1,4}[A-Za-z]?$/.test(String(t).trim());
  // The cards matching a search, one entry per card name with its matching printings and their prices.
  function csSearch(q) {
    const text = String(q || "").trim();
    if (!catalog || text.length < 2) return [];
    let hits = csLooksLikeNumber(text) ? findByNumber(text).filter(p => !p.sealed) : [];
    if (!hits.length) {
      const words = csNorm(text).split(/\s+/).filter(Boolean);
      hits = catalog.products.filter(p => !p.sealed && words.every(w => csHay(p).includes(w)));
    }
    const groups = new Map();
    for (const p of hits) {
      const name = artless(cleanName(p.name, p.rarity)), key = csNorm(name);
      let g = groups.get(key);
      if (!g) groups.set(key, g = {key, name, products: []});
      g.products.push(p);
    }
    const phrase = csNorm(text);
    return Array.from(groups.values()).map(g => {
      const rows = [];
      for (const p of g.products) {
        const eds = printingsFor(p);
        if (!eds.length) rows.push({p, ed: "", sub: null, v: null});
        for (const ed of eds) rows.push({p, ed, sub: p.prices[ed], v: firstPrice(p.prices[ed])});
      }
      rows.sort((a, b) => (a.v == null) - (b.v == null) || (b.v || 0) - (a.v || 0) || (b.p.group.published || "").localeCompare(a.p.group.published || ""));
      const priced = rows.filter(r => r.v != null);
      return Object.assign(g, {rows, top: priced[0] || null, low: priced.length ? priced[priced.length - 1] : null,
        sets: new Set(g.products.map(p => p.group.id)).size, all: csByName(g.key).length,
        score: g.key === phrase ? 0 : g.key.startsWith(phrase) ? 1 : g.key.includes(phrase) ? 2 : 3});
    });
  }
  function csSort(list) {
    const by = settings.csSort, top = g => g.top ? g.top.v : -1, low = g => g.low ? g.low.v : Infinity;
    const sorters = {
      best: (a, b) => a.score - b.score || top(b) - top(a) || a.name.localeCompare(b.name),
      high: (a, b) => top(b) - top(a) || a.name.localeCompare(b.name),
      low: (a, b) => low(a) - low(b) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name)
    };
    return list.sort(sorters[by] || sorters.best);
  }
  // The last few cards you opened here
  function csRecent() {
    if (!cs.recent) { const r = readJSON(CS_RECENT_KEY, []); cs.recent = Array.isArray(r) ? r.filter(x => x && x.n).slice(0, 8) : []; }
    return cs.recent;
  }
  function csRemember(name) {
    const list = csRecent().filter(x => csNorm(x.n) !== csNorm(name));
    list.unshift({n: name});
    cs.recent = list.slice(0, 8);
    try { localStorage.setItem(CS_RECENT_KEY, JSON.stringify(cs.recent)); } catch (e) { /* optional */ }
  }
  function renderSearch() {
    const panel = $("panel-search");
    if (!catalog) {
      panel.innerHTML = emptyPanel("Card search needs TCGplayer data", SITE ? "Reload the page (it needs an internet connection)."
        : "Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, then press F5 here.");
      return;
    }
    // (the Japanese and Korean prices, once; after a failure, again 10 minutes later)
    if (!ocgMk.data && !ocgMk.loading && !(ocgMk.failed && Date.now() - ocgMk.failed < 10 * 60000) && ocgMarketURL()) loadOcgMarket();
    const intro = "What any card is worth, and every card in a set: TCGplayer's market price and lowest listing for every printing, from " + esc(fmtDate(catalog.generated)) +
      ", and Japanese and Korean prices from BIGWEB and Bunjang (Rush Duel too: Japanese from Fullahead).";
    // (the box you type in stays put while the results change, and when new prices arrive)
    if (!$("csQ")) {
      panel.innerHTML = '<div class="panel-head"><div><h2>Card search</h2><p id="csIntro">' + intro + "</p></div></div>" +
        '<div class="cs-bar"><div class="seg" role="group" aria-label="Search for" id="csMode"><button type="button" data-csmode="cards">Cards</button><button type="button" data-csmode="sets">Sets</button></div>' +
        '<input class="search" id="csQ" type="search" autocomplete="off" spellcheck="false" value="' + esc(cs.q) + '">' +
        '<select class="select" id="csSort" aria-label="Sort">' + CS_SORTS.map(([k, l]) => '<option value="' + k + '"' + ((settings.csSort || "best") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
        '<button class="btn cs-scan" type="button" id="csScan" title="Point your camera at a card to see what it\'s worth"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5V4.2A1.7 1.7 0 0 1 4.2 2.5h2.3M13.5 2.5h2.3a1.7 1.7 0 0 1 1.7 1.7v2.3M17.5 13.5v2.3a1.7 1.7 0 0 1-1.7 1.7h-2.3M6.5 17.5H4.2a1.7 1.7 0 0 1-1.7-1.7v-2.3"/><path d="M6 10h8"/></svg>Scan a card</button></div>' +
        '<div id="csOut"></div>';
    } else {
      $("csIntro").innerHTML = intro;
    }
    csSyncBar();
    renderSearchResults();
  }
  // Cards or Sets: the switch, what the box asks for, and the card sort (cards only)
  function csSyncBar() {
    const sets = settings.csMode === "sets";
    document.querySelectorAll("#csMode [data-csmode]").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.csmode === "sets") === sets)));
    const q = $("csQ");
    if (q) { q.placeholder = sets ? "Set name or code" : "Card name, number or set"; q.setAttribute("aria-label", sets ? "Set name or code" : "Card name, number or set"); }
    if ($("csSort")) $("csSort").hidden = sets || !!cs.set;
  }
  function csStartHTML() {
    const recent = csRecent();
    const yours = [];
    const seen = new Set();
    for (const r of collection.slice().sort((a, b) => (priceInfo(b).unit || 0) - (priceInfo(a).unit || 0))) {
      if (r.sealed || !r.productId || yours.length >= 6) continue;
      const k = csNorm(lookupName(r.name));
      if (!seen.has(k)) { seen.add(k); yours.push(lookupName(r.name)); }
    }
    const chips = (label, list) => list.length ? '<p class="cs-chips-h">' + label + '</p><div class="cs-chips">' +
      list.map(n => '<button type="button" class="chip" data-cs-q="' + esc(n) + '">' + esc(n) + "</button>").join("") + "</div>" : "";
    return '<div class="cs-start"><p>Type a card\'s name (or part of it), its number from under the artwork, or a set. Add more words to narrow it down, like <b>dark magician lob</b> or <b>blue-eyes secret</b>. ' +
      'To see every card in a set, switch to <button type="button" class="link-btn" data-cs-mode="sets">Sets</button>.</p>' +
      chips("Looked up recently", recent.map(x => x.n)) + chips("Your most valuable cards", yours) +
      '<p class="small">Japanese and Korean cards too, by name or number (like DUNE-JP004, or RD/KP25-JP001 for Rush Duel): BIGWEB prices for Japanese cards (Fullahead for Rush Duel) and Bunjang prices (sales, else asking) for Korean ones, from Card Vault\'s daily list.</p></div>';
  }
  function renderSearchResults() {
    const out = $("csOut");
    if (!out) return;
    csSyncBar();
    if (cs.set) { renderSetView(out); return; }
    out.dataset.view = "";
    if (settings.csMode === "sets") { renderSetSearch(out); return; }
    const text = cs.q.trim();
    cs.groups = new Map();
    if (text.length < 2) { out.innerHTML = csStartHTML(); return; }
    const ocgG = ocgRegion(text), ocgM = ocgG && (ocgG.old || /\d{3}/.test(ocgG.tail)) ? ocgKey(ocgG) : null;
    if (ocgM && !findByNumber(text).length) { renderOcgSearch(out, normNumber(text), ocgM); return; }
    const groups = csSort(csSearch(text));
    for (const g of groups) cs.groups.set(g.key, g);
    if (!groups.length) {
      const region = normNumber(text).match(/^([A-Z0-9]+)-(JA|AE|TC|SC)([A-Z]?\d+)$/);
      const ocgOnly = region ? "" : csOcgOnlyHTML(text);
      out.innerHTML = (ocgOnly || '<div class="notice">' + (region ? "TCGplayer only lists English cards, and " + esc(normNumber(text)) + " isn't one. Search for the card's name, or the English number " + esc(region[1] + "-EN" + region[3]) + "."
        : "No card matches \"" + esc(text) + "\". Check the spelling, or try fewer words.") + "</div>") + themeHintHTML(text) + csSetChipsHTML(text) + csMarketHint(text);
      return;
    }
    const printings = groups.reduce((t, g) => t + g.rows.length, 0);
    const owned = new Map();
    for (const r of collection) if (r.productId) owned.set(r.productId, (owned.get(r.productId) || 0) + r.qty);
    out.innerHTML = themeHintHTML(text) + csSetChipsHTML(text) + '<p class="results-head">' + plural(groups.length, "card") + ", " + plural(printings, "printing") + (groups.length > cs.limit ? ", showing the first " + cs.limit : "") + ".</p>" +
      groups.slice(0, cs.limit).map(g => csCardHTML(g, owned, groups.length === 1)).join("") +
      (groups.length > cs.limit ? '<div class="mk-more"><button class="btn" type="button" data-cs-more>Show more</button></div>' : "") +
      csMarketHint(text);
  }
  const csMarketHint = text => '<p class="small cs-hint">Booster boxes, packs and other sealed products: <button type="button" class="link-btn" data-cs-market="' + esc(text) + '">search the Market</button>.</p>';
  function csCardHTML(g, owned, only) {
    const open = cs.open.has(g.key) || (only && !cs.shut.has(g.key));   // (a single card opens by itself)
    const have = g.products.reduce((t, p) => t + (owned.get(p.id) || 0), 0);
    const pic = (g.top || g.rows[0]).p;
    const one = !g.top || g.top === g.low;
    const price = (label, row, cls) => '<span class="cs-price' + (cls ? " " + cls : "") + '"><small>' + label + "</small> <b>" + esc(usd(row.v)) + "</b></span>";
    return '<article class="cs-card set-row"><button type="button" class="cs-toggle set-toggle" aria-expanded="' + open + '" data-cs-card="' + esc(g.key) + '">' +
      '<span class="sleeve cs-thumb"' + foilAttr(pic.rarity) + ">" + imgTag(productPics(pic, "200w"), g.name) + "</span>" +
      '<span class="cs-main"><span class="cs-name">' + esc(g.name) + '</span><span class="cs-sub">' +
      esc(plural(g.rows.length, "printing") + (g.sets > 1 ? " in " + g.sets + " sets" : ", " + pic.group.name)) + (have ? ' <span class="cs-own">You have ' + have + "</span>" : "") + "</span></span>" +
      '<span class="cs-prices">' + (!g.top ? '<span class="cs-price"><small>Market price</small> <b class="none">No sales</b></span>'
        : one ? price("Market price", g.top, "top") : price("Cheapest", g.low) + price("Most valuable", g.top, "top")) + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="cs-body set-body">' + csBodyHTML(g, owned) + "</div>" : "") + "</article>";
  }
  function csBodyHTML(g, owned) {
    const rows = g.rows.map(x => {
      const p = x.p, s = x.sub || {}, have = owned.get(p.id) || 0;
      const chg = s.market != null && s.m30 != null ? changeHTML(s.market - s.m30, s.m30 > 0 ? (s.market - s.m30) / s.m30 : null, true) : "";
      const key = esc(p.id + "|" + x.ed);
      const year = p.group.published ? String(p.group.published).slice(0, 4) : "";
      return '<tr><td class="c-thumb"><span class="sleeve"' + foilAttr(p.rarity) + ">" + imgTag(productPics(p, "200w"), p.name) + "</span></td>" +
        '<td><button type="button" class="cell-name" data-cs-open="' + key + '">' + esc(p.group.name) + '</button><span class="cell-sub">' + esc([p.number, p.rarity, isOverframe(p) ? "Overframe" : "", year].filter(Boolean).join(" · ")) +
        (have ? ' <span class="cs-own">You have ' + have + "</span>" : "") + "</span></td>" +
        '<td data-label="Printing"' + (x.ed ? "" : " data-empty") + ">" + esc(csPrinting(x.ed)) + "</td>" +
        '<td class="num" data-label="Market">' + (s.market != null ? '<b class="gold">' + esc(usd(s.market)) + "</b>" : '<span class="small">No sales</span>') + "</td>" +
        '<td class="num" data-label="Lowest listing"' + (s.low == null ? " data-empty" : "") + ">" + esc(s.low == null ? "" : usd(s.low)) + "</td>" +
        '<td class="num" data-label="30 days"' + (chg ? "" : " data-empty") + ">" + chg + "</td>" +
        '<td><button class="btn btn-small" type="button" data-cs-open="' + key + '">Details</button></td></tr>';
    }).join("");
    const ocg = csOcgRows(g.key);
    const q = encodeURIComponent(g.name);
    return '<div class="table-wrap"><table class="table cs-table stack-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>Set</th><th>Printing</th>' +
      '<th class="num">Market</th><th class="num">Lowest listing</th><th class="num">30 days</th><th><span class="sr">Details</span></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (g.all > g.products.length ? '<p class="small cs-all"><button type="button" class="link-btn" data-cs-q="' + esc(g.name) + '">See every printing of ' + esc(g.name) + "</button></p>" : "") +
      (ocg.length ? '<h3 class="mk-h">Japanese and Korean</h3>' + csOcgTableHTML(ocg) +
        '<p class="small">' + (ocgCd.data ? "From Card Vault\'s daily Japanese and Korean list (BIGWEB prices, Fullahead for Rush Duel, Bunjang sales or asking prices), " + esc(ocgListDate()) + "."
          : "From the Market\'s Japanese and Korean lists, which have each set\'s most valuable cards. For any other printing, search its number (like DUNE-JP004).") + "</p>" : "") +
      '<div class="links cs-links"><a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + q + '">eBay</a>' +
      '<a target="_blank" rel="noopener" href="https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=' + q + '">Cardmarket</a>' +
      '<a target="_blank" rel="noopener" href="https://auctions.yahoo.co.jp/search/search?p=' + q + '">Yahoo! Auctions JP</a></div>';
  }
  // The Japanese and Korean printings with this English name: every one from the daily list, else the Market's chase cards
  function csOcgRows(key) {
    if (ocgCardsReady()) {
      const list = [];
      for (const card of ocgCd.data.byName.get(key) || []) for (const row of card.rows) list.push(ocgChaseLike(row));
      return list.sort((a, b) => (b.c.local > 0) - (a.c.local > 0) || (ocgUSD(b.c.local, b.s.region) || 0) - (ocgUSD(a.c.local, a.s.region) || 0) || a.c.number.localeCompare(b.c.number));
    }
    if (!ocgMk.data) return [];
    if (!ocgMk.byName || ocgMk.byName.data !== ocgMk.data) {
      const map = new Map();
      for (const region of ["jp", "kr"]) for (const s of ocgMk.data[region]) for (const c of s.chase) pushMap(map, csNorm(c.name), {s, c});
      ocgMk.byName = {data: ocgMk.data, map};
    }
    return (ocgMk.byName.map.get(key) || []).slice().sort((a, b) => (ocgUSD(b.c.local, b.s.region) || 0) - (ocgUSD(a.c.local, a.s.region) || 0));
  }
  // Japanese and Korean printings as a table: set, number, rarity, price, change, source, and what to do with it
  function csOcgTableHTML(list, opts) {
    opts = opts || {};
    const owned = ocgOwnedMaps();
    return '<div class="table-wrap"><table class="table cs-table cs-ocg stack-table"><thead><tr>' + (opts.thumbs ? '<th class="c-thumb"><span class="sr">Image</span></th>' : "") +
      "<th>" + (opts.name ? "Card" : "Set") + '</th><th>Number</th><th>Rarity</th><th class="num">Price</th><th class="num">30 days</th><th>From</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(({s, c}) => {
        const row = c.row, have = row ? ocgRowOwned(owned, row) : ocgOwnedCount(c);
        const chg = row && row.local && row.m30 && ocgUSD(row.local, s.region) != null && ocgUSD(row.m30, s.region) != null
          ? changeHTML(ocgUSD(row.local, s.region) - ocgUSD(row.m30, s.region), row.m30 > 0 ? (row.local - row.m30) / row.m30 : null, true) : "";
        const ref = row ? esc(ocgRef(row)) : "";
        const name = row ? '<button type="button" class="cell-name" data-ocgc-open="' + ref + '">' + esc(opts.name ? c.name : s.name) + "</button>" : esc(opts.name ? c.name : s.name);
        return "<tr" + (have ? ' class="cs-have"' : "") + ">" + (opts.thumbs ? '<td class="c-thumb"><span class="sleeve"' + foilAttr(c.rarity) + ">" + imgTag({list: [c.img].filter(Boolean).concat(namePics(c.name, "200w", c.rarity).list)}, c.name) + "</span></td>" : "") +
          "<td>" + name + '<span class="cell-sub">' + esc(opts.inSet ? (row && row.ja) || "" : opts.name ? s.name + " · " + ocgLangOf(s.region, c.number) : ocgLangOf(s.region, c.number)) + (have ? ' <span class="cs-own">You have ' + have + "</span>" : "") + "</span></td>" +
          '<td data-label="Number">' + esc(c.number) + '</td><td data-label="Rarity">' + esc(c.rarity || "not stated") + "</td>" +
          '<td class="num" data-label="Price">' + (c.local ? ocgMoneyHTML(c.local, s.region) : '<span class="small">' + (s.region === "jp" ? "Sold out" : "No listings") + "</span>") + "</td>" +
          '<td class="num" data-label="30 days"' + (chg ? "" : " data-empty") + ">" + chg + "</td>" +
          '<td data-label="From"' + (c.local ? "" : " data-empty") + ">" + esc(c.local ? chaseFrom(s, c) : "") + "</td>" +
          '<td><div class="want-actions">' + (ref ? (ocgWanted(c) ? '<span class="on-list">On want list</span>' : '<button class="btn btn-small" type="button" data-ocgc-want="' + ref + '">Want</button>') +
            '<button class="btn btn-small" type="button" data-ocgc-have="' + ref + '">I have it</button><button class="btn btn-small" type="button" data-ocgc-open="' + ref + '">Details</button>' : "") + "</div></td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  // Japanese and Korean cards with these words in their English name, when no English card has them
  function csOcgOnlyHTML(text) {
    const hits = ocgNameHits(text, 40);
    if (!hits.length) return "";
    const list = [];
    for (const c of hits) for (const row of c.rows) list.push(ocgChaseLike(row));
    return '<p class="results-head">No English card, but ' + plural(hits.length, "Japanese or Korean card") + ' with that name.</p>' + csOcgTableHTML(list, {thumbs: true, name: true}) +
      '<p class="small">From Card Vault\'s daily Japanese and Korean list, ' + esc(ocgListDate()) + ".</p>";
  }
  // A Japanese or Korean number: every rarity from the daily list, else the Yugipedia/BIGWEB/Bunjang lookup.
  function renderOcgSearch(out, code, m) {
    const region = m[2] === "JP" ? "jp" : "kr";
    if (!ocgCd.data && !(ocgCd.failed && Date.now() - ocgCd.failed < 10 * 60000) && ocgCardsURL()) {
      loadOcgCards(); out.innerHTML = '<p class="hint" role="status">Loading the Japanese and Korean card list…</p>'; return;
    }
    const card = ocgCardAt(code);
    if (card && card.rows.length) {
      const list = card.rows.map(ocgChaseLike), s = list[0].s;
      out.innerHTML = '<p class="results-head">' + esc(card.name) + ": " + esc(s.name) + " (" + ocgLangOf(region, code) + ")" + (card.rows.length > 1 ? ", " + card.rows.length + " rarities" : "") + ".</p>" +
        csOcgTableHTML(list, {thumbs: true, name: true}) +
        '<p class="small">From Card Vault\'s daily list (' + esc(ocgListSource(region, code)) + "), " + esc(ocgListDate()) + "." +
        (ocgLiveOK({region: m[2], code}) ? ' <button type="button" class="link-btn" data-ocg-live="' + esc(code) + '">Ask the shop now</button>' : "") + '</p><div id="csOcg"></div>';
      return;
    }
    const s = ocgSetsOf(region).find(x => x.prefix === m[1]);
    const known = s ? s.chase.filter(c => c.number === code) : [];
    out.innerHTML = (known.length ? '<p class="results-head">In the Market: ' + esc(s.name) + " (" + ocgLangOf(region, code) + ")</p>" +
      '<div class="table-wrap"><table class="table cs-table cs-ocg stack-table"><thead><tr><th>Card</th><th>Rarity</th><th class="num">Price</th><th>From</th></tr></thead><tbody>' +
      known.map(c => "<tr><td>" + esc(c.name) + '<span class="cell-sub">' + esc(c.number) + '</span></td><td data-label="Rarity">' + esc(c.rarity || "not stated") + "</td>" +
        '<td class="num" data-label="Price">' + ocgMoneyHTML(c.local, region) + '</td><td data-label="From">' + esc(chaseFrom(s, c)) + "</td></tr>").join("") +
      "</tbody></table></div>" : "") + '<div id="csOcg"></div>';
    showOcgLookup($("csOcg"), code, m, {search: true});
  }
  /* ----- Card search: sets ----- */
  // Find a set by name or code (English from TCGplayer; Japanese and Korean from the Market) and see its cards: every
  // card of an English set with its prices and which you have; the most valuable cards of a Japanese or Korean set.
  const CS_SET_SORTS = [["number", "By number"], ["value", "Most valuable"], ["name", "By name"], ["rarity", "By rarity"]];
  const CS_SET_SHOWS = [["", "All cards"], ["missing", "Ones I don't have"], ["have", "Ones I have"]];
  // An English set's code: TCGplayer's, else the one most of its card numbers start with
  function csSetCode(s) {
    if (s.code != null) return s.code;
    if (s.group.abbr) return (s.code = String(s.group.abbr).toUpperCase());
    const count = new Map();
    for (const p of s.cards) { const m = String(p.number || "").match(/^([A-Z0-9]+)-/i); if (m) count.set(m[1].toUpperCase(), (count.get(m[1].toUpperCase()) || 0) + 1); }
    let best = "", n = 0;
    for (const [k, v] of count) if (v > n) { best = k; n = v; }
    return (s.code = best);
  }
  const csSetsEN = () => marketData().filter(s => s.cards.length);
  const csCardKey = p => normNumber(p.number) || "p" + p.id;   // (each card number once)
  function csSetCount(s) {
    if (s.csCount == null) s.csCount = new Set(s.cards.map(csCardKey)).size;
    return s.csCount;
  }
  const csSetDay = s => String(s.group ? s.group.published || "" : s.date || "");
  // The sets matching what's typed: a set code ("MAMO", or a card number's), or words of its name
  function csSetMatches(text) {
    const t = String(text || "").trim();
    if (t.length < 2) return {en: [], ocg: []};
    const phrase = csNorm(t), words = phrase.split(/\s+/).filter(Boolean);
    const code = csLooksLikeNumber(t) ? t.split("-")[0].toUpperCase() : "";
    const rank = (name, c) => (csNorm(c) === phrase || csNorm(name) === phrase ? 0 : csNorm(name).startsWith(phrase) ? 1 : 2);
    const en = csSetsEN().filter(s => code ? csSetCode(s) === code : words.every(w => csNorm(s.group.name + " " + csSetCode(s)).includes(w)))
      .map(s => ({s, r: rank(s.group.name, csSetCode(s))})).sort((a, b) => a.r - b.r || csSetDay(b.s).localeCompare(csSetDay(a.s))).map(x => x.s);
    const ocg = ["jp", "kr"].flatMap(rg => ocgSetsOf(rg)).filter(s => code ? s.prefix === code : words.every(w => csNorm(s.name + " " + s.prefix + " " + s.local + (s.rush ? " rush duel" : "")).includes(w)))
      .map(s => ({s, r: rank(s.name, s.prefix)})).sort((a, b) => a.r - b.r || csSetDay(b.s).localeCompare(csSetDay(a.s))).map(x => x.s);
    return {en, ocg};
  }
  function csOwnedMap() {
    const owned = new Map();
    for (const r of collection) if (r.productId) owned.set(r.productId, (owned.get(r.productId) || 0) + r.qty);
    return owned;
  }
  // You have X of Y cards (each card number once)
  function csSetProgress(s, owned) {
    const have = new Set();
    for (const p of s.cards) if (owned.get(p.id)) have.add(csCardKey(p));
    return {have: have.size, total: csSetCount(s), keys: have};
  }
  const csLang = s => ocgLangOf(s.region, s.prefix);
  function csSetRowHTML(s, owned) {
    const year = csSetDay(s).slice(0, 4);
    if (s.region) {
      const top = s.top, full = ocgCd.data ? ocgSetOf(s.id) : null;
      const pr = full && full.cards.length ? ocgSetProgress(full) : null;
      return '<article class="set-row mk-row cs-set"><button type="button" class="set-toggle" data-cs-set="' + esc(s.id) + '">' +
        '<span style="min-width:0"><span class="set-name">' + esc(s.name) + '</span><span class="set-sub">' +
        esc([s.prefix + (s.region === "jp" ? "-JP" : "-KR"), year, s.cards ? plural(s.cards, "card") : ""].filter(Boolean).join(", ")) +
        '<span class="mk-line">' + csLang(s) + "</span></span></span>" +
        '<span class="mk-top">' + (top ? "Top card: <b>" + esc(top.name) + '</b> <span class="gold">' + esc(usd(ocgUSD(top.local, s.region)) || fmtLocal(top.local, OCG_CUR[s.region])) + "</span>" : "No prices yet") + "</span>" +
        '<span class="set-cost">' + (pr && pr.have ? "<b>" + pr.have + " of " + pr.total + "</b><small>you have</small>" : "<small>" + esc(ocgLineLabel(s)) + "</small>") + "</span>" +
        '<span class="caret go" aria-hidden="true"></span></button></article>';
    }
    const pr = csSetProgress(s, owned), top = s.top;
    return '<article class="set-row mk-row cs-set"><button type="button" class="set-toggle" data-cs-set="en:' + s.group.id + '">' +
      '<span style="min-width:0"><span class="set-name">' + esc(s.group.name) + '</span><span class="set-sub">' +
      esc([csSetCode(s), year, plural(csSetCount(s), "card")].filter(Boolean).join(", ")) + '<span class="mk-line">' + esc(mkLineName(s.line)) + "</span></span></span>" +
      '<span class="mk-top">' + (top ? "Top card: <b>" + esc(cleanName(top.product.name, top.product.rarity)) + '</b> <span class="gold">' + esc(usd(top.price)) + "</span>" : "No prices yet") + "</span>" +
      '<span class="set-cost">' + (pr.have ? "<b>" + pr.have + " of " + pr.total + "</b><small>you have</small>" : "<small>none yet</small>") + "</span>" +
      '<span class="caret go" aria-hidden="true"></span></button></article>';
  }
  // The Sets search: matching sets, or the newest ones before anything is typed
  function renderSetSearch(out) {
    const text = cs.q.trim();
    const owned = csOwnedMap();
    if (text.length < 2) {
      const yours = setsData().sort((a, b) => b.have - a.have).slice(0, 8);
      const newest = csSetsEN().slice().sort((a, b) => csSetDay(b).localeCompare(csSetDay(a)) || a.group.name.localeCompare(b.group.name));
      out.innerHTML = '<div class="cs-start"><p>Type a set\'s name or code (like <b>MAMO</b> or <b>legend of blue eyes</b>) to see every card in it, with prices and the ones you have. ' +
        "Japanese and Korean sets are found by name or code too.</p>" +
        (yours.length ? '<p class="cs-chips-h">Sets you collect</p><div class="cs-chips">' + yours.map(s => '<button type="button" class="chip" data-cs-set="' + esc(s.ocg ? s.group.id : "en:" + s.group.id) + '">' +
          esc(s.group.name) + " · " + s.have + "/" + s.total + "</button>").join("") + "</div>" : "") + "</div>" +
        '<h3 class="mk-h">Newest sets</h3>' + newest.slice(0, cs.limit).map(s => csSetRowHTML(s, owned)).join("") +
        (newest.length > cs.limit ? '<div class="mk-more"><button class="btn" type="button" data-cs-more>Show more</button></div>' : "");
      return;
    }
    const m = csSetMatches(text);
    if (!m.en.length && !m.ocg.length) {
      out.innerHTML = '<div class="notice">No set matches "' + esc(text) + '". Try part of its name, or its code (the letters before the dash in a card number).</div>';
      return;
    }
    out.innerHTML = '<p class="results-head">' + plural(m.en.length + m.ocg.length, "set") + ".</p>" +
      m.en.slice(0, cs.limit).map(s => csSetRowHTML(s, owned)).join("") +
      (m.en.length > cs.limit ? '<div class="mk-more"><button class="btn" type="button" data-cs-more>Show more</button></div>' : "") +
      (m.ocg.length ? '<h3 class="mk-h">Japanese and Korean sets</h3>' + m.ocg.slice(0, cs.limit).map(s => csSetRowHTML(s, owned)).join("") : "");
  }
  // In the card search: the sets the words match, to open
  function csSetChipsHTML(text) {
    const m = csSetMatches(text), list = m.en.slice(0, 4).concat(m.ocg.slice(0, 2));
    if (!list.length) return "";
    const more = m.en.length + m.ocg.length - list.length;
    return '<div class="cs-chips cs-setchips"><span class="small">Sets:</span>' + list.map(s => s.region
      ? '<button type="button" class="chip" data-cs-set="' + esc(s.id) + '">' + esc(s.name) + " · " + esc(s.prefix) + "-" + (s.region === "jp" ? "JP" : "KR") + "</button>"
      : '<button type="button" class="chip" data-cs-set="en:' + s.group.id + '">' + esc(s.group.name) + (csSetCode(s) ? " · " + esc(csSetCode(s)) : "") + "</button>").join("") +
      (more > 0 ? '<button type="button" class="chip" data-cs-mode="sets">' + more + " more</button>" : "") + "</div>";
  }
  function csFindSet(key) {
    const k = String(key || "");
    if (k.startsWith("en:")) return csSetsEN().find(s => String(s.group.id) === k.slice(3)) || null;
    const full = ocgSetOf(k);
    return ocgFindSet(k) || (full ? ocgSetInfo(full) : null);
  }
  // Open a set in Card search (from anywhere: a card's price page, the Sets tab, the Market)
  function openSearchSet(key) {
    if (!$("drawer").hidden) closeDrawer();
    cs.set = key; cs.setFind = ""; cs.setRarity = ""; cs.setShow = "";
    if (settings.tab !== "search") setTab("search"); else renderSearchResults();
    const out = $("csOut");
    if (out && out.getBoundingClientRect().top < 0 && out.scrollIntoView) out.scrollIntoView({block: "start"});
  }
  // One set's cards. The parts you type in stay put; the list below them changes.
  function renderSetView(out) {
    const s = csFindSet(cs.set);
    if (!s) {
      out.dataset.view = "";
      out.innerHTML = '<p><button type="button" class="link-btn" data-cs-back>← Back</button></p><div class="notice">' +
        (String(cs.set).startsWith("en:") ? "That set isn't in TCGplayer's list anymore." : ocgMk.loading ? "Loading the Japanese and Korean sets…" : "Couldn't load the Japanese and Korean sets right now.") + "</div>";
      return;
    }
    const back = '<p class="cs-back"><button type="button" class="link-btn" data-cs-back>← Back to ' + (settings.csMode === "sets" ? "sets" : cs.q.trim().length >= 2 ? "results" : "search") + "</button></p>";
    if (s.region) {
      if (s.region === "jp") loadYugiMarket();   // (its booster box; read twice a day at most)
      const full = ocgCardsReady() ? ocgSetOf(s.id) : null;
      if (full && full.cards.length) {
        if (out.dataset.view !== cs.set || !$("csSetList")) { out.dataset.view = cs.set; out.innerHTML = back + csOcgSetHeadHTML(s, full); }
        renderOcgSetCards(s, full);
        return;
      }
      out.dataset.view = cs.set; out.innerHTML = back + csOcgSetHTML(s); return;
    }
    if (out.dataset.view !== cs.set || !$("csSetList")) {
      out.dataset.view = cs.set;
      const rarities = Array.from(new Set(s.cards.map(p => p.rarity).filter(Boolean))).sort();
      const opt = (list, cur) => list.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === cur ? " selected" : "") + ">" + esc(l) + "</option>").join("");
      const day = s.group.published ? parseDay(String(s.group.published).slice(0, 10)) : null;
      out.innerHTML = back + '<div class="cs-set-head"><h3 class="cs-set-title">' + esc(s.group.name) + "</h3>" +
        '<p class="cs-set-sub">' + esc([csSetCode(s), day ? "released " + fmtDate(day) : "", mkLineName(s.line), plural(csSetCount(s), "card")].filter(Boolean).join(" · ")) + "</p>" +
        '<div class="cs-set-actions" id="csSetActions"></div></div>' +
        '<div id="csSetFacts" class="cs-set-facts"></div>' +
        '<div class="cs-set-tools"><input class="search" id="csSetFind" type="search" autocomplete="off" placeholder="Find in this set" aria-label="Find in this set" value="' + esc(cs.setFind || "") + '">' +
        '<select class="select" id="csSetRarity" aria-label="Rarity">' + opt([["", "All rarities"]].concat(rarities.map(r => [r, r])), cs.setRarity || "") + "</select>" +
        '<select class="select" id="csSetShow" aria-label="Show">' + opt(CS_SET_SHOWS, cs.setShow || "") + "</select>" +
        '<select class="select" id="csSetSort" aria-label="Sort">' + opt(CS_SET_SORTS, settings.csSetSort || "number") + "</select></div>" +
        '<div id="csSetList"></div>';
    }
    renderSetCards(s);
  }
  function renderSetCards(s) {
    s = s || csFindSet(cs.set);
    const box = $("csSetList"), facts = $("csSetFacts");
    if (!s || !box) return;
    if (s.region) { const full = ocgSetOf(s.id); if (full) renderOcgSetCards(s, full); return; }
    const owned = csOwnedMap(), pr = csSetProgress(s, owned);
    // the cheapest copy of each card you're missing
    const cheapest = new Map();
    for (const p of s.cards) {
      const k = csCardKey(p);
      if (pr.keys.has(k)) continue;
      for (const ed in p.prices) { const v = firstPrice(p.prices[ed]); if (v != null && (!cheapest.has(k) || v < cheapest.get(k))) cheapest.set(k, v); }
    }
    const missingCost = Array.from(cheapest.values()).reduce((t, v) => t + v, 0);
    const box2 = s.cheapBox;
    const needs = csSetNeeds(s, owned), goal = isGoal(s.group.id);
    if ($("csSetActions")) $("csSetActions").innerHTML = '<button type="button" class="btn btn-small' + (goal ? " is-goal" : "") + '" data-goal-toggle="' + s.group.id + '" aria-pressed="' + goal + '">' +
      (goal ? "&#9733; Your goal (tap to remove)" : "&#9734; Make this set a goal") + "</button>" +
      (needs.toWant.length ? '<button type="button" class="btn btn-small" data-goal-wants="' + s.group.id + '">Add the ' + plural(needs.toWant.length, "missing card") + " to my want list</button>"
        : needs.missing.length ? '<span class="small">The missing cards are on your want list.</span>' : "");
    facts.innerHTML = '<div class="cs-fact"><span class="small">You have</span> <b>' + pr.have + " of " + pr.total + "</b>" +
      '<span class="progress" aria-hidden="true"><span style="width:' + (pr.total ? pr.have / pr.total * 100 : 0).toFixed(1) + '%"></span></span></div>' +
      (pr.have < pr.total ? '<div class="cs-fact"><span class="small">The rest, one of each</span> <b>' + esc(usd(missingCost)) + '</b> <span class="small">cheapest printings</span></div>'
        : '<div class="cs-fact"><span class="small">Complete</span> <b>Every card</b></div>') +
      (s.top ? '<div class="cs-fact"><span class="small">Most valuable</span> <b class="gold">' + esc(usd(s.top.price)) + '</b> <span class="small">' + esc(cleanName(s.top.product.name, s.top.product.rarity)) + "</span></div>" : "") +
      (box2 ? '<div class="cs-fact"><span class="small">' + (/mini/i.test(box2.p.name) ? "Mini box" : "Booster box") + "</span> <b>" + esc(usd(box2.best)) + '</b> <button type="button" class="link-btn" data-cs-mkset="' + s.group.id + '">Sealed products in the Market</button></div>'
        : s.sealed.length ? '<div class="cs-fact"><span class="small">Sealed</span> <b>' + s.sealed.length + '</b> <button type="button" class="link-btn" data-cs-mkset="' + s.group.id + '">See them in the Market</button></div>' : "");
    const words = csNorm(cs.setFind || "").split(/\s+/).filter(Boolean);
    const best = p => { let b = null; for (const ed of printingsFor(p)) { const v = firstPrice(p.prices[ed]); if (v != null && (!b || v > b.v)) b = {ed, v}; } return b; };
    let list = s.cards.filter(p => (!cs.setRarity || p.rarity === cs.setRarity) &&
      (cs.setShow !== "have" || owned.get(p.id)) && (cs.setShow !== "missing" || !pr.keys.has(csCardKey(p))) &&
      (!words.length || words.every(w => csHay(p).includes(w))));
    const byNum = (a, b) => String(a.number).localeCompare(String(b.number), undefined, {numeric: true}) || a.name.localeCompare(b.name);
    const sorters = {
      number: byNum,
      value: (a, b) => ((best(b) || {v: -1}).v - (best(a) || {v: -1}).v) || byNum(a, b),
      name: (a, b) => cleanName(a.name, a.rarity).localeCompare(cleanName(b.name, b.rarity)) || byNum(a, b),
      rarity: (a, b) => a.rarity.localeCompare(b.rarity) || byNum(a, b)
    };
    list = list.slice().sort(sorters[settings.csSetSort] || sorters.number);
    if (!list.length) { box.innerHTML = '<div class="notice">No card in this set matches. ' + (cs.setShow === "have" ? "You don't have any of these yet." : "Try fewer words, or All rarities.") + "</div>"; return; }
    box.innerHTML = '<p class="results-head">' + (list.length === s.cards.length ? plural(list.length, "printing") : list.length + " of " + plural(s.cards.length, "printing")) + ".</p>" +
      '<div class="table-wrap"><table class="table cs-table cs-settable stack-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>No.</th><th>Card</th>' +
      '<th class="num">Price</th><th>Yours</th><th><span class="sr">Details</span></th></tr></thead><tbody>' +
      list.map(p => {
        const b = best(p), eds = printingsFor(p), have = owned.get(p.id) || 0, name = cleanName(p.name, p.rarity);
        const key = esc(p.id + "|" + (b ? b.ed : eds[0] || ""));
        const priceHTML = !eds.length || !b ? '<span class="small">No sales</span>' : eds.length === 1 ? '<b class="gold">' + esc(usd(b.v)) + "</b>"
          : eds.map(ed => { const v = firstPrice(p.prices[ed]); return v == null ? "" : '<span class="cs-ed">' + esc(csPrinting(ed).replace(" Edition", " Ed.")) + "</span> " + (ed === b.ed ? '<b class="gold">' + esc(usd(v)) + "</b>" : esc(usd(v))); }).filter(Boolean).join("<br>");
        return "<tr" + (have ? ' class="cs-have"' : "") + '><td class="c-thumb"><span class="sleeve"' + foilAttr(p.rarity) + ">" + imgTag(productPics(p, "200w"), name) + "</span></td>" +
          '<td data-label="No."' + (p.number ? "" : " data-empty") + ">" + esc(p.number) + "</td>" +
          '<td><button type="button" class="cell-name" data-cs-open="' + key + '">' + esc(name) + '</button><span class="cell-sub">' + esc(p.rarity || "Rarity unknown") + "</span></td>" +
          '<td class="num cs-pricecell" data-label="Price">' + priceHTML + "</td>" +
          "<td" + (have ? "" : " data-empty") + ">" + (have ? '<span class="cs-own">You have ' + have + "</span>" : "") + "</td>" +
          '<td><button class="btn btn-small" type="button" data-cs-open="' + key + '">Details</button></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="small">TCGplayer\'s market price for each printing (1st Edition, Unlimited…), from ' + esc(fmtDate(catalog.generated)) + ". \"You have\" counts each card number once.</p>";
  }
  // A Japanese or Korean set from the daily list: every card, with prices, which you have, and what the rest would cost
  function csOcgSetHeadHTML(s, full) {
    const lang = csLang(s), code = s.prefix + (s.region === "jp" ? "-JP" : "-KR");
    const rarities = Array.from(new Set(full.cards.flatMap(c => c.rows.map(x => x.rarity)).filter(Boolean))).sort();
    const opt = (list, cur) => list.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === cur ? " selected" : "") + ">" + esc(l) + "</option>").join("");
    return '<div class="cs-set-head"><h3 class="cs-set-title">' + esc(s.name) + "</h3>" +
      '<p class="cs-set-sub">' + esc([code, s.date ? "released " + fmtDate(parseDay(s.date.slice(0, 10))) : "", ocgLineLabel(s), plural(full.cards.length, "card"), lang].filter(Boolean).join(" · ")) + "</p></div>" +
      '<div id="csSetFacts" class="cs-set-facts"></div>' +
      '<div class="cs-set-tools"><input class="search" id="csSetFind" type="search" autocomplete="off" placeholder="Find in this set" aria-label="Find in this set" value="' + esc(cs.setFind || "") + '">' +
      '<select class="select" id="csSetRarity" aria-label="Rarity">' + opt([["", "All rarities"]].concat(rarities.map(r => [r, r])), cs.setRarity || "") + "</select>" +
      '<select class="select" id="csSetShow" aria-label="Show">' + opt(CS_SET_SHOWS, cs.setShow || "") + "</select>" +
      '<select class="select" id="csSetSort" aria-label="Sort">' + opt(CS_SET_SORTS, settings.csSetSort || "number") + "</select></div>" +
      '<div id="csSetList"></div>';
  }
  function renderOcgSetCards(s, full) {
    const box = $("csSetList"), facts = $("csSetFacts");
    if (!box) return;
    const region = s.region, owned = ocgOwnedMaps(), pr = ocgSetProgress(full, owned);
    const box2 = region === "jp" ? ymBox(s) : null;
    const yp = "https://yugipedia.com/wiki/Set_Card_Lists:" + encodeURIComponent(s.name.replace(/ /g, "_")) + "_(OCG-" + (region === "jp" ? "JP" : "KR") + ")";
    if (facts) facts.innerHTML = '<div class="cs-fact"><span class="small">You have</span> <b>' + pr.have + " of " + pr.total + "</b>" +
      '<span class="progress" aria-hidden="true"><span style="width:' + (pr.total ? pr.have / pr.total * 100 : 0).toFixed(1) + '%"></span></span></div>' +
      (pr.have < pr.total ? '<div class="cs-fact"><span class="small">The rest, one of each</span> <b>' + esc(usd(pr.cost)) + '</b> <span class="small">cheapest rarities' + (pr.unpriced ? ", " + pr.unpriced + " without a price" : "") + "</span></div>"
        : '<div class="cs-fact"><span class="small">Complete</span> <b>Every card</b></div>') +
      (pr.top ? '<div class="cs-fact"><span class="small">Most valuable</span> <b class="gold">' + esc(usd(pr.top.usd)) + '</b> <span class="small">' + esc(pr.top.row.card.name) + "</span></div>" : "") +
      (box2 ? '<div class="cs-fact"><span class="small">Booster box, Yugi-Market</span> <b>' + esc(usd(box2.price)) + '</b> <a target="_blank" rel="noopener" href="' + esc(ymLink(box2)) + '">Yugi-Market</a></div>' : "") +
      (s.box ? '<div class="cs-fact"><span class="small">Booster box, Bunjang</span> <b>' + esc(usd(ocgUSD(s.box.price, "kr")) || fmtLocal(s.box.price, "KRW")) + '</b> <a target="_blank" rel="noopener" href="' + esc(bunjangBoxURL(s)) + '">Bunjang</a></div>' : "");
    const words = csNorm(cs.setFind || "").split(/\s+/).filter(Boolean);
    let rows = [];
    for (const c of full.cards) for (const x of c.rows) rows.push(x);
    const usdOf = x => x.local ? ocgUSD(x.local, region) : null;
    rows = rows.filter(x => (!cs.setRarity || x.rarity === cs.setRarity) &&
      (cs.setShow !== "have" || ocgRowOwned(owned, x)) && (cs.setShow !== "missing" || !owned.byNumber.get(x.card.number)) &&
      (!words.length || words.every(w => csNorm(x.card.name + " " + x.card.number + " " + x.rarity + " " + x.ja).includes(w))));
    const byNum = (a, b) => a.card.number.localeCompare(b.card.number, undefined, {numeric: true}) || a.rarity.localeCompare(b.rarity);
    const sorters = {
      number: byNum,
      value: (a, b) => ((usdOf(b) == null ? -1 : usdOf(b)) - (usdOf(a) == null ? -1 : usdOf(a))) || byNum(a, b),
      name: (a, b) => a.card.name.localeCompare(b.card.name) || byNum(a, b),
      rarity: (a, b) => a.rarity.localeCompare(b.rarity) || byNum(a, b)
    };
    rows.sort(sorters[settings.csSetSort] || sorters.number);
    const total = full.cards.reduce((t, c) => t + c.rows.length, 0);
    if (!rows.length) { box.innerHTML = '<div class="notice">No card in this set matches. ' + (cs.setShow === "have" ? "You don't have any of these yet." : "Try fewer words, or All rarities.") + "</div>"; return; }
    box.innerHTML = '<p class="results-head">' + (rows.length === total ? plural(rows.length, "printing") : rows.length + " of " + plural(total, "printing")) + ".</p>" +
      csOcgTableHTML(rows.map(ocgChaseLike), {thumbs: true, name: true, inSet: true}) +
      '<p class="small">' + (region === "jp" ? (s.rush ? "Fullahead's price (a Japanese card shop), with its photos" : "BIGWEB's price for a copy in stock (a large Japanese shop), with its photos")
        : "Bunjang (a Korean marketplace): what each card sold for lately, else the middle of the asking prices; the photos are the Japanese prints") +
      ", from Card Vault's daily list, " + esc(ocgListDate()) + '. "You have" counts each card number once. Yugipedia: <a target="_blank" rel="noopener" href="' + esc(yp) + '">the set\'s card list</a>.</p>';
  }
  // A Japanese or Korean set the daily list doesn't have yet: what the Market has (its most valuable cards), and where to see the rest
  function csOcgSetHTML(s) {
    const lang = csLang(s), code = s.prefix + (s.region === "jp" ? "-JP" : "-KR");
    const yp = "https://yugipedia.com/wiki/Set_Card_Lists:" + encodeURIComponent(s.name.replace(/ /g, "_")) + "_(OCG-" + (s.region === "jp" ? "JP" : "KR") + ")";
    const box = s.region === "jp" ? ymBox(s) : null;
    return '<div class="cs-set-head"><h3 class="cs-set-title">' + esc(s.name) + "</h3>" +
      '<p class="cs-set-sub">' + esc([code, s.date ? "released " + fmtDate(parseDay(s.date.slice(0, 10))) : "", ocgLineLabel(s), s.cards ? plural(s.cards, "card") : "", lang].filter(Boolean).join(" · ")) + "</p></div>" +
      '<div class="cs-set-facts">' +
      (s.top ? '<div class="cs-fact"><span class="small">Most valuable</span> <b class="gold">' + esc(usd(ocgUSD(s.top.local, s.region)) || fmtLocal(s.top.local, OCG_CUR[s.region])) + '</b> <span class="small">' + esc(s.top.name) + "</span></div>" : "") +
      (box ? '<div class="cs-fact"><span class="small">Booster box, Yugi-Market</span> <b>' + esc(usd(box.price)) + '</b> <a target="_blank" rel="noopener" href="' + esc(ymLink(box)) + '">Yugi-Market</a></div>' : "") +
      (s.box ? '<div class="cs-fact"><span class="small">Booster box, Bunjang</span> <b>' + esc(usd(ocgUSD(s.box.price, "kr")) || fmtLocal(s.box.price, "KRW")) + '</b> <a target="_blank" rel="noopener" href="' + esc(bunjangBoxURL(s)) + '">Bunjang</a></div>' : "") +
      "</div>" +
      (s.chase.length ? '<p class="results-head">Its ' + plural(s.chase.length, "most valuable card") + " (of " + (s.cards ? s.cards : "all its") + ").</p>" +
        '<div class="table-wrap"><table class="table cs-table cs-settable stack-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>No.</th><th>Card</th><th class="num">Price</th><th>From</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
        s.chase.map((c, i) => {
          const owned = ocgOwnedCount(c), k = esc(s.id + "|" + i);
          return "<tr" + (owned ? ' class="cs-have"' : "") + '><td class="c-thumb"><span class="sleeve"' + foilAttr(c.rarity) + ">" + imgTag({list: [c.img].filter(Boolean).concat(namePics(c.name, "200w", c.rarity).list)}, c.name) + "</span></td>" +
            '<td data-label="No.">' + esc(c.number) + "</td><td>" + esc(c.name) + '<span class="cell-sub">' + esc(c.rarity || "rarity not stated") + (owned ? ' <span class="cs-own">You have ' + owned + "</span>" : "") + "</span></td>" +
            '<td class="num" data-label="Price">' + ocgMoneyHTML(c.local, s.region) + '</td><td data-label="From">' + esc(chaseFrom(s, c)) + "</td>" +
            '<td><div class="want-actions">' + (ocgWanted(c) ? '<span class="on-list">On want list</span>' : '<button class="btn btn-small" type="button" data-cs-ocgwant="' + k + '">Want</button>') +
            '<button class="btn btn-small" type="button" data-cs-ocghave="' + k + '">I have it</button></div></td></tr>';
        }).join("") + "</tbody></table></div>" : '<div class="notice">The Market has no prices for this set\'s cards yet.</div>') +
      '<p class="small">The Market keeps the most valuable cards of each ' + lang + ' set. Every card in it: <a target="_blank" rel="noopener" href="' + esc(yp) + '">Yugipedia\'s card list</a>. ' +
      "For any other card, search its number (like " + esc(code) + "001).</p>";
  }

  /* ----- Set goals: sets you're finishing, on the Collection tab ----- */
  // A goal is just the set and when it was last changed; its progress is worked out from your collection. A removed
  // goal is remembered for a while (off), so syncing doesn't bring it back from a device that still has it.
  const GOAL_MAX = 12;
  function cleanGoals(list) {
    const by = new Map();
    for (const x of Array.isArray(list) ? list : []) {
      const g = Number(x && x.g);
      if (!Number.isFinite(g)) continue;
      const e = {g, t: modTime(x.t) || 0};
      if (x.off) e.off = 1;
      const cur = by.get(g);
      if (!cur || e.t > cur.t) by.set(g, e);
    }
    const all = Array.from(by.values());
    const on = all.filter(e => !e.off).sort((a, b) => a.t - b.t).slice(-GOAL_MAX);
    const off = all.filter(e => e.off).sort((a, b) => b.t - a.t).slice(0, 40);
    return on.concat(off);
  }
  function mergeGoals(mine, theirs, fileWins) {
    const a = new Map(cleanGoals(mine).map(e => [e.g, e])), b = new Map(cleanGoals(theirs).map(e => [e.g, e]));
    let changed = false, behind = false;
    for (const [g, e] of b) {
      const m = a.get(g);
      if (!m || e.t > m.t || (fileWins && (e.t !== m.t || !!e.off !== !!m.off))) { if (!m || !!m.off !== !!e.off || m.t !== e.t) changed = true; a.set(g, e); }
      else if (m.t > e.t) behind = true;
    }
    for (const g of a.keys()) if (!b.has(g)) behind = true;
    return {list: cleanGoals(Array.from(a.values())), changed, behind};
  }
  const goalIds = () => cleanGoals(settings.setGoals).filter(e => !e.off).map(e => e.g);
  function setGoal(gid, on) {
    const list = cleanGoals(settings.setGoals).filter(e => e.g !== gid);
    list.push(on ? {g: gid, t: Date.now()} : {g: gid, t: Date.now(), off: 1});
    settings.setGoals = cleanGoals(list);
  }
  const isGoal = gid => goalIds().includes(+gid);
  // What a set still needs: for each card number you don't have, its cheapest printing (TCGplayer market, else listing)
  function csSetNeeds(s, owned) {
    owned = owned || csOwnedMap();
    const pr = csSetProgress(s, owned);
    const need = new Map();
    for (const p of s.cards) {
      const k = csCardKey(p);
      if (pr.keys.has(k)) continue;
      let cur = need.get(k);
      if (!cur) need.set(k, cur = {key: k, p, v: null});
      for (const ed in p.prices) { const v = firstPrice(p.prices[ed]); if (v != null && (cur.v == null || v < cur.v)) { cur.v = v; cur.p = p; } }
    }
    const missing = Array.from(need.values()).sort((a, b) => String(a.p.number).localeCompare(String(b.p.number), undefined, {numeric: true}));
    // (missing cards already on the want list, as any printing of that number from this set)
    const wanted = new Set();
    for (const w of wants) { const p = w.productId && catalog ? catalog.byId.get(w.productId) : null; if (p && p.group.id === s.group.id) wanted.add(csCardKey(p)); }
    return {pr, missing, cost: missing.reduce((t, m) => t + (m.v || 0), 0), unpriced: missing.filter(m => m.v == null).length,
      toWant: missing.filter(m => !wanted.has(m.key))};
  }
  function toggleGoal(gid) {
    gid = +gid;
    const s = csFindSet("en:" + gid);
    const on = isGoal(gid);
    if (!on && goalIds().length >= GOAL_MAX) { toast("You can have up to " + GOAL_MAX + " set goals. Remove one first.", {kind: "error"}); return; }
    setGoal(gid, !on);
    if (!on) goalDone.set(gid, s ? csSetProgress(s, csOwnedMap()).have >= csSetCount(s) : false);
    save(); render();
    const name = s ? s.group.name : "that set";
    toast(on ? "Removed " + name + " from your goals." : "Added " + name + " to your goals. Its progress shows on the Collection tab.",
      {action: "Undo", onAction: () => { setGoal(gid, on); save(); render(); }});
  }
  // The option (never automatic): every card of the set you don't have, onto the want list, cheapest printing
  // of each, any edition. Ones already on the want list are left as they are.
  function goalAddMissing(gid) {
    const s = csFindSet("en:" + gid);
    if (!s) return;
    const needs = csSetNeeds(s);
    if (!needs.toWant.length) { toast(needs.missing.length ? "The missing cards are already on your want list." : "You have every card in " + s.group.name + "."); return; }
    const before = wants.slice();
    for (const m of needs.toWant) addWant(Object.assign(wantFromProduct(m.p), {edition: "Any", notes: "For " + s.group.name}), {keepNotes: true});
    save(); render();
    toast("Added " + plural(needs.toWant.length, "card") + " from " + s.group.name + " to your want list" +
      (needs.toWant.reduce((t, m) => t + (m.v || 0), 0) ? ", about " + usd(needs.toWant.reduce((t, m) => t + (m.v || 0), 0)) + " at today's prices" : "") + ".",
      {action: "Undo", onAction: () => { wants = before; save(); render(); }});
  }
  const goalDone = new Map();   // (to notice a goal being finished while you add cards)
  let lastAddAt = 0;
  function checkGoalsDone() {
    if (!catalog) return;
    const ids = goalIds();
    if (!ids.length) return;
    const owned = csOwnedMap(), fresh = Date.now() - lastAddAt < 5000;
    for (const g of ids) {
      const s = csFindSet("en:" + g);
      if (!s) continue;
      const done = csSetProgress(s, owned).have >= csSetCount(s);
      if (done && goalDone.get(g) === false && fresh) toast("You finished " + s.group.name + "! Every card in the set is in your collection.");
      goalDone.set(g, done);
    }
  }
  // Each goal folds down to its name and progress bar; tapping it shows the numbers and buttons. Which ones are
  // open is remembered on this device.
  const goalOpen = gid => (settings.goalsOpen || []).includes(+gid);
  function foldGoal(gid) {
    gid = +gid;
    const open = (settings.goalsOpen || []).filter(g => g !== gid && isGoal(g));
    if (!goalOpen(gid)) open.push(gid);
    settings.goalsOpen = open;
    saveSettings();
    renderGoalsBar();
    const again = document.querySelector('#goalsBar [data-goal-fold="' + gid + '"]');
    if (again) again.focus();
  }
  function goalHeadHTML(gid, name, pr, done) {
    const open = goalOpen(gid), pctW = pr && pr.total ? (pr.have / pr.total * 100).toFixed(1) : 0;
    return '<button type="button" class="goal-head" data-goal-fold="' + gid + '" aria-expanded="' + open + '">' +
      '<span class="goal-name">' + esc(name) + (done ? ' <span class="goal-check" aria-hidden="true">&#10003;</span>' : "") + "</span>" +
      (pr ? '<span class="sr">, ' + (done ? "complete" : pr.have + " of " + pr.total + " cards") + "</span>" : "") +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (pr ? '<span class="progress" aria-hidden="true"><span style="width:' + pctW + '%"></span></span>' : "");
  }
  function goalCardHTML(s, needs) {
    const pr = needs.pr, pct = pr.total ? Math.floor(pr.have / pr.total * 100) : 0, done = pr.have >= pr.total, gid = s.group.id;
    const open = goalOpen(gid);
    return '<article class="goal' + (done ? " done" : "") + (open ? " open" : "") + '">' + goalHeadHTML(gid, s.group.name, pr, done) +
      (open ? '<div class="goal-more"><p class="goal-nums">' + (done ? '<b class="gold">Complete!</b> You have all ' + pr.total + " cards."
          : "<b>" + pr.have + " of " + pr.total + "</b> cards (" + pct + "%)" + (needs.cost ? " · about <b>" + esc(usd(needs.cost)) + "</b> to finish" : "") +
            (needs.unpriced ? ' <span class="small">(' + needs.unpriced + " without a price)</span>" : "")) + "</p>" +
        '<div class="goal-actions"><button class="btn btn-small" type="button" data-goal-open="' + gid + '">See the cards</button>' +
        (done ? "" : needs.toWant.length ? '<button class="btn btn-small" type="button" data-goal-wants="' + gid + '">Add the ' + plural(needs.toWant.length, "missing card") + " to my want list</button>"
          : '<span class="small">The missing ' + (needs.missing.length === 1 ? "card is" : "cards are") + " on your want list</span>") + "</div>" +
        '<button type="button" class="link-btn goal-remove" data-goal-toggle="' + gid + '">Remove this goal</button></div>' : "") + "</article>";
  }
  function renderGoalsBar() {
    const bar = $("goalsBar");
    if (!bar) return;
    const ids = catalog ? goalIds() : [], themes = themeGoals();
    if (!ids.length && !themes.length) { bar.innerHTML = ""; bar.hidden = true; return; }
    bar.hidden = false;
    if (themes.length) themesReady();
    const owned = csOwnedMap();
    const cards = ids.map(g => {
      const s = csFindSet("en:" + g);
      if (!s) return '<article class="goal' + (goalOpen(g) ? " open" : "") + '">' + goalHeadHTML(g, "A set TCGplayer no longer lists", null, false) +
        (goalOpen(g) ? '<div class="goal-more"><p class="goal-nums">This goal\'s set isn\'t in TCGplayer\'s list anymore. Remove it to make room for another.</p>' +
          '<button type="button" class="link-btn goal-remove" data-goal-toggle="' + g + '">Remove this goal</button></div>' : "") + "</article>";
      return goalCardHTML(s, csSetNeeds(s, owned));
    });
    bar.innerHTML = '<div class="goals-head"><h3 class="sub-h">' + (themes.length ? "Goals" : "Set goals") + '</h3><span><button type="button" class="link-btn" data-goal-add>Add a set</button> · ' +
      '<button type="button" class="link-btn" data-theme-pick>Add an archetype or card</button></span></div>' +
      '<div class="goal-list">' + cards.concat(themes.map(themeGoalHTML)).join("") + "</div>";
  }
  // "Add a goal": find the set in Card search
  function openGoalPicker() {
    settings.csMode = "sets"; cs.set = null; cs.q = ""; cs.limit = 30; saveSettings();
    if ($("csQ")) $("csQ").value = "";
    setTab("search");
    toast("Find the set, open it, then tap Make this set a goal.");
  }

  // A card's worth, in the drawer: every printing's price, its price over time, PSA 10 value, other markets, yours.
  // opts.fromScan: opened from Scan to check (a button goes back to scanning)
  function openPriceCard(pid, edition, opts) {
    const p = catalog ? catalog.byId.get(+pid) : null;
    if (!p) return;
    const eds = printingsFor(p), ed = eds.includes(edition) ? edition : eds[0] || "";
    const id = "price:" + p.id + ":" + ed;
    drawerCtx = {mode: "price", id};
    const name = cleanName(p.name, p.rarity);
    csRemember(name);
    // (a stand-in for one Near Mint copy, so the price, PSA 10 and chart helpers can be used)
    const r = {id, productId: p.id, name, productName: p.name, setName: p.group.name, number: p.number, rarity: p.rarity, edition: ed ? csPrinting(ed) : "",
      condition: "Near Mint", language: "English", qty: 1, sealed: false};
    const sub = catalogPrice(p, r.edition);
    const mine = collection.filter(x => x.productId === p.id);
    const want = wants.find(w => w.productId === p.id);
    const q = encodeURIComponent((p.number + " " + name).trim());
    const bigPics = productPics(p, "in_1000x1000"), big = firstPhoto(bigPics);
    const changes = sub && sub.market != null ? PERIODS.filter(([k]) => sub[k] != null).map(([k]) =>
      "<span>" + esc(periodLabel(k)) + ": " + changeHTML(sub.market - sub[k], sub[k] > 0 ? (sub.market - sub[k]) / sub[k] : null, true) + "</span>") : [];
    openDrawer("Card price",
      '<a href="' + esc(big || "#") + '" target="_blank" rel="noopener" class="detail-img" title="Open full-size image"' + (big ? "" : ' onclick="return false"') + ">" +
      '<span class="sleeve"' + foilAttr(p.rarity) + ">" + imgTag(bigPics, name, true) + "</span></a>" +
      '<h3 class="detail-title">' + esc(name) + "</h3>" +
      '<p class="detail-sub"><button type="button" class="link-btn" id="csSetLink" title="Every card in this set">' + esc(p.group.name) + "</button>" + (p.group.published ? " (" + esc(String(p.group.published).slice(0, 4)) + ")" : "") + "<br>" + esc(p.number || "No card number") + (p.rarity ? ", " + esc(p.rarity) : "") + "</p>" +
      '<div class="links"><a target="_blank" rel="noopener" href="' + esc(tcgPage(p.id)) + '">View on TCGplayer</a>' +
      '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + q + (ed === "1st Edition" ? "+1st" : "") + '">eBay</a>' +
      '<a target="_blank" rel="noopener" href="https://www.cardmarket.com/en/YuGiOh/Products/Search?searchString=' + encodeURIComponent(name) + '">Cardmarket</a></div>' +
      '<div class="section"><h3>TCGplayer price</h3>' + (eds.length ? '<table class="price-table"><thead><tr><th>Printing</th><th class="num">Market</th><th class="num">Lowest listing</th></tr></thead><tbody>' +
        eds.map(k => { const s = p.prices[k]; return "<tr" + (k === ed && eds.length > 1 ? ' class="mine"' : "") + "><td>" + esc(csPrinting(k)) + '</td><td class="num">' +
          esc(s.market == null ? "no sales" : usd(s.market)) + '</td><td class="num">' + esc(s.low == null ? "" : usd(s.low)) + "</td></tr>"; }).join("") + "</tbody></table>"
        : '<p class="small">TCGplayer has no recent sales or listings for this card.</p>') +
      (changes.length ? '<div class="changes" aria-label="Market price change' + (eds.length > 1 ? " for " + esc(csPrinting(ed)) : "") + '">' + changes.join("") + "</div>" : "") +
      '<p class="small">From TCGplayer, ' + esc(fmtDate(catalog.generated)) + ". Market price is what the card has recently sold for (Near Mint); lowest listing is the cheapest copy for sale now.</p>" +
      '<div id="otherMarkets"><button type="button" class="btn btn-small" id="otherBtn">Check other markets</button></div></div>' +
      (SITE ? '<div class="section"><h3>Price over time</h3><div id="cardHist" class="card-hist"><p class="small">Loading…</p></div></div>' : "") +
      '<div class="section"><h3>Graded value</h3><div id="gradedBox">' + gradedBoxHTML(r) + "</div></div>" +
      '<div class="section"><h3>Yours</h3>' +
      (mine.length ? '<ul class="cs-mine">' + mine.map(x => "<li><span>" + esc([x.qty > 1 ? x.qty + " ×" : "", x.edition, x.grade ? gradeLabel(x.grade) : x.condition].filter(Boolean).join(" ")) +
        '<span class="small">' + esc(x.location ? " · " + x.location : "") + "</span></span>" +
        '<button type="button" class="link-btn" data-cs-mine="' + esc(x.id) + '">Open</button></li>').join("") + "</ul>" : '<p class="small">Not in your collection.</p>') +
      (want ? '<p class="small">On your want list' + (want.target != null ? ", target " + esc(usd(want.target)) : "") + ".</p>" : "") +
      '<div class="form-actions"><button class="btn btn-primary" type="button" id="csHave">' + (mine.length ? "Add more" : "I have it") + "</button>" +
      '<button class="btn" type="button" id="csWant">' + (want ? "Edit want" : "Want") + "</button>" +
      (opts && opts.fromScan ? '<span class="spacer"></span><button class="btn" type="button" id="csScanMore">Scan another card</button>' : "") + "</div></div>");
    if ($("csScanMore")) $("csScanMore").addEventListener("click", () => openScanner({check: true}));
    $("otherBtn").addEventListener("click", () => loadOtherMarkets(r));
    $("csSetLink").addEventListener("click", () => openSearchSet("en:" + p.group.id));
    $("csHave").addEventListener("click", () => { drawerCtx = null; openPickedForm(p, {edition: r.edition || null}); });
    $("csWant").addEventListener("click", () => { const w = wants.find(x => x.productId === p.id); if (w) openWantForm(p, w); else openWantForm(p, null, {edition: r.edition}); });
    $("drawerBody").querySelectorAll("[data-cs-mine]").forEach(b => b.addEventListener("click", () => openDetails(b.dataset.csMine)));
    if (SITE) loadCardHistory(r, p);
    if (pcOn() && !pcBad() && normNumber(p.number)) {
      const h = pcCache()[pcKey(r)];
      if (!h || Date.now() - h.t > PC_TTL) pcLookup(r).then(() => { if (drawerCtx && drawerCtx.id === id && $("gradedBox")) $("gradedBox").innerHTML = gradedBoxHTML(r); }).catch(() => {});
    }
  }

  /* ======================= Want list ======================= */
  // The want list's groups: cards, booster boxes, booster packs, and other sealed products.
  const WANT_GROUPS = [["card", "Cards"], ["box", "Booster boxes"], ["pack", "Booster packs"], ["sealed", "Other sealed"]];
  const wantGroupName = k => (WANT_GROUPS.find(x => x[0] === k) || WANT_GROUPS[0])[1];
  const WANT_ONE = {card: "Card", box: "Booster box", pack: "Booster pack", sealed: "Sealed product"};
  const WANT_SHORT = {box: "Boxes", pack: "Packs", sealed: "Other"};   // (on a phone's switch)
  // A sealed product's group, from the Market's product types (a case of boxes goes with the boxes).
  const sealedWantKind = mkKindValue => mkKindValue === "box" || mkKindValue === "case" ? "box" : mkKindValue === "pack" ? "pack" : "sealed";
  function wantKind(w) {
    if (w.kind && w.kind !== "card") return w.kind;
    const p = w.productId && catalog ? catalog.byId.get(w.productId) : null;
    return p && p.sealed ? sealedWantKind(mkKind(p.name)) : "card";
  }
  const wantIsSealed = w => wantKind(w) !== "card";
  // "3 cards", or "3 items" once the list has sealed products too
  const wantCount = n => plural(n, wants.some(wantIsSealed) ? "item" : "card");
  // Where a want's price comes from, for the list
  function wantSource(w) {
    if (w.ref) return w.shop || "";
    if (w.productId) return "TCGplayer";
    const g = ocgRegion(w.number);
    return g ? ocgSrc(g.region, g.code) : "";
  }
  // A shop product's price now: Yugi-Market's current price (from its lists the Market reads), the middle of the
  // Korean boxes listed on Bunjang, else the price when it was added.
  function ymCached() {
    if (!ymk.list) { const c = readJSON(YM_KEY, null); if (c && Array.isArray(c.list)) { ymk.list = c.list; ymk.at = c.t || 0; } }
    return ymk.list || [];
  }
  function shopWantLive(w) {
    const ref = String(w.ref || "");
    if (ref.startsWith("ym:")) {
      const x = ymCached().find(y => y.handle === ref.slice(3));
      return x && x.price > 0 ? x.price : null;
    }
    if (ref.startsWith("krbox:")) {
      if (!ocgMk.data && !ocgMk.loading && !ocgMk.failed && ocgMarketURL()) loadOcgMarket();
      const s = ocgFindSet("kr:" + ref.slice(6));
      return s && s.box ? ocgUSD(s.box.price, "kr") : null;
    }
    return null;
  }
  // Yugi-Market lists it, but sold out: its price isn't one you can pay now
  function shopWantSoldOut(w) {
    const ref = String(w.ref || "");
    if (!ref.startsWith("ym:")) return false;
    const x = ymCached().find(y => y.handle === ref.slice(3));
    return !!(x && !x.available);
  }
  function shopWantPrice(w) {
    const v = shopWantLive(w);
    return v != null ? v : w.shopPrice != null ? w.shopPrice : null;
  }
  // The current TCGplayer market price for the printing you want (the cheapest printing when any will do).
  function wantPrice(w) {
    if (w.ref) return shopWantPrice(w);
    if (!w.productId) { const pr = ocgPrice(w); return pr && pr.usd != null ? pr.usd : ocgMarketPrice(w); }   // (Japanese and Korean cards: BIGWEB, Bunjang)
    if (!catalog) return null;
    const p = catalog.byId.get(w.productId);
    if (!p) return null;
    if (w.edition && w.edition !== "Any") return firstPrice(catalogPrice(p, w.edition));
    let best = null;
    for (const k in p.prices) {
      const v = firstPrice(p.prices[k]);
      if (v != null && (best == null || v < best)) best = v;
    }
    return best;
  }
  function wantStatus(w) {
    const price = wantPrice(w), soldOut = shopWantSoldOut(w);
    return {price, soldOut, hit: !soldOut && w.target != null && price != null && price <= w.target};
  }
  // opts.keepNotes: a note filled in by Card Vault (like "For Blue-Eyes") doesn't replace one you wrote
  function addWant(fields, opts) {
    const edition = fields.edition || "Any";
    const existing = wants.find(x => (x.productId && x.productId === fields.productId && x.edition === edition) || (fields.ref && x.ref === fields.ref));
    if (existing) {
      if (fields.target != null) existing.target = fields.target;
      if (fields.notes && !(opts && opts.keepNotes && existing.notes)) existing.notes = fields.notes;
      if (fields.qty) existing.qty = Math.max(existing.qty, posInt(fields.qty) || 1);
      return {merged: true, want: existing};
    }
    const w = upgradeWant(Object.assign({id: newId(), added: new Date().toISOString()}, fields, {edition}));
    wants.push(w);
    return {merged: false, want: w};
  }
  function removeWant(id) {
    const w = wants.find(x => x.id === id);
    if (!w) return;
    const before = wants.slice();
    wants = wants.filter(x => x.id !== id);
    save();
    if (!$("drawer").hidden) closeDrawer();
    render();
    toast("Removed " + w.name + " from your want list.", {action: "Undo", onAction: () => { wants = before; save(); render(); }});
  }
  // "I got it": the matching Add form, and the want comes off the list (or down by the number added) once it's added.
  function gotWant(id) {
    const w = wants.find(x => x.id === id);
    if (!w) return;
    drawerCtx = null;
    if (w.productId) {
      const p = catalog ? catalog.byId.get(w.productId) : null;
      if (!p) { toast("Adding it needs TCGplayer's card list. " + GET_DATA, {kind: "error"}); return; }
      if (p.sealed) openSealedForm(p, "", {fromWant: w.id});
      else openPickedForm(p, {fromWant: w.id, edition: w.edition !== "Any" ? w.edition : null});
      return;
    }
    if (wantIsSealed(w)) { openShopGotForm(w); return; }
    // a Japanese or Korean card: its BIGWEB or Bunjang price and photo when the Market has the card
    const g = ocgRegion(w.number);
    if (g) {
      const s = ocgSetsOf(g.region === "JP" ? "jp" : "kr").find(x => x.prefix === g.set);
      const same = s ? s.chase.filter(x => x.number === g.code) : [];
      const c = !w.rarity ? same[0] : matchRarity(same, w.rarity, x => x.rarity) || same.find(x => !x.rarity);
      if (c) { ocgHave(s, c, {fromWant: w.id}); return; }
      const op = ocgPrice(w);
      openOcgForm({code: g.code, name: w.name, setName: w.setName, rarities: w.rarity ? [w.rarity] : []}, g.region === "JP" ? "Japanese" : "Korean",
        {rarity: w.rarity, image: ocgImage(w), backup: "", ja: "", price: op && !op.none && op.local != null ? op : null}, {fromWant: w.id});
      return;
    }
    openManual({name: w.name, number: w.number, setName: w.setName, rarity: w.rarity, fromWant: w.id});
  }
  // After adding qty copies of a want to the collection: it comes off the want list, or down by qty.
  // Returns the toast's ending.
  function tookWant(wantId, qty) {
    const want = wants.find(w => w.id === wantId);
    if (!want) return "";
    if (want.qty > qty) { want.qty -= qty; return ". You still want " + want.qty + " more."; }
    wants = wants.filter(w => w.id !== want.id);
    return " and took it off your want list.";
  }
  const fromWantNotice = '<div class="notice" style="margin:0 0 14px">From your want list. Adding it to your collection takes it off the want list.</div>';
  function wantFromProduct(p) {
    if (p.sealed) return {productId: p.id, name: p.name, productName: p.name, setName: p.group.name, number: "", rarity: "", kind: sealedWantKind(mkKind(p.name))};
    return {productId: p.id, name: cleanName(p.name, p.rarity), productName: p.name, setName: p.group.name, number: p.number, rarity: p.rarity};
  }
  // Yugi-Market products and Korean booster boxes from the Market
  const ymLink = x => "https://yugi-market.com/products/" + encodeURIComponent(x.handle);
  const ymWanted = x => wants.some(w => w.ref === "ym:" + x.handle);
  const krBoxWanted = s => wants.some(w => w.ref === "krbox:" + s.prefix);
  const ownedByRef = ref => collection.filter(r => r.sealed && r.ref === ref).reduce((t, r) => t + r.qty, 0);
  const ymOwned = x => ownedByRef("ym:" + x.handle);
  const krBoxOwned = s => ownedByRef("krbox:" + s.prefix);
  function addShopWant(fields) {
    const res = addWant(Object.assign({productId: null, number: "", rarity: "", edition: "Any"}, fields));
    save(); renderTabs(); renderMarketList();
    toast("Added " + res.want.name + " to your want list.", {action: "Set a target price", onAction: () => openWantEdit(res.want)});
    return res;
  }
  function ymWant(x) {
    if (ymWanted(x)) return;
    const set = ymMatch().get(x.id);
    addShopWant({name: x.title, productName: x.title, setName: set ? set.name : "", kind: x.kind === "box" ? "box" : x.kind === "pack" ? "pack" : "sealed",
      ref: "ym:" + x.handle, shop: "Yugi-Market", link: ymLink(x), image: x.img, shopPrice: x.price, notes: "Japanese"});
  }
  function krBoxWant(s) {
    if (krBoxWanted(s)) return;
    addShopWant({name: s.name + " booster box", productName: s.name + " booster box", setName: s.name, kind: "box",
      ref: "krbox:" + s.prefix, shop: "Bunjang", link: bunjangBoxURL(s), shopPrice: s.box ? ocgUSD(s.box.price, "kr") : null, notes: "Korean"});
  }

  /* ----- Japanese and Korean sealed products you own ----- */
  // Yugi-Market's boxes, packs and decks (Japanese) and Bunjang's booster boxes (Korean) as things you can add: ref says
  // which product it is, so its value follows the shop's price from then on (a fixed price is only kept if you enter one).
  function ymItem(x) {
    const set = ymMatch().get(x.id);
    return {ref: "ym:" + x.handle, name: x.title, setName: set ? set.name : "", kind: x.kind === "box" ? "box" : x.kind === "pack" ? "pack" : "sealed",
      shop: "Yugi-Market", link: ymLink(x), image: x.img, price: x.price, language: "Japanese", soldOut: !x.available, pics: {list: [x.img].filter(Boolean)}, src: x};
  }
  function krBoxItem(s) {
    return {ref: "krbox:" + s.prefix, name: s.name + " booster box", setName: s.name, kind: "box", shop: "Bunjang", link: bunjangBoxURL(s), image: "",
      price: s.box ? ocgUSD(s.box.price, "kr") : null, language: "Korean", soldOut: false, pics: {list: [], art: s.top && s.top.img ? s.top.img : ""}, src: s};
  }
  // What a want list entry from a shop is, as the same kind of thing (for "I got it")
  function wantItem(w) {
    const ref = String(w.ref || "");
    return {ref, name: w.name, setName: w.setName, kind: wantKind(w), shop: w.shop || "", link: w.link || "", image: w.image || "", price: wantPrice(w),
      language: /korean/i.test(w.notes) || ref.startsWith("krbox:") ? "Korean" : "Japanese", soldOut: shopWantSoldOut(w), pics: wantPics(w, "in_400x400"), src: w};
  }
  // lang: "Japanese" or "Korean". The words must all be in the product's name, its set's name or its code.
  function searchShopSealed(lang, q, limit) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return {items: [], more: false, total: 0};
    let hits;
    if (lang === "Korean") {
      hits = ocgSetsOf("kr").filter(s => s.box && words.every(w => (s.name + " " + s.prefix + " booster box korean").toLowerCase().includes(w)))
        .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)).map(krBoxItem);
    } else {
      const match = ymMatch();
      hits = ymCached().filter(x => {
        const set = match.get(x.id);
        const hay = (x.title + " " + (set ? set.name : "") + " " + x.codes.join(" ") + " " + ymKindName(x.kind)).toLowerCase();
        return words.every(w => hay.includes(w));
      }).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)).map(ymItem);
    }
    return {items: hits.slice(0, limit), more: hits.length > limit, total: hits.length};
  }
  // Where a sealed product from a shop is shown from: your photo, the shop's current one, else the set's top card
  function shopSealedPics(r, own) {
    const ref = String(r.ref || "");
    const x = ref.startsWith("ym:") ? ymCached().find(y => y.handle === ref.slice(3)) : null;
    const s = ref.startsWith("krbox:") ? ocgFindSet("kr:" + ref.slice(6)) : null;
    return {list: [own, x ? x.img : ""], sub: "Sealed product", art: s && s.top && s.top.img ? s.top.img : ""};
  }
  // The last price seen for each shop product you own, kept on this device for when the shop can't be reached
  const SHOP_KEPT_KEY = "cardvault.v2.shopkept";
  let shopKeptMem = null;
  function shopKept() {
    if (!shopKeptMem) { const c = readJSON(SHOP_KEPT_KEY, null); shopKeptMem = c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
    return shopKeptMem;
  }
  function keepShopPrices() {
    const next = {};
    for (const r of collection) {
      if (!r.sealed || !r.ref) continue;
      const live = shopWantLive(r), old = shopKept()[r.ref];
      if (live != null) next[r.ref] = {usd: live}; else if (old) next[r.ref] = old;
    }
    if (JSON.stringify(next) === JSON.stringify(shopKept())) return;
    shopKeptMem = next;
    try { localStorage.setItem(SHOP_KEPT_KEY, JSON.stringify(next)); } catch (e) { /* optional */ }
  }
  // Your shop products are priced from the shops' lists: start on them right away (the last list read is kept, so
  // they have a price at once), and show the new prices when they're in.
  function shopPricesReady() {
    const refs = collection.filter(r => r.sealed && r.ref).map(r => String(r.ref));
    if (!refs.length) return;
    if (refs.some(x => x.startsWith("ym:"))) loadYugiMarket();
    if (refs.some(x => x.startsWith("krbox:")) && !ocgMk.data && !ocgMk.loading && !(ocgMk.failed && Date.now() - ocgMk.failed < 10 * 60000) && ocgMarketURL()) loadOcgMarket();
    keepShopPrices();   // (a list this device already had gives prices now; a fresh read goes through shopPricesIn)
  }
  function shopPricesIn() {
    if (!collection.some(r => r.sealed && r.ref)) return;
    keepShopPrices();
    renderSoon();
  }

  /* ======================= Moving cards between locations & trade list ======================= */
  const sameLoc = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const locName = l => l || "No location";
  const whereNow = r => (r.location ? "In " + r.location : "No location") + ": " + r.qty;
  // Moves copies to another location. plan: [{id, qty}]. Copies that end up matching an entry already kept there
  // (same printing, condition, language and grading) join it; moving only some copies splits the entry.
  // Returns what happened, with undo().
  function moveCopies(plan, dest) {
    dest = String(dest || "").trim();
    dest = allLocations().find(l => sameLoc(l, dest)) || dest;   // (keep the spelling the location already has)
    const beforeIds = collection.map(r => r.id), snaps = new Map(), created = [];
    const keep = r => { if (!snaps.has(r.id)) snaps.set(r.id, JSON.parse(JSON.stringify(r))); };
    const res = {dest, cards: 0, printings: 0, joined: 0, missing: 0};
    for (const step of plan) {
      const r = collection.find(x => x.id === step.id);
      if (!r) { res.missing++; continue; }
      const n = Math.min(Math.max(0, Math.floor(Number(step.qty)) || 0), r.qty);
      if (!n || sameLoc(r.location, dest)) continue;
      const target = collection.find(x => x !== r && recordKey(x) === recordKey(Object.assign({}, r, {location: dest})));
      keep(r);
      if (target) {
        keep(target);
        target.qty += n;
        pcSentShift(r, target, n);
        for (const f of ["paid", "manualPrice", "jp", "kr", "customImage", "snap"]) if (target[f] == null && r[f] != null) target[f] = JSON.parse(JSON.stringify(r[f]));
        if (!target.notes && r.notes) target.notes = r.notes;
        r.qty -= n;
        if (r.qty <= 0) { collection = collection.filter(x => x !== r); selected.delete(r.id); }
        res.joined++;
      } else if (n === r.qty) {
        r.location = dest;
      } else {
        r.qty -= n;
        const copy = Object.assign(JSON.parse(JSON.stringify(r)), {id: newId(), qty: n, location: dest, mod: 0});
        delete copy.pcSent;
        pcSentShift(r, copy, n);
        collection.splice(collection.indexOf(r) + 1, 0, copy);
        created.push(copy.id);
      }
      res.cards += n; res.printings++;
    }
    res.undo = () => {
      collection = collection.filter(x => !created.includes(x.id));
      for (const [id, s] of snaps) {
        const cur = collection.find(x => x.id === id);
        if (cur) Object.keys(s).forEach(k => { if (k !== "mod") cur[k] = s[k]; });
        else { const back = upgradeRecord(s); if (back) collection.push(back); }
      }
      const order = new Map(beforeIds.map((id, i) => [id, i]));
      const pos = x => order.has(x.id) ? order.get(x.id) : beforeIds.length;
      collection.sort((a, b) => pos(a) - pos(b));
    };
    return res;
  }
  // The Move drawer: where to, and how many of each card. opts.back: the card whose details to go back to.
  function openMove(ids, opts) {
    opts = opts || {};
    const recs = ids.map(id => collection.find(r => r.id === id)).filter(Boolean);
    if (!recs.length) return;
    drawerCtx = {mode: "move"};
    const from = recs.every(r => sameLoc(r.location, recs[0].location)) ? recs[0].location : null;
    const chips = allLocations().filter(l => from == null || !sameLoc(l, from)).map(l => [l, l]);
    if (from == null || from) chips.push(["", "No location"]);
    const row = r => '<div class="mv-row" data-row="' + esc(r.id) + '">' +
      '<span class="sleeve' + (r.sealed ? " boxed" : "") + '">' + imgTag(recordPics(r, "200w"), r.name, true) + "</span>" +
      '<div class="batch-info"><b>' + esc(r.name) + "</b><span>" + esc(r.sealed ? r.setName || "Sealed product" : [r.number, r.rarity].filter(Boolean).join(", ")) + "<br>" +
      esc(r.sealed ? "Sealed product" : [r.edition, r.grade ? gradeLabel(r.grade) : r.condition, r.language !== "English" ? r.language : ""].filter(Boolean).join(", ")) + "</span>" +
      '<span class="mv-where">' + esc(whereNow(r)) + "</span></div>" +
      '<div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="One fewer">&minus;</button>' +
      '<input class="input" type="number" inputmode="numeric" min="0" max="' + r.qty + '" step="1" value="' + r.qty + '" data-qty="' + esc(r.id) + '" aria-label="How many ' + esc(r.name) + ' to move">' +
      '<button type="button" class="icon-btn" data-step="1" aria-label="One more">+</button><small>of ' + r.qty + "</small></div></div>";
    openDrawer("Move cards",
      '<form id="moveForm" class="stack" novalidate>' +
      '<label class="field"><span>Move to</span><input class="input" id="mvTo" data-loc="1" autocomplete="off" placeholder="Binder, box or deck, e.g. Deck box"></label>' +
      (chips.length ? '<div class="loc-chips" id="mvChips">' + chips.map(([v, label]) =>
        '<button type="button" class="loc-chip" data-loc="' + esc(v) + '">' + esc(label) + "</button>").join("") + "</div>" : "") +
      '<div class="mv-list">' + recs.map(row).join("") + "</div>" +
      '<p class="mv-total" id="mvTotal"></p>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit" id="mvGo">Move</button>' +
      (opts.back ? '<button class="btn" type="button" id="mvBack">Back</button>' : "") + "</div></form>");
    let picked = false;   // a location was typed or picked (an empty box alone doesn't mean "No location")
    const form = $("moveForm");
    const rowFor = id => Array.from(form.querySelectorAll("[data-row]")).find(el => el.dataset.row === id);
    const qtyOf = id => { const r = collection.find(x => x.id === id), row = rowFor(id), el = row && row.querySelector("[data-qty]");
      return r && el ? Math.min(Math.max(0, Math.floor(Number(el.value)) || 0), r.qty) : 0; };
    const update = () => {
      const dest = $("mvTo").value.trim();
      let cards = 0, printings = 0;
      for (const r of recs) {
        const here = picked && sameLoc(r.location, dest);
        const rowEl = rowFor(r.id);
        rowEl.classList.toggle("here", here);
        rowEl.querySelector(".mv-where").textContent = here ? (r.location ? "Already in " + r.location : "Already has no location") : whereNow(r);
        const n = qtyOf(r.id);
        if (!here && n) { cards += n; printings++; }
      }
      document.querySelectorAll("#mvChips .loc-chip").forEach(c => c.classList.toggle("on", picked && sameLoc(c.dataset.loc, dest)));
      $("mvGo").textContent = cards ? "Move " + plural(cards, "card") + (picked ? " to " + locName(dest) : "") : "Move";
      $("mvGo").disabled = !picked || !cards;
      $("mvTotal").innerHTML = !picked ? "Type where they're going, or pick a location above." :
        cards ? "Moving <b>" + plural(cards, "card") + "</b>" + (printings > 1 ? " (" + printings + " different printings)" : "") + " to <b>" + esc(locName(dest)) + "</b>." :
        "Nothing to move: set how many of each card.";
    };
    $("mvTo").addEventListener("input", () => { picked = !!$("mvTo").value.trim(); update(); });
    form.addEventListener("click", e => {
      const chip = e.target.closest("[data-loc]");
      if (chip) { $("mvTo").value = chip.dataset.loc; picked = true; update(); return; }
      const step = e.target.closest("[data-step]");
      if (step) {
        const input = step.parentNode.querySelector("input");
        input.value = Math.min(Math.max(0, (Math.floor(Number(input.value)) || 0) + Number(step.dataset.step)), Number(input.max));
        update();
      }
    });
    form.querySelectorAll("[data-qty]").forEach(el => el.addEventListener("input", update));
    if ($("mvBack")) $("mvBack").addEventListener("click", () => openDetails(opts.back));
    update();
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (!picked) { toast("Type where the cards are going, or pick a location.", {kind: "error"}); $("mvTo").focus(); return; }
      const res = moveCopies(recs.map(r => ({id: r.id, qty: qtyOf(r.id)})), $("mvTo").value);
      if (!res.cards) { toast(res.missing ? "Those cards aren't in your collection anymore." : "Nothing to move.", {kind: "error"}); return; }
      if (opts.bulk) selected.clear();
      save(); closeDrawer(); render();
      toast("Moved " + plural(res.cards, "card") + " to " + locName(res.dest) + "." + (res.missing ? " (" + plural(res.missing, "card was", "cards were") + " no longer in your collection.)" : ""),
        {action: "Undo", onAction: () => { res.undo(); save(); render(); }});
    });
  }
  function tradeListText() {
    const extras = extrasMap();
    return visibleRecords().filter(r => extras.has(r.id)).map(r => {
      const u = marketValue(r).unit;
      return extras.get(r.id) + "x " + r.name + " (" + [r.number, r.rarity, r.edition, r.condition].filter(Boolean).join(", ") + ")" +
        (u != null ? " - " + usd(u) + " each" : "");
    });
  }
  function copyText(text, done) {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast("Your browser blocked copying. Select the cards in List view and copy them instead.", {kind: "error"});
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* ======================= Share links ======================= */
  // A link to share.html on this website with the cards in the link itself (compressed), so nothing is stored
  // anywhere: whoever gets the link sees those cards, with photos and prices, and nothing else of yours.
  const shareBase = () => SITE ? new URL("share.html", location.href).href : "";
  const shareImg = u => /^https:\/\/(tcgplayer-cdn\.tcgplayer\.com|ms\.yugipedia\.com|image\.bigweb\.co\.jp|[a-z0-9-]*makeshop[a-z0-9-]*\.akamaized\.net)\//i.test(String(u || "")) || isHostedPhoto(u) ? String(u) : "";
  function shareItem(r, opts) {
    const it = {n: r.name, no: r.number || "", s: r.setName || "", r: r.rarity || "", e: r.edition || "", q: opts.qty ? opts.qty(r) : (r.qty || 1)};
    if (r.productId) it.p = r.productId;
    if (r.sealed) it.b = 1; else it.c = r.condition || "";
    if (r.grade) it.g = gradeLabel(r.grade);
    // the first photo the share page may show; none needed when it's the product's own TCGplayer photo
    const im = recordPics(r, "in_400x400").list.map(u => shareImg(String(u || "").replace(/^~/, ""))).find(Boolean);
    if (im && !(r.productId && im === tcgImg(r.productId, "in_400x400"))) it.i = im;
    // Only market prices go out (TCGplayer's, or BIGWEB's/Bunjang's for Japanese and Korean cards): never what you
    // paid, your own estimates or graded values.
    if (opts.prices) { const pi = priceInfo(r); if (pi.unit != null && (pi.from === "tcgplayer" || pi.from === "ocg")) it.v = round2(pi.unit); }
    return it;
  }
  function shareWant(w, opts) {
    const it = {n: w.name, no: w.number || "", s: w.setName || "", r: w.rarity || "", e: w.edition && w.edition !== "Any" ? w.edition : "", q: w.qty || 1};
    if (w.productId) it.p = w.productId;
    if (wantIsSealed(w)) it.b = 1;
    const im = wantPics(w, "in_400x400").list.map(u => shareImg(String(u || "").replace(/^~/, ""))).find(Boolean);
    if (im && !(w.productId && im === tcgImg(w.productId, "in_400x400"))) it.i = im;
    if (opts.prices) { const v = wantPrice(w); if (v != null) it.v = round2(v); }
    if (opts.targets && w.target != null) it.t = w.target;
    return it;
  }
  async function shareLink(payload) {
    const text = JSON.stringify(payload);
    const b64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const utf8 = t => typeof TextEncoder === "function" ? new TextEncoder().encode(t) : Uint8Array.from(unescape(encodeURIComponent(t)), c => c.charCodeAt(0));
    let tag = "j", bytes = utf8(text);
    if (typeof CompressionStream === "function") {
      try {
        const cs = new CompressionStream("deflate-raw");
        const w = cs.writable.getWriter(); w.write(bytes); w.close();
        bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        tag = "z";
      } catch (e) { tag = "j"; bytes = utf8(text); }
    }
    return shareBase() + "#" + tag + "." + b64(bytes);
  }
  // kind: "cards" (the records given) or "wants". opts.extras: the extras map, to share only the spare copies.
  function openShare(kind, ids, opts) {
    opts = opts || {};
    const recs = kind === "wants" ? wants.slice() : ids.map(id => collection.find(r => r.id === id)).filter(Boolean);
    if (!recs.length) { toast(kind === "wants" ? "Your want list is empty." : "Nothing to share."); return; }
    drawerCtx = {mode: "share"};
    const defTitle = kind === "wants" ? "My want list" : opts.extras ? "My trade binder" : "Cards for trade";
    const qtyOf = opts.extras ? (r => opts.extras.get(r.id) || r.qty) : null;
    openDrawer("Share a link",
      '<form id="shareForm" class="stack">' +
      '<p class="small" style="margin:0">A link to a page on this website showing ' + (kind === "wants" ? "your want list" : plural(recs.length, "card")) +
      " with photos. The cards are in the link itself: nothing is stored anywhere, and the page shows nothing else of yours.</p>" +
      '<label class="field"><span>Title</span><input class="input" id="shTitle" value="' + esc(defTitle) + '"></label>' +
      '<label class="check-row"><input type="checkbox" class="check" id="shPrices" checked><span>Include TCGplayer market prices</span></label>' +
      (kind === "wants" ? '<label class="check-row"><input type="checkbox" class="check" id="shTargets"><span>Include the prices I\'d pay</span></label>' : "") +
      '<div class="price-line" id="shOut"><span class="small">Making the link…</span></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="button" id="shCopy">Copy link</button>' +
      (navigator.share ? '<button class="btn" type="button" id="shShare">Share…</button>' : "") +
      '<a class="btn" id="shOpen" target="_blank" rel="noopener" href="#">Open it</a></div></form>');
    let link = "";
    const build = async () => {
      const o = {prices: $("shPrices").checked, targets: !!($("shTargets") && $("shTargets").checked), qty: qtyOf};
      const payload = {app: "Card Vault", v: 1, kind, title: $("shTitle").value.trim().slice(0, 80), at: new Date().toISOString(), prices: o.prices,
        priceDate: catalog && catalog.generated ? fmtDate(catalog.generated) : "", items: recs.map(x => kind === "wants" ? shareWant(x, o) : shareItem(x, o))};
      link = await shareLink(payload);
      if (!$("shOut")) return;
      $("shOpen").href = link;
      $("shOut").innerHTML = "Link ready: " + plural(recs.length, "card") + ', <span class="small">' + esc(Math.round(link.length / 1024 * 10) / 10 + " KB") + "</span>" +
        (link.length > 30000 ? '<br><span class="small">A long link: some messaging apps cut links this long. Share fewer cards if it doesn\'t open.</span>' : "");
    };
    ["shTitle", "shPrices", "shTargets"].forEach(k => { if ($(k)) $(k).addEventListener("change", build); });
    $("shCopy").addEventListener("click", () => { if (link) copyText(link, () => toast("Link copied. Paste it in a message to share it.")); });
    if ($("shShare")) $("shShare").addEventListener("click", () => { if (link) navigator.share({title: $("shTitle").value.trim() || "Card Vault", url: link}).catch(() => {}); });
    build();
  }

