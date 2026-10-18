  /* ======================= Theme goals: every card of an archetype or a name ======================= */
  // "Every Shaddoll card", "every Dark Magician Girl card": a goal like a set goal, for one language at a time
  // (English, Japanese or Korean: each its own goal, its own progress). Its cards are the archetype's own (YGOPRODeck's
  // archetype, a card with the name in its name, or one always treated as it) and its support (cards whose text names
  // it), from card-themes.js, which the nightly update reads from YGOPRODeck once a week. A card counts as done with one
  // copy, any printing, in that language. A goal is the name, the language and when it was last changed; a removed one
  // is remembered for a while (off), so syncing doesn't bring it back from a device that still has it.
  const THEME_MAX = 12;
  const THEME_LANGS = ["English", "Japanese", "Korean"];
  const THEME_REGION = {Japanese: "jp", Korean: "kr"};
  const th = {data: null, loading: null, failed: 0, memo: new Map()};
  const themeId = g => g.l + "|" + String(g.k).toLowerCase();
  const themeLabel = g => g.k + " · " + g.l;

  function cleanThemeGoals(list) {
    const by = new Map();
    for (const x of Array.isArray(list) ? list : []) {
      const k = String((x && x.k) || "").trim().slice(0, 80), l = THEME_LANGS.includes(x && x.l) ? x.l : "";
      if (k.length < 2 || !l) continue;
      const e = {k, l, t: modTime(x.t) || 0};
      if (x.off) e.off = 1;
      const id = themeId(e), cur = by.get(id);
      if (!cur || e.t > cur.t) by.set(id, e);
    }
    const all = Array.from(by.values());
    const on = all.filter(e => !e.off).sort((a, b) => a.t - b.t).slice(-THEME_MAX);
    const off = all.filter(e => e.off).sort((a, b) => b.t - a.t).slice(0, 40);
    return on.concat(off);
  }
  function mergeThemeGoals(mine, theirs, fileWins) {
    const a = new Map(cleanThemeGoals(mine).map(e => [themeId(e), e])), b = new Map(cleanThemeGoals(theirs).map(e => [themeId(e), e]));
    let changed = false, behind = false;
    for (const [id, e] of b) {
      const m = a.get(id);
      if (!m || e.t > m.t || (fileWins && (e.t !== m.t || !!e.off !== !!m.off))) { if (!m || !!m.off !== !!e.off || m.t !== e.t) changed = true; a.set(id, e); }
      else if (m.t > e.t) behind = true;
    }
    for (const id of a.keys()) if (!b.has(id)) behind = true;
    return {list: cleanThemeGoals(Array.from(a.values())), changed, behind};
  }
  const themeGoals = () => cleanThemeGoals(settings.themeGoals).filter(e => !e.off);
  const isThemeGoal = (k, l) => themeGoals().some(g => themeId(g) === themeId({k, l}));
  function setThemeGoal(k, l, on) {
    const list = cleanThemeGoals(settings.themeGoals).filter(e => themeId(e) !== themeId({k, l}));
    list.push(on ? {k, l, t: Date.now()} : {k, l, t: Date.now(), off: 1});
    settings.themeGoals = cleanThemeGoals(list);
  }

  /* ----- the list of cards (card-themes.js) ----- */
  const themesURL = () => ocgMarketURL().replace(/ocg-market\.js$/, "card-themes.js");
  function buildThemes(raw) {
    if (!raw || !Array.isArray(raw.terms) || !Array.isArray(raw.cards)) throw new Error("not the card themes list");
    const terms = raw.terms.map(String);
    const cards = [];
    for (const x of raw.cards) {
      if (!Array.isArray(x) || !x[0]) continue;
      const pick = ids => (Array.isArray(ids) ? ids : []).map(i => terms[i]).filter(Boolean);
      cards.push({name: String(x[0]), arch: x[1] >= 0 ? terms[x[1]] || "" : "", refs: pick(x[2]), as: pick(x[3]), kind: String(x[4] || "m"), key: photoKey(String(x[0]))});
    }
    const arch = new Set((raw.arch || []).map(i => terms[i]).filter(Boolean));
    const byKey = new Map();
    for (const c of cards) if (!byKey.has(c.key)) byKey.set(c.key, c);
    return {generated: parseDate(raw.generated), terms, arch, archLower: new Map(Array.from(arch).map(a => [a.toLowerCase(), a])), cards, byKey};
  }
  // (read only when a theme is used: about half a megabyte, much less over the network)
  function loadThemes() {
    if (th.data) return Promise.resolve(th.data);
    if (th.loading) return th.loading;
    if (th.failed && Date.now() - th.failed < 10 * 60000) return Promise.resolve(null);
    const url = themesURL();
    if (!url) { th.failed = Date.now(); return Promise.resolve(null); }
    const http = /^https?:$/.test(location.protocol);
    th.loading = (http
      ? fetch(url).then(res => { if (!res.ok) throw new Error("answered " + res.status); return res.text(); }).then(t => readWindowJSON(t, "CARD_THEMES"))
      : new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url + "?d=" + Math.floor(Date.now() / 86400000);
        s.onload = () => { const raw = window.CARD_THEMES; window.CARD_THEMES = null; s.remove(); resolve(raw); };
        s.onerror = () => { s.remove(); reject(new Error("didn't load")); };
        document.head.appendChild(s);
      }))
      .then(raw => { th.data = buildThemes(raw); th.failed = 0; th.memo.clear(); })
      .catch(() => { th.failed = Date.now(); })
      .then(() => {
        th.loading = null;
        renderGoalsBar();
        if (settings.tab === "search") renderSearchResults();
        if (drawerCtx && drawerCtx.mode === "theme-pick" && $("thQ")) $("thQ").dispatchEvent(new Event("input"));
        if (drawerCtx && drawerCtx.mode === "theme-cards") openThemeCards(drawerCtx.k, drawerCtx.l);
        return th.data;
      });
    return th.loading;
  }
  const themesReady = () => { if (th.data) return true; loadThemes(); return false; };

  // Which cards a theme has: {members, support}, by YGOPRODeck name. Members: the archetype's own, a card with the name
  // in its name (as a whole word: "HERO" isn't "Heroic"), one always treated as it. Support: a card whose text names it.
  const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function themeCards(term) {
    const low = String(term || "").trim().toLowerCase();
    if (!th.data || low.length < 2) return {members: [], support: []};
    if (th.memo.has(low)) return th.memo.get(low);
    const re = new RegExp("(^|[^a-z0-9])" + escRe(low) + "([^a-z0-9]|$)");
    const members = [], support = [];
    for (const c of th.data.cards) {
      if ((c.arch && c.arch.toLowerCase() === low) || re.test(c.name.toLowerCase()) || c.as.some(a => a.toLowerCase() === low)) members.push(c);
      else if (c.refs.some(r => r.toLowerCase() === low)) support.push(c);
    }
    const out = {members, support};
    th.memo.set(low, out);
    return out;
  }

  /* ----- your progress, in one language ----- */
  // Your cards in a language, by name: {key: copies}. (Rush Duel cards are another game's; sealed products aren't cards.)
  function themeOwned(lang) {
    const out = new Map();
    for (const r of collection) {
      if (r.sealed || !r.name || r.language !== lang || isRushNo(r.number)) continue;
      const k = photoKey(lookupName(r.name));
      out.set(k, (out.get(k) || 0) + r.qty);
    }
    return out;
  }
  // The printings of a card in a language, and the cheapest one with a price: {printed, v, p (English) | c, row (else)}
  function themeOcgIndex(region) {
    const key = "ocg:" + region;
    if (th.memo.has(key) && th.memo.get(key).data === ocgCd.data) return th.memo.get(key).map;
    const map = new Map();
    for (const c of ocgCd.data ? ocgCd.data.cards : []) if (c.region === region && !isRushNo(c.number)) pushMap(map, photoKey(c.name), c);
    th.memo.set(key, {data: ocgCd.data, map});
    return map;
  }
  function themePrint(c, lang) {
    if (lang === "English") {
      const list = catalog ? (photosByName().get(c.key) || []) : [];
      let best = null;
      for (const p of list) for (const ed in p.prices) { const v = firstPrice(p.prices[ed]); if (v != null && (!best || v < best.v)) best = {v, p}; }
      return {printed: list.length > 0, known: !!catalog, v: best ? best.v : null, p: best ? best.p : list[0] || null};
    }
    const region = THEME_REGION[lang];
    const list = ocgCd.data ? (themeOcgIndex(region).get(c.key) || []) : [];
    let best = null;
    for (const card of list) for (const row of card.rows) { const v = row.local > 0 ? ocgUSD(row.local, region) : null; if (v != null && (!best || v < best.v)) best = {v, oc: card, row}; }
    return {printed: list.length > 0, known: !!ocgCd.data, v: best ? best.v : null, oc: best ? best.oc : list[0] || null, row: best ? best.row : list[0] ? list[0].rows[0] || null : null};
  }
  const themeWanted = (c, lang) => wants.some(w => !wantIsSealed(w) && photoKey(lookupName(w.name)) === c.key &&
    (lang === "English" ? !!w.productId : !w.productId && ocgRegion(w.number) && ocgRegion(w.number).region === (lang === "Japanese" ? "JP" : "KR")));
  // Each card of a theme in one language: {c, qty, printed, v, p|c, row, wanted}; and the totals
  function themeStatus(g) {
    const {members, support} = themeCards(g.k);
    const owned = themeOwned(g.l);
    if (g.l !== "English") ocgCardsReady();
    const row = c => Object.assign({c, qty: owned.get(c.key) || 0, wanted: themeWanted(c, g.l)}, themePrint(c, g.l));
    const m = members.map(row), s = support.map(row);
    // (a card never printed in that language doesn't count, unless you have one anyway)
    const counts = list => { const inIt = list.filter(x => x.printed || x.qty || !x.known); return {have: inIt.filter(x => x.qty).length, total: inIt.length}; };
    const missing = m.concat(s).filter(x => !x.qty && x.printed);
    return {members: m, support: s, m: counts(m), s: counts(s), missing, cost: missing.reduce((t, x) => t + (x.v || 0), 0),
      unpriced: missing.filter(x => x.v == null).length, notPrinted: m.concat(s).filter(x => x.known && !x.printed && !x.qty).length,
      toWant: missing.filter(x => !x.wanted), known: g.l === "English" ? !!catalog : !!ocgCd.data};
  }

  /* ----- the goals bar ----- */
  const themeOpen = g => (settings.themesOpen || []).includes(themeId(g));
  function foldTheme(id) {
    const open = (settings.themesOpen || []).filter(x => x !== id && themeGoals().some(g => themeId(g) === x));
    if (!(settings.themesOpen || []).includes(id)) open.push(id);
    settings.themesOpen = open;
    saveSettings();
    renderGoalsBar();
    const again = document.querySelector('#goalsBar [data-theme-fold="' + CSS.escape(id) + '"]');
    if (again) again.focus();
  }
  function themeGoalHTML(g) {
    const id = themeId(g), open = themeOpen(g);
    if (!th.data) {
      return '<article class="goal"><button type="button" class="goal-head" data-theme-fold="' + esc(id) + '" aria-expanded="false"><span class="goal-name">' + esc(themeLabel(g)) +
        '</span><span class="caret" aria-hidden="true"></span></button><p class="small" style="margin:6px 0 0">' +
        (th.failed ? "Couldn't load the list of cards (it comes with the nightly update). " + '<button type="button" class="link-btn" data-theme-retry>Try again</button>' : "Loading the list of cards…") + "</p></article>";
    }
    const st = themeStatus(g);
    const have = st.m.have + st.s.have, total = st.m.total + st.s.total, done = total > 0 && have >= total, pctW = total ? (have / total * 100).toFixed(1) : 0;
    const head = '<button type="button" class="goal-head" data-theme-fold="' + esc(id) + '" aria-expanded="' + open + '">' +
      '<span class="goal-name">' + esc(themeLabel(g)) + (done ? ' <span class="goal-check" aria-hidden="true">&#10003;</span>' : "") + "</span>" +
      '<span class="sr">, ' + (done ? "complete" : have + " of " + total + " cards") + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button><span class="progress" aria-hidden="true"><span style="width:' + pctW + '%"></span></span>';
    if (!open) return '<article class="goal' + (done ? " done" : "") + '">' + head + "</article>";
    const who = esc(g.k);
    return '<article class="goal open' + (done ? " done" : "") + '">' + head + '<div class="goal-more"><p class="goal-nums">' +
      (!total ? "No " + esc(g.l) + " cards found for " + who + "." + (st.known ? "" : " (The " + esc(g.l) + " card list is still loading.)")
        : done ? '<b class="gold">Complete!</b> You have all ' + total + " cards."
        : "<b>" + st.m.have + " of " + st.m.total + "</b> " + who + " cards" + (st.s.total ? " · <b>" + st.s.have + " of " + st.s.total + "</b> support cards" : "") +
          (st.cost ? " · about <b>" + esc(usd(st.cost)) + "</b> to finish" : "") + (st.unpriced ? ' <span class="small">(' + st.unpriced + " without a price)</span>" : "")) +
      (st.notPrinted ? '<br><span class="small">' + plural(st.notPrinted, "card") + " never printed in " + esc(g.l) + " left out.</span>" : "") + "</p>" +
      '<div class="goal-actions"><button class="btn btn-small" type="button" data-theme-open="' + esc(id) + '">See the cards</button>' +
      (done || !st.missing.length ? "" : st.toWant.length ? '<button class="btn btn-small" type="button" data-theme-wants="' + esc(id) + '">Add the ' + plural(st.toWant.length, "missing card") + " to my want list</button>"
        : '<span class="small">The missing ' + (st.missing.length === 1 ? "card is" : "cards are") + " on your want list</span>") + "</div>" +
      '<button type="button" class="link-btn goal-remove" data-theme-remove="' + esc(id) + '">Remove this goal</button></div></article>';
  }
  const themeById = id => themeGoals().find(g => themeId(g) === id) || null;

  /* ----- adding, removing ----- */
  function addThemeGoals(k, langs) {
    k = String(k || "").trim();
    const fresh = langs.filter(l => !isThemeGoal(k, l));
    if (!fresh.length) { toast("You're already tracking " + k + " in " + langs.join(" and ") + "."); return; }
    if (themeGoals().length + fresh.length > THEME_MAX) { toast("You can track up to " + THEME_MAX + " archetypes and cards. Remove one first.", {kind: "error"}); return; }
    const before = JSON.parse(JSON.stringify(settings.themeGoals || []));
    for (const l of fresh) setThemeGoal(k, l, true);
    settings.themesOpen = (settings.themesOpen || []).concat(fresh.map(l => themeId({k, l})));
    save(); render();
    toast("Tracking every " + k + " card (" + fresh.join(", ") + "). The goal is on the Collection tab.",
      {action: "Undo", onAction: () => { settings.themeGoals = before; save(); render(); }});
  }
  function removeThemeGoal(id) {
    const g = themeById(id);
    if (!g) return;
    setThemeGoal(g.k, g.l, false);
    save(); render();
    toast("Removed " + themeLabel(g) + " from your goals.", {action: "Undo", onAction: () => { setThemeGoal(g.k, g.l, true); save(); render(); }});
  }
  // A missing card onto the want list: its cheapest printing in that language (any edition)
  function themeWantFields(x, g) {
    const notes = "For " + g.k;
    if (g.l === "English") return x.p ? Object.assign(wantFromProduct(x.p), {edition: "Any", notes}) : null;
    if (!x.oc) return null;
    const s = ocgFindSet(x.oc.set.id);
    return {productId: null, name: x.oc.name, productName: x.oc.name, setName: s ? s.name : x.oc.set.prefix, number: x.oc.number, rarity: x.row ? x.row.rarity : "", edition: "Any", notes};
  }
  function themeAddMissing(id) {
    const g = themeById(id);
    if (!g || !th.data) return;
    const st = themeStatus(g);
    const fields = st.toWant.map(x => themeWantFields(x, g)).filter(Boolean);
    if (!fields.length) { toast(st.missing.length ? "The missing cards are already on your want list." : "You have every " + g.k + " card in " + g.l + "."); return; }
    const before = wants.slice();
    for (const f of fields) addWant(f, {keepNotes: true});
    save(); render();
    if (g.l !== "English") refreshOcgPrices();
    toast("Added " + plural(fields.length, "card") + " to your want list" + (st.cost ? ", about " + usd(st.toWant.reduce((t, x) => t + (x.v || 0), 0)) + " at today's prices" : "") + ".",
      {action: "Undo", onAction: () => { wants = before; save(); render(); }});
  }

  /* ----- the picker: an archetype or a card name, and which languages ----- */
  // Suggestions for some words: archetypes first, then names of cards, each with how many cards it has.
  function themeSuggestions(text, limit) {
    const low = String(text || "").trim().toLowerCase();
    if (!th.data || low.length < 2) return [];
    const out = [], seen = new Set();
    const add = (k, what) => {
      if (seen.has(k.toLowerCase())) return;
      const n = themeCards(k);
      if (!n.members.length) return;
      seen.add(k.toLowerCase());
      out.push({k, what, members: n.members.length, support: n.support.length});
    };
    const archs = Array.from(th.data.arch).filter(a => a.toLowerCase().includes(low)).sort((a, b) => (a.toLowerCase().indexOf(low) - b.toLowerCase().indexOf(low)) || a.length - b.length);
    for (const a of archs.slice(0, limit)) add(a, "Archetype");
    if (out.length < limit) {
      const names = th.data.cards.filter(c => c.name.toLowerCase().includes(low)).sort((a, b) => a.name.length - b.name.length);
      for (const c of names) { if (out.length >= limit) break; add(c.name, "Card"); }
    }
    return out;
  }
  // pre: the words to start with
  function openThemePicker(pre) {
    drawerCtx = {mode: "theme-pick"};
    openDrawer("Track an archetype or card",
      '<p class="small" style="margin:0 0 12px">Every card of an archetype (Shaddoll, Blue-Eyes…) or of a monster (Dark Magician Girl…): the cards that belong to it, and the support cards that name it. ' +
      "Like a set goal, it shows what you have, what's missing and what that costs. One copy of each card, any printing.</p>" +
      '<label class="field"><span>Archetype or card name</span><input class="input" id="thQ" autocomplete="off" autofocus placeholder="e.g. Shaddoll or Dark Magician Girl" value="' + esc(pre || "") + '"></label>' +
      '<div class="field" style="margin-top:12px"><span>Track it in</span><div class="theme-langs">' + THEME_LANGS.map(l => '<label class="check-row"><input type="checkbox" class="check" data-th-lang="' + l + '"' + (l === "English" ? " checked" : "") + "> <span>" + l + "</span></label>").join("") + "</div>" +
      '<p class="hint" style="margin:4px 0 0">Each language is its own goal: a Japanese copy counts for the Japanese one only.</p></div>' +
      '<div id="thOut" style="margin-top:12px"></div>');
    const langs = () => Array.from(document.querySelectorAll("#drawerBody [data-th-lang]")).filter(b => b.checked).map(b => b.dataset.thLang);
    const run = () => {
      const out = $("thOut");
      if (!out) return;
      if (!th.data) { out.innerHTML = '<p class="small">' + (th.failed ? "Couldn't load the list of cards right now (it comes with the nightly update). Try again in a few minutes." : "Loading the list of cards…") + "</p>"; loadThemes(); return; }
      const text = $("thQ").value.trim();
      if (text.length < 2) { out.innerHTML = ""; return; }
      const list = themeSuggestions(text, 8);
      out.innerHTML = !list.length ? '<div class="notice">No archetype or card name has "' + esc(text) + '" in it. Check the spelling, or try fewer letters.</div>'
        : '<div class="results">' + list.map((x, i) => '<div class="result static theme-sug"><span class="result-name">' + esc(x.k) + "</span>" +
          '<span class="result-meta">' + esc(x.what) + " · " + plural(x.members, "card") + (x.support ? " and " + plural(x.support, "support card") : "") + "</span>" +
          '<span class="result-actions"><button class="btn" type="button" data-th-pick="' + i + '">Track it</button></span></div>').join("") + "</div>";
      out.querySelectorAll("[data-th-pick]").forEach(b => b.addEventListener("click", () => {
        const l = langs();
        if (!l.length) { toast("Tick at least one language.", {kind: "error"}); return; }
        closeDrawer();
        addThemeGoals(list[+b.dataset.thPick].k, l);
      }));
    };
    let timer = null;
    $("thQ").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    run();
  }

  /* ----- "See the cards" ----- */
  function openThemeCards(k, l) {
    const g = themeById(themeId({k, l})) || {k, l};
    drawerCtx = {mode: "theme-cards", k, l};
    if (!th.data) { openDrawer(themeLabel(g), '<p class="small">Loading the list of cards…</p>'); loadThemes(); return; }
    const st = themeStatus(g);
    const rowHTML = (x, i, part) => {
      const pics = l === "English" ? (x.p ? productPics(x.p, "200w") : namePics(x.c.name, "200w")) : {list: [x.row && x.row.img].filter(Boolean).concat(namePics(x.c.name, "200w").list)};
      const where = l === "English" ? (x.p ? x.p.group.name : "") : (x.oc && ocgFindSet(x.oc.set.id) ? ocgFindSet(x.oc.set.id).name : x.oc ? x.oc.number : "");
      return '<div class="theme-card' + (x.qty ? " have" : "") + '"><span class="sleeve">' + imgTag(pics, x.c.name) + "</span><div>" +
        "<b>" + esc(x.c.name) + "</b>" +
        '<span class="small">' + (x.qty ? '<span class="cs-own">You have ' + x.qty + "</span>" : !x.printed ? "Never printed in " + esc(l) : x.v != null ? "Missing · cheapest " + esc(usd(x.v)) + (where ? " (" + esc(where) + ")" : "") : "Missing · no price yet") + "</span></div>" +
        (x.qty || !x.printed ? "" : x.wanted ? '<span class="on-list">On want list</span>' : '<button class="btn btn-small" type="button" data-th-want="' + part + ":" + i + '">Want</button>') + "</div>";
    };
    const order = list => list.map((x, i) => ({x, i})).sort((a, b) => (!!b.x.printed - !!a.x.printed) || (!!a.x.qty - !!b.x.qty) || a.x.c.name.localeCompare(b.x.c.name));
    const html = (list, part) => order(list).map(({x, i}) => rowHTML(x, i, part)).join("");
    openDrawer(themeLabel(g),
      '<p class="small" style="margin:0 0 6px">' + st.m.have + " of " + st.m.total + " " + esc(k) + " cards" + (st.s.total ? ", " + st.s.have + " of " + st.s.total + " support cards" : "") +
        (st.cost ? " · about " + esc(usd(st.cost)) + " to finish" : "") + ". Cards from YGOPRODeck" + (th.data.generated ? ", " + esc(fmtDate(th.data.generated)) : "") + "; prices from " +
        (l === "English" ? "TCGplayer" : l === "Japanese" ? "BIGWEB" : "Bunjang") + ".</p>" +
      (st.members.length ? '<h3 class="mk-h">' + esc(k) + " cards</h3>" + '<div class="theme-cards">' + html(st.members, "m") + "</div>" : "") +
      (st.support.length ? '<h3 class="mk-h">Support cards <span class="small">(cards whose text names ' + esc(k) + ")</span></h3>" + '<div class="theme-cards">' + html(st.support, "s") + "</div>" : "") +
      (!st.members.length && !st.support.length ? '<div class="notice">No cards found for ' + esc(k) + ".</div>" : ""));
    document.querySelectorAll("#drawerBody [data-th-want]").forEach(b => b.addEventListener("click", () => {
      const [part, i] = b.dataset.thWant.split(":");
      const x = (part === "m" ? st.members : st.support)[+i];
      const f = x && themeWantFields(x, g);
      if (!f) return;
      addWant(f, {keepNotes: true});
      save(); renderTabs();
      if (l !== "English") refreshOcgPrices();
      b.outerHTML = '<span class="on-list">On want list</span>';
      toast("Added " + x.c.name + " to your want list.");
    }));
  }

  /* ----- in Card search: "Track every Shaddoll card" ----- */
  function themeHintHTML(text) {
    const t = String(text || "").trim();
    if (t.length < 3 || !themesReady()) return "";
    const low = t.toLowerCase();
    const k = th.data.archLower.get(low) || (th.data.cards.find(c => c.name.toLowerCase() === low) || {}).name || t;
    const n = themeCards(k);
    if (n.members.length < 3) return "";
    return '<div class="theme-hint"><span><b>' + esc(k) + "</b>: " + plural(n.members.length, "card") + (n.support.length ? " and " + plural(n.support.length, "support card") : "") + ".</span>" +
      (THEME_LANGS.every(l => isThemeGoal(k, l)) ? '<span class="on-list">Tracked</span>' : '<button type="button" class="btn btn-small" data-theme-add="' + esc(k) + '">Track every ' + esc(k) + " card</button>") + "</div>";
  }

  // On a card's page: "Track every Shaddoll card" (its archetype), or the card's own name when other cards carry it
  function themeLinksHTML(r) {
    if (!r || r.sealed || !th.data) return "";
    const c = th.data.byKey.get(photoKey(lookupName(r.name)));
    if (!c) return "";
    const ks = [c.arch, c.name].concat(c.as).filter((k, i, a) => k && a.indexOf(k) === i && themeCards(k).members.length >= 3);
    return ks.length ? '<p class="small theme-links">Track every card of ' + ks.slice(0, 3).map(k => '<button type="button" class="link-btn" data-theme-add="' + esc(k) + '">' + esc(k) + "</button>").join(", ") + "</p>" : "";
  }
