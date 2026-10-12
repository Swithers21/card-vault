  /* ======================= Ban list & reprints ======================= */
  // The Forbidden & Limited lists come from the nightly update (banlist.js, read from YGOPRODeck), with the changes it
  // noticed night by night. English cards follow the TCG list; Japanese and Korean ones the OCG list (Rush Duel has
  // its own list, which isn't covered). Reprints: a newer printing of a card you own, in a set out in the last 90 days
  // or coming soon (from TCGplayer's sets, and the Japanese and Korean sets in the Market), since a reprint often
  // brings the older printings' price down.
  const BAN_RANK = {"Forbidden": 0, "Limited": 1, "Semi-Limited": 2};
  const BAN_LISTS = {tcg: "TCG", ocg: "OCG"};
  const banWord = st => st || "Unlimited";
  const banListOf = r => (r && (isOcg(r) || /^(Japanese|Korean)$/.test(r.language || "")) && !r.productId ? "ocg" : "tcg");
  function banData() {
    const b = live.ban;
    if (!b || b.format !== 1 || !b.lists) return null;
    if (!b.maps) {
      b.maps = {};
      for (const k of Object.keys(BAN_LISTS)) {
        const m = new Map();
        for (const [name, st] of Object.entries(b.lists[k] || {})) if (BAN_RANK[st] != null) m.set(normCardName(name), {name, st});
        b.maps[k] = m;
      }
    }
    return b;
  }
  // Every card name you have something to do with: in your collection, on your want list, in a saved deck
  function banYours() {
    const out = new Map();   // "tcg|key" -> {name, list, owned, want, deck}
    const add = (list, name, what, n) => {
      const key = normCardName(name);
      if (!key) return;
      const k = list + "|" + key, e = out.get(k) || {name: plainName(name), key, list, owned: 0, want: false, deck: ""};
      if (what === "owned") e.owned += n; else if (what === "want") e.want = true; else if (!e.deck) e.deck = n;
      out.set(k, e);
    };
    for (const r of collection) if (!r.sealed && !isRushNo(r.number)) add(banListOf(r), r.name, "owned", r.qty);
    for (const w of wants) if (!w.kind || w.kind === "card") { if (!isRushNo(w.number)) add(isRegionNumber(w.number || "") ? "ocg" : "tcg", w.name, "want"); }
    for (const d of decks) for (const sec of parseDeckText(d.text).sections) for (const c of sec.cards) add("tcg", c.name, "deck", d.name || "a saved deck");
    return out;
  }
  // The changes the nightly update noticed lately that touch your cards
  function banChangesForYou(days) {
    const b = banData();
    if (!b) return [];
    const mine = banYours(), cutoff = localDay(new Date(Date.now() - days * 86400000));
    return (b.changes || []).filter(c => c && c.day >= cutoff && BAN_LISTS[c.list] && mine.has(c.list + "|" + normCardName(c.name)))
      .map(c => Object.assign({}, c, {you: mine.get(c.list + "|" + normCardName(c.name)), key: "ban-" + c.list + "-" + normCardName(c.name) + "-" + c.day}));
  }
  const banChangeText = c => c.name + " is " + (c.now ? "now " + c.now : "no longer on the list") + " in the " + BAN_LISTS[c.list] + " (was " + banWord(c.was) + ").";
  const youText = e => [e.owned ? "you have " + e.owned : "", e.want ? "on your want list" : "", e.deck ? "in " + e.deck : ""].filter(Boolean).join(", ");
  // Reprints: newer printings of cards you own
  function reprintsForYou() {
    const today = localDay(new Date()), since = localDay(new Date(Date.now() - 90 * 86400000));
    const out = [];
    const seen = new Set();
    if (catalog) {
      const byName = productsByName();
      const ownedTcg = new Map();
      for (const r of collection) if (!r.sealed && r.productId) { const k = normCardName(r.name); const e = ownedTcg.get(k) || {recs: [], ids: new Set(), newest: ""}; e.recs.push(r); e.ids.add(r.productId); const p = catalog.byId.get(r.productId); if (p && p.group.published > e.newest) e.newest = p.group.published; ownedTcg.set(k, e); }
      for (const [k, e] of ownedTcg) {
        const fresh = (byName.get(k) || []).filter(p => !e.ids.has(p.id) && p.group.published && p.group.published.slice(0, 10) >= since && p.group.published > e.newest);
        if (!fresh.length) continue;
        fresh.sort((a, b) => b.group.published.localeCompare(a.group.published));
        const p = fresh[0];
        seen.add("tcg|" + k);
        out.push({region: "en", name: plainName(e.recs[0].name), recs: e.recs, set: p.group.name, day: p.group.published.slice(0, 10), soon: p.group.published.slice(0, 10) > today,
          rarity: p.rarity, price: firstPrice(catalogPrice(p, "")) , more: fresh.length - 1});
      }
    }
    if (ocgCd.data && ocgMk.data) {
      const ownedOcg = new Map();
      for (const r of collection) if (isOcg(r)) { const g = ocgRegion(r.number); const region = g.region === "JP" ? "jp" : "kr"; const k = region + "|" + csNorm(r.name); const e = ownedOcg.get(k) || {recs: [], sets: new Set(), region}; e.recs.push(r); e.sets.add(g.set); ownedOcg.set(k, e); }
      for (const [k, e] of ownedOcg) {
        const cards = (ocgCd.data.byName.get(k.slice(3)) || []).filter(c => c.region === e.region && !e.sets.has(c.set.prefix));
        let best = null;
        for (const c of cards) { const s = ocgFindSet(c.set.id); if (s && s.date && s.date >= since && (!best || s.date > best.s.date)) best = {c, s}; }
        if (!best) continue;
        const mineNewest = e.recs.map(r => { const s = ocgSetsOf(e.region).find(x => x.prefix === ocgRegion(r.number).set); return s ? s.date : ""; }).sort().pop() || "";
        if (best.s.date <= mineNewest) continue;
        out.push({region: e.region, name: plainName(e.recs[0].name), recs: e.recs, set: best.s.name, day: best.s.date, soon: best.s.date > today, rarity: best.c.rows.map(x => x.rarity).filter(Boolean).join(", "), price: null, more: 0});
      }
    }
    const worth = x => x.recs.reduce((s, r) => s + (marketValue(r).unit || 0) * r.qty, 0);
    return out.map(x => Object.assign(x, {worth: worth(x)})).sort((a, b) => (b.soon - a.soon) || (b.worth - a.worth)).slice(0, 80);
  }
  function renderWatch() {
    const body = insightBody();
    const b = banData();
    if (!live.at && !live.loading) loadLive();
    if (!ocgCd.data && collection.some(isOcg)) ocgCardsReady();
    if (!ocgMk.data && !ocgMk.loading && ocgMarketURL() && collection.some(isOcg)) loadOcgMarket();
    let html = '<div class="panel-head sub-head"><div><h3 class="sub-h">Ban list</h3><p>' + (b
      ? "Your cards on the Forbidden &amp; Limited lists (English cards: TCG; Japanese and Korean: OCG), from YGOPRODeck, checked " + esc(fmtDate(parseDate(b.checked))) + "."
      : siteFileURL("banlist.js") ? (live.at ? "The ban list arrives with the nightly update's next run." : "Loading the ban list…") : "Add the website's address in Settings to see the ban list.") + "</p></div></div>";
    if (b) {
      const mine = banYours(), changes = banChangesForYou(120);
      const hits = [];
      for (const e of mine.values()) { const h = b.maps[e.list] && b.maps[e.list].get(e.key); if (h) hits.push(Object.assign({}, e, {st: h.st})); }
      hits.sort((x, y) => (BAN_RANK[x.st] - BAN_RANK[y.st]) || x.name.localeCompare(y.name));
      if (changes.length) html += '<div class="notice" style="margin:0 0 12px"><b>Lately:</b> ' + changes.slice(0, 12).map(c => esc(banChangeText(c)) + ' <span class="small">(' + esc(youText(c.you)) + "; noticed " + esc(fmtShortDate(parseDay(c.day))) + ")</span>").join(" ") + "</div>";
      html += hits.length ? '<div class="table-wrap"><table class="table stack-table ban-table"><thead><tr><th>Card</th><th>List</th><th>Status</th><th>Yours</th></tr></thead><tbody>' +
        hits.map(e => "<tr><td><b>" + esc(e.name) + '</b></td><td data-label="List">' + BAN_LISTS[e.list] + '</td><td data-label="Status"><span class="ban-st ban-' + BAN_RANK[e.st] + '">' + esc(e.st) + "</span>" +
          (changes.some(c => c.list === e.list && normCardName(c.name) === e.key) ? ' <span class="small">(changed lately)</span>' : "") + '</td><td data-label="Yours">' + esc(youText(e)) + "</td></tr>").join("") + "</tbody></table></div>"
        : '<p class="small">None of your cards, wanted cards or saved decks\' cards are Forbidden, Limited or Semi-Limited right now.</p>';
    }
    const rp = reprintsForYou();
    html += '<div class="panel-head sub-head" style="margin-top:22px"><div><h3 class="sub-h">Reprints</h3><p>Cards you own with a newer printing out in the last 90 days or coming soon. A reprint often brings the older printings\' price down.</p></div></div>';
    html += !catalog ? '<p class="small">Waiting for TCGplayer\'s card list…</p>' : rp.length ? '<div class="table-wrap"><table class="table stack-table rp-table"><thead><tr><th>Card</th><th>New printing</th><th class="num">Yours now</th><th class="num">30 days</th></tr></thead><tbody>' +
      rp.map(x => {
        const r = x.recs.slice().sort((a, b2) => (marketValue(b2).unit || 0) - (marketValue(a).unit || 0))[0];
        const ch = r.productId && catalog ? catalogPrice(catalog.byId.get(r.productId), r.edition) : null;
        const m30 = ch && ch.market != null && ch.m30 ? (ch.market - ch.m30) / ch.m30 : null;
        return '<tr><td><button type="button" class="cell-name" data-watch="open" data-id="' + esc(r.id) + '">' + esc(x.name) + '</button><span class="cell-sub">' + esc(plural(x.recs.reduce((s, y) => s + y.qty, 0), "copy", "copies")) +
          (x.region === "en" ? "" : x.region === "jp" ? " · Japanese" : " · Korean") + "</span></td>" +
          '<td data-label="New printing">' + esc(x.set) + '<span class="cell-sub">' + (x.soon ? "Coming " : "Out ") + esc(fmtDate(parseDay(x.day))) + (x.rarity ? " · " + esc(x.rarity) : "") +
          (x.price != null ? " · " + esc(usd(x.price)) : "") + (x.more ? " · and " + plural(x.more, "more printing") : "") + "</span></td>" +
          '<td class="num" data-label="Yours now">' + esc(usd(x.worth)) + '</td><td class="num" data-label="30 days"' + (m30 == null ? " data-empty" : "") + ">" + (m30 == null ? "" : esc(pctText(m30))) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="small">No new printings of your cards in the last 90 days.</p>';
    body.innerHTML = html;
  }
  function watchAction(el) {
    if (el.dataset.watch === "open") openDetails(el.dataset.id);
  }

  /* ======================= Box openings ======================= */
  // Boxes and packs you opened: what you paid, the cards you pulled (added with "Cards you pulled", which also puts
  // them in your collection) and what they're worth now, so you can see which boxes paid off.
  const OPENING_KINDS = ["Booster box", "Booster packs", "Other"];
  const openingOpen = new Set();
  const pullFrom = (rec, qty) => ({name: rec.name, productId: rec.productId, number: rec.number, rarity: rec.rarity, setName: rec.setName, edition: rec.edition,
    condition: rec.condition, language: rec.language, qty, value: marketValue(rec).unit, image: rec.productId ? "" : rec.customImage || ""});
  const pullRecord = x => ({productId: x.productId, name: x.name, number: x.number, rarity: x.rarity, setName: x.setName, edition: x.edition, condition: x.condition,
    language: x.language, qty: x.qty, grade: null, customImage: x.image || null, sealed: false});
  function pullValueNow(x) { const v = marketValue(pullRecord(x)).unit; return v != null ? v : x.value; }
  function openingNumbers(o) {
    let value = 0, cards = 0, priced = 0, best = null;
    for (const x of o.pulls) {
      const u = pullValueNow(x);
      cards += x.qty;
      if (u != null) { value += u * x.qty; priced += x.qty; if (!best || u > best.u) best = {x, u}; }
    }
    return {cards, value, priced, best, net: o.cost != null ? value - o.cost : null};
  }
  const openingsSorted = () => openings.slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.added).localeCompare(String(a.added)));
  function renderOpenings() {
    const body = insightBody();
    const list = openingsSorted();
    const head = '<div class="panel-head sub-head"><div><h3 class="sub-h">Box openings</h3><p>Boxes and packs you opened: what you paid, what you pulled and what it\'s worth today.</p></div>' +
      '<div class="panel-tools"><button class="btn btn-small btn-primary" type="button" data-op-act="new">Log an opening</button></div></div>';
    if (!list.length) {
      body.innerHTML = head + emptyPanel("No openings yet", "Opened a booster box or some packs? Choose <b>Log an opening</b>: say what it was and what you paid, then type or scan the cards you pulled. " +
        "They go into your collection, and this page keeps a running score of whether the box paid off.");
      return;
    }
    let spent = 0, costed = 0, value = 0, cards = 0, costedValue = 0;
    for (const o of list) { const n = openingNumbers(o); value += n.value; cards += n.cards; if (o.cost != null) { spent += o.cost; costed++; costedValue += n.value; } }
    const fact = (v, label) => '<div class="fact"><b>' + v + "</b><span>" + label + "</span></div>";
    body.innerHTML = head + '<div class="facts sales-facts">' + fact(list.length.toLocaleString(), list.length === 1 ? "opening" : "openings") +
      fact(esc(usd(spent)), "spent" + (costed < list.length ? " (" + (list.length - costed) + " without a price)" : "")) +
      fact(esc(usd(value)), plural(cards, "card") + " pulled, worth today") + (costed ? fact(changeHTML(costedValue - spent, null, true), costed < list.length ? "on the ones with a price paid" : "overall") : "") + "</div>" +
      '<div class="op-list">' + list.map(openingHTML).join("") + "</div>" +
      '<p class="small">Today\'s value is each card\'s market price now (TCGplayer, or the Japanese and Korean shops), with your condition percentages; a card without one counts at what it was worth when you added it.</p>';
  }
  function openingHTML(o) {
    const n = openingNumbers(o), open = openingOpen.has(o.id);
    const perPack = o.packs && o.packs > 1 ? " · " + esc(usd(n.value / o.packs)) + " a pack" + (o.cost != null ? " (paid " + esc(usd(o.cost / o.packs)) + ")" : "") : "";
    const pulls = o.pulls.map((x, i) => ({x, i, u: pullValueNow(x)})).sort((a, b) => ((b.u || 0) - (a.u || 0)));
    return '<section class="op-item' + (open ? " open" : "") + '" data-opening="' + esc(o.id) + '">' +
      '<button type="button" class="op-head" data-op-act="toggle" aria-expanded="' + open + '"><span class="op-title"><b>' + esc(o.name) + "</b><span class=\"small\">" +
      esc([fmtDate(parseDay(o.date)), o.kind, o.packs ? plural(o.packs, "pack") : "", plural(n.cards, "card")].filter(Boolean).join(" · ")) + "</span></span>" +
      '<span class="op-nums"><span>' + (o.cost != null ? "Paid " + esc(usd(o.cost)) : '<span class="small">No price paid</span>') + "</span><span>Worth " + esc(usd(n.value)) + "</span>" +
      (n.net != null ? "<span>" + changeHTML(n.net, o.cost > 0 ? n.net / o.cost : null, true) + "</span>" : "") + "</span></button>" +
      (open ? '<div class="op-body">' +
        (n.best ? '<p class="small" style="margin:0 0 8px">Best pull: <b>' + esc(n.best.x.name) + "</b>" + (n.best.x.rarity ? " (" + esc(n.best.x.rarity) + ")" : "") + ", " + esc(usd(n.best.u)) + perPack + ".</p>" : "") +
        (o.notes ? '<p class="small" style="margin:0 0 8px">' + esc(o.notes) + "</p>" : "") +
        (pulls.length ? '<div class="table-wrap"><table class="table stack-table op-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>Card</th><th class="num">Qty</th><th class="num">Worth today, each</th><th class="num">When added</th><th><span class="sr">Remove</span></th></tr></thead><tbody>' +
          pulls.map(({x, i, u}) => '<tr><td class="c-thumb"><span class="sleeve"' + foilAttr(x.rarity) + ">" + imgTag(recordPics(pullRecord(x), "200w"), x.name) + "</span></td>" +
            "<td><b>" + esc(x.name) + '</b><span class="cell-sub">' + esc([x.number, x.rarity, x.edition === "No edition mark" ? "" : x.edition, x.condition === "Near Mint" ? "" : x.condition].filter(Boolean).join(", ")) + "</span></td>" +
            '<td class="num" data-label="Qty">' + x.qty + '</td><td class="num" data-label="Worth today, each"' + (u == null ? " data-empty" : "") + ">" + esc(u == null ? "" : usd(u)) + "</td>" +
            '<td class="num" data-label="When added"' + (x.value == null ? " data-empty" : "") + ">" + esc(x.value == null ? "" : usd(x.value)) + "</td>" +
            '<td><button type="button" class="icon-btn" data-op-act="unpull" data-i="' + i + '" aria-label="Take ' + esc(x.name) + ' off this opening (it stays in your collection)">&times;</button></td></tr>').join("") +
          "</tbody></table></div>" : '<p class="small" style="margin:0 0 8px">No cards yet.</p>') +
        '<div class="btn-row"><button type="button" class="btn btn-small btn-primary" data-op-act="pulls">Add cards you pulled</button><button type="button" class="btn btn-small" data-op-act="edit">Edit</button>' +
        '<button type="button" class="btn btn-small" data-op-act="delete">Delete</button></div>' +
        '<p class="small" style="margin:8px 0 0">The × takes a card off this opening only; deleting the opening leaves its cards in your collection.</p></div>' : "") + "</section>";
  }
  // Insights > Box openings, with this one open
  function showOpening(id) {
    openingOpen.add(id);
    settings.insightView = "openings";
    saveSettings();
    if (settings.tab !== "history") setTab("history"); else renderPanel();
    const el = document.querySelector('[data-opening="' + id + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({block: "start"});
  }
  function openOpeningForm(id) {
    const o = id ? openings.find(x => x.id === id) : null;
    drawerCtx = {mode: "opening", id: o ? o.id : null};
    const sealedMine = collection.filter(r => r.sealed).sort((a, b) => a.name.localeCompare(b.name));
    openDrawer(o ? "Edit opening" : "Log an opening",
      '<form id="opForm" class="stack" novalidate>' +
      (!o && sealedMine.length ? '<label class="field"><span>From your sealed products (takes one out of your collection)</span><select class="input" id="opFrom"><option value="">No, something else</option>' +
        sealedMine.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + (r.qty > 1 ? " (you have " + r.qty + ")" : "") + "</option>").join("") + "</select></label>" : "") +
      '<label class="field"><span>What you opened</span><input class="input" id="opName" maxlength="120" required placeholder="e.g. Quarter Century Bonanza booster box" value="' + esc(o ? o.name : "") + '"></label>' +
      '<div class="grid-2"><label class="field"><span>Kind</span><select class="input" id="opKind">' + options(OPENING_KINDS, o ? o.kind || "Booster box" : "Booster box") + "</select></label>" +
      '<label class="field"><span>Packs (optional)</span><input class="input" id="opPacks" type="number" min="1" max="999" step="1" value="' + (o && o.packs ? o.packs : "") + '"></label></div>' +
      '<div class="grid-2"><label class="field"><span>Date opened</span><input class="input" id="opDate" type="date" value="' + esc(o ? o.date : localDay(new Date())) + '"></label>' +
      '<label class="field"><span>What you paid, in all (US$)</span><input class="input" id="opCost" type="number" min="0" step="0.01" value="' + (o && o.cost != null ? o.cost : "") + '"></label></div>' +
      '<label class="field"><span>Notes (optional)</span><input class="input" id="opNotes" maxlength="300" value="' + esc(o ? o.notes : "") + '"></label>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">' + (o ? "Save" : "Next: the cards you pulled") + "</button></div></form>");
    const guessKind = name => /\bbox\b|ボックス/i.test(name) ? "Booster box" : /\bpacks?\b/i.test(name) ? "Booster packs" : null;
    if ($("opFrom")) $("opFrom").addEventListener("change", () => {
      const r = collection.find(x => x.id === $("opFrom").value);
      if (!r) return;
      $("opName").value = r.name;
      if (r.paid != null) $("opCost").value = r.paid;
      const k = guessKind(r.name);
      if (k) $("opKind").value = k;
    });
    $("opName").addEventListener("change", () => { const k = guessKind($("opName").value); if (k && !o) $("opKind").value = k; });
    $("opForm").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("opName").value.trim();
      if (!name) { toast("Say what you opened (a box name, say).", {kind: "error"}); $("opName").focus(); return; }
      const fields = {name, kind: $("opKind").value, packs: $("opPacks").value, date: $("opDate").value, cost: $("opCost").value, notes: $("opNotes").value.trim()};
      if (o) {
        const cur = openings.find(x => x.id === o.id);
        if (!cur) { closeDrawer(); toast("That opening was deleted meanwhile.", {kind: "error"}); return; }
        Object.assign(cur, upgradeOpening(Object.assign({}, cur, fields)), {id: cur.id, pulls: cur.pulls, added: cur.added, mod: cur.mod});
        save(); closeDrawer(); render();
        toast("Saved " + cur.name + ".");
        return;
      }
      const rec = $("opFrom") && $("opFrom").value ? collection.find(x => x.id === $("opFrom").value) : null;
      const op = upgradeOpening(Object.assign({id: newId(), pulls: [], added: new Date().toISOString()}, fields, rec ? {productId: rec.productId, setName: rec.setName} : {}));
      const beforeCollection = collection.slice(), beforeQty = rec ? rec.qty : 0;
      openings.push(op);
      if (rec) { rec.qty -= 1; if (rec.qty <= 0) collection = collection.filter(x => x !== rec); }
      save(); render();
      openingOpen.add(op.id);
      openBatch({opening: op.id});
      toast("Logged " + op.name + (rec ? " (one taken out of your sealed products)" : "") + ". Now add the cards you pulled.", {action: "Undo", onAction: () => {
        openings = openings.filter(x => x.id !== op.id);
        if (rec) { rec.qty = beforeQty; collection = beforeCollection; }
        save(); render();   // (the card list for it is set aside the next time "Add several cards" opens)
        if (drawerCtx && drawerCtx.mode === "batch") closeDrawer();
      }});
    });
  }
  function openingAction(act, el) {
    const box = el.closest("[data-opening]");
    const o = box ? openings.find(x => x.id === box.dataset.opening) : null;
    if (act === "new") { openOpeningForm(null); return; }
    if (!o) return;
    if (act === "toggle") {
      if (openingOpen.has(o.id)) openingOpen.delete(o.id); else openingOpen.add(o.id);
      renderOpenings();
      const again = document.querySelector('[data-opening="' + o.id + '"] .op-head');
      if (again) again.focus();
    } else if (act === "pulls") openBatch({opening: o.id});
    else if (act === "edit") openOpeningForm(o.id);
    else if (act === "unpull") {
      const i = +el.dataset.i, x = o.pulls[i];
      if (!x) return;
      const before = o.pulls.slice();
      o.pulls = o.pulls.filter((_, k) => k !== i);
      save(); renderOpenings();
      toast("Took " + x.name + " off " + o.name + ". It's still in your collection.", {action: "Undo", onAction: () => { const cur = openings.find(y => y.id === o.id); if (cur) { cur.pulls = before; save(); renderOpenings(); } }});
    } else if (act === "delete") {
      const before = openings.slice();
      openings = openings.filter(x => x !== o);
      save(); renderOpenings();
      toast("Deleted " + o.name + ". Its cards stay in your collection.", {action: "Undo", onAction: () => { openings = before; save(); render(); }});
    }
  }

