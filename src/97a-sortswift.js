  /* ======================= Export for SortSwift ======================= */
  // A file for SortSwift's inventory import (in SortSwift: Inventory, then Import), to sell cards through your shop there
  // (its eBay, TCGplayer and Shopify listings). SortSwift's catalog is TCGplayer's, so each row is a card's TCGplayer
  // product with its condition (NM, LP, MP, HP, DMG), language (EN, FR…) and printing (TCGplayer's names: 1st Edition,
  // Unlimited, Limited; Normal for one with no edition mark), how many, a price (your asking price on the sell list, or
  // today's market) and its cost (what you paid). Its importer's documented columns: productId with condition, language
  // and printing, and quantity; price and cost are optional. Each card remembers how many of its copies went (r.ssSent,
  // kept with the card, so on every device), so the next file can have only the rest. Graded cards, sealed products and
  // cards that aren't TCGplayer printings (Japanese and Korean ones) stay out.
  // (Cards coming the other way, SortSwift's own exports and its scans, go in with Import CSV: 97-import-export.)
  const SS_DOCS = "https://sortswift.com/docs/inventory/import/import-process";
  const SS_COND = {"Near Mint": "NM", "Lightly Played": "LP", "Moderately Played": "MP", "Heavily Played": "HP", "Damaged": "DMG", "Sealed": "NM"};
  const SS_LANG = {English: "EN", French: "FR", German: "DE", Italian: "IT", Spanish: "ES", Portuguese: "PT", Japanese: "JP", Korean: "KO"};
  const SS_EDITIONS = ["1st Edition", "Unlimited", "Limited", "1st Edition Foil", "Normal"];
  // The card's printing as TCGplayer (and so SortSwift) names it, or "" when Card Vault doesn't know which it is
  function ssPrinting(r, p) {
    const keys = Object.keys((p && p.prices) || {});
    const ed = r.edition === "No edition mark" ? "Normal" : String(r.edition || "").trim();
    if (ed && (SS_EDITIONS.includes(ed) || keys.includes(ed))) return ed;
    return keys.length === 1 ? keys[0] : "";
  }
  // Whether SortSwift can take a card of yours: {p (its TCGplayer product), printing} or {skip: why}
  function ssExportItem(r) {
    if (r.sealed) return {skip: "sealed"};
    if (r.grade) return {skip: "graded"};
    if (r.grading) return {skip: "away"};
    const p = r.productId && catalog ? catalog.byId.get(r.productId) : null;
    if (!p) return {skip: !r.productId && (ocgRegion(r.number) || r.language === "Japanese" || r.language === "Korean") ? "ocg" : "nomatch"};
    const printing = ssPrinting(r, p);
    return printing ? {p, printing} : {skip: "printing"};
  }
  const ssSentOf = r => Math.min(r.qty, r.ssSent || 0);
  // How many copies of a card go: on the sell list, as many as you said to sell; otherwise all of them; with onlyNew,
  // less the ones already sent
  function ssCopies(r, from, onlyNew) {
    const n = from === "sell" ? sellQty(r) : r.qty;
    return onlyNew ? Math.max(0, n - ssSentOf(r)) : n;
  }
  const ssx = {from: "all", ids: [], onlyNew: true, price: true, saved: null};
  // The cards it's for: your sell list, the cards you selected, or your whole collection
  function ssSource(from) {
    if (from === "sell") return collection.filter(r => r.sell);
    if (from === "selected") return collection.filter(r => ssx.ids.includes(r.id));
    return collection.slice();
  }
  // The file's rows, one for each TCGplayer printing, condition and language (two entries of the same card go together):
  // {rows: [{productId, name, number, condition, language, printing, qty, price, cost, recs: [{r, n}]}], copies, sent
  // (copies of these already sent), onlyNew, skipped: {why: [records]}}
  function ssExportPlan(from, onlyNew, withPrice) {
    const out = {rows: [], copies: 0, sent: 0, onlyNew: !!onlyNew, skipped: {ocg: [], nomatch: [], printing: [], graded: [], away: [], sealed: []}};
    const byKey = new Map();
    for (const r of ssSource(from)) {
      const x = ssExportItem(r);
      if (x.skip) { out.skipped[x.skip].push(r); continue; }
      out.sent += Math.min(ssSentOf(r), from === "sell" ? sellQty(r) : r.qty);
      const n = ssCopies(r, from, onlyNew);
      if (!n) continue;
      const condition = SS_COND[r.condition] || "NM", language = SS_LANG[r.language] || "EN";
      const ask = r.sell ? sellAsk(r) : null, mv = marketValue(r).unit;
      const price = !withPrice ? null : ask != null ? round2(ask) : mv != null && mv > 0 ? round2(mv) : null;
      const key = [r.productId, condition, language, x.printing].join("|");
      let row = byKey.get(key);
      if (!row) {
        row = {productId: r.productId, name: x.p.name, number: x.p.number, condition, language, printing: x.printing, qty: 0, price: null, cost: null, paidSum: 0, paidQty: 0, recs: []};
        byKey.set(key, row);
        out.rows.push(row);
      }
      row.qty += n;
      if (price != null) row.price = Math.max(row.price || 0, price);   // (two entries at different prices: the higher one)
      if (r.paid != null) { row.paidSum += r.paid * n; row.paidQty += n; }
      row.recs.push({r, n});
      out.copies += n;
    }
    for (const row of out.rows) row.cost = row.paidQty ? round2(row.paidSum / row.paidQty) : null;
    return out;
  }
  function ssExportText(rows) {
    const money = v => v == null ? "" : v.toFixed(2);
    const head = ["productId", "condition", "language", "printing", "quantity", "price", "cost"];
    // (no byte-order mark, so the first column's name reads exactly "productId")
    return [head.join(",")].concat(rows.map(x => [x.productId, x.condition, x.language, x.printing, x.qty, money(x.price), money(x.cost)].map(csvCell).join(","))).join("\r\n") + "\r\n";
  }

  const SSX_WHY = {
    ocg: n => plural(n, "Japanese or Korean card") + ": SortSwift's import goes by TCGplayer's cards, and these aren't on TCGplayer.",
    nomatch: n => plural(n, "card") + " not linked to a TCGplayer printing (Change printing on the card links it).",
    printing: n => plural(n, "card") + " without a printing (1st Edition, Unlimited…): set it on the card first.",
    graded: n => plural(n, "graded card") + ": a slab isn't one of TCGplayer's printings, so add those in SortSwift yourself.",
    away: n => plural(n, "card") + " away at a grading company.",
    sealed: n => plural(n, "sealed product") + ": add those in SortSwift yourself."};
  // opts: {from: "sell" | "selected" | "all", ids (the selected cards)}
  function openSsExport(opts) {
    opts = opts || {};
    ssx.ids = Array.from(opts.ids || selected);
    ssx.from = opts.from || (ssx.ids.length ? "selected" : collection.some(r => r.sell) ? "sell" : "all");
    ssx.onlyNew = true;
    ssx.saved = null;
    drawerCtx = {mode: "ss-export"};
    openDrawer("Export for SortSwift", '<div id="ssxBody"></div>');
    renderSsExport();
  }
  function renderSsExport() {
    const box = $("ssxBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "ss-export") return;
    if (!catalog) { box.innerHTML = '<div class="notice">This needs TCGplayer\'s card list, which hasn\'t loaded yet. Try again in a moment.</div>'; return; }
    const sellN = collection.filter(r => r.sell).length, selN = collection.filter(r => ssx.ids.includes(r.id)).length;
    if (ssx.from === "selected" && !selN) ssx.from = sellN ? "sell" : "all";
    if (ssx.from === "sell" && !sellN) ssx.from = "all";
    const all = ssExportPlan(ssx.from, false, ssx.price), sentAny = all.sent > 0;
    const onlyNew = sentAny && ssx.onlyNew;
    const plan = onlyNew ? ssExportPlan(ssx.from, true, ssx.price) : all;
    const sk = plan.skipped, left = Object.keys(sk).reduce((n, k) => n + sk[k].length, 0);
    const noPrice = ssx.price ? plan.rows.filter(x => x.price == null).reduce((n, x) => n + x.qty, 0) : 0;
    const last = parseDate(settings.ssExportAt);
    const radio = (name, value, on, text) => '<label class="check-row"><input type="radio" name="' + name + '" value="' + value + '"' + (on ? " checked" : "") + "> <span>" + text + "</span></label>";
    const sources = [sellN ? radio("ssxFrom", "sell", ssx.from === "sell", "Your sell list (" + plural(sellN, "card") + ", as many of each as you said to sell)") : "",
      selN ? radio("ssxFrom", "selected", ssx.from === "selected", "The " + plural(selN, "card") + " you selected") : "",
      radio("ssxFrom", "all", ssx.from === "all", "Your whole collection")].filter(Boolean);
    const rowText = x => [x.name, x.number, x.printing === "Normal" ? "" : x.printing, x.condition, x.language === "EN" ? "" : x.language].filter(Boolean).join(" · ") +
      (x.qty > 1 ? " ×" + x.qty : "") + (x.price != null ? ": " + usd(x.price) : "");
    box.innerHTML =
      '<p class="small" style="margin:0 0 12px">A file for SortSwift\'s inventory import, to sell cards through your shop there. SortSwift goes by TCGplayer\'s cards, so each one comes across as its TCGplayer printing ' +
      "with its condition, language and how many, a price, and what you paid as its cost.</p>" +
      (ssx.saved ? '<div class="notice good" role="status">Saved ' + plural(ssx.saved.copies, "card") + " for SortSwift at " + esc(fmtDateTime(ssx.saved.at)) + ". Import that file once in SortSwift (Inventory, then Import). " +
        'Didn\'t import it? <button type="button" class="link-btn" id="ssxUndo">Take it back</button> and Card Vault offers those cards again next time.</div>' : "") +
      '<div class="field"><span>Which cards</span><div class="theme-langs">' + sources.join("") + "</div></div>" +
      (sentAny ? '<div class="field"><span>Sent before</span><div class="theme-langs">' + radio("ssxWhich", "new", onlyNew, "Only the copies not sent to SortSwift yet") + radio("ssxWhich", "all", !onlyNew, "Everything, again") +
        '</div><p class="hint" style="margin:4px 0 0">' + plural(all.sent, "card") + " of these already went to SortSwift" + (last ? " (last file " + esc(fmtDateTime(last)) + ")" : "") + "." +
        (onlyNew ? "" : " <b>Importing them again may add them twice.</b>") + "</p></div>" : "") +
      '<label class="check-row" style="margin-top:12px"><input type="checkbox" class="check" id="ssxPrice"' + (ssx.price ? " checked" : "") + "> <span>Fill in a price: your asking price on the sell list, or today's TCGplayer market price</span></label>" +
      '<p class="hint" style="margin:2px 0 0">Untick it to let SortSwift\'s own pricing rules price them.</p>' +
      '<div class="pcx-sum" id="ssxSum">' +
      '<p class="pcx-line"><b>' + (plan.rows.length ? plural(plan.copies, "card") + " ready" : onlyNew ? "Nothing new for SortSwift" : "No cards SortSwift can take here") + "</b>" +
      (plan.rows.length ? " (" + plural(plan.rows.length, "row") + ")" : "") + "</p>" +
      (plan.rows.length ? '<ul class="pcx-left">' + plan.rows.slice(0, 8).map(x => "<li>" + esc(rowText(x)) + "</li>").join("") + (plan.rows.length > 8 ? "<li>…and " + (plan.rows.length - 8) + " more</li>" : "") + "</ul>" : "") +
      (noPrice ? '<p class="pcx-line small">' + plural(noPrice, "card has", "cards have") + " no price yet, so " + (noPrice === 1 ? "it goes" : "they go") + " without one.</p>" : "") +
      Object.keys(SSX_WHY).filter(k => sk[k].length).map(k => '<p class="pcx-line small">Left out: ' + esc(SSX_WHY[k](sk[k].length)) + "</p>").join("") +
      (left ? '<details class="more"><summary>Which cards are left out</summary><ul class="pcx-left">' +
        Object.keys(sk).flatMap(k => sk[k]).slice(0, 150).map(r => "<li>" + esc([r.name, r.number, r.language !== "English" ? r.language : ""].filter(Boolean).join(" · ")) + "</li>").join("") +
        (left > 150 ? "<li>…and " + (left - 150) + " more</li>" : "") + "</ul></details>" : "") +
      "</div>" +
      '<p class="hint" style="margin:12px 0 0"><b>In SortSwift:</b> Inventory, then Import, and choose this file. Leave <b>Direct Import</b> off, so the cards wait in staging for you to check before they go live. ' +
      "Each card remembers how many of its copies went (on every device you use), so next time the file can have only the rest.</p>" +
      '<div class="form-actions"><button type="button" class="btn btn-primary" id="ssxGo"' + (plan.rows.length ? "" : " disabled") + ">Download the file</button>" +
      '<a class="btn" target="_blank" rel="noopener" href="' + SS_DOCS + '">How SortSwift\'s import works</a></div>';
    box.querySelectorAll("[name=ssxFrom]").forEach(b => b.addEventListener("change", () => { ssx.from = b.value; renderSsExport(); }));
    box.querySelectorAll("[name=ssxWhich]").forEach(b => b.addEventListener("change", () => { ssx.onlyNew = b.value === "new"; renderSsExport(); }));
    $("ssxPrice").addEventListener("change", e => { ssx.price = e.target.checked; renderSsExport(); });
    if ($("ssxUndo")) $("ssxUndo").addEventListener("click", ssExportUndo);
    $("ssxGo").addEventListener("click", () => ssExportDownload(plan));
  }
  function ssExportDownload(plan) {
    if (!plan.rows.length) return;
    download(new Blob([ssExportText(plan.rows)], {type: "text/csv;charset=utf-8"}), "card-vault-for-sortswift-" + localDay(new Date()) + ".csv");
    const at = new Date(), was = new Map();
    for (const row of plan.rows) for (const {r, n} of row.recs) {
      if (!was.has(r.id)) was.set(r.id, r.ssSent || 0);
      r.ssSent = Math.min(r.qty, plan.onlyNew ? ssSentOf(r) + n : Math.max(ssSentOf(r), n));
    }
    settings.ssExportAt = at.toISOString();
    saveSettings();
    save();
    ssx.saved = {copies: plan.copies, at, was};
    ssx.onlyNew = true;
    renderSsExport();
    toast("Saved " + plural(plan.copies, "card") + " for SortSwift. Import the file once in SortSwift.");
  }
  // The file wasn't imported after all: those copies count as not sent again
  function ssExportUndo() {
    if (!ssx.saved || !ssx.saved.was) return;
    for (const r of collection) if (ssx.saved.was.has(r.id)) { const v = ssx.saved.was.get(r.id); if (v) r.ssSent = v; else delete r.ssSent; }
    save();
    ssx.saved = null;
    renderSsExport();
    toast("Taken back: Card Vault offers those cards again next time.");
  }
