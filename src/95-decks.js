  /* ======================= Deck check ======================= */
  let deckDraft = null;   // the deck being edited: {id, name, text}
  let deckResult = null;
  const normCardName = s => lookupName(String(s || "")).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  function productsByName() {
    if (!catalog.byName) {
      catalog.byName = new Map();
      for (const p of catalog.products) if (!p.sealed) pushMap(catalog.byName, normCardName(cleanName(p.name, p.rarity)), p);
    }
    return catalog.byName;
  }
  function cheapestByName(key) {
    if (!catalog) return null;
    let best = null;
    for (const p of productsByName().get(key) || []) {
      for (const ed in p.prices) {
        const v = firstPrice(p.prices[ed]);
        if (v != null && (!best || v < best.price)) best = {price: v, product: p, edition: ed};
      }
    }
    return best;
  }
  // Deck lists in the usual text forms: "3 Ash Blossom & Joyous Spring", "Ash Blossom x3", or one name per line,
  // with optional Main / Extra / Side Deck headings.
  function parseDeckText(text) {
    const sections = [], unread = [];
    let cur = null;
    const start = name => { cur = sections.find(x => x.name === name); if (!cur) sections.push(cur = {name, cards: []}); };
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line || /^(\/\/|--)/.test(line)) continue;
      const sec = line.match(/^[#!]?\s*(main|extra|side)(\s*deck)?\s*:?\s*(\(\d+\))?\s*:?$/i);
      if (sec) { start(sec[1][0].toUpperCase() + sec[1].slice(1).toLowerCase() + " Deck"); continue; }
      if (/^#/.test(line) || /^(monsters?|spells?|traps?)(\s*cards?)?\s*:?\s*(\(\d+\))?\s*:?$/i.test(line)) continue;
      let m, name, count;
      if ((m = line.match(/^(\d{1,2})\s*[xX×]?\s+(.+)$/))) { count = +m[1]; name = m[2]; }
      else if ((m = line.match(/^(.+?)\s*[xX×]\s*(\d{1,2})$/))) { name = m[1]; count = +m[2]; }
      else { name = line; count = 1; }
      const key = normCardName(name);
      if (!key || !count || /^\d+$/.test(key)) { unread.push(line); continue; }
      if (!cur) start("Main Deck");
      const same = cur.cards.find(c => c.key === key);
      if (same) same.count += count; else cur.cards.push({name: name.trim(), key, count});
    }
    return {sections, unread};
  }
  function parseYdk(text) {
    const out = {"Main Deck": [], "Extra Deck": [], "Side Deck": []};
    let cur = "Main Deck";
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (/^#main/i.test(line)) cur = "Main Deck";
      else if (/^#extra/i.test(line)) cur = "Extra Deck";
      else if (/^!side/i.test(line)) cur = "Side Deck";
      else if (/^\d{3,10}$/.test(line)) out[cur].push(+line);
    }
    return out;
  }
  // "ydke://" links (from Dueling Book, Duelists Unite and others): three base64 lists of 32-bit card IDs.
  function parseYdke(link) {
    const m = String(link || "").trim().match(/^ydke:\/\/([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!([A-Za-z0-9+/=]*)!?$/);
    if (!m) return null;
    const ids = b64 => {
      const bin = atob(b64), out = [];
      for (let i = 0; i + 3 < bin.length; i += 4) {
        out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
      }
      return out;
    };
    try { return {"Main Deck": ids(m[1]), "Extra Deck": ids(m[2]), "Side Deck": ids(m[3])}; } catch (e) { return null; }
  }
  // A deck file has only card IDs, "#main"-style headings and comments. A list of card names with
  // "#main" headings is read as names.
  const looksLikeIds = text => /^\s*ydke:\/\//i.test(text) || (/^\s*\d{3,10}\s*$/m.test(text) &&
    String(text).split(/\r?\n/).every(line => /^\s*(#.*|!.*|\d{3,10})?\s*$/.test(line)));
  // Deck files list Konami card IDs; YGOPRODeck turns them into names (remembered in this browser).
  async function cardNamesFor(ids) {
    const cache = readJSON(CARD_IDS_KEY, {}) || {};
    const need = ids.filter(id => !cache[id]);
    for (let i = 0; i < need.length; i += 50) {
      const chunk = need.slice(i, i + 50);
      const res = await fetch(YGOPRODECK + "/cardinfo.php?id=" + chunk.join(","));
      const json = await res.json().catch(() => null);
      if (!res.ok && !(json && json.error)) throw new Error("YGOPRODeck answered " + res.status);
      for (const c of (json && json.data) || []) {
        if (!c || !c.name) continue;
        cache[c.id] = c.name;
        for (const im of c.card_images || []) if (im && im.id) cache[im.id] = c.name;
      }
    }
    try { localStorage.setItem(CARD_IDS_KEY, JSON.stringify(cache)); } catch (e) { /* optional */ }
    return cache;
  }
  async function idsToDeckText(sections) {
    const all = Array.from(new Set([].concat(...Object.values(sections))));
    const names = all.length ? await cardNamesFor(all) : {};
    let text = "";
    for (const [sec, list] of Object.entries(sections)) {
      if (!list.length) continue;
      const counts = new Map();
      for (const id of list) { const n = names[id] || "Unknown card (ID " + id + ")"; counts.set(n, (counts.get(n) || 0) + 1); }
      text += (text ? "\n" : "") + sec + "\n" + Array.from(counts).map(([n, c]) => c + " " + n).join("\n") + "\n";
    }
    return text;
  }
  function checkDeck(parsed) {
    const owned = new Map();   // copies not yet counted toward an earlier part of the deck
    // (Rush Duel cards can't be played in an OCG/TCG deck, even with the same name)
    for (const r of collection) { const k = r.sealed || isRushNo(r.number) ? "" : normCardName(r.name); if (k) owned.set(k, (owned.get(k) || 0) + r.qty); }
    let need = 0, have = 0, cost = 0, unpriced = 0;
    const sections = parsed.sections.map(sec => {
      const rows = sec.cards.map(c => {
        const left = owned.get(c.key) || 0;
        const got = Math.min(left, c.count);
        owned.set(c.key, left - got);
        const best = cheapestByName(c.key);
        const inCatalog = !!(catalog && productsByName().has(c.key));
        const missing = c.count - got;
        if (missing && best) cost += best.price * missing; else if (missing) unpriced += missing;
        return {name: inCatalog ? lookupName(cleanName(productsByName().get(c.key)[0].name, productsByName().get(c.key)[0].rarity)) : c.name,
          key: c.key, need: c.count, have: got, missing, best, known: inCatalog || got > 0};
      });
      const n = rows.reduce((s, r) => s + r.need, 0), h = rows.reduce((s, r) => s + r.have, 0);
      need += n; have += h;
      return {name: sec.name, rows, need: n, have: h};
    });
    return {sections, unread: parsed.unread, need, have, missing: need - have, cost, unpriced};
  }
  function renderDecks() {
    const panel = $("panel-decks");
    if (settings.deckView === "ideas") { renderDeckIdeas(); return; }
    if (!deckDraft) {
      const k = decks.find(x => x.id === settings.deckId);
      deckDraft = k ? {id: k.id, name: k.name, text: k.text} : {id: null, name: "", text: ""};
      deckResult = deckDraft.text.trim() && !looksLikeIds(deckDraft.text) ? checkDeck(parseDeckText(deckDraft.text)) : null;
    }
    const saved = decks.slice().sort((a, b) => a.name.localeCompare(b.name));
    panel.innerHTML = '<div class="panel-head"><div><h2>Deck check</h2><p>Paste a deck list or load a deck file to see which cards you already have and what the rest would cost.</p></div>' + deckViewSeg() + "</div>" +
      '<div class="deck-grid"><div class="box deck-edit">' +
      '<label class="field"><span>Deck name</span><input class="input" id="deckName" placeholder="e.g. Blue-Eyes" value="' + esc(deckDraft.name) + '"></label>' +
      '<label class="field" style="margin-top:10px"><span>Deck list</span><textarea class="input deck-text" id="deckText" spellcheck="false" placeholder="3 Ash Blossom &amp; Joyous Spring&#10;2 Called by the Grave&#10;1 Blue-Eyes White Dragon&#10;&#10;Extra Deck&#10;1 Blue-Eyes Spirit Dragon">' +
      esc(deckDraft.text) + "</textarea></label>" +
      '<p class="hint">One card per line with how many you need. Headings like "Extra Deck" and "Side Deck" are optional. You can also paste a ydke:// link.</p>' +
      '<div class="btn-row"><button class="btn btn-primary" type="button" data-deck="check">Check deck</button>' +
      '<button class="btn" type="button" data-deck="file">Load a deck file</button><input type="file" id="deckFile" accept=".ydk,.txt,.ydke,text/plain" hidden>' +
      '<button class="btn" type="button" data-deck="save">Save deck</button>' + (deckDraft.id ? '<button class="btn" type="button" data-deck="new">New deck</button>' : "") + "</div>" +
      (saved.length ? '<div class="saved-decks"><p class="small" style="margin:14px 0 6px">Saved decks</p>' + saved.map(k =>
        '<span class="deck-chip' + (k.id === deckDraft.id ? " on" : "") + '"><button type="button" data-deck-open="' + esc(k.id) + '">' + esc(k.name) + "</button>" +
        '<button type="button" class="x" data-deck-del="' + esc(k.id) + '" aria-label="Delete ' + esc(k.name) + '">&times;</button></span>').join("") + "</div>" : "") +
      '</div><div id="deckOut">' + deckResultHTML() + "</div></div>";
  }
  // The deck against a Forbidden & Limited list (Main, Extra and Side together): cards over their limit, and the
  // limited cards it plays. TCG for English play, OCG for Japanese and Korean; Settings remembers the choice.
  const BAN_MAX = {"Forbidden": 0, "Limited": 1, "Semi-Limited": 2};
  function deckBanCheck(res, list) {
    const b = banData();
    if (!b) return null;
    // (a list that couldn't be read yet isn't "everything allowed")
    if (!b.lists[list] || !Object.keys(b.lists[list]).length) return {list, missing: true};
    const counts = new Map();
    for (const sec of res.sections) for (const r of sec.rows) { const e = counts.get(r.key) || {name: r.name, n: 0}; e.n += r.need; counts.set(r.key, e); }
    const over = [], limited = [];
    for (const [key, e] of counts) {
      const hit = b.maps[list].get(key);
      if (!hit) { if (e.n > 3) over.push({name: e.name, n: e.n, st: "", max: 3}); continue; }   // (any card: 3 at most)
      const row = {name: e.name, n: e.n, st: hit.st, max: BAN_MAX[hit.st]};
      (e.n > row.max ? over : limited).push(row);
    }
    const rank = x => x.st ? BAN_MAX[x.st] : 3;
    const order = (x, y) => (rank(x) - rank(y)) || x.name.localeCompare(y.name);
    return {list, over: over.sort(order), limited: limited.sort(order), checked: (b.lastOk && b.lastOk[list]) || b.checked};
  }
  const deckBanList = () => settings.deckBan === "ocg" ? "ocg" : "tcg";
  function deckBanHTML(res) {
    const list = deckBanList();
    const seg = '<div class="seg seg-small" role="group" aria-label="Ban list">' + [["tcg", "TCG"], ["ocg", "OCG"]].map(([k, l]) =>
      '<button type="button" data-deck-ban="' + k + '" aria-pressed="' + (k === list) + '">' + l + "</button>").join("") + "</div>";
    const chk = deckBanCheck(res, list);
    let body;
    if (!chk) {
      const waiting = siteFileURL("banlist.js") && (!live.at || live.loading);
      // (when it arrives, the whole result is drawn again, so the table's tags show too)
      if (waiting) (live.loading || loadLive()).then(() => { if (settings.tab === "decks" && $("deckOut") && banData()) $("deckOut").innerHTML = deckResultHTML(); });
      body = '<p class="small" style="margin:0">' + (!siteFileURL("banlist.js") ? "Add the website's address in Settings to check the ban list."
        : waiting ? "Loading the ban list…" : "The ban list isn't available right now; it comes with the nightly update.") + "</p>";
    } else if (chk.missing) {
      body = '<p class="small" style="margin:0">The ' + BAN_LISTS[list] + " list isn't available yet; it comes with the nightly update.</p>";
    } else if (!chk.over.length) {
      body = '<p style="margin:0"><span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>Legal under the ' + BAN_LISTS[list] + " list</span>" +
        (chk.limited.length ? ' <span class="small">(it plays ' + esc(chk.limited.map(x => x.name + " ×" + x.n + ", " + x.st).join("; ")) + ")</span>" : "") + "</p>";
    } else {
      body = '<p style="margin:0"><b>Not legal under the ' + BAN_LISTS[list] + " list:</b></p><ul class=\"deck-ban\">" + chk.over.map(x => "<li><b>" + esc(x.name) + "</b>" +
        (!x.st ? ": " + x.n + " copies, and any card is 3 at most" : " is " + esc(x.st) + (x.max ? ": " + plural(x.max, "copy", "copies") + " allowed, the deck has " + x.n : ": none allowed, the deck has " + x.n)) + "</li>").join("") + "</ul>" +
        (chk.limited.length ? '<p class="small" style="margin:6px 0 0">Within their limit: ' + esc(chk.limited.map(x => x.name + " ×" + x.n + " (" + x.st + ")").join("; ")) + ".</p>" : "");
    }
    return '<div class="deck-ban-head"><b>Ban list</b>' + seg + "</div>" + body + (chk && !chk.missing ? '<p class="small" style="margin:6px 0 0">Main, Extra and Side Deck together, from YGOPRODeck, checked ' + esc(fmtDate(parseDate(chk.checked))) + ".</p>" : "");
  }
  const deckBanInner = res => res && !res.error && res.need ? deckBanHTML(res) : "";
  function deckResultHTML() {
    const res = deckResult;
    if (!res) return '<div class="chart-empty" style="text-align:left">Your results show up here.' + (catalog ? "" : SITE ? " Prices need TCGplayer's card list (reload the page)." : " Prices need TCGplayer data (Update TCGplayer Data).") + "</div>";
    if (res.error) return '<div class="notice" style="margin:0">' + esc(res.error) + "</div>";
    if (!res.need) return '<div class="notice" style="margin:0">No cards found in that list. Put one card per line, like "3 Ash Blossom &amp; Joyous Spring".</div>';
    const lines = res.sections.map(s => "<li><b>" + esc(s.name) + ":</b> you have " + s.have + " of " + s.need + "</li>").join("");
    const wantable = res.sections.reduce((n, s) => n + s.rows.filter(r => r.missing && r.best).length, 0);
    const pull = deckPullPlan();
    let html = '<div class="box"><ul class="deck-sum">' + lines + "</ul>" +
      (res.missing ? '<p style="margin:10px 0 0">You need <b>' + plural(res.missing, "more card") + "</b>" +
        (res.cost ? ", about <b>" + esc(usd(res.cost)) + "</b> at the cheapest TCGplayer prices" : "") +
        (res.unpriced ? " (" + plural(res.unpriced, "card") + " without a price)" : "") + ".</p>"
        : '<p style="margin:10px 0 0"><span class="status"><span class="status-icon good" aria-hidden="true">&#10003;</span>You have every card for this deck.</span></p>') +
      ((res.missing && wantable) || pull.cards ? '<div class="btn-row">' +
        (res.missing && wantable ? '<button class="btn btn-primary" type="button" data-deck="wants">Add the missing cards to my want list</button>' : "") +
        (pull.cards ? '<button class="btn' + (res.missing && wantable ? "" : " btn-primary") + '" type="button" data-deck="pull">Move the ' + plural(pull.cards, "card") + " I have into " + esc(pull.dest) + "</button>" : "") + "</div>" : "") +
      (res.have && !pull.cards && pull.dest ? '<p class="small" style="margin:8px 0 0">Your copies are already in ' + esc(pull.dest) + " (graded cards stay where they are).</p>" : "") + "</div>" +
      '<div class="box deck-ban-box" id="deckBan">' + deckBanInner(res) + "</div>";
    const bd = banData(), banMap = bd && bd.maps[deckBanList()];
    const banNote = r => { const h = banMap && banMap.get(r.key); return h ? ' <span class="ban-st ban-' + BAN_RANK[h.st] + ' ban-tag">' + esc(h.st) + "</span>" : ""; };
    for (const s of res.sections) {
      html += '<div class="table-wrap deck-table"><table class="data-table"><caption>' + esc(s.name) + " (" + s.need + ")</caption><thead><tr><th>Card</th>" +
        '<th class="num">Need</th><th class="num">Have</th><th class="num">Cheapest</th><th class="num">To buy</th></tr></thead><tbody>' +
        s.rows.map(r => "<tr" + (r.missing ? ' class="short"' : "") + "><td>" + esc(r.name) + banNote(r) + (r.known ? "" : '<span class="cell-sub">Not in TCGplayer\'s list. Check the spelling.</span>') +
          '</td><td class="num">' + r.need + '</td><td class="num">' + (r.missing ? r.have : '<span class="status-icon good" aria-hidden="true">&#10003;</span> ' + r.have) +
          '</td><td class="num">' + esc(r.best ? usd(r.best.price) : "") + '</td><td class="num">' + (r.missing ? r.missing + (r.best ? " for " + esc(usd(r.best.price * r.missing)) : "") : "") +
          "</td></tr>").join("") + "</tbody></table></div>";
    }
    if (res.unread && res.unread.length) html += '<p class="small">Couldn\'t read ' + plural(res.unread.length, "line") + ": " + esc(res.unread.slice(0, 5).join("; ")) + (res.unread.length > 5 ? "…" : "") + "</p>";
    return html;
  }
  async function runDeckCheck() {
    const text = $("deckText").value;
    deckDraft.text = text;
    deckDraft.name = $("deckName").value.trim();
    if (looksLikeIds(text)) {
      $("deckOut").innerHTML = '<p class="small">Looking up the cards on YGOPRODeck…</p>';
      try {
        const ids = /^\s*ydke:\/\//i.test(text) ? parseYdke(text.trim()) : parseYdk(text);
        if (!ids) throw new Error("bad link");
        const converted = await idsToDeckText(ids);
        if (!converted.trim()) {
          deckResult = {error: "There are no cards in this deck file or link."};
          $("deckOut").innerHTML = deckResultHTML();
          return;
        }
        deckDraft.text = converted;
      } catch (e) {
        deckResult = {error: "Couldn't look up the card IDs in this deck on YGOPRODeck (it needs an internet connection). You can paste the list as card names instead."};
        $("deckOut").innerHTML = deckResultHTML();
        return;
      }
    }
    deckResult = checkDeck(parseDeckText(deckDraft.text));
    renderDecks();
  }
  function saveDeck() {
    deckDraft.text = $("deckText").value;
    deckDraft.name = $("deckName").value.trim() || "Untitled deck";
    if (!deckDraft.text.trim()) { toast("There's no deck list to save yet."); return; }
    let k = deckDraft.id ? decks.find(x => x.id === deckDraft.id) : null;
    if (!k) { k = upgradeDeck({name: deckDraft.name, text: deckDraft.text}); decks.push(k); deckDraft.id = k.id; }
    Object.assign(k, {name: deckDraft.name, text: deckDraft.text, updated: new Date().toISOString()});
    settings.deckId = k.id;
    save();
    renderDecks();
    toast("Saved " + k.name + ".");
  }
  function deleteDeck(id) {
    const k = decks.find(x => x.id === id);
    if (!k) return;
    const before = decks.slice(), draft = deckDraft, showing = !!(draft && draft.id === id);
    decks = decks.filter(x => x !== k);
    if (showing) draft.id = null;
    if (settings.deckId === id) settings.deckId = null;
    save(); renderDecks();
    toast("Deleted " + k.name + ".", {action: "Undo", onAction: () => {
      decks = before;
      // Reconnect the list on screen only if it's still the deleted deck (not a new list or a loaded file).
      if (showing && deckDraft === draft && !draft.id) { draft.id = id; settings.deckId = id; }
      save(); renderDecks();
    }});
  }
  // The copies you have of this deck's cards, and where they'd go: a location named after the deck.
  function deckPullPlan() {
    const res = deckResult;
    const liveName = $("deckName") ? $("deckName").value.trim() : ((deckDraft && deckDraft.name) || "").trim();
    const dest = liveName ? "Deck: " + liveName : "";
    if (!res || !res.sections || !dest) return {cards: 0, dest, plan: []};
    const need = new Map();
    for (const s of res.sections) for (const r of s.rows) if (r.have) need.set(r.key, (need.get(r.key) || 0) + r.have);
    const plan = [];
    let cards = 0;
    // copies already in the deck's box count first; the rest come from wherever they are (cheapest copies first)
    for (const [key, n] of need) {
      const mine = collection.filter(r => !r.sealed && !r.grade && !isRushNo(r.number) && normCardName(r.name) === key);   // (graded slabs stay where they are; Rush Duel cards aren't for these decks)
      let left = n - mine.filter(r => sameLoc(r.location, dest)).reduce((s, r) => s + r.qty, 0);
      const from = mine.filter(r => !sameLoc(r.location, dest)).sort((a, b) => (marketValue(a).unit || 0) - (marketValue(b).unit || 0) || (!!a.grade - !!b.grade));
      for (const r of from) {
        if (left <= 0) break;
        const take = Math.min(left, r.qty);
        plan.push({id: r.id, qty: take});
        cards += take; left -= take;
      }
    }
    return {cards, dest, plan};
  }
  function deckPullIntoBox() {
    const pull = deckPullPlan();
    if (!pull.cards) { toast(pull.dest ? "Those cards are already in " + pull.dest + "." : "Give the deck a name first: the cards go into a location named after it."); return; }
    const res = moveCopies(pull.plan, pull.dest);
    save(); render();
    toast("Moved " + plural(res.cards, "card") + " into " + res.dest + ". Find them under that location in your collection.",
      {action: "Undo", onAction: () => { res.undo(); save(); render(); }});
  }
  function deckMissingToWants() {
    if (!deckResult || !deckResult.sections) return;
    const before = JSON.parse(JSON.stringify(wants));
    const totals = new Map();   // the same card missing in several parts of the deck
    for (const s of deckResult.sections) for (const r of s.rows) {
      if (!r.missing || !r.best) continue;
      const t = totals.get(r.key) || {best: r.best, qty: 0};
      t.qty += r.missing;
      totals.set(r.key, t);
    }
    let cards = 0;
    const name = (deckDraft && deckDraft.name) || "";
    for (const t of totals.values()) {
      addWant(Object.assign(wantFromProduct(t.best.product), {edition: "Any", qty: t.qty, notes: name ? "For " + name : ""}), {keepNotes: true});
      cards += t.qty;
    }
    save(); renderTabs(); renderWantBanner();
    toast("Added " + plural(totals.size, "card") + " (" + plural(cards, "copy", "copies") + ") to your want list.", {action: "Undo", onAction: () => {
      wants = before.map(upgradeWant).filter(Boolean); save(); render();
    }});
  }

  /* ======================= Decks you can build ======================= */
  // Looks up every card you own on YGOPRODeck (archetype, type, Extra Deck or not, TCG banlist, popularity), groups
  // them into the archetypes they belong to or support (cards whose text names it), and shows how close each deck is:
  // the archetype's most-played cards you own and the ones you'd need, with TCGplayer prices.
  const YGO_CARDS_KEY = "cardvault.v2.ygocards";
  const YGO_ARCH_KEY = "cardvault.v2.ygoarch";
  const ideas = {busy: false, step: "", result: null, error: "", open: new Set(), last: 0};
  const extraFrame = f => /fusion|synchro|xyz|link/.test(String(f || ""));
  const banLimit = b => b === "Banned" ? 0 : b === "Limited" ? 1 : b === "Semi-Limited" ? 2 : 3;
  // The plain card name: TCGplayer adds "(Starlight Rare)", "(Alternate Art)" and the like, sometimes two of them.
  const ygoName = plainName;
  const cardKey = n => ygoName(n).toLowerCase();
  function ygoStore(key) { const c = readJSON(key, {}); return c && typeof c === "object" && !Array.isArray(c) ? c : {}; }
  function ygoSave(key, c, max) {
    const keys = Object.keys(c);
    if (keys.length > max) keys.sort((a, b) => (c[a].t || 0) - (c[b].t || 0)).slice(0, keys.length - max).forEach(k => delete c[k]);
    try { localStorage.setItem(key, JSON.stringify(c)); } catch (e) { /* optional: looked up again next time */ }
  }
  // What we keep of a YGOPRODeck card: the names quoted in its text say which archetypes it supports.
  function ygoSlim(x) {
    const m = (x.misc_info && x.misc_info[0]) || {};
    const quoted = Array.from(new Set((String(x.desc || "").match(/"([^"]{2,40})"/g) || []).map(q => q.slice(1, -1))));
    return {id: x.id, name: x.name, frame: x.frameType || "", type: x.type || "", race: x.race || "", arch: x.archetype || "",
      ban: (x.banlist_info && x.banlist_info.ban_tcg) || "", views: num(m.views) || 0, tcg: !m.formats || m.formats.includes("TCG"), refs: quoted};
  }
  let ygoLast = 0;
  async function ygoJSON(params) {
    const wait = ygoLast + 150 - Date.now();   // (YGOPRODeck allows 20 requests a second; we stay well under)
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    ygoLast = Date.now();
    const res = await fetch(YGOPRODECK + "/cardinfo.php?" + params);
    const json = await res.json().catch(() => null);
    if (!res.ok) { if (json && json.error) return {data: []}; throw new Error("YGOPRODeck answered " + res.status); }
    return json || {data: []};
  }
  // Card details for these names, from the cache or YGOPRODeck (40 names a request).
  async function ygoCards(names) {
    const cache = ygoStore(YGO_CARDS_KEY), now = Date.now();
    const fresh = h => h && now - h.t < (h.c ? 30 : 7) * 86400000;
    const need = Array.from(new Set(names.map(cardKey))).filter(k => k && !fresh(cache[k]));
    const byKey = new Map(names.map(n => [cardKey(n), ygoName(n)]));
    for (let i = 0; i < need.length; i += 40) {
      const chunk = need.slice(i, i + 40);
      ideas.step = "Looking up your cards on YGOPRODeck (" + Math.min(i + 40, need.length) + " of " + need.length + ")…";
      refreshIdeasStatus();
      const json = await ygoJSON("misc=yes&name=" + encodeURIComponent(chunk.map(k => byKey.get(k)).join("|")));
      const found = new Map((json.data || []).map(x => [x.name.toLowerCase(), x]));
      for (const k of chunk) cache[k] = {t: now, c: found.has(k) ? ygoSlim(found.get(k)) : null};
    }
    // Names that differ only in punctuation ("Mystical Elf White Lightning" for "Mystical Elf - White Lightning",
    // "Evil Twin Challenge" for "Evil★Twin Challenge"): search by the name's longest word and compare letters and digits.
    const loose = n => String(n || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
    let misses = need.filter(k => !cache[k].c && !/^token\b|"/.test(k)).slice(0, 40);
    for (let i = 0; i < misses.length; i++) {
      const k = misses[i];
      if (cache[k].c) continue;
      const word = (byKey.get(k).match(/[A-Za-z0-9]{4,}/g) || []).sort((a, b) => b.length - a.length)[0];
      if (!word) continue;
      ideas.step = "Looking up cards with unusual names (" + (i + 1) + " of " + misses.length + ")…";
      refreshIdeasStatus();
      const json = await ygoJSON("misc=yes&fname=" + encodeURIComponent(word));
      const byLoose = new Map((json.data || []).map(x => [loose(x.name), x]));
      for (const m of misses) if (!cache[m].c && byLoose.has(loose(m))) cache[m] = {t: now, c: ygoSlim(byLoose.get(loose(m)))};
    }
    ygoSave(YGO_CARDS_KEY, cache, 4000);
    const out = new Map();
    for (const n of names) { const h = cache[cardKey(n)]; if (h && h.c) out.set(cardKey(n), h.c); }
    return out;
  }
  async function ygoArchetype(name) {
    const cache = ygoStore(YGO_ARCH_KEY), hit = cache[name];
    if (hit && Date.now() - hit.t < 14 * 86400000) return hit.cards;
    const json = await ygoJSON("misc=yes&archetype=" + encodeURIComponent(name));
    const cards = (json.data || []).map(ygoSlim).map(c => Object.assign(c, {refs: undefined}));
    cache[name] = {t: Date.now(), cards};
    ygoSave(YGO_ARCH_KEY, cache, 120);
    return cards;
  }
  async function ygoStaples() {
    const cache = ygoStore(YGO_ARCH_KEY), hit = cache["__staples"];
    if (hit && Date.now() - hit.t < 14 * 86400000) return hit.cards;
    const json = await ygoJSON("misc=yes&staple=yes");
    const cards = (json.data || []).map(ygoSlim).map(c => Object.assign(c, {refs: undefined}));
    cache["__staples"] = {t: Date.now(), cards};
    ygoSave(YGO_ARCH_KEY, cache, 120);
    return cards;
  }
  // The whole analysis. Returns {decks, themes, staples, unknown}.
  async function analyzeDeckIdeas() {
    const owned = new Map();   // card name (lower) -> {name, qty}
    for (const r of collection) {
      if (r.sealed || !r.name || isRushNo(r.number)) continue;   // (Rush Duel cards are another game's)
      const k = cardKey(r.name);
      const o = owned.get(k) || {name: ygoName(r.name), qty: 0};
      o.qty += r.qty;
      owned.set(k, o);
    }
    const info = await ygoCards(Array.from(owned.values()).map(o => o.name));
    // your cards by their YGOPRODeck name (two spellings of one card count together)
    const mineBy = new Map();   // YGOPRODeck name (lower) -> {c, qty}
    for (const [k, o] of owned) {
      const c = info.get(k);
      if (!c) continue;
      const e = mineBy.get(c.name.toLowerCase()) || {c, qty: 0};
      e.qty += o.qty;
      mineBy.set(c.name.toLowerCase(), e);
    }
    const have = k => mineBy.has(k) ? mineBy.get(k).qty : 0;
    // archetypes: the ones your cards belong to, and the ones your cards' text names
    const counts = new Map();
    const bump = (a, k, how) => { let e = counts.get(a); if (!e) counts.set(a, e = {members: new Set(), support: new Set()}); e[how].add(k); };
    for (const [k, {c}] of mineBy) {
      if (c.arch) bump(c.arch, k, "members");
    }
    const known = new Set(counts.keys());
    for (const [k, {c}] of mineBy) for (const ref of c.refs || []) if (known.has(ref) && ref !== c.arch) bump(ref, k, "support");
    const candidates = Array.from(counts.entries()).map(([a, e]) => ({arch: a, members: e.members, support: e.support, n: e.members.size + e.support.size}))
      .filter(x => x.members.size >= 2 || x.n >= 3).sort((a, b) => b.n - a.n).slice(0, 25);
    const staples = await ygoStaples().catch(() => []);
    const stapleKeys = new Set(staples.map(c => c.name.toLowerCase()));
    const decks = [];
    let i = 0;
    for (const cand of candidates) {
      i++;
      ideas.step = "Checking archetypes (" + i + " of " + candidates.length + "): " + cand.arch + "…";
      refreshIdeasStatus();
      let list;
      try { list = await ygoArchetype(cand.arch); } catch (e) { continue; }
      list = list.filter(c => c.tcg && banLimit(c.ban) > 0);
      if (!list.length) continue;
      const byViews = list.slice().sort((a, b) => b.views - a.views);
      const core = byViews.slice(0, Math.min(15, list.length));
      const coreOwned = core.filter(c => have(c.name.toLowerCase()) > 0);
      const mine = list.filter(c => have(c.name.toLowerCase()) > 0).map(c => ({c, qty: have(c.name.toLowerCase())}));
      const support = Array.from(cand.support).map(k => ({c: mineBy.get(k).c, qty: have(k)}));
      const playable = mine.concat(support).reduce((t, x) => t + Math.min(x.qty, banLimit(x.c.ban)), 0);
      const missing = core.filter(c => !have(c.name.toLowerCase())).map(c => {
        const best = catalog ? cheapestByName(normCardName(c.name)) : null;
        return {c, best};
      });
      decks.push({arch: cand.arch, list, core, coreOwned: coreOwned.length, mine, support, playable, missing,
        score: coreOwned.length / core.length, cost: missing.reduce((t, m) => t + (m.best ? m.best.price : 0), 0), unpriced: missing.filter(m => !m.best).length});
    }
    // closest first; an archetype with only a handful of cards can't fill a deck alone, so it ranks a little lower
    const rank = d => d.score * Math.min(1, d.core.length / 12);
    decks.sort((a, b) => rank(b) - rank(a) || b.playable - a.playable);
    // Monster types you have a lot of, outside the archetypes above (a Zombie or Dragon deck, say)
    const inDecks = new Set();
    for (const d of decks) { d.mine.forEach(x => inDecks.add(x.c.name.toLowerCase())); d.support.forEach(x => inDecks.add(x.c.name.toLowerCase())); }
    const races = new Map();
    for (const [k, {c, qty}] of mineBy) {
      if (inDecks.has(k) || !/monster/i.test(c.type) || stapleKeys.has(k)) continue;
      const e = races.get(c.race) || {race: c.race, cards: []};
      e.cards.push({c, qty});
      races.set(c.race, e);
    }
    const themes = Array.from(races.values()).filter(e => e.cards.length >= 6).sort((a, b) => b.cards.length - a.cards.length).slice(0, 8);
    const myStaples = staples.filter(c => have(c.name.toLowerCase())).map(c => ({c, qty: have(c.name.toLowerCase())})).sort((a, b) => b.c.views - a.c.views);
    const unknown = Array.from(owned.keys()).filter(k => !info.has(k)).length;
    return {decks, themes, staples: myStaples, unknown, cards: owned.size, at: Date.now()};
  }
  async function runDeckIdeas() {
    if (ideas.busy) return;
    ideas.busy = true; ideas.error = ""; ideas.step = "Starting…";
    renderDeckIdeas();
    try { ideas.result = await analyzeDeckIdeas(); ideas.last = collection.length; }
    catch (e) { ideas.error = "Couldn't reach YGOPRODeck (it needs an internet connection). Try again in a moment."; }
    ideas.busy = false;
    if (settings.tab === "decks" && settings.deckView === "ideas") renderDeckIdeas();
  }
  function refreshIdeasStatus() { const el = document.getElementById("ideasStatus"); if (el) el.textContent = ideas.step; }
  const deckViewSeg = () => '<div class="panel-tools"><div class="seg" role="group" aria-label="Deck check" id="deckViewSeg">' +
    '<button type="button" data-deckview="check" aria-pressed="' + (settings.deckView !== "ideas") + '">Check a deck</button>' +
    '<button type="button" data-deckview="ideas" aria-pressed="' + (settings.deckView === "ideas") + '">Decks I can build</button></div></div>';
  function renderDeckIdeas() {
    const panel = $("panel-decks");
    const head = '<div class="panel-head"><div><h2>Decks I can build</h2><p>Every card you own, grouped into the archetypes they belong to or support, with how close each deck is.</p></div>' + deckViewSeg() + "</div>";
    if (!collection.some(r => !r.sealed)) { panel.innerHTML = head + emptyPanel("No cards yet", "Add cards to your collection and Card Vault shows which decks they could make."); return; }
    if (ideas.busy) { panel.innerHTML = head + '<div class="box"><p id="ideasStatus" role="status" style="margin:0">' + esc(ideas.step) + "</p></div>"; return; }
    if (!ideas.result) {
      panel.innerHTML = head + '<div class="box">' + (ideas.error ? '<div class="notice" style="margin:0 0 12px">' + esc(ideas.error) + "</div>" : "") +
        '<p style="margin:0 0 10px">Card Vault looks up each of your cards on YGOPRODeck (its archetype, type and how popular it is), then shows the decks your collection is closest to, the key cards you\'re missing and what they\'d cost.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" type="button" data-ideas="run">Find decks in my collection</button></div>' +
        '<p class="small" style="margin:10px 0 0">The first time takes a little while for a big collection; after that it\'s quick (the details are kept for a month).</p></div>';
      return;
    }
    const res = ideas.result;
    const stale = ideas.last !== collection.length;
    let html = head + '<p class="small" style="margin:-6px 0 12px">From ' + plural(res.cards, "different card") + (res.unknown ? " (" + res.unknown + " not found on YGOPRODeck)" : "") +
      (stale ? '. Your collection changed since: <button type="button" class="link-btn" data-ideas="run">check again</button>.' : '. <button type="button" class="link-btn" data-ideas="run">Check again</button>') + "</p>";
    if (!res.decks.length) html += '<div class="notice">None of your cards share an archetype yet. As your collection grows, the decks it could make show up here.</div>';
    html += res.decks.map((dk, i) => ideaHTML(dk, i)).join("");
    if (res.themes.length) {
      html += '<h3 class="idea-h">Other themes in your collection</h3><p class="small" style="margin:0 0 8px">Monster types you have a lot of, outside the archetypes above: a starting point for a type-based deck.</p>' +
        res.themes.map(t => '<div class="box" style="margin-bottom:8px"><b>' + esc(t.race) + "</b> " + '<span class="small">(' + plural(t.cards.length, "card") + ")</span>" +
          '<div class="idea-cards">' + t.cards.sort((a, b) => b.c.views - a.c.views).slice(0, 30).map(x => '<span class="idea-chip">' + esc(x.c.name) + (x.qty > 1 ? " ×" + x.qty : "") + "</span>").join("") + "</div></div>").join("");
    }
    if (res.staples.length) {
      html += '<h3 class="idea-h">Staples you own (they fit almost any deck)</h3><div class="idea-cards">' +
        res.staples.map(x => '<span class="idea-chip">' + esc(x.c.name) + (x.qty > 1 ? " ×" + x.qty : "") + "</span>").join("") + "</div>";
    }
    html += '<p class="small" style="margin-top:14px">Card details, archetypes, popularity and the TCG banlist come from YGOPRODeck. "Key cards" are an archetype\'s most-viewed cards there; prices are the cheapest TCGplayer printing.</p>';
    panel.innerHTML = html;
  }
  function ideaHTML(dk, i) {
    const open = ideas.open.has(dk.arch);
    const pct = Math.round(dk.score * 100);
    const chip = (x, cls) => '<span class="idea-chip' + (cls ? " " + cls : "") + (extraFrame(x.c.frame) ? " extra" : "") + '" title="' + esc(x.c.type) + (x.c.ban ? ", " + esc(x.c.ban) : "") + '">' +
      esc(x.c.name) + (x.qty > 1 ? " ×" + x.qty : "") + "</span>";
    return '<article class="idea"><button type="button" class="idea-toggle" aria-expanded="' + open + '" data-idea="' + esc(dk.arch) + '">' +
      '<span style="min-width:0"><span class="idea-name">' + esc(dk.arch) + '</span><span class="idea-sub">' + plural(dk.mine.length, "card") + " from the archetype" +
      (dk.support.length ? " + " + dk.support.length + " that support it" : "") + ", " + plural(dk.playable, "copy", "copies") + "</span></span>" +
      '<span class="set-prog"><span class="progress" aria-hidden="true"><span style="width:' + pct + '%"></span></span><span class="set-count"><b>' + dk.coreOwned + " of " + dk.core.length + "</b> key cards</span></span>" +
      '<span class="set-cost">' + (!dk.missing.length ? "<b>All key cards</b>" :
        dk.unpriced === dk.missing.length ? "<b>No price yet</b><small>for the " + dk.missing.length + " missing</small>" :
        "<b>" + esc(usd(dk.cost)) + (dk.unpriced ? "+" : "") + "</b><small>for the " + dk.missing.length + " missing" + (dk.unpriced ? " (" + dk.unpriced + " unpriced)" : "") + "</small>") + "</span>" +
      '<span class="caret" aria-hidden="true"></span></button>' +
      (open ? '<div class="idea-body">' +
        '<h4 class="idea-h">Your ' + esc(dk.arch) + " cards</h4><div class=\"idea-cards\">" + dk.mine.sort((a, b) => b.c.views - a.c.views).map(x => chip(x)).join("") + "</div>" +
        (dk.support.length ? '<h4 class="idea-h">Your cards that support it</h4><div class="idea-cards">' + dk.support.map(x => chip(x, "support")).join("") + "</div>" : "") +
        (dk.missing.length ? '<h4 class="idea-h">Key cards you don\'t have</h4><table class="idea-miss"><tbody>' + dk.missing.map(m =>
          "<tr><td>" + esc(m.c.name) + (extraFrame(m.c.frame) ? ' <span class="small">(Extra Deck)</span>' : "") + (m.c.ban ? ' <span class="small">(' + esc(m.c.ban) + ")</span>" : "") +
          '</td><td class="num">' + (m.best ? esc(usd(m.best.price)) : '<span class="small">no price</span>') + "</td><td class=\"num\">" +
          (m.best ? (wants.some(w => w.productId === m.best.product.id) ? '<span class="on-list">On want list</span>' : '<button class="btn btn-small" type="button" data-idea-want="' + m.best.product.id + '">Want</button>') : "") + "</td></tr>").join("") + "</tbody></table>" : "") +
        '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" type="button" data-idea-build="' + esc(dk.arch) + '">Build a starter list</button>' +
        (dk.missing.some(m => m.best) ? '<button class="btn" type="button" data-idea-wants="' + esc(dk.arch) + '">Add the missing key cards to my want list</button>' : "") + "</div>" +
        '<p class="small" style="margin:8px 0 0">The starter list makes a 40-card deck from the most-played ' + esc(dk.arch) + " cards: your copies (up to 3 of each, within the banlist) and one of each missing key card, then your staples if it's short. It opens in Check a deck, where you can change it and save it.</p>" +
        "</div>" : "") + "</article>";
  }
  // A first deck list of 40: the archetype's most-played cards (your copies, up to 3 within the banlist, and one of
  // each missing key card), then your staples if it's short. Extra Deck up to 15.
  function starterList(dk) {
    const main = new Map(), extra = new Map();
    const add = (c, n) => {
      const to = extraFrame(c.frame) ? extra : main;
      const cur = to.get(c.name) || 0;
      const room = extraFrame(c.frame) ? 15 - Array.from(extra.values()).reduce((t, v) => t + v, 0) : 60 - Array.from(main.values()).reduce((t, v) => t + v, 0);
      const take = Math.max(0, Math.min(n, banLimit(c.ban) - cur, room));
      if (take) to.set(c.name, cur + take);
    };
    const mainCount = () => Array.from(main.values()).reduce((t, v) => t + v, 0);
    const picks = dk.mine.concat(dk.support).map(x => ({c: x.c, n: Math.min(x.qty, extraFrame(x.c.frame) ? 1 : 3)}))
      .concat(dk.missing.map(m => ({c: m.c, n: 1}))).sort((a, b) => b.c.views - a.c.views);
    for (const x of picks) add(x.c, extraFrame(x.c.frame) ? x.n : Math.min(x.n, 40 - mainCount()));
    for (const x of (ideas.result && ideas.result.staples) || []) { if (mainCount() >= 40) break; if (!extraFrame(x.c.frame)) add(x.c, Math.min(x.qty, 40 - mainCount())); }
    const lines = m => Array.from(m.entries()).map(([n, q]) => q + " " + n).join("\n");
    return "Main Deck\n" + lines(main) + (extra.size ? "\n\nExtra Deck\n" + lines(extra) : "") + "\n";
  }
  function wireDeckIdeas(panel) {
    panel.addEventListener("click", e => {
      if (settings.tab !== "decks") return;
      const v = e.target.closest("[data-deckview]");
      if (v) { settings.deckView = v.dataset.deckview; saveSettings(); renderDecks(); if (settings.deckView === "ideas" && !ideas.result && !ideas.busy && ideasCached()) runDeckIdeas(); return; }
      if (settings.deckView !== "ideas") return;
      if (e.target.closest('[data-ideas="run"]')) { runDeckIdeas(); return; }
      const t = e.target.closest("[data-idea]");
      if (t) { const a = t.dataset.idea; if (ideas.open.has(a)) ideas.open.delete(a); else ideas.open.add(a); renderDeckIdeas(); const again = Array.from(document.querySelectorAll("[data-idea]")).find(x => x.dataset.idea === a); if (again) again.focus(); return; }
      const w = e.target.closest("[data-idea-want]");
      if (w && catalog) {
        const p = catalog.byId.get(+w.dataset.ideaWant);
        if (!p) return;
        addWant(Object.assign(wantFromProduct(p), {edition: "Any"}));
        save(); renderTabs(); renderDeckIdeas();
        return;
      }
      const all = e.target.closest("[data-idea-wants]");
      if (all && ideas.result) {
        const dk = ideas.result.decks.find(x => x.arch === all.dataset.ideaWants);
        if (!dk) return;
        const before = JSON.parse(JSON.stringify(wants));
        let n = 0;
        for (const m of dk.missing) if (m.best) { addWant(Object.assign(wantFromProduct(m.best.product), {edition: "Any", notes: "For " + dk.arch}), {keepNotes: true}); n++; }
        save(); renderTabs(); renderDeckIdeas();
        toast("Added " + plural(n, "card") + " to your want list.", {action: "Undo", onAction: () => { wants = before.map(upgradeWant).filter(Boolean); save(); render(); }});
        return;
      }
      const b = e.target.closest("[data-idea-build]");
      if (b && ideas.result) {
        const dk = ideas.result.decks.find(x => x.arch === b.dataset.ideaBuild);
        if (!dk) return;
        deckDraft = {id: null, name: dk.arch, text: starterList(dk)};
        settings.deckView = "check";
        saveSettings();
        deckResult = checkDeck(parseDeckText(deckDraft.text));
        renderDecks();
        toast("Here's a starter " + dk.arch + " list. Edit it, then Save deck to keep it.");
      }
    });
  }
  // (everything already looked up: the analysis runs by itself, without asking)
  function ideasCached() {
    const cache = ygoStore(YGO_CARDS_KEY);
    return collection.filter(r => !r.sealed).every(r => cache[cardKey(r.name)]);
  }

