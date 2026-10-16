  /* ======================= Market: every set, its chase cards, and sealed products ======================= */
  // Every set in TCGplayer's catalog with its most valuable cards, and every sealed product with the cheapest
  // listing on TCGplayer next to its market price, plus one-tap searches at other stores (sorted cheapest first).
  const MK_LINES = [["core", "Core booster sets"], ["side", "Side sets"], ["dbp", "Deck Build Packs"], ["bol", "Battles of Legend"],
    ["foil", "All-foil sets"], ["structure", "Structure Decks"], ["speed", "Speed Duel"], ["ots", "OTS Tournament Packs"],
    ["tins", "Tins and mega packs"], ["boxed", "Starter decks and box sets"], ["promo", "Promos and other"]];
  const MK_KINDS = [["pack", "Booster packs"], ["box", "Booster boxes"], ["case", "Cases"], ["structure", "Structure Decks"],
    ["se", "Special Editions"], ["de", "Deluxe Editions"], ["tin", "Tins"], ["boxset", "Box sets and collections"], ["starter", "Starter decks"], ["other", "Tokens and other"]];
  const mkLineName = k => (MK_LINES.find(x => x[0] === k) || [k, ""])[1];
  const mkKindName = k => (MK_KINDS.find(x => x[0] === k) || [k, ""])[1];
  // The English counterparts of the OCG's Deck Build Packs.
  const MK_DBP = new Set(["spirit warriors", "dark saviors", "shadows in valhalla", "hidden summoners", "the infinity chasers", "fists of the gadgets",
    "mystic fighters", "secret slayers", "genesis impact", "ancient guardians", "the grand creators", "tactical masters", "amazing defenders",
    "wild survivors", "valiant smashers", "crossover breakers", "justice hunters"]);
  // Which line a set belongs to, from its name (TCGplayer doesn't say).
  function mkSetLine(name, cards, sealed) {
    const n = String(name || "").toLowerCase();
    if (/^ots tournament pack/.test(n)) return "ots";
    if (/speed duel/.test(n)) return "speed";
    if (/^battles of legend/.test(n)) return "bol";
    if (MK_DBP.has(n)) return "dbp";
    if (/ra yellow|anniversary pack/.test(n)) return "side";
    if (/forbidden legacy/.test(n)) return "promo";
    if (/all-foil|rarity collection|quarter century (bonanza|stampede)|^maximum gold|^premium gold|ghosts from the past|hidden arsenal: chapter|brothers of legend|^dragons of legend|legendary duelists: season|^gold series|^duel devastator$|^duel overload$|^duel power$|ultimate kaiba set/.test(n)) return "foil";
    if (/structure deck|egyptian god deck/.test(n)) return "structure";
    if (/\btins?\b|mega-tins?|mega[- ]?pack|collectors? tins?|collection tin/.test(n)) return "tins";
    if (/starter|legendary (hero |dragon |modern |5d's |arc-v )?decks|yugi's legendary decks|box set|collector'?s? box|value box|chronicles deck|2-player|^legendary collection|hero collection|pot collection|master collection/.test(n)) return "boxed";
    if (/promo|prize|championship|hobby league|tournament pack|champion pack|turbo pack|astral pack|duel terminal|demo|\btokens?\b|sneak preview|judge|advent calendar|event pack|winner's pack|limited pack|shonen jump|video game|mcdonald|manga|redemption|gba|ps2|xbox|nintendo|power of chaos|duelist league|lost art|collaboration|ultimate edition|movie exclusive|eternal duelist soul|duelist of the roses|falsebound|reshef|stairway|dawn of destiny|valuable book|duel master's guide|miscellaneous|collector's boxes|world championship|pharaoh tour|power pack/.test(n)) return "promo";
    if (/legendary duelists|maze of|magnificent|king's court|star pack|battle pack|duelist pack|hidden arsenal|dark revelation|retro pack|movie pack|dark legends|dark beginning|premium pack|ra yellow|duelist saga|world superstars|millennium pack|the secret forces|high-speed riders|wing raiders|fusion enforcers|destiny soldiers|pendulum evolution|toon chaos|legendary collection/.test(n)) return "side";
    if (cards < 20 && !sealed && !/special edit|super edition|advance|deluxe|\bse\b/.test(n)) return "promo";
    return "core";
  }
  // What kind of sealed product this is, from its name.
  function mkKind(name) {
    const n = String(name || "").toLowerCase();
    if (/field center token|\btokens?\b|oversized|ingot|masterpiece|playmat|game mat|sleeves|card case|deck box(?!.*structure)|protector|figure|calendar/.test(n)) return "other";
    if (/deluxe edition/.test(n)) return "de";
    if (/special edition|super edition|advanced? edition|special set|\bse\b display/.test(n)) return "se";
    if (/\bcase\b/.test(n)) return "case";
    if (/mega[- ]pack/.test(n) && !/tin(\s*\[[^\]]*\])?\s*$/.test(n)) return "pack";
    if (/\btins?\b|mega-tins?\b|collectors? tin/.test(n)) return "tin";
    if (/structure deck|egyptian god deck|speed duel decks?\b|chronicles deck/.test(n)) return "structure";
    if (/starter (deck|set|display)|super starter|starter deck/.test(n)) return "starter";
    if (/(^|[^-])box set|collector'?s? (box|set)|collector set|value box|portfolio|gameboard edition|legendary decks|battle kit|binder/.test(n)) return "boxset";
    if (/booster box|mini[- ]?box|box display|\bdisplay\b/.test(n)) return "box";
    if (/booster pack|\bpacks?\b|blister|sleeved/.test(n)) return "pack";
    if (/collection\b/.test(n)) return "boxset";
    if (/\bbox\b/.test(n)) return "box";
    return "other";
  }
  // A card's best price: the highest market price among its printings (the lowest listing when nothing sold).
  function mkBest(p) {
    let best = null;
    for (const ed in p.prices) {
      const sub = p.prices[ed];
      const v = sub.market != null ? sub.market : sub.low;
      if (v != null && (!best || v > best.price)) best = {price: v, edition: ed, product: p};
    }
    return best;
  }
  // A lowest listing under half the market price is usually not what it seems (opened, damaged, mislabeled, a
  // placeholder price): it's shown with a warning and never counted as a deal.
  function mkSealedPrice(p) {
    const sub = catalogPrice(p, "") || {};
    const low = sub.low != null ? sub.low : null, market = sub.market != null ? sub.market : null;
    const suspect = low != null && market != null && low < market * 0.5;
    return {low, market, suspect, best: suspect ? market : (low != null ? low : market),
      under: !suspect && low != null && market != null && market > 0 && low < market ? (market - low) / market : 0};
  }
  function marketData() {
    if (catalog.market) return catalog.market;
    const sets = new Map();
    for (const p of catalog.products) {
      let s = sets.get(p.group.id);
      if (!s) sets.set(p.group.id, s = {group: p.group, cards: [], sealed: []});
      (p.sealed ? s.sealed : s.cards).push(p);
    }
    const out = [];
    for (const s of sets.values()) {
      s.line = mkSetLine(s.group.name, s.cards.length, s.sealed.length);
      s.top = null;
      for (const p of s.cards) { const b = mkBest(p); if (b && (!s.top || b.price > s.top.price)) s.top = b; }
      s.sealedInfo = s.sealed.map(p => Object.assign({p, kind: mkKind(p.name), set: s}, mkSealedPrice(p)));
      // (a full booster box when the set has one, not a retail mini box)
      const boxes = s.sealedInfo.filter(x => x.kind === "box" && x.best != null);
      const full = boxes.filter(x => !/mini/i.test(x.p.name));
      const pick = full.length ? full : boxes;
      s.cheapBox = pick.length ? pick.reduce((a, b) => (b.best < a.best ? b : a)) : null;
      out.push(s);
    }
    catalog.market = out;
    return out;
  }
  function mkChase(s, n) { return s.cards.map(mkBest).filter(Boolean).sort((a, b) => b.price - a.price || a.product.name.localeCompare(b.product.name)).slice(0, n || 25); }
  // Searches at other stores, cheapest first (the sites' own price sorting).
  function mkStoreLinks(p) {
    const q = ("Yu-Gi-Oh " + p.name.replace(/\[[^\]]*\]/g, " ").replace(/\s+-\s+/g, " ")).replace(/\s+/g, " ").trim();
    const e = encodeURIComponent(q);
    return '<span class="mk-stores">' +
      '<a target="_blank" rel="noopener" href="' + esc(tcgPage(p.id)) + '">TCGplayer</a>' +
      '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + e + '&amp;_sop=15&amp;LH_BIN=1&amp;LH_ItemCondition=1000">eBay</a>' +
      '<a target="_blank" rel="noopener" href="https://www.amazon.com/s?k=' + e + '&amp;s=price-asc-rank">Amazon</a>' +
      '<a target="_blank" rel="noopener" href="https://www.walmart.com/search?q=' + e + '&amp;sort=price_low">Walmart</a>' +
      '<a target="_blank" rel="noopener" href="https://www.target.com/s?searchTerm=' + e + '&amp;sortBy=PriceLow">Target</a></span>';
  }
  function mkSealedTileHTML(x, showSet) {
    const p = x.p;
    const owned = collection.filter(r => r.productId === p.id).reduce((t, r) => t + r.qty, 0);
    return '<div class="result static"><span class="sleeve boxed">' + imgTag(productPics(p, "in_400x400"), p.name) + "</span>" +
      '<span class="result-name">' + esc(p.name) + "</span>" +
      '<span class="result-meta">' + esc(showSet ? x.set.group.name + " · " : "") + esc(mkKindName(x.kind)) + "</span>" +
      (x.low == null && x.market == null ? '<span class="result-meta">No listings or recent sales</span>'
        : '<dl class="mk-prices">' + (x.low != null ? "<dt>Lowest listing</dt><dd class=\"" + (x.suspect ? "" : "low") + "\">" + esc(usd(x.low)) + "</dd>" : "") +
          (x.market != null ? "<dt>Market price</dt><dd>" + esc(usd(x.market)) + "</dd>" : "") + "</dl>") +
      (x.under >= 0.05 ? '<span class="mk-deal">' + Math.round(x.under * 100) + "% under market</span>" : "") +
      (x.suspect ? '<span class="mk-warn" title="Under half the market price: it may be opened, damaged, mislabeled or a placeholder price">Unusually low: check that listing</span>' : "") +
      mkStoreLinks(p) +
      '<span class="result-actions">' + (owned ? '<span class="on-list">You have ' + owned + "</span>" : "") +
      (wants.some(w => w.productId === p.id) ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-mk-want="' + p.id + '">Want</button>') +
      '<button class="btn" type="button" data-mk-add="' + p.id + '">' + (owned ? "Add more" : "I have it") + "</button></span></div>";
  }
  function mkChaseHTML(list) {
    const wanted = new Set(wants.map(w => w.productId));
    const owned = new Map();
    for (const r of collection) if (r.productId) owned.set(r.productId, (owned.get(r.productId) || 0) + r.qty);
    return '<div class="results">' + list.map((b, i) => {
      const p = b.product;
      return '<div class="result static"><span class="sleeve"' + foilAttr(p.rarity) + '><span class="mk-rank">#' + (i + 1) + "</span>" + imgTag(productPics(p, "200w"), p.name) + "</span>" +
        '<span class="result-name">' + esc(cleanName(p.name, p.rarity)) + "</span>" +
        '<span class="result-meta">' + esc(p.number) + ", " + esc(p.rarity || "rarity unknown") + "</span>" +
        '<span class="result-price">' + esc(usd(b.price)) + (Object.keys(p.prices).length > 1 ? ' <span class="small">' + esc(b.edition) + "</span>" : "") + "</span>" +
        '<span class="result-actions">' + (owned.get(p.id) ? '<span class="on-list">You have ' + owned.get(p.id) + "</span>" : "") +
        (wanted.has(p.id) ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-mk-want="' + p.id + '">Want</button>') +
        '<button class="btn" type="button" data-mk-have="' + p.id + '">I have it</button></span></div>';
    }).join("") + "</div>";
  }
  const mk = {q: "", open: new Set(), limit: 40};
  function renderMarket() {
    const panel = $("panel-market");
    const region = MK_REGIONS.some(r => r[0] === settings.mkRegion) ? settings.mkRegion : "en";
    const ocgView = region !== "en";
    const regionSeg = '<div class="seg" role="group" aria-label="Which cards" id="mkRegion">' +
      MK_REGIONS.map(([k, l]) => '<button type="button" data-mkregion="' + k + '" aria-pressed="' + (region === k) + '">' + l + "</button>").join("") + "</div>";
    const sealedView = settings.mkView === "sealed";
    const viewSeg = '<div class="seg" role="group" aria-label="Show" id="mkView"><button type="button" data-mkview="sets" aria-pressed="' + !sealedView + '">Sets and chase cards</button>' +
      '<button type="button" data-mkview="sealed" aria-pressed="' + sealedView + '">Sealed products</button></div>';
    if (!ocgView && !catalog) {
      panel.innerHTML = '<div class="panel-head"><div><h2>Market</h2></div><div class="panel-tools">' + regionSeg + "</div></div>" +
        emptyPanel("The market needs TCGplayer data", SITE ? "Reload the page (it needs an internet connection)." : "Double-click <b>Update TCGplayer Data</b> in the Card Vault folder, then press F5 here.");
      return;
    }
    if (ocgView) { loadOcgMarket(); if (region === "jp") loadYugiMarket(); }
    const sorts = sealedView ? (ocgView ? [["newest", "Newest first"], ["low", "Lowest price first"], ["high", "Highest price first"]]
      : [["deal", "Biggest discount first"], ["low", "Lowest price first"], ["high", "Highest price first"], ["newest", "Newest first"]])
      : [["newest", "Newest first"], ["oldest", "Oldest first"], ["chase", "Most valuable top card"], ["name", "Set name"]];
    const sortVal = sealedView ? settings.mkSortSealed : settings.mkSortSets;
    const lines = ocgView ? OCG_LINES : MK_LINES, lineVal = ocgView ? settings.mkLineOcg : settings.mkLine;
    const kinds = sealedView ? (ocgView ? (region === "jp" ? YM_KINDS : null) : MK_KINDS) : null, kindVal = ocgView ? settings.mkKindOcg : settings.mkKind;
    const intro = {
      en: sealedView ? "Sealed products from every set, with the cheapest listing on TCGplayer next to the market price."
        : "Every Yu-Gi-Oh! set on TCGplayer, with its 25 most valuable cards and its sealed products.",
      jp: sealedView ? "Japanese booster boxes, limited boxes, decks and packs at Yugi-Market (based in Japan, ships worldwide), in US$, Rush Duel's included."
        : "Japanese sets with their most valuable cards at BIGWEB (Rush Duel sets: at Fullahead), and their sealed products at Yugi-Market.",
      kr: sealedView ? "Korean booster boxes: unopened boxes on Bunjang, and God of Cards." : "Korean sets, Rush Duel's included, with their most valuable cards on Bunjang, and their sealed products."
    }[region];
    const gen = ocgMk.data && ocgMk.data.generated ? " (" + esc(fmtDate(ocgMk.data.generated)) + ")" : "";
    const note = {
      en: "Prices are TCGplayer's, from " + esc(fmtDate(catalog ? catalog.generated : null)) + '. "Lowest listing" is the cheapest seller on TCGplayer before shipping; check the listing\'s condition and shipping. ' +
        "The other store links search for the product sorted cheapest first: Amazon, Walmart and Target don't share their prices with apps like this one, so compare there in a tap. " +
        "Set types are worked out from set names, so a few may be in a neighboring group.",
      jp: "Card prices are BIGWEB's (a large card shop in Japan): the cheapest copy for play it has in stock, in yen, shown in US$ at today's exchange rate. " +
        "BIGWEB doesn't sell Rush Duel cards, so theirs are Fullahead's (another Japanese card shop), read once a day. " +
        "Sealed prices are Yugi-Market's, checked when you open this page (twice a day at most). Sets and English card names are from Yugipedia. " +
        "The list is updated every day" + gen + ": new sets daily, older ones every week or two.",
      kr: "Card prices are from Bunjang (a Korean marketplace), in won, shown in US$ at today's exchange rate: what each card and rarity sold for once it sold twice in the last four months, " +
        "else the middle of the asking prices. Listings of several copies, graded cards and wanted posts are left out, so treat them as a rough guide. God of Cards (Germany) sells Korean sealed products: each set links to it. " +
        "Sets and English card names are from Yugipedia. The list is updated every day" + gen + "."
    }[region];
    panel.innerHTML = '<div class="panel-head"><div><h2>Market</h2><p>' + intro + "</p></div>" +
      '<div class="panel-tools mk-tools">' + regionSeg + viewSeg + "</div></div>" +
      '<div class="mk-filters"><input class="search" id="mkQ" type="search" placeholder="' + (sealedView ? "Product or set name" : "Set name or code") + '" aria-label="Search" value="' + esc(mk.q) + '">' +
      '<select class="select" id="mkLine" aria-label="Set type"><option value="">All set types</option>' + lines.map(([k, l]) => '<option value="' + k + '"' + (lineVal === k ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>" +
      (ocgView ? '<select class="select" id="mkGame" aria-label="Game">' + MK_GAMES.map(([k, l]) => '<option value="' + k + '"' + ((settings.mkGame || "") === k ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>" : "") +
      (kinds ? '<select class="select" id="mkKind" aria-label="Product type"><option value="">All products</option>' + kinds.map(([k, l]) => '<option value="' + k + '"' + (kindVal === k ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>" : "") +
      '<select class="select" id="mkSort" aria-label="Sort">' + sorts.map(([k, l]) => '<option value="' + k + '"' + (sortVal === k ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></div>" +
      '<div id="mkList"></div>' +
      '<p class="small">' + note + "</p>";
    renderMarketList();
  }
  function renderMarketList() {
    const box = $("mkList");
    if (box && settings.mkRegion && settings.mkRegion !== "en") { renderOcgMarketList(box); return; }
    if (!box || !catalog) return;
    const data = marketData();
    const q = mk.q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const day = s => String(s.group.published || "");
    if (settings.mkView === "sealed") {
      let list = [];
      for (const s of data) if (!settings.mkLine || s.line === settings.mkLine) list = list.concat(s.sealedInfo);
      list = list.filter(x => (!settings.mkKind || x.kind === settings.mkKind) &&
        (!words.length || words.every(w => (x.p.name + " " + x.set.group.name + " " + (x.set.group.abbr || "")).toLowerCase().includes(w))));
      const sorters = {
        deal: (a, b) => b.under - a.under || (a.best == null) - (b.best == null) || (a.best || 0) - (b.best || 0),
        low: (a, b) => (a.best == null) - (b.best == null) || (a.best || 0) - (b.best || 0),
        high: (a, b) => (a.best == null) - (b.best == null) || (b.best || 0) - (a.best || 0),
        newest: (a, b) => day(b.set).localeCompare(day(a.set)) || a.p.name.localeCompare(b.p.name)
      };
      list.sort(sorters[settings.mkSortSealed] || sorters.deal);
      if (!list.length) {
        box.innerHTML = '<div class="notice">' + (settings.mkLine === "ots" ? "OTS Tournament Packs aren't sold sealed: stores hand them out at OTS events. Their chase cards are under Sets and chase cards."
          : "No sealed product matches. Try fewer words, or another type.") + "</div>";
        return;
      }
      box.innerHTML = '<p class="results-head">' + plural(list.length, "product") + (list.length > mk.limit ? ", showing the first " + mk.limit : "") + ".</p>" +
        '<div class="results">' + list.slice(0, mk.limit).map(x => mkSealedTileHTML(x, true)).join("") + "</div>" +
        (list.length > mk.limit ? '<div class="mk-more"><button class="btn" type="button" data-mk-more>Show more</button></div>' : "");
      return;
    }
    let list = data.filter(s => (s.cards.length || s.sealed.length) && (!settings.mkLine || s.line === settings.mkLine) &&
      (!words.length || words.every(w => (s.group.name + " " + (s.group.abbr || "")).toLowerCase().includes(w))));
    const sorters = {
      newest: (a, b) => day(b).localeCompare(day(a)) || a.group.name.localeCompare(b.group.name),
      oldest: (a, b) => day(a).localeCompare(day(b)) || a.group.name.localeCompare(b.group.name),
      chase: (a, b) => (b.top ? b.top.price : -1) - (a.top ? a.top.price : -1),
      name: (a, b) => a.group.name.localeCompare(b.group.name)
    };
    list.sort(sorters[settings.mkSortSets] || sorters.newest);
    if (!list.length) { box.innerHTML = '<div class="notice">No set matches. Try fewer words, or another set type.</div>'; return; }
    box.innerHTML = '<p class="results-head">' + plural(list.length, "set") + (list.length > mk.limit ? ", showing the first " + mk.limit : "") + ".</p>" +
      list.slice(0, mk.limit).map(mkSetRowHTML).join("") +
      (list.length > mk.limit ? '<div class="mk-more"><button class="btn" type="button" data-mk-more>Show more</button></div>' : "");
  }
  function mkSetRowHTML(s) {
    const gid = s.group.id, open = mk.open.has(gid);
    const year = s.group.published ? String(s.group.published).slice(0, 4) : "";
    const top = s.top;
    return '<article class="set-row mk-row"><button type="button" class="set-toggle" aria-expanded="' + open + '" data-mk-set="' + gid + '">' +
      '<span style="min-width:0"><span class="set-name">' + esc(s.group.name) + '</span><span class="set-sub">' + esc([s.group.abbr, year, plural(s.cards.length, "card")].filter(Boolean).join(", ")) +
      '<span class="mk-line">' + esc(mkLineName(s.line)) + "</span></span></span>" +
      '<span class="mk-top">' + (top ? "Top card: <b>" + esc(cleanName(top.product.name, top.product.rarity)) + '</b> <span class="gold">' + esc(usd(top.price)) + "</span>" : "No prices yet") + "</span>" +
      '<span class="set-cost">' + (s.cheapBox ? "<b>" + esc(usd(s.cheapBox.best)) + "</b><small>" + (/mini/i.test(s.cheapBox.p.name) ? "mini box" : "booster box") + "</small>"
        : s.sealed.length ? "<b>" + s.sealed.length + "</b><small>sealed " + (s.sealed.length === 1 ? "product" : "products") + "</small>" : "<small>not sold sealed</small>") + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="set-body">' + mkSetBodyHTML(s) + "</div>" : "") + "</article>";
  }
  function mkSetBodyHTML(s) {
    let html = "";
    if (s.sealedInfo.length) {
      const order = MK_KINDS.map(k => k[0]);
      const list = s.sealedInfo.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.best == null) - (b.best == null) || (a.best || 0) - (b.best || 0));
      html += '<h3 class="mk-h">Sealed products</h3><div class="results">' + list.map(x => mkSealedTileHTML(x, false)).join("") + "</div>";
    } else {
      html += '<p class="small" style="margin:12px 0 0">' + (s.line === "ots" ? "OTS Tournament Packs aren't sold sealed: stores hand them out at OTS events." : "TCGplayer doesn't list sealed products for this set.") + "</p>";
    }
    const chase = mkChase(s, 25);
    if (chase.length) {
      const total = chase.reduce((t, b) => t + b.price, 0);
      html += '<h3 class="mk-h">Top ' + chase.length + " chase cards <span class=\"small\">(one of each: " + esc(usd(total)) + ")</span></h3>" + mkChaseHTML(chase);
    }
    if (s.cards.length) html += '<p class="small" style="margin:12px 0 0"><button type="button" class="link-btn" data-cs-browse="en:' + s.group.id + '">See all ' + plural(s.cards.length, "printing") + " in this set</button></p>";
    return html;
  }

  /* ======================= Market: Japanese and Korean sets ======================= */
  // TCGplayer only lists English cards. The Japanese and Korean sets come from ocg-market.js, put together every day by
  // the website's GitHub workflow (ocg_market.py): Yugipedia's sets and English card names, BIGWEB's Japanese prices, and
  // Bunjang's Korean asking prices and boxes. Sealed products for Japanese sets are Yugi-Market's, read from here (that
  // shop turns GitHub's computers away); Korean ones link to God of Cards, whose list can't be read from another site.
  const OCG_LINES = [["core", "Core booster sets"], ["side", "Special and side packs"], ["dbp", "Deck Build Packs"], ["structure", "Structure and starter decks"],
    ["boxed", "Box sets and collector's sets"], ["promo", "Tournament, event and token packs"], ["other", "Other sets"]];
  const ocgLineName = k => (OCG_LINES.find(x => x[0] === k) || [k, ""])[1];
  // (Rush Duel's own: Deck Mod Packs are its core boosters)
  const RUSH_LINES = {core: "Rush Duel: Deck Mod Packs", side: "Rush Duel: other packs", structure: "Rush Duel: starter and battle decks", promo: "Rush Duel: tournament and promo packs", other: "Rush Duel: other sets"};
  const ocgLineLabel = s => s.rush || isRushNo(s.prefix) ? RUSH_LINES[s.line] || "Rush Duel" : ocgLineName(s.line);
  const MK_REGIONS = [["en", "English"], ["jp", "Japanese"], ["kr", "Korean"]];
  // Japanese and Korean: the OCG's sets, Rush Duel's, or both
  const MK_GAMES = [["", "OCG and Rush Duel"], ["ocg", "OCG only"], ["rush", "Rush Duel only"]];
  const mkGameOK = rush => !settings.mkGame || (settings.mkGame === "rush") === !!rush;
  const OCG_CUR = {jp: "JPY", kr: "KRW"};
  const ocgMk = {data: null, loading: null, failed: 0, open: new Set()};
  function readWindowJSON(text, name) {
    const at = text.indexOf("window." + name);
    if (at < 0) return null;
    let body = text.slice(text.indexOf("=", at) + 1).trim();
    if (body.endsWith(";")) body = body.slice(0, -1);
    return JSON.parse(body);
  }
  // On the website, the file next to this page; Card Vault.html on a computer loads it from the website.
  function ocgMarketURL() {
    if (/^https?:$/.test(location.protocol)) return "ocg-market.js";
    const site = String(settings.siteUrl || "");
    return /^https:\/\/[^\s]+$/.test(site) ? site.replace(/\/?$/, "/") + "ocg-market.js" : "";
  }
  function buildOcgMarket(raw) {
    if (!raw || !Array.isArray(raw.jp) || !Array.isArray(raw.kr)) throw new Error("not the Japanese and Korean set data");
    const make = region => raw[region].filter(Array.isArray).map(r => {
      const s = {region, id: region + ":" + r[0], prefix: String(r[0]), name: String(r[1] || r[0]), date: String(r[2] || ""), line: String(r[3] || "other"),
        cards: +r[4] || 0, local: String(r[6] || ""), box: region === "kr" && Array.isArray(r[7]) && +r[7][0] > 0 ? {price: +r[7][0], n: +r[7][1] || 0} : null, rush: isRushNo(r[0])};
      s.chase = (Array.isArray(r[5]) ? r[5] : []).filter(Array.isArray).map(c => ({number: normNumber(c[0]), name: String(c[1] || c[0]), rarity: String(c[2] || ""),
        local: +c[3] || 0, stock: region === "jp" ? !!c[4] : null, n: region === "kr" ? +c[4] || 0 : null, img: safeImg(c[5]), set: s,
        sales: region === "kr" ? +c[6] || 0 : 0, sold: region === "kr" ? +c[7] || null : null, last: region === "kr" ? String(c[8] || "") : ""})).filter(c => c.local > 0);
      s.top = s.chase[0] || null;
      return s;
    });
    return {generated: parseDate(raw.generated), fx: raw.fx || null, jp: make("jp"), kr: make("kr")};
  }
  function loadOcgMarket() {
    if (ocgMk.data || ocgMk.loading) return ocgMk.loading || Promise.resolve(ocgMk.data);
    const url = ocgMarketURL();
    if (!url) { ocgMk.failed = Date.now(); return Promise.resolve(null); }
    const http = /^https?:$/.test(location.protocol);
    // (remembered for Card Vault.html on your computer, which gets it through the backup file)
    if (http && SITE && siteAddress() && settings.siteUrl !== siteAddress()) { settings.siteUrl = siteAddress(); save({quiet: true}); }
    fxRates().catch(() => null);
    ocgMk.loading = (http
      ? fetch(url, {cache: "no-cache"}).then(res => { if (!res.ok) throw new Error("answered " + res.status); return res.text(); }).then(t => readWindowJSON(t, "OCG_MARKET"))
      : new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url + "?h=" + Math.floor(Date.now() / 3600000);
        s.onload = () => { const raw = window.OCG_MARKET; window.OCG_MARKET = null; s.remove(); resolve(raw); };
        s.onerror = () => { s.remove(); reject(new Error("didn't load")); };
        document.head.appendChild(s);
      }))
      .then(raw => { ocgMk.data = buildOcgMarket(raw); ocgMk.failed = 0; })
      .catch(() => { ocgMk.failed = Date.now(); })
      .then(() => {
        ocgMk.loading = null;
        if (settings.tab === "market" && settings.mkRegion !== "en") renderMarket();
        else if (settings.tab === "wants") renderPanel();
        else if (settings.tab === "search") renderSearchResults();
        return ocgMk.data;
      });
    return ocgMk.loading;
  }
  function ocgUSD(amount, region) {
    const cur = OCG_CUR[region];
    const v = toUSD(amount, cur);
    if (v != null) return v;
    const rate = (ocgMk.data && ocgMk.data.fx && ocgMk.data.fx[cur]) || (ocgCd.data && ocgCd.data.fx && ocgCd.data.fx[cur]);
    return amount != null && rate > 0 ? round2(amount / rate) : null;
  }
  // US$ first (what the rest of Card Vault uses), the yen or won price beside it
  function ocgMoneyHTML(amount, region) {
    const u = ocgUSD(amount, region), local = fmtLocal(amount, OCG_CUR[region]);
    return u != null ? esc(usd(u)) + ' <span class="small">' + esc(local) + "</span>" : esc(local);
  }

  /* ----- every Japanese and Korean card: ocg-cards.js, built each night with ocg-market.js ----- */
  // Each set's cards and rarities with BIGWEB's price, stock and photo (Japanese) or Bunjang's asking price (Korean),
  // and the price a day, a week and a month before. It's a few MB, so it's read once per visit, the first time
  // something needs it: your Japanese and Korean cards, a lookup, a set, the movers.
  const ocgCd = {data: null, loading: null, failed: 0};
  const ocgCardsURL = () => ocgMarketURL().replace(/ocg-market\.js$/, "ocg-cards.js");
  const ocgHistoryBase = () => ocgMarketURL().replace(/ocg-market\.js$/, "ocg-history/");
  // BIGWEB's photos all live at one address pattern, so the list carries just the number
  const bigwebImg = ref => { if (typeof ref === "number" && ref > 0) { const s = String(ref).padStart(8, "0"); return "https://image.bigweb.co.jp/new/imgc/" + s.slice(0, 3) + "/" + s.slice(3, 6) + "/" + ref + ".jpg"; } return safeImg(ref) || ""; };
  function buildOcgCards(raw) {
    if (!raw || !Array.isArray(raw.jp) || !Array.isArray(raw.kr) || !Array.isArray(raw.names)) throw new Error("not the Japanese and Korean card data");
    const names = raw.names.map(String), ja = (raw.ja || []).map(String), rar = (raw.rar || []).map(String);
    const data = {generated: parseDate(raw.generated), fx: raw.fx || null, jp: new Map(), kr: new Map(), byNumber: new Map(), byName: new Map(), cards: []};
    for (const region of ["jp", "kr"]) {
      const tag = region === "jp" ? "-JP" : "-KR";
      for (const row of raw[region]) {
        if (!Array.isArray(row) || !row[0]) continue;
        const refs = Array.isArray(row[1]) ? row[1] : [];
        const set = {region, prefix: String(row[0]), id: region + ":" + row[0], refs: {m1: String(refs[0] || ""), m7: String(refs[1] || ""), m30: String(refs[2] || "")}, cards: []};
        for (const c of (Array.isArray(row[2]) ? row[2] : [])) {
          if (!Array.isArray(c)) continue;
          const t = String(c[0] || ""), number = t.startsWith("*") ? set.prefix + "-" + t.slice(1) : set.prefix + tag + t;
          const card = {region, set, number, name: names[c[1]] || number, rows: []};
          for (const x of (Array.isArray(c[2]) ? c[2] : [])) {
            if (!Array.isArray(x)) continue;
            const hk = region === "jp" ? x[8] : x[7] || null;   // (the rarity name its history is kept under, when that differs)
            const sold = region === "kr" && Array.isArray(x[8]) ? x[8] : null;   // (Korean: [asking, sold for, sales, last sale] once it has sold)
            card.rows.push({card, rarity: rar[x[0]] || "", local: +x[1] || 0, stock: region === "jp" ? +x[2] || 0 : null, n: region === "kr" ? +x[2] || 0 : null,
              img: bigwebImg(x[3]), m1: +x[4] || 0, m7: +x[5] || 0, m30: +x[6] || 0, ja: region === "jp" ? ja[x[7]] || "" : "", hk: typeof hk === "string" ? hk : null,
              ask: sold ? +sold[0] || null : null, sold: sold ? +sold[1] || null : null, sales: sold ? +sold[2] || 0 : 0, last: sold ? String(sold[3] || "") : ""});
          }
          set.cards.push(card);
          data.byNumber.set(number, card);
          pushMap(data.byName, csNorm(card.name), card);
          data.cards.push(card);
        }
        data[region].set(set.prefix, set);
      }
    }
    return data;
  }
  // fresh: read it again even though one is here (it stays in use until the new one has arrived)
  function loadOcgCards(fresh) {
    if ((ocgCd.data && !fresh) || ocgCd.loading) return ocgCd.loading || Promise.resolve(ocgCd.data);
    const url = ocgCardsURL();
    if (!url) { ocgCd.failed = Date.now(); return Promise.resolve(null); }
    const http = /^https?:$/.test(location.protocol);
    ocgCd.loading = (http
      ? fetch(url, {cache: "no-cache"}).then(res => { if (!res.ok) throw new Error("answered " + res.status); return res.text(); }).then(t => readWindowJSON(t, "OCG_CARDS"))
      : new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url + "?h=" + (fresh ? Date.now() : Math.floor(Date.now() / 3600000));
        s.onload = () => { const raw = window.OCG_CARDS; window.OCG_CARDS = null; s.remove(); resolve(raw); };
        s.onerror = () => { s.remove(); reject(new Error("didn't load")); };
        document.head.appendChild(s);
      }))
      .then(raw => { ocgCd.data = buildOcgCards(raw); ocgCd.failed = 0; renderSoon(0); })   // (prices are in: show them now, not after the set names that follow)
      .catch(() => { ocgCd.failed = Date.now(); })
      .then(() => ocgMk.data || ocgMarketURL() === "" ? null : loadOcgMarket())   // (the sets' names and dates come with it)
      .then(() => { ocgCd.loading = null; renderSoon(); return ocgCd.data; });
    return ocgCd.loading;
  }
  // Where the Japanese, Korean and Rush Duel list stands, in a few words (Settings)
  function ocgListStatus() {
    if (ocgCd.data) return ocgCd.data.generated ? "from " + fmtDate(ocgCd.data.generated) : "loaded";
    if (ocgCd.loading) return "loading…";
    if (!ocgCardsURL()) return "not available here (open Card Vault from its website)";
    return ocgCd.failed ? "couldn't be loaded, so Rush Duel cards have no price (press the button to try again)" : "not loaded yet";
  }
  // The list when it's here or can be loaded; null after a failure, for 10 minutes (so nothing keeps asking)
  function loadOcgCardsSoft() {
    if (ocgCd.data) return Promise.resolve(ocgCd.data);
    if (!ocgCardsURL() || (ocgCd.failed && Date.now() - ocgCd.failed < 10 * 60000)) return Promise.resolve(null);
    return loadOcgCards();
  }
  // true when the list is here; otherwise starts loading it (once; after a failure, again 10 minutes later)
  function ocgCardsReady() {
    if (ocgCd.data) return true;
    if (!ocgCd.loading && !(ocgCd.failed && Date.now() - ocgCd.failed < 10 * 60000) && ocgCardsURL()) loadOcgCards();
    return false;
  }
  /* ----- How last night's update went (update-status.js) and the grading fees it read (grading-fees.js) ----- */
  // Both are made by the nightly update on GitHub, next to the website's other files. Card Vault.html on a computer
  // reads them from the website (Settings > the website address), like the Japanese and Korean cards.
  const live = {status: null, fees: null, ban: null, at: 0, loading: null};
  function siteFileURL(name) {
    if (/^https?:$/.test(location.protocol)) return name;
    const site = String(settings.siteUrl || "");
    return /^https:\/\/[^\s]+$/.test(site) ? site.replace(/\/?$/, "/") + name : "";
  }
  function loadSiteJS(name, global) {
    const url = siteFileURL(name);
    if (!url) return Promise.resolve(null);
    // (on the website: past the browser's own cache, one copy kept for offline; on a computer: a script, new every 10 minutes)
    const fresh = url + "?h=" + Math.floor(Date.now() / 600000);
    if (/^https?:$/.test(location.protocol)) {
      return fetch(url, {cache: "no-store"}).then(res => res.ok ? res.text() : null).then(t => t ? readWindowJSON(t, global) : null).catch(() => null);
    }
    return new Promise(resolve => {
      const s = document.createElement("script");
      s.src = fresh;
      s.onload = () => { const v = window[global]; try { delete window[global]; } catch (e) { window[global] = null; } s.remove(); resolve(v || null); };
      s.onerror = () => { s.remove(); resolve(null); };
      document.head.appendChild(s);
    });
  }
  // (every half hour at most, unless asked; a failure keeps what was there)
  function loadLive(force) {
    if (live.loading) return live.loading;
    if (!force && live.at && Date.now() - live.at < 30 * 60000) return Promise.resolve(false);
    live.loading = Promise.all([loadSiteJS("update-status.js", "CARDVAULT_STATUS"), loadSiteJS("grading-fees.js", "GRADING_FEES"), loadSiteJS("banlist.js", "CARDVAULT_BANLIST")]).then(([s, f, bl]) => {
      if (bl && bl.format === 1 && bl.lists) live.ban = bl;
      if (s && s.format === 1 && s.parts) {
        live.status = s;
        // (a problem you dismissed that has since been fixed is forgotten, so if it breaks again you're told again)
        const now = new Set((s.problems || []).concat(s.news || []).map(x => x && x.key).filter(Boolean));
        const seen = Array.isArray(settings.statusSeen) ? settings.statusSeen : [];
        const kept = seen.filter(k => now.has(k) || /^(stale|ban)-/.test(k));
        if (kept.length !== seen.length) { settings.statusSeen = kept; saveSettings(); }
      }
      if (f && f.format === 1 && f.companies) { live.fees = f; feeTables = null; }
      live.at = Date.now();
      live.loading = null;
      renderStatusBanner();
      const box = document.getElementById("updateStatus");
      if (box) box.innerHTML = updateStatusHTML();
      if (settings.tab === "history") renderPanel();
      return true;
    });
    return live.loading;
  }
  const statusSeen = () => new Set(Array.isArray(settings.statusSeen) ? settings.statusSeen : []);
  const seriousProblems = () => live.status ? (live.status.problems || []).filter(p => p && !p.minor && p.text) : [];
  // The nightly update hasn't run for a day and a half: GitHub may have paused it, or the website isn't being built.
  function statusStale() {
    const t = live.status && parseDate(live.status.checked);
    return t && Date.now() - t.getTime() > 36 * 3600000 ? t : null;
  }
  // The notice at the top: something broke last night (until you dismiss it), or grading fees changed.
  function renderStatusBanner() {
    const b = $("statusBanner");
    if (!b) return;
    const seen = statusSeen(), stale = statusStale();
    const probs = seriousProblems().filter(p => !seen.has(p.key));
    const news = live.status ? (live.status.news || []).filter(n => n && n.key && !seen.has(n.key) && n.day && Date.now() - (parseDay(n.day) || new Date(0)).getTime() < 14 * 86400000) : [];
    let html = "", keys = [], kind = "";
    const banNews = banChangesForYou(30).filter(c => !seen.has(c.key));
    if (stale && !seen.has("stale-" + localDay(stale))) {
      keys = ["stale-" + localDay(stale)];
      html = "<strong>The nightly price update hasn't run since " + esc(fmtDate(stale)) + ".</strong> Prices stay as they were until it runs again. " +
        "GitHub pauses scheduled updates now and then; " + (live.status.run ? '<a href="' + esc(safeUrl(live.status.run)) + '" target="_blank" rel="noopener">its page on GitHub</a> shows what happened.' : "the Actions tab on GitHub shows what happened.");
    } else if (probs.length) {
      keys = probs.map(p => p.key);
      html = "<strong>" + (probs.length === 1 ? "Part of last night's price update didn't work." : probs.length + " parts of last night's price update didn't work.") + "</strong> " +
        probs.map(p => esc(p.text)).join(" ") + " Card Vault tries again tonight.";
    } else if (banNews.length) {
      keys = banNews.map(c => c.key);
      kind = "ban";
      html = "<strong>The ban list changed for " + (banNews.length === 1 ? "one of your cards" : banNews.length + " of your cards") + ".</strong> " +
        banNews.slice(0, 4).map(c => esc(banChangeText(c))).join(" ") + (banNews.length > 4 ? " And " + (banNews.length - 4) + " more." : "");
    } else if (news.length) {
      keys = news.map(n => n.key);
      html = "<strong>Grading fees changed.</strong> " + news.slice(0, 4).map(n => esc(n.text)).join(" ") + (news.length > 4 ? " And " + (news.length - 4) + " more (Settings &gt; Grading fees)." : "") +
        " Card Vault's grading estimates use the new fees.";
    }
    if (html) html += '<div class="banner-actions"><button class="btn btn-small" type="button" data-banner="' + (kind === "ban" ? "ban-show" : "status-details") + '">' + (kind === "ban" ? "Show" : "Details") + "</button>" +
      '<button class="btn btn-small" type="button" data-banner="status-dismiss">Dismiss</button></div>';
    b.dataset.keys = keys.join(" ");
    b.hidden = !html;
    b.innerHTML = html;
    syncBanners();
  }
  function dismissStatusBanner() {
    const keys = ($("statusBanner").dataset.keys || "").split(" ").filter(Boolean);
    settings.statusSeen = Array.from(new Set(keys.concat(Array.from(statusSeen())))).slice(0, 200);
    saveSettings();
    renderStatusBanner();
  }
  const safeUrl = u => /^https:\/\/[^\s"<>]+$/.test(String(u || "")) ? String(u) : "#";
  // Settings > Daily price updates: last night's update, part by part
  function updateStatusHTML() {
    const s = live.status;
    if (!s) {
      return '<p class="small" style="margin:0">' + (siteFileURL("update-status.js") ? (live.at ? "No report from the nightly update yet: it appears after its next run." : "Looking for last night's report…")
        : "Add the website's address (below) to see how the nightly update went.") + "</p>";
    }
    const at = parseDate(s.checked), p = s.parts || {}, ocg = p.ocg || {}, fees = p.fees || {};
    const line = (ok, text) => '<div class="status-line ' + (ok ? "on" : "warn") + '"><span class="dot" aria-hidden="true"></span><span>' + text + "</span></div>";
    const n = v => (+v || 0).toLocaleString("en-US");
    const tcgAt = parseDate((p.tcg || {}).generated);
    const sites = ocg.sites || {}, siteNames = {yugipedia: "Yugipedia", bigweb: "BIGWEB", bunjang: "Bunjang", fullahead: "Fullahead", frankfurter: "exchange rates"};
    const rush = ocg.rush && typeof ocg.rush === "object" ? ocg.rush : null, rj = (rush && rush.jp) || {}, rk = (rush && rush.kr) || {};
    const siteBits = Object.keys(sites).filter(k => siteNames[k]).map(k => siteNames[k] + (sites[k].failed ? " (" + n(sites[k].failed) + " of " + n(sites[k].requests) + " failed)" : ""));
    const probs = (s.problems || []).filter(x => x && x.text);
    const feeCos = Object.entries(fees.companies || {});
    const recent = Array.isArray(s.recent) ? s.recent : [];
    return '<p style="margin:0 0 8px"><b>Last night\'s update' + (at ? " (" + esc(fmtDateTime(at)) + ")" : "") + ":</b> " +
        (probs.filter(x => !x.minor).length ? plural(probs.filter(x => !x.minor).length, "problem") + "." : "everything worked.") +
        (statusStale() ? " <b>It hasn't run since then.</b>" : "") + "</p>" +
      line((p.tcg || {}).ok !== false, "TCGplayer prices: " + (tcgAt ? "from " + esc(fmtDate(tcgAt)) : "none yet") + ".") +
      line(ocg.ok !== false, "Japanese cards: " + n((ocg.cardsPriced || {}).jp) + " of " + n((ocg.cards || {}).jp) + " priced (BIGWEB" + (rush ? "; Rush Duel: Fullahead" : "") + "). Korean cards: " + n((ocg.cardsPriced || {}).kr) +
        " of " + n((ocg.cards || {}).kr) + " priced (Bunjang)" + (ocg.krSold ? ", " + n(ocg.krSold) + " of them from what they sold for" : "") + "." +
        (rush && (rj.cards || rk.cards) ? " Rush Duel among them: " + n(rj.priced) + " of " + n(rj.cards) + " Japanese and " + n(rk.priced) + " of " + n(rk.cards) + " Korean cards priced." : "") +
        (siteBits.length ? " Sites read: " + esc(siteBits.join(", ")) + "." : "") + (ocg.left ? " " + n(ocg.left) + " lookups wait for the next nights." : "")) +
      line(fees.ok !== false, "Grading fees: " + (feeCos.length ? feeCos.filter(([, c]) => c.ok).length + " of " + feeCos.length + " price lists read" +
        (feeCos.some(([, c]) => !c.ok) ? " (not " + esc(feeCos.filter(([, c]) => !c.ok).map(([co]) => gradingCoName(co)).join(", ")) + ")" : "") : "not checked") + ".") +
      (probs.length ? '<ul class="status-probs">' + probs.map(x => "<li>" + esc(x.text) + "</li>").join("") + "</ul>" : "") +
      ((s.news || []).length ? '<p class="small" style="margin:8px 0 0"><b>Grading fee changes:</b> ' + s.news.slice(-6).map(x => esc(x.text) + (x.day ? " (" + esc(fmtDate(parseDay(x.day))) + ")" : "")).join(" ") + "</p>" : "") +
      (recent.length > 1 ? '<p class="small" style="margin:8px 0 0">' + recent.filter(x => x.ok).length + " of the last " + recent.length + " runs went fine." : '<p class="small" style="margin:8px 0 0">') +
      (s.run ? ' <a href="' + esc(safeUrl(s.run)) + '" target="_blank" rel="noopener">The run on GitHub</a>.' : "") + "</p>";
  }

  const ocgCardAt = number => ocgCd.data ? ocgCd.data.byNumber.get(normNumber(number)) || null : null;
  // The list's name for the rarity of a card you have or want ("Prismatic Secret Rare (Overframe)" for a plain
  // "Prismatic Secret Rare" the card has only as Overframe), so they're matched with the list's rows
  const rowRarityOf = (number, rarity) => { const card = rarity ? ocgCardAt(number) : null, hit = card ? matchRarity(card.rows, rarity, x => x.rarity) : null; return hit ? hit.rarity : rarity; };
  const sameRowRarity = (number, mine, rowRarity) => sameRarity(rowRarityOf(number, mine), rowRarity) || sameRarity(mine, rowRarity);
  const ocgSetOf = key => { const [region, prefix] = String(key).split(":"); return ocgCd.data && ocgCd.data[region] ? ocgCd.data[region].get(prefix) || null : null; };
  const ocgLang = region => region === "jp" ? "Japanese" : "Korean";
  const ocgListDate = () => ocgCd.data && ocgCd.data.generated ? fmtDate(ocgCd.data.generated) : "";
  // The row (printing) of the list that is this card: its rarity, else the only one, else the only one with a price
  function ocgRowFor(card, rarity) {
    if (!card || !card.rows.length) return null;
    if (rarity) { const hit = matchRarity(card.rows, rarity, x => x.rarity); if (hit) return hit; }
    if (!rarity && card.rows.length === 1) return card.rows[0];
    const priced = card.rows.filter(x => x.local > 0);
    if (!rarity && priced.length === 1) return priced[0];
    if (rarity) { const unk = card.rows.find(x => !x.rarity && x.local > 0); if (unk) return unk; }   // (Korean listings that don't say)
    return null;
  }
  const rowNote = row => row.card.region === "jp" ? (row.stock ? jpStockNote(row.stock, row.card.number) : "sold out; last price seen") : krNote(row);
  const rowFrom = row => row.card.region === "jp" ? ocgSrc("jp", row.card.number) + (row.stock ? "" : ", sold out") : krFrom(row);
  // Where a chase card's price is from: "BIGWEB", "Fullahead, sold out", "Bunjang, 3 sales"
  const chaseFrom = (s, c) => s.region === "jp" ? ocgSrc("jp", c.number) + (c.stock ? "" : ", sold out") : krFrom(c);
  // Korean prices: what the card sold for on Bunjang once it sold twice in the last four months, else what sellers ask.
  // x: {n: listings for sale, sales, sold: the middle of the sales, last: the last sale's day}
  function krNote(x) {
    const sales = +x.sales || 0, n = +x.n || 0;
    if (sales >= 2) return "what it sold for, middle of " + plural(sales, "sale") + (x.last ? " (last " + fmtDate(parseDay(x.last)) + ")" : "") + (n ? "; " + plural(n, "listing") + " for sale" : "");
    return "asking prices, middle of " + plural(n, "listing") + (sales === 1 && x.sold ? "; sold once for " + fmtLocal(x.sold, "KRW") + (x.last ? " (" + fmtDate(parseDay(x.last)) + ")" : "") : "");
  }
  const krFrom = x => "Bunjang, " + ((+x.sales || 0) >= 2 ? plural(+x.sales, "sale") : plural(+x.n || 0, "listing"));
  // A card's price from the list, in the shape ocgPrice gives
  function ocgFilePrice(r) {
    const g = r.productId ? null : ocgRegion(r.number);
    const card = g ? ocgCardAt(g.code) : null;
    if (!card) return null;
    const row = ocgRowFor(card, r.rarity), region = card.region, src = ocgSrc(region, card.number);
    const at = ocgCd.data.generated ? ocgCd.data.generated.getTime() : Date.now();
    if (!row || !row.local) return {none: true, src, at, file: true, row, card, note: !row ? (card.rows.length > 1 ? "which rarity is yours?" : "no price") : region === "jp" ? "sold out, no price seen yet" : "no listings"};
    return {local: row.local, cur: OCG_CUR[region], usd: ocgUSD(row.local, region), src, note: rowNote(row), at, file: true, row, card,
      url: ocgShopURL(region, g.code)};
  }
  // How a card's price moved since a day, a week or a month ago (ref: m1, m7, m30), in US$ at today's rate
  function ocgChangeFor(r, ref) {
    const fp = ocgFilePrice(r);
    if (!fp || fp.none || !fp.row[ref] || priceInfo(r).from !== "ocg") return null;
    const region = fp.card.region, now0 = ocgUSD(fp.row.local, region), then0 = ocgUSD(fp.row[ref], region);
    if (now0 == null || then0 == null) return null;
    const f = conditionFactor(r), now = now0 * f, then = then0 * f;
    return {now, then, diff: now - then, pct: then > 0 ? (now - then) / then : null, marketNow: now0, marketThen: then0, day: fp.card.set.refs[ref]};
  }
  // "Since Sep 10" for a row's earlier price
  const ocgSince = (row, k) => row.card.set.refs[k] ? "Since " + fmtShortDate(parseDay(row.card.set.refs[k])) : periodLabel(k);
  // The longest change there is, in a line: "30 days: ▲ $1.20 (10%)"
  function ocgOneChangeHTML(row) {
    if (!row.local) return "";
    const k = ["m30", "m7", "m1"].find(x => row[x] > 0);
    const now = k && ocgUSD(row.local, row.card.region), then = k && ocgUSD(row[k], row.card.region);
    if (!k || now == null || then == null) return "";
    return '<br><span class="small">' + (k === "m30" ? "30 days" : k === "m7" ? "7 days" : "A day") + ": " + changeHTML(now - then, then > 0 ? (now - then) / then : null, true) + "</span>";
  }
  function ocgChangesHTML(row, label) {
    const list = PERIODS.filter(([k]) => row[k] > 0 && row.local > 0).map(([k]) => {
      const now = ocgUSD(row.local, row.card.region), then = ocgUSD(row[k], row.card.region);
      return now == null || then == null ? "" : "<span>" + esc(ocgSince(row, k)) + ": " + changeHTML(now - then, then > 0 ? (now - then) / then : null, true) + "</span>";
    }).filter(Boolean);
    return list.length ? '<div class="changes" aria-label="' + esc(label || "Price change") + '">' + list.join("") + "</div>" : "";
  }
  // A row of the list as the Market's chase-card shape, with its set, so the Want and I have it helpers work on it
  // A set of the list as the Market knows it, or (before the Market's list is here) just its code
  function ocgSetInfo(set) {
    return ocgFindSet(set.id) || {region: set.region, id: set.id, prefix: set.prefix, name: set.prefix + (set.region === "jp" ? "-JP" : "-KR"), date: "", line: "other",
      cards: set.cards.length, local: "", chase: [], top: null, box: null, rush: isRushNo(set.prefix)};
  }
  function ocgChaseLike(row) {
    const card = row.card, region = card.region;
    const s = ocgSetInfo(card.set);
    return {s, c: {number: card.number, name: card.name, rarity: row.rarity, local: row.local, stock: region === "jp" ? !!row.stock : null, n: region === "kr" ? row.n : null, img: row.img, set: s, row}};
  }
  const ocgRef = row => row.card.number + "|" + row.rarity;
  function ocgRefAt(ref) {
    const at = String(ref || "").indexOf("|");
    if (at < 0) return null;
    const card = ocgCardAt(ref.slice(0, at)), rarity = ref.slice(at + 1);
    const row = card && (card.rows.find(x => x.rarity === rarity) || ocgRowFor(card, rarity));
    return row ? ocgChaseLike(row) : null;
  }
  // Cards of the list whose English name has these words, best matches first
  function ocgNameHits(text, limit) {
    if (!ocgCd.data) return [];
    const phrase = csNorm(String(text || "").trim()), words = phrase.split(/\s+/).filter(Boolean);
    if (!words.length || phrase.length < 2) return [];
    const out = [];
    for (const [key, cards] of ocgCd.data.byName) {
      if (!words.every(w => key.includes(w))) continue;
      const score = key === phrase ? 0 : key.startsWith(phrase) ? 1 : 2;
      for (const c of cards) if (ocgRegion(c.number)) out.push({c, score});
    }
    out.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name) || b.c.set.prefix.localeCompare(a.c.set.prefix));
    return out.slice(0, limit || 40).map(x => x.c);
  }
  // Your Japanese and Korean cards: how many of each number, and of each number and rarity
  function ocgOwnedMaps() {
    const byNumber = new Map(), byRow = new Map();
    for (const r of collection) {
      if (!isOcg(r)) continue;
      const n = normNumber(r.number);
      byNumber.set(n, (byNumber.get(n) || 0) + r.qty);
      const k = n + "|" + String(rowRarityOf(n, r.rarity) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      byRow.set(k, (byRow.get(k) || 0) + r.qty);
    }
    return {byNumber, byRow};
  }
  const ocgRowOwned = (owned, row) => owned.byRow.get(row.card.number + "|" + String(row.rarity || "").toLowerCase().replace(/[^a-z0-9]/g, "")) ||
    (row.card.rows.length === 1 ? owned.byNumber.get(row.card.number) || 0 : 0);
  // A set of the list: how many of its cards you have (each number once), and what the rest would cost
  function ocgSetProgress(set, owned) {
    owned = owned || ocgOwnedMaps();
    let have = 0, cost = 0, unpriced = 0, top = null;
    const missing = [];
    for (const card of set.cards) {
      const priced = card.rows.filter(x => x.local > 0);
      for (const x of priced) { const u = ocgUSD(x.local, set.region); if (u != null && (!top || u > top.usd)) top = {row: x, usd: u}; }
      if (owned.byNumber.get(card.number)) { have++; continue; }
      const cheapest = priced.length ? priced.reduce((a, b) => (b.local < a.local ? b : a)) : null;
      const u = cheapest ? ocgUSD(cheapest.local, set.region) : null;
      if (u == null) unpriced++; else cost += u;
      missing.push({card, row: cheapest || card.rows[0] || null, usd: u});
    }
    return {have, total: set.cards.length, missing, cost, unpriced, top};
  }
  // The price chart for a card of the list: each day's price from ocg-history/, in US$ at today's rate
  const ocgHist = new Map();
  function ocgSetHistory(region, prefix) {
    const key = region + "-" + String(prefix).replace(/[^A-Za-z0-9_-]/g, "_");   // (RD/KP25's file is jp-RD_KP25.json)
    if (!ocgHist.has(key)) ocgHist.set(key, fetch(ocgHistoryBase() + key + ".json").then(res => res.ok ? res.json() : null).catch(() => null).then(h => { if (!h) ocgHist.delete(key); return h; }));
    return ocgHist.get(key);
  }
  // r: the card (number and rarity); exact: the list's row itself, when it's known
  async function loadOcgHistory(r, exact) {
    const ctx = drawerCtx && drawerCtx.id, g = ocgRegion(r.number);
    const box = () => drawerCtx && drawerCtx.id === ctx ? $("cardHist") : null;
    if (!g || !box()) return;
    await loadOcgCardsSoft();
    const fp = exact ? null : ocgFilePrice(r), card = exact ? exact.card : fp && fp.card, row = exact || (fp && fp.row);
    if (!box()) return;
    if (!card || !row) { box().innerHTML = '<p class="small">' + (card ? "Pick the card's rarity (edit it below) to see its price over time." : "This card isn't in Card Vault's daily price list yet.") + "</p>"; return; }
    const h = await ocgSetHistory(card.region, card.set.prefix);
    if (!box()) return;
    const region = card.region, days = h && h.days;
    const arr = h && h.p && (h.p[card.number + "|" + (row.hk != null ? row.hk : row.rarity || "?")] || h.p[card.number + "|" + (row.rarity || "?")]);
    const all = (Array.isArray(arr) && Array.isArray(days) ? days.map((d, i) => ({date: parseDay(d), local: arr[i]})) : [])
      .filter(x => x.date && x.local > 0).map(x => ({date: x.date, v: ocgUSD(x.local, region), local: x.local})).filter(x => x.v != null).sort((a, b) => a.date - b.date);
    if (all.length < 2) {
      box().innerHTML = '<p class="small">Card Vault saves ' + (region === "jp" ? ocgSrc(region, card.number) + "'s price" : "Bunjang's price") + " for this set's cards each time it checks them (" +
        (region === "jp" && isRushNo(card.number) ? "every day" : "new sets daily, older ones weekly") + ")" +
        (days && days.length ? ", since " + esc(fmtDate(parseDay(days[0]))) : "") + ". The chart appears once this card has prices from two days.</p>";
      return;
    }
    drawPriceHistory(box(), all, (row.rarity || "") + (row.rarity ? ", " : "") + (region === "jp" ? ocgSrc(region, card.number) + " price" : "Bunjang price") + " in US$",
      x => "<b>" + esc(usd(x.v)) + "</b><span>" + esc(fmtLocal(x.local, OCG_CUR[region])) + ", " + esc(fmtDate(x.date)) + "</span>");
  }

  /* ----- Yugi-Market (Japan): sealed products for Japanese sets, in US$ ----- */
  const YM_KEY = "cardvault.v2.yugimarket";
  const YM_TTL = 12 * 3600000;
  const YM_COLLECTIONS = [["yu-gi-oh-booster-box", "box"], ["yu-gi-oh-box", "boxset"], ["yu-gi-oh-deck", "structure"], ["yu-gi-oh-booster-pack", "pack"],
    ["yu-gi-oh-booster-pack-retro", "pack"]];
  const YM_KINDS = [["box", "Booster boxes"], ["boxset", "Limited and collector's boxes"], ["structure", "Decks"], ["pack", "Booster packs"]];
  const ymKindName = k => (YM_KINDS.find(x => x[0] === k) || [k, ""])[1];
  const ymk = {list: null, at: 0, loading: null, failed: 0, match: null};
  function ymProduct(p, kind) {
    const title = String((p && p.title) || "");
    const tags = ((p && p.tags) || []).map(String);
    if (!title) return null;
    const rush = /rush\s*duel|ラッシュデュエル/i.test(title) || tags.some(t => /rush\s*duel|ラッシュデュエル/i.test(t)) || tags.some(t => /^RD\/[A-Z0-9]{2,6}-JP$/i.test(t));
    const vars = (p.variants || []).map(v => ({title: String(v.title || ""), price: num(v.price), available: !!v.available})).filter(v => v.price > 0);
    if (!vars.length) return null;   // (announced, no price yet)
    const single = v => !/case|bundle|carton|\bx\s*\d|\d+\s*(boxes|packs)/i.test(v.title);
    const pick = vars.find(v => v.available && single(v)) || vars.find(single) || vars[0];
    const img = String(((p.images || [])[0] || {}).src || "");
    return {id: p.id, title: title.replace(/^\s*\[pre-?order\]\s*/i, "").trim(), pre: /pre-?order/i.test(title), handle: String(p.handle || ""), kind,
      price: pick.price, available: vars.some(v => v.available), variants: vars.length > 1 ? vars : [],
      img: /^https:\/\/cdn\.shopify\.com\//.test(img) ? img + (img.includes("?") ? "&" : "?") + "width=400" : "", date: String(p.published_at || "").slice(0, 10),
      codes: tags.map(t => (t.match(/^((?:RD\/)?[A-Z0-9]{2,6})-JP$/i) || [])[1]).filter(Boolean).map(x => x.toUpperCase()), rush};
  }
  // Read twice a day at most, a second apart: the shop's own lists of booster boxes, limited boxes, decks and packs.
  function loadYugiMarket(force) {
    if (!ymk.list) { const c = readJSON(YM_KEY, null); if (c && Array.isArray(c.list)) { ymk.list = c.list; ymk.at = c.t || 0; } }
    if (ymk.loading) return ymk.loading;
    if (!force && ymk.list && Date.now() - ymk.at < YM_TTL) return Promise.resolve(ymk.list);
    if (!force && ymk.failed && Date.now() - ymk.failed < 10 * 60000) return Promise.resolve(ymk.list);
    ymk.loading = (async () => {
      const seen = new Set(), list = [], missed = new Set();
      let failed = 0;
      for (const [handle, kind] of YM_COLLECTIONS) {
        try {
          const j = await politeJSON("https://yugi-market.com/collections/" + handle + "/products.json?limit=250", 1200);
          for (const p of (j && j.products) || []) {
            if (!p || seen.has(p.id)) continue;
            const x = ymProduct(p, kind);
            if (x) { seen.add(p.id); list.push(x); }
          }
        } catch (e) { missed.add(kind); failed++; }
      }
      if (failed < YM_COLLECTIONS.length) {
        // (a list that didn't load this time keeps what it had)
        for (const x of ymk.list || []) if (missed.has(x.kind) && !seen.has(x.id)) { seen.add(x.id); list.push(x); }
        ymk.list = list; ymk.at = Date.now(); ymk.failed = 0;
        try { localStorage.setItem(YM_KEY, JSON.stringify({t: ymk.at, list})); } catch (e) { /* optional */ }
      } else {
        ymk.failed = Date.now();
      }
      ymk.loading = null;
      if (settings.tab === "market" && settings.mkRegion === "jp") renderMarketList();
      else if (settings.tab === "wants") { renderWants(); renderTabs(); }
      else if (settings.tab === "search" && String(cs.set || "").startsWith("jp:")) renderSearchResults();
      return ymk.list;
    })();
    return ymk.loading;
  }
  // Which set each product is: a set code in its tags, else the longest set name in its title.
  const ymKey = s => " " + String(s || "").normalize("NFKC").toLowerCase().replace(/\[pre-?order\]/g, " ")
    .replace(/\bdeck modification pack\b/g, "deck mod pack").replace(/\brush duel\b/g, " ")
    .replace(/yu-gi-oh!?|\bocg\b|\bbooster\b|\bbox(es)?\b|\bpacks?\b|\bset\b|\bdisplay\b|\bedition\b|\bthe\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim() + " ";
  function ymMatch() {
    if (!ymk.list || !ocgMk.data) return new Map();
    if (ymk.match && ymk.match.list === ymk.list && ymk.match.data === ocgMk.data) return ymk.match.map;
    const sets = ocgMk.data.jp, byPrefix = new Map(sets.map(s => [s.prefix, s]));
    const keyed = sets.map(s => ({s, k: ymKey(s.name)})).filter(x => x.k.trim().length >= 5);
    const map = new Map();
    for (const x of ymk.list) {
      // (a Rush Duel product goes with a Rush Duel set, and an OCG one with an OCG set: some names are alike)
      let hit = x.codes.map(c => byPrefix.get(c)).find(s => s && !!s.rush === !!x.rush) || null;
      if (!hit) {
        const k = ymKey(x.title);
        let best = null;
        for (const c of keyed) if (!!c.s.rush === !!x.rush && k.includes(c.k) && (!best || c.k.length > best.k.length)) best = c;
        hit = best ? best.s : null;
      }
      if (hit) map.set(x.id, hit);
    }
    ymk.match = {list: ymk.list, data: ocgMk.data, map};
    return map;
  }
  function ymForSet(s) { const m = ymMatch(); return (ymk.list || []).filter(x => m.get(x.id) === s); }
  function ymBox(s) {
    const boxes = ymForSet(s).filter(x => x.kind === "box");
    const pool = boxes.filter(x => x.available).length ? boxes.filter(x => x.available) : boxes;
    return pool.length ? pool.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  }
  function ymTileHTML(x, showSet) {
    const set = showSet ? ymMatch().get(x.id) : null;
    const q = encodeURIComponent("Yu-Gi-Oh OCG " + x.title + " Japanese");
    return '<div class="result static"><span class="sleeve boxed">' + imgTag({list: [x.img].filter(Boolean)}, x.title) + "</span>" +
      '<span class="result-name">' + esc(x.title) + "</span>" +
      '<span class="result-meta">' + esc((set ? set.name + " · " : "") + ymKindName(x.kind)) + "</span>" +
      '<dl class="mk-prices"><dt>Yugi-Market</dt><dd class="low">' + esc(usd(x.price)) + "</dd>" +
      x.variants.filter(v => v.price !== x.price).map(v => "<dt>" + esc(v.title) + "</dt><dd>" + esc(usd(v.price)) + "</dd>").join("") + "</dl>" +
      (x.pre ? '<span class="mk-deal">Pre-order</span>' : !x.available ? '<span class="mk-warn">Sold out at Yugi-Market</span>' : "") +
      '<span class="mk-stores"><a target="_blank" rel="noopener" href="' + esc(ymLink(x)) + '">Yugi-Market</a>' +
      '<a target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=' + q + '&amp;_sop=15&amp;LH_BIN=1">eBay</a></span>' +
      '<span class="result-actions">' + (ymWanted(x) ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-ym-want="' + esc(String(x.id)) + '">Want</button>') +
      "</span></div>";
  }

  /* ----- the lists ----- */
  const ocgSetsOf = region => (ocgMk.data && ocgMk.data[region]) || [];
  const ocgFindSet = id => { const [region, prefix] = String(id).split(":"); return ocgSetsOf(region).find(s => s.prefix === prefix) || null; };
  function ocgOwnedCount(c) {
    return collection.filter(r => !r.productId && normNumber(r.number) === c.number && (!c.rarity || !r.rarity || sameRowRarity(c.number, r.rarity, c.rarity))).reduce((t, r) => t + r.qty, 0);
  }
  const ocgWanted = c => wants.some(w => !w.productId && normNumber(w.number) === c.number && (!c.rarity || !w.rarity || sameRowRarity(c.number, w.rarity, c.rarity)));
  function ocgChaseHTML(s) {
    return '<div class="results">' + s.chase.map((c, i) => {
      const owned = ocgOwnedCount(c), key = esc(s.id + "|" + i);
      const src = chaseFrom(s, c) + (s.region === "jp" && !c.stock ? " (last price)" : "");
      return '<div class="result static"><span class="sleeve"' + foilAttr(c.rarity) + '><span class="mk-rank">#' + (i + 1) + "</span>" + imgTag({list: [c.img].filter(Boolean).concat(namePics(c.name, "200w", c.rarity).list)}, c.name) + "</span>" +
        '<span class="result-name">' + esc(c.name) + "</span>" +
        '<span class="result-meta">' + esc(c.number) + ", " + esc(c.rarity || "rarity not stated") + "</span>" +
        '<span class="result-price">' + ocgMoneyHTML(c.local, s.region) + '<br><span class="small">' + esc(src) + "</span></span>" +
        '<span class="result-actions">' + (owned ? '<span class="on-list">You have ' + owned + "</span>" : "") +
        (ocgWanted(c) ? '<span class="on-list">On want list</span>' : '<button class="btn" type="button" data-ocg-want="' + key + '">Want</button>') +
        '<button class="btn" type="button" data-ocg-have="' + key + '">I have it</button></span></div>';
    }).join("") + "</div>";
  }
  const godOfCardsURL = s => "https://godofcards.com/en-int/search?type=product&q=" + encodeURIComponent(s.name + " Korean");
  const bunjangBoxURL = s => "https://m.bunjang.co.kr/search/products?q=" + encodeURIComponent((s.local || s.name) + " 박스");
  function ocgSetBodyHTML(s) {
    let html = "";
    if (s.region === "jp") {
      const mine = ymForSet(s);
      const order = YM_KINDS.map(k => k[0]);
      if (mine.length) {
        html += '<h3 class="mk-h">Sealed products at Yugi-Market</h3><div class="results">' +
          mine.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.available - a.available || a.price - b.price).map(x => ymTileHTML(x, false)).join("") + "</div>";
      } else {
        html += '<p class="small" style="margin:12px 0 0">' + (ymk.loading ? "Checking Yugi-Market for sealed products…" : ymk.list ? "Yugi-Market doesn't list sealed products for this set right now."
          : "Couldn't reach Yugi-Market for sealed prices right now.") +
          ' <a target="_blank" rel="noopener" href="https://yugi-market.com/search?q=' + encodeURIComponent(s.name) + '">Search Yugi-Market</a></p>';
      }
    } else {
      html += '<h3 class="mk-h">Sealed</h3><p class="small" style="margin:0 0 4px">' +
        (s.box ? "Unopened booster box on Bunjang: <b>" + ocgMoneyHTML(s.box.price, "kr") + "</b> (asking prices, the middle of " + plural(s.box.n, "listing") + "). "
          : "No unopened boxes listed on Bunjang right now. ") +
        '<span class="mk-stores" style="display:inline-flex"><a target="_blank" rel="noopener" href="' + esc(godOfCardsURL(s)) + '">God of Cards</a>' +
        '<a target="_blank" rel="noopener" href="' + esc(bunjangBoxURL(s)) + '">Bunjang</a></span>' +
        (krBoxWanted(s) ? ' <span class="on-list">Booster box on want list</span>'
          : ' <button class="btn btn-small" type="button" data-krbox-want="' + esc(s.id) + '">Want a booster box</button>') + "</p>";
    }
    if (s.chase.length) {
      const total = s.chase.reduce((t, c) => t + (ocgUSD(c.local, s.region) || 0), 0);
      html += '<h3 class="mk-h">Top ' + s.chase.length + " chase cards" + (total ? ' <span class="small">(one of each: ' + esc(usd(total)) + ")</span>" : "") + "</h3>" + ocgChaseHTML(s);
    } else {
      html += '<p class="small" style="margin:12px 0 0">No ' + (s.region === "jp" ? ocgSrc("jp", s.prefix) + " prices" : "Bunjang listings") + " for this set's cards yet" +
        (s.cards ? " (" + plural(s.cards, "card") + " in the set)" : "") + ".</p>";
    }
    return html;
  }
  function ocgSetRowHTML(s) {
    const open = ocgMk.open.has(s.id);
    const top = s.top;
    const box = s.region === "jp" ? ymBox(s) : null;
    const cost = s.region === "jp"
      ? (box ? "<b>" + esc(usd(box.price)) + "</b><small>booster box" + (box.available ? "" : ", sold out") + "</small>" : "<small>" + (ymk.loading ? "checking…" : "no box listed") + "</small>")
      : (s.box ? "<b>" + esc(usd(ocgUSD(s.box.price, "kr")) || fmtLocal(s.box.price, "KRW")) + "</b><small>box, Bunjang</small>" : "<small>no box listed</small>");
    return '<article class="set-row mk-row"><button type="button" class="set-toggle" aria-expanded="' + open + '" data-ocg-set="' + esc(s.id) + '">' +
      '<span style="min-width:0"><span class="set-name">' + esc(s.name) + '</span><span class="set-sub">' +
      esc([s.prefix + (s.region === "jp" ? "-JP" : "-KR"), s.date.slice(0, 4), s.cards ? plural(s.cards, "card") : ""].filter(Boolean).join(", ")) +
      '<span class="mk-line">' + esc(ocgLineLabel(s)) + "</span></span></span>" +
      '<span class="mk-top">' + (top ? "Top card: <b>" + esc(top.name) + '</b> <span class="gold">' + esc(usd(ocgUSD(top.local, s.region)) || fmtLocal(top.local, OCG_CUR[s.region])) + "</span>" : "No prices yet") + "</span>" +
      '<span class="set-cost">' + cost + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="set-body">' + ocgSetBodyHTML(s) + "</div>" : "") + "</article>";
  }
  function renderOcgMarketList(box) {
    const region = settings.mkRegion;
    if (!ocgMk.data) {
      box.innerHTML = '<div class="notice">' + (ocgMk.loading ? "Loading the " + (region === "jp" ? "Japanese" : "Korean") + " sets…"
        : !ocgMarketURL() ? "The Japanese and Korean sets come from your Card Vault website. Open the Market tab there once; this computer then loads them from it."
        : "Couldn't load the Japanese and Korean sets. Check the internet connection and try again." +
          ' <button class="btn btn-small" type="button" data-ocg-retry>Try again</button>') + "</div>";
      return;
    }
    const words = mk.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const day = s => s.date || "";
    if (settings.mkView === "sealed" && region === "jp") {
      if (!ymk.list) {
        box.innerHTML = '<div class="notice">' + (ymk.loading ? "Getting Yugi-Market's sealed products…" : "Couldn't reach Yugi-Market right now." +
          ' <button class="btn btn-small" type="button" data-ym-retry>Try again</button> <a target="_blank" rel="noopener" href="https://yugi-market.com/collections/yu-gi-oh-booster-box">Open Yugi-Market</a>') + "</div>";
        return;
      }
      const m = ymMatch();
      let list = ymk.list.filter(x => mkGameOK(x.rush) && (!settings.mkKindOcg || x.kind === settings.mkKindOcg) && (!settings.mkLineOcg || (m.get(x.id) || {}).line === settings.mkLineOcg) &&
        (!words.length || words.every(w => (x.title + " " + ((m.get(x.id) || {}).name || "") + " " + ((m.get(x.id) || {}).prefix || "")).toLowerCase().includes(w))));
      const sorters = {
        low: (a, b) => b.available - a.available || a.price - b.price,
        high: (a, b) => b.price - a.price,
        newest: (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title)
      };
      list.sort(sorters[settings.mkSortSealed] || sorters.newest);
      if (!list.length) { box.innerHTML = '<div class="notice">No product matches. Try fewer words, or another type.</div>'; return; }
      box.innerHTML = '<p class="results-head">' + plural(list.length, "product") + " at Yugi-Market" + (list.length > mk.limit ? ", showing the first " + mk.limit : "") + ".</p>" +
        '<div class="results">' + list.slice(0, mk.limit).map(x => ymTileHTML(x, true)).join("") + "</div>" +
        (list.length > mk.limit ? '<div class="mk-more"><button class="btn" type="button" data-mk-more>Show more</button></div>' : "");
      return;
    }
    let list = ocgSetsOf(region).filter(s => mkGameOK(s.rush) && (!settings.mkLineOcg || s.line === settings.mkLineOcg) &&
      (!words.length || words.every(w => (s.name + " " + s.prefix + " " + s.local + (s.rush ? " rush duel" : "")).toLowerCase().includes(w))));
    if (settings.mkView === "sealed") {
      // Korean sealed: the sets with unopened boxes on Bunjang, and a God of Cards search for every set
      list = list.filter(s => s.box);
      const sorters = {low: (a, b) => a.box.price - b.box.price, high: (a, b) => b.box.price - a.box.price, newest: (a, b) => day(b).localeCompare(day(a))};
      list.sort(sorters[settings.mkSortSealed] || sorters.newest);
      box.innerHTML = '<div class="notice" style="margin-bottom:12px">God of Cards sells Korean booster boxes and decks, but its prices can\'t be read from here: each set has a link to it. ' +
        'Below are the sets with unopened boxes on Bunjang (asking prices). <a target="_blank" rel="noopener" href="https://godofcards.com/en-int/collections/korean-yugioh-cards">God of Cards: Korean Yu-Gi-Oh!</a></div>' +
        (list.length ? '<p class="results-head">' + plural(list.length, "set") + (list.length > mk.limit ? ", showing the first " + mk.limit : "") + ".</p>" +
          list.slice(0, mk.limit).map(ocgSetRowHTML).join("") + (list.length > mk.limit ? '<div class="mk-more"><button class="btn" type="button" data-mk-more>Show more</button></div>' : "")
          : '<div class="notice">No set matches.</div>');
      return;
    }
    const topUSD = s => s.top ? ocgUSD(s.top.local, s.region) || 0 : -1;
    const sorters = {
      newest: (a, b) => day(b).localeCompare(day(a)) || a.name.localeCompare(b.name),
      oldest: (a, b) => day(a).localeCompare(day(b)) || a.name.localeCompare(b.name),
      chase: (a, b) => topUSD(b) - topUSD(a),
      name: (a, b) => a.name.localeCompare(b.name)
    };
    list.sort(sorters[settings.mkSortSets] || sorters.newest);
    if (!list.length) { box.innerHTML = '<div class="notice">No set matches. Try fewer words, or another set type.</div>'; return; }
    box.innerHTML = '<p class="results-head">' + plural(list.length, "set") + (list.length > mk.limit ? ", showing the first " + mk.limit : "") + ".</p>" +
      list.slice(0, mk.limit).map(ocgSetRowHTML).join("") +
      (list.length > mk.limit ? '<div class="mk-more"><button class="btn" type="button" data-mk-more>Show more</button></div>' : "");
  }
  function ocgChaseAt(key) {
    const bar = String(key).lastIndexOf("|");
    const s = ocgFindSet(String(key).slice(0, bar));
    const c = s && s.chase[+String(key).slice(bar + 1)];
    return c ? {s, c} : null;
  }
  // A Japanese or Korean card's price from the Market's lists (its set's most valuable cards), in US$.
  function ocgMarketPrice(r) {
    const g = ocgRegion(r.number);
    if (!g) return null;
    if (!ocgMk.data) { if (!ocgMk.loading && !ocgMk.failed && ocgMarketURL()) loadOcgMarket(); return null; }
    const region = g.region === "JP" ? "jp" : "kr";
    const s = ocgSetsOf(region).find(x => x.prefix === g.set);
    const same = s ? s.chase.filter(x => x.number === g.code) : [];
    const c = !r.rarity ? same[0] : matchRarity(same, r.rarity, x => x.rarity) || same.find(x => !x.rarity);
    return c ? ocgUSD(c.local, region) : null;
  }
  function ocgHave(s, c, opts) {
    const lang = s.region === "jp" ? "Japanese" : "Korean";
    const price = c.local > 0 ? {local: c.local, cur: OCG_CUR[s.region], src: ocgSrc(s.region, c.number),
      note: s.region === "jp" ? (c.stock ? "in stock" : "sold out; last price seen") : krNote(c)} : null;
    drawerCtx = null;
    openOcgForm({code: c.number, name: c.name, setName: s.name, rarities: c.rarity ? [c.rarity] : []}, lang, {rarity: c.rarity, image: c.img, backup: "", ja: "", price}, opts);
  }
  function ocgWant(s, c) {
    if (ocgWanted(c)) return;
    addWant({productId: null, name: c.name, productName: c.name, setName: s.name, number: c.number, rarity: c.rarity, edition: "Any",
      notes: ocgLangOf(s.region, c.number)});
    save(); renderTabs(); renderMarketList();
    toast("Added " + c.name + " (" + c.number + ") to your want list.");
    refreshOcgPrices();
  }

