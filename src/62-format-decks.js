  /* ======================= Decks I can build, by format ======================= */
  // Real deck lists for every format, from format-decks.js (made each night by format_decks.py): Format Library's
  // tournament decks (Goat, Edison, HAT and about 120 more, TCG and OCG) and YGOPRODeck's (Advanced, Genesys and OCG
  // tournaments, Speed Duel, community formats); and Rush Duel's Starter and Structure Decks, from the Japanese list. Each is held against your cards, the way
  // tournaments allow: TCG formats count your English cards, OCG formats your Japanese and Korean ones, Rush Duel your
  // Rush Duel cards. Closest first, with what's missing and what it costs.
  const fdk = {data: null, loading: null, failed: 0, memo: null, open: new Set(), shown: 30};
  const FDK_COMMUNITY = ["Common Charity", "Domain", "Trinity"];
  const FDK_TODAY = ["Advanced", "Genesys", "Traditional", "OCG", "Speed Duel"];
  const FDK_WHO = {TCG: "your English cards (TCG tournaments allow only those)", Speed: "your English cards", OCG: "your Japanese and Korean cards (OCG tournaments allow those)",
    Rush: "your Rush Duel cards"};
  function buildFormatDecks(raw) {
    if (!raw || !Array.isArray(raw.names) || !Array.isArray(raw.formats) || !Array.isArray(raw.decks)) throw new Error("not the format decks list");
    const names = raw.names.map(String), keys = names.map(normCardName);
    const formats = raw.formats.filter(Array.isArray).map((f, i) => ({i, name: String(f[0]), kind: String(f[1] || "TCG"), date: String(f[2] || ""), popular: !!f[3],
      era: String(f[4] || ""), src: String(f[5] || ""), decks: []}));
    const pairs = flat => { const out = []; for (let i = 0; i + 1 < (flat || []).length; i += 2) if (names[flat[i]] != null) out.push({name: names[flat[i]], key: keys[flat[i]], n: +flat[i + 1] || 1}); return out; };
    const decks = [];
    for (const d of raw.decks) {
      if (!Array.isArray(d) || !formats[d[0]]) continue;
      const deck = {id: decks.length, f: formats[d[0]], type: String(d[1] || "Deck"), event: String(d[2] || ""), place: d[3] == null ? "" : String(d[3]), date: String(d[4] || ""),
        src: String(d[5] || ""), ref: String(d[6] || ""), main: pairs(d[7]), extra: pairs(d[8])};
      if (!deck.main.length && !deck.extra.length) continue;
      decks.push(deck);
      deck.f.decks.push(deck);
    }
    return {generated: parseDate(raw.generated), formats: formats.filter(f => f.decks.length), decks};
  }
  function loadFormatDecks() {
    if (fdk.data) return Promise.resolve(fdk.data);
    if (fdk.loading) return fdk.loading;
    if (fdk.failed && Date.now() - fdk.failed < 10 * 60000) return Promise.resolve(null);
    const url = siteFileURL("format-decks.js");
    if (!url) { fdk.failed = Date.now(); return Promise.resolve(null); }
    const http = /^https?:$/.test(location.protocol);
    fdk.loading = (http
      ? fetch(url).then(res => { if (!res.ok) throw new Error("answered " + res.status); return res.text(); }).then(t => readWindowJSON(t, "FORMAT_DECKS"))
      : new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url + "?d=" + Math.floor(Date.now() / 86400000);
        s.onload = () => { const raw = window.FORMAT_DECKS; window.FORMAT_DECKS = null; s.remove(); resolve(raw); };
        s.onerror = () => { s.remove(); reject(new Error("didn't load")); };
        document.head.appendChild(s);
      }))
      .then(raw => { fdk.data = buildFormatDecks(raw); fdk.failed = 0; fdk.memo = null; })
      .catch(() => { fdk.failed = Date.now(); })
      .then(() => {
        fdk.loading = null;
        if (settings.tab === "decks" && settings.deckView === "ideas") renderDecks();
        return fdk.data;
      });
    return fdk.loading;
  }

  // Rush Duel: nobody publishes its deck lists in a form Card Vault can read, so its Starter and Structure Decks from the
  // Japanese list stand in (each card once). Added once both Japanese lists have loaded.
  function fdkAddRush() {
    if (!fdk.data || fdk.data.rush || !ocgMk.data || !ocgCd.data) return false;
    const f = {i: fdk.data.formats.length, name: "Rush Duel", kind: "Rush", date: "", popular: false, era: "", src: "Card Vault's Japanese list", decks: []};
    const bySet = new Map();
    for (const c of ocgCd.data.cards) if (c.region === "jp" && isRushNo(c.number)) pushMap(bySet, c.set.id, c);
    for (const set of ocgSetsOf("jp").filter(x => x.rush && x.line === "structure")) {
      const seen = new Set(), main = [];
      for (const c of bySet.get(set.id) || []) { const key = normCardName(c.name); if (key && !seen.has(key)) { seen.add(key); main.push({name: c.name, key, n: 1}); } }
      if (main.length < 5) continue;
      const deck = {id: fdk.data.decks.length, f, type: set.name, event: "", place: "", date: set.date, src: "rush", ref: set.prefix, main, extra: []};
      fdk.data.decks.push(deck);
      f.decks.push(deck);
    }
    fdk.data.rush = true;
    if (f.decks.length) fdk.data.formats.push(f);
    fdk.memo = null;
    return true;
  }
  function fdkRushSoon() {
    if (!fdk.data || fdk.data.rush || fdkAddRush() || fdk.rushWait) return;
    fdk.rushWait = true;
    const cards = ocgCardsReady() ? null : ocgCd.loading;
    Promise.all([loadOcgMarket(), cards]).then(() => {
      fdk.rushWait = false;
      if (fdkAddRush() && settings.tab === "decks" && settings.deckView === "ideas" && settings.ideasMode !== "archetypes") renderFormatDecks();
    });
  }

  /* ----- your cards against a deck ----- */
  // (worked out again when your cards, or the price lists, change)
  function fdkMemo() {
    const sig = collection.length + ":" + collection.reduce((t, r) => t + r.qty, 0) + ":" + (catalog ? 1 : 0) + ":" + (ocgCd.data ? 1 : 0);
    if (!fdk.memo || fdk.memo.sig !== sig || fdk.memo.data !== fdk.data) fdk.memo = {sig, data: fdk.data, owned: {}, status: new Map(), price: new Map(), ocg: null};
    return fdk.memo;
  }
  const fdkCounts = (r, kind) => !r.sealed && r.name && (kind === "Rush" ? isRushNo(r.number) : !isRushNo(r.number) &&
    (kind === "OCG" ? /^(japanese|korean)$/i.test(r.language || "") : (r.language || "English") === "English"));
  function fdkOwned(kind) {
    const m = fdkMemo();
    if (!m.owned[kind]) {
      const map = new Map();
      for (const r of collection) if (fdkCounts(r, kind)) { const k = normCardName(r.name); map.set(k, (map.get(k) || 0) + r.qty); }
      m.owned[kind] = map;
    }
    return m.owned[kind];
  }
  // The cheapest copy you could buy: TCGplayer's for TCG and Speed Duel cards; BIGWEB's or Bunjang's for OCG cards, Rush Duel ones for Rush.
  function fdkPrice(key, kind) {
    const m = fdkMemo(), id = kind + "|" + key;
    if (m.price.has(id)) return m.price.get(id);
    let best = null;
    if (kind === "TCG" || kind === "Speed") {
      const b = cheapestByName(key);
      if (b) best = {v: b.price, product: b.product};
    } else if (ocgCd.data) {
      if (!m.ocg) { m.ocg = new Map(); for (const c of ocgCd.data.cards) pushMap(m.ocg, normCardName(c.name), c); }
      for (const c of m.ocg.get(key) || []) {
        if (isRushNo(c.number) !== (kind === "Rush")) continue;
        for (const row of c.rows) { const v = row.local > 0 ? ocgUSD(row.local, c.region) : null; if (v != null && (!best || v < best.v)) best = {v, c, row}; }
      }
    }
    m.price.set(id, best);
    return best;
  }
  // {need, have, pct, rows: [{name, key, n, have, extra}], missing: [row + best], cost, unpriced}
  function fdkStatus(d) {
    const m = fdkMemo();
    if (m.status.has(d.id)) return m.status.get(d.id);
    const owned = fdkOwned(d.f.kind), left = new Map();
    const rows = d.main.map(x => Object.assign({extra: false}, x)).concat(d.extra.map(x => Object.assign({extra: true}, x)));
    let need = 0, have = 0, cost = 0, unpriced = 0;
    const missing = [];
    for (const x of rows) {
      const l = left.has(x.key) ? left.get(x.key) : owned.get(x.key) || 0;
      x.have = Math.min(l, x.n);
      left.set(x.key, l - x.have);
      need += x.n; have += x.have;
      if (x.have < x.n) {
        x.best = fdkPrice(x.key, d.f.kind);
        if (x.best) cost += x.best.v * (x.n - x.have); else unpriced += x.n - x.have;
        missing.push(x);
      }
    }
    const st = {need, have, pct: need ? have / need : 0, rows, missing, cost, unpriced};
    m.status.set(d.id, st);
    return st;
  }
  const fdkBetter = (a, b) => (b.st.pct - a.st.pct) || (a.st.cost - b.st.cost);
  function fdkDecksOf(f, onlyDone) {
    return f.decks.map(d => ({d, st: fdkStatus(d)})).filter(x => !onlyDone || x.st.have === x.st.need).sort(fdkBetter);
  }

  /* ----- the view ----- */
  const fdkPlace = p => { const n = +p; if (!String(p).trim()) return ""; if (!isFinite(n) || n <= 0) return String(p); const s = n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"; return n + s; };
  const fdkLink = d => d.src === "fl" && /^\d+$/.test(d.ref) ? "https://formatlibrary.com/decks/" + d.ref : d.src === "ypd" && /^[\w-]+$/.test(d.ref) ? "https://ygoprodeck.com/deck/" + d.ref : "";
  const fdkSite = d => d.src === "fl" ? "Format Library" : d.src === "ypd" ? "YGOPRODeck" : "";
  const fdkYear = f => /^\d{4}/.test(f.date) ? f.date.slice(0, 4) : "";
  function fdkGroups(formats) {
    const today = formats.filter(f => FDK_TODAY.includes(f.name)).sort((a, b) => FDK_TODAY.indexOf(a.name) - FDK_TODAY.indexOf(b.name));
    const rest = formats.filter(f => !today.includes(f));
    const byDate = list => list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name));
    return [["Today's formats", today], ["Popular formats", byDate(rest.filter(f => f.popular))],
      ["Rush Duel", rest.filter(f => f.kind === "Rush")], ["Community formats", rest.filter(f => FDK_COMMUNITY.includes(f.name))],
      ["TCG formats, newest first", byDate(rest.filter(f => !f.popular && f.kind === "TCG" && !FDK_COMMUNITY.includes(f.name)))],
      ["OCG formats, newest first", byDate(rest.filter(f => !f.popular && f.kind === "OCG"))]].filter(g => g[1].length);
  }
  const fdkMeter = (st, unit) => '<span class="set-prog"><span class="progress" aria-hidden="true"><span style="width:' + Math.round(st.pct * 100) + '%"></span></span>' +
    '<span class="set-count"><b>' + st.have + " of " + st.need + "</b> " + (unit || "cards") + " (" + Math.round(st.pct * 100) + "%)</span></span>";
  const fdkCost = st => '<span class="set-cost">' + (!st.missing.length ? "<b>You can build it</b>" :
    st.unpriced && !st.cost ? "<b>No price yet</b><small>for the " + plural(st.need - st.have, "missing card") + "</small>" :
    "<b>" + esc(usd(st.cost)) + (st.unpriced ? "+" : "") + "</b><small>to finish" + (st.unpriced ? " (" + st.unpriced + " unpriced)" : "") + "</small>") + "</span>";
  function renderFormatDecks() {
    const panel = $("panel-decks");
    const head = '<div class="panel-head"><div><h2>Decks I can build</h2><p>Real deck lists from tournaments and players, for every format, and how much of each your cards already make.</p></div>' + deckViewSeg() + "</div>" + ideasModeHTML();
    if (!collection.some(r => !r.sealed)) { panel.innerHTML = head + emptyPanel("No cards yet", "Add cards to your collection and Card Vault shows which decks they could make, in every format."); return; }
    if (!fdk.data) {
      loadFormatDecks();
      panel.innerHTML = head + '<div class="box">' + (fdk.failed && !fdk.loading
        ? '<p style="margin:0 0 10px">Couldn\'t load the deck lists. They come with the nightly update; if this is the first day, they arrive with tonight\'s.</p><button class="btn" type="button" data-fdk-retry>Try again</button>'
        : '<p role="status" style="margin:0">Loading the deck lists…</p>') + "</div>";
      return;
    }
    ocgCardsReady();
    fdkRushSoon();
    const f = fdk.data.formats.find(x => x.name === settings.fdkFormat) || null;
    const only = !!settings.fdkOnlyDone;
    const groups = fdkGroups(fdk.data.formats.slice());
    let html = head + '<div class="panel-tools fdk-tools"><label class="basis">Format <select class="select" id="fdkFormat"><option value="">Every format: your closest deck in each</option>' +
      groups.map(([label, list]) => '<optgroup label="' + esc(label) + '">' + list.map(x => '<option value="' + esc(x.name) + '"' + (f === x ? " selected" : "") + ">" +
        esc(x.name + (fdkYear(x) && !FDK_TODAY.includes(x.name) ? " (" + fdkYear(x) + ")" : "") + " · " + plural(x.decks.length, "deck")) + "</option>").join("") + "</optgroup>").join("") +
      '</select></label><label class="check-row"><input type="checkbox" class="check" id="fdkOnlyDone"' + (only ? " checked" : "") + "> <span>Only decks I can build now</span></label></div>";
    html += f ? fdkFormatHTML(f, only) : fdkOverviewHTML(only);
    html += '<p class="small" style="margin-top:14px">Deck lists from Format Library (formatlibrary.com: tournament decks of each format, with their event and placing) and YGOPRODeck (today\'s tournament decks, Speed Duel and community formats), ' +
      "read each night" + (fdk.data.generated ? ", last on " + esc(fmtDate(fdk.data.generated)) : "") + ". Prices are the cheapest copy: TCGplayer for English cards, BIGWEB or Bunjang for Japanese and Korean ones.</p>";
    panel.innerHTML = html;
    const sel = $("fdkFormat");
    if (sel) sel.addEventListener("change", () => { settings.fdkFormat = sel.value; fdk.open.clear(); saveSettings(); renderFormatDecks(); const again = $("fdkFormat"); if (again) again.focus(); });
    const box = $("fdkOnlyDone");
    if (box) box.addEventListener("change", () => { settings.fdkOnlyDone = box.checked; saveSettings(); renderFormatDecks(); const again = $("fdkOnlyDone"); if (again) again.focus(); });
  }
  // Every format at once: its closest deck, the formats you're closest in first
  function fdkOverviewHTML(only) {
    const rows = fdk.data.formats.map(f => ({f, best: fdkDecksOf(f, only)[0]})).filter(x => x.best).sort((a, b) => fdkBetter(a.best, b.best));
    if (!rows.length) return '<div class="notice">' + (only ? "None of the decks can be built with your cards alone yet. Turn off \"Only decks I can build now\" to see the closest ones." : "No deck lists yet.") + "</div>";
    const shown = rows.slice(0, fdk.shown);
    return '<p class="small" style="margin:0 0 10px">' + plural(rows.length, "format") + ", the ones your cards are closest to first. TCG formats count your English cards, OCG formats your Japanese and Korean ones.</p>" +
      shown.map(({f, best}) => '<article class="idea fdk-row"><button type="button" class="idea-toggle" data-fdk-format="' + esc(f.name) + '">' +
        '<span style="min-width:0"><span class="idea-name">' + esc(f.name) + ' <span class="fdk-kind">' + esc([f.kind === "TCG" || f.kind === "OCG" ? f.kind : "", fdkYear(f) && !FDK_TODAY.includes(f.name) ? fdkYear(f) : ""].filter(Boolean).join(" · ")) + "</span></span>" +
        '<span class="idea-sub">Closest: ' + esc(best.d.type) + (best.d.event ? " (" + esc([fdkPlace(best.d.place), best.d.event].filter(Boolean).join(" at ")) + ")" : "") + " · " + plural(f.decks.length, "deck") + "</span></span>" +
        fdkMeter(best.st) + fdkCost(best.st) + '<span class="caret" aria-hidden="true"></span></button></article>').join("") +
      (rows.length > shown.length ? '<div class="btn-row" style="margin-top:10px"><button class="btn" type="button" data-fdk-more>Show all ' + rows.length + " formats</button></div>" : "");
  }
  function fdkFormatHTML(f, only) {
    const list = fdkDecksOf(f, only);
    const rush = f.kind === "Rush";
    let html = '<p class="small" style="margin:0 0 10px">' + esc(f.name) + (f.era ? " · " + esc(f.era) + " era" : "") + (f.date && !FDK_TODAY.includes(f.name) ? " · " + esc(fmtDate(parseDay(f.date))) : "") +
      ". Counts " + esc(FDK_WHO[f.kind] || FDK_WHO.TCG) + "." + (rush ? " Nobody publishes Rush Duel deck lists in a form Card Vault can read, so these are its Starter and Structure Decks, each card once." : "") +
      ' <button type="button" class="link-btn" data-fdk-format="">Every format</button></p>';
    if (!list.length) return html + '<div class="notice">' + (only ? "None of these decks can be built with your cards alone yet." : "No decks for this format yet.") + "</div>";
    return html + list.map(x => fdkDeckHTML(x.d, x.st)).join("");
  }
  function fdkDeckHTML(d, st) {
    const open = fdk.open.has(d.id), rush = d.f.kind === "Rush";
    const when = d.date ? fmtDate(parseDay(d.date)) : "";
    const sub = rush ? ["Starter or Structure Deck", when].filter(Boolean).join(" · ") : [d.event ? [fdkPlace(d.place), d.event].filter(Boolean).join(" at ") : fdkSite(d), when].filter(Boolean).join(" · ");
    const link = fdkLink(d);
    const row = x => {
      const lack = x.n - x.have;
      const wanted = lack && x.best && fdkWanted(x.best);
      return "<tr" + (lack ? "" : ' class="have"') + "><td>" + esc(x.name) + (x.extra ? ' <span class="small">(Extra Deck)</span>' : "") + '</td><td class="num">' + x.have + " / " + x.n + "</td>" +
        '<td class="num">' + (!lack ? '<span class="small">You have ' + (x.n > 1 ? "them" : "it") + "</span>" : x.best ? esc(usd(x.best.v)) : '<span class="small">no price</span>') + "</td>" +
        '<td class="num">' + (!lack || !x.best ? "" : wanted ? '<span class="on-list">On want list</span>' : '<button class="btn btn-small" type="button" data-fdk-want="' + d.id + ":" + esc(x.key) + '">Want</button>') + "</td></tr>";
    };
    return '<article class="idea"><button type="button" class="idea-toggle" aria-expanded="' + open + '" data-fdk-deck="' + d.id + '">' +
      '<span style="min-width:0"><span class="idea-name">' + esc(d.type) + '</span><span class="idea-sub">' + esc(sub) + "</span></span>" +
      fdkMeter(st) + fdkCost(st) + '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="idea-body"><div class="table-wrap"><table class="idea-miss fdk-cards"><thead><tr><th>Card</th><th class="num">You have</th><th class="num">Price</th><th><span class="sr">Want</span></th></tr></thead><tbody>' +
        st.rows.slice().sort((a, b) => (a.extra - b.extra) || ((a.have >= a.n) - (b.have >= b.n))).map(row).join("") + "</tbody></table></div>" +
        '<div class="btn-row" style="margin-top:12px">' + (st.missing.some(x => x.best) ? '<button class="btn btn-primary" type="button" data-fdk-wants="' + d.id + '">Add the missing cards to my want list</button>' : "") +
        (rush ? "" : '<button class="btn" type="button" data-fdk-check="' + d.id + '">Open in Check a deck</button>') +
        (link ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(link) + '">See it on ' + esc(fdkSite(d)) + "</a>" : "") + "</div></div>" : "") + "</article>";
  }
  function ideasModeHTML() {
    const formats = settings.ideasMode !== "archetypes";
    return '<div class="seg fdk-mode" role="group" aria-label="Decks I can build"><button type="button" data-ideas-mode="formats" aria-pressed="' + formats + '">By format</button>' +
      '<button type="button" data-ideas-mode="archetypes" aria-pressed="' + !formats + '">By archetype</button></div>';
  }

  /* ----- want list and Check a deck ----- */
  const fdkWanted = best => best.product ? wants.some(w => w.productId === best.product.id) : wants.some(w => !w.productId && normNumber(w.number) === normNumber(best.c.number));
  function fdkWantFields(best, d) {
    const notes = "For " + d.type + " (" + d.f.name + ")";
    if (best.product) return Object.assign(wantFromProduct(best.product), {edition: "Any", notes});
    const s = ocgFindSet(best.c.set.id);
    return {productId: null, name: best.c.name, productName: best.c.name, setName: s ? s.name : best.c.set.prefix, number: best.c.number, rarity: best.row ? best.row.rarity : "", edition: "Any", notes};
  }
  function fdkWantMissing(d, onlyKey) {
    const st = fdkStatus(d), before = JSON.parse(JSON.stringify(wants));
    let n = 0;
    for (const x of st.missing) {
      if (!x.best || fdkWanted(x.best) || (onlyKey && x.key !== onlyKey)) continue;
      addWant(Object.assign(fdkWantFields(x.best, d), {qty: x.n - x.have}), {keepNotes: true});
      n++;
    }
    save(); renderTabs(); renderFormatDecks();
    if (onlyKey) { if (n) toast("Added to your want list."); return; }
    toast(n ? "Added " + plural(n, "card") + " to your want list." : "The missing cards are already on your want list.",
      n ? {action: "Undo", onAction: () => { wants = before.map(upgradeWant).filter(Boolean); save(); render(); }} : undefined);
  }
  const fdkListText = d => {
    const lines = list => list.map(x => x.n + " " + x.name).join("\n");
    return "Main Deck\n" + lines(d.main) + (d.extra.length ? "\n\nExtra Deck\n" + lines(d.extra) : "") + "\n";
  };
  function fdkOpenInCheck(d) {
    deckDraft = {id: null, name: d.type + " (" + d.f.name + ")", text: fdkListText(d)};
    settings.deckView = "check";
    saveSettings();
    deckResult = checkDeck(parseDeckText(deckDraft.text));
    renderDecks();
    toast("Here's the " + d.type + " list. Change it if you like, then Save deck to keep it.");
  }
  // Clicks in the Decks tab's "Decks I can build" (wired by wireDeckIdeas); true when handled
  function fdkClick(e) {
    const mode = e.target.closest("[data-ideas-mode]");
    if (mode) {
      settings.ideasMode = mode.dataset.ideasMode; saveSettings(); renderDecks();
      if (settings.ideasMode === "archetypes" && !ideas.result && !ideas.busy && ideasCached()) runDeckIdeas();
      const again = document.querySelector('[data-ideas-mode="' + settings.ideasMode + '"]');
      if (again) again.focus();
      return true;
    }
    if (settings.ideasMode === "archetypes") return false;
    if (e.target.closest("[data-fdk-retry]")) { fdk.failed = 0; loadFormatDecks(); renderFormatDecks(); return true; }
    if (e.target.closest("[data-fdk-more]")) { fdk.shown = 1000; renderFormatDecks(); return true; }
    const fm = e.target.closest("[data-fdk-format]");
    if (fm) { settings.fdkFormat = fm.dataset.fdkFormat; fdk.open.clear(); saveSettings(); renderFormatDecks(); window.scrollTo({top: 0}); const s = $("fdkFormat"); if (s) s.focus(); return true; }
    const byId = id => fdk.data && fdk.data.decks[+id];
    const t = e.target.closest("[data-fdk-deck]");
    if (t) {
      const id = +t.dataset.fdkDeck;
      if (fdk.open.has(id)) fdk.open.delete(id); else fdk.open.add(id);
      renderFormatDecks();
      const again = document.querySelector('[data-fdk-deck="' + id + '"]');
      if (again) again.focus();
      return true;
    }
    const w = e.target.closest("[data-fdk-want]");
    if (w) { const at = w.dataset.fdkWant.indexOf(":"), d = byId(w.dataset.fdkWant.slice(0, at)); if (d) fdkWantMissing(d, w.dataset.fdkWant.slice(at + 1)); return true; }
    const all = e.target.closest("[data-fdk-wants]");
    if (all) { const d = byId(all.dataset.fdkWants); if (d) fdkWantMissing(d); return true; }
    const c = e.target.closest("[data-fdk-check]");
    if (c) { const d = byId(c.dataset.fdkCheck); if (d) fdkOpenInCheck(d); return true; }
    return false;
  }
