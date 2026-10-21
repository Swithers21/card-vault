  /* ======================= Add several cards ======================= */
  // A list of cards to add in one go: type or paste card numbers (or names), or scan cards one after another.
  // The list stays while Card Vault is open, so you can go to the camera and back.
  const batch = {rows: [], text: "", condition: "Near Mint", language: "English", location: "", opening: null};
  const NUMBER_LIKE = /^(RD\/)?[A-Z0-9]{2,6}-[A-Z]{0,3}\d{1,4}[A-Z]?$/;
  const batchCards = () => batch.rows.reduce((s, r) => s + r.qty, 0);
  function batchDefaultEdition(p) {
    const available = printingsFor(p).filter(k => k !== "Normal");
    return available[0] || (Object.keys(p.prices).length ? "No edition mark" : "1st Edition");
  }
  // "MAMO-EN040", "3 MAMO-EN040", "MAMO-EN040 x3", "3x Dark Magician", "Dark Magician x2", or several numbers on one line.
  function parseBatchLine(line) {
    let text = String(line || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const whole = text;
    let qty = 1, m;
    if ((m = text.match(/^(\d{1,3})\s*[x×]?\s+(.+)$/i))) { qty = +m[1]; text = m[2]; }
    else if ((m = text.match(/^(.+?)\s*[x×]\s*(\d{1,3})$/i))) { text = m[1]; qty = +m[2]; }
    else if ((m = text.match(/^(\S+-\S+)\s+(\d{1,3})$/))) { text = m[1]; qty = +m[2]; }
    const tokens = text.split(/[\s,;|]+/).filter(Boolean);
    if (tokens.length > 1 && tokens.every(t => NUMBER_LIKE.test(normNumber(t)))) return tokens.map(t => ({text: t, qty}));
    return [{text, qty: Math.max(1, Math.min(999, qty || 1)), whole}];
  }
  function setBatchProduct(row, p) {
    row.pid = p.id;
    row.edition = batchDefaultEdition(p);
    row.number = p.number;
  }
  // A Japanese or Korean card number, from Card Vault's daily list (every rarity it was printed in, with photos)
  function setBatchOcg(row, c) {
    row.ocg = c.number;
    row.number = c.number;
    row.name = c.name;
    row.lang = c.region === "jp" ? "Japanese" : "Korean";
    const s = ocgFindSet(c.set.id);
    row.setName = s ? s.name : "";
    row.rarities = Array.from(new Set(c.rows.map(x => x.rarity).filter(Boolean)));
    row.rarity = row.rarities.length === 1 ? row.rarities[0] : "";
    row.edition = "No edition mark";
    row.status = "";
  }
  const batchReady = r => !!(r.pid ? catalog && catalog.byId.get(r.pid) : r.ocg && (r.rarity || !r.rarities.length));
  const batchOcgImg = r => { const c = ocgCardAt(r.ocg); const row = c ? ocgRowFor(c, r.rarity) || c.rows.find(x => x.img) : null; return row && row.img ? row.img : ""; };
  // Finds the TCGplayer printing(s) for one line, or the Japanese or Korean card.
  function batchRowFor(text, qty, whole) {
    const row = {key: newId(), input: String(text), qty: qty || 1, pid: null, cands: [], edition: "", condition: batch.condition, number: "", status: "", ocg: "", rarities: [], rarity: ""};
    const number = normNumber(text);
    if (NUMBER_LIKE.test(number) && isRegionNumber(number)) {
      row.number = number;
      const c = ocgCardAt(number);
      if (c) setBatchOcg(row, c);
      else row.status = !ocgCd.data && ocgCardsURL() && !(ocgCd.failed && Date.now() - ocgCd.failed < 10 * 60000) ? "ocgwait" : "region";
      return row;
    }
    if (!catalog) { row.status = "nocatalog"; return row; }
    let list = [];
    if (NUMBER_LIKE.test(number)) {
      list = findByNumber(number);
      row.number = number;
      if (!list.length) { row.status = isRegionNumber(number) ? "region" : "notfound"; return row; }
    } else {
      list = productsByName().get(normCardName(text)) || [];
      // a name that starts with a number, like "7 Colored Fish"
      if (!list.length && whole && whole !== text) { const again = productsByName().get(normCardName(whole)) || []; if (again.length) { list = again; row.input = whole; row.qty = 1; } }
      if (!list.length) { row.status = "notfound"; return row; }
      list = sortPrintings(list);
    }
    row.cands = list.map(p => p.id);
    if (list.length === 1) setBatchProduct(row, list[0]);
    return row;
  }
  // Rows waiting for the Japanese and Korean list: looked up once it's here.
  function batchResolveWaiting() {
    if (!ocgCd.data) return;
    for (const r of batch.rows) if (r.status === "ocgwait") { const c = ocgCardAt(r.number); if (c) setBatchOcg(r, c); else r.status = "region"; }
  }
  function batchLoadOcg() {
    if (ocgCd.data || !batch.rows.some(r => r.status === "ocgwait")) return;
    loadOcgCardsSoft().then(() => {
      for (const r of batch.rows) if (r.status === "ocgwait" && !ocgCd.data) r.status = "region";
      renderBatchList();
    });
  }
  // The same printing twice just adds to how many.
  function addBatchRows(rows) {
    for (const r of rows) {
      const same = batch.rows.find(x => r.pid ? x.pid === r.pid && x.edition === r.edition && x.condition === r.condition
        : r.ocg ? x.ocg === r.ocg && x.rarity === r.rarity && x.condition === r.condition && !!r.rarity
        : !x.pid && !x.ocg && x.input.toUpperCase() === r.input.toUpperCase());
      if (same) same.qty = Math.min(999, same.qty + r.qty);
      else batch.rows.push(r);
    }
    batchLoadOcg();
  }
  function batchValue(r) {
    if (r.ocg) {
      const v = marketValue({productId: null, name: r.name, number: r.ocg, rarity: r.rarity, edition: r.edition, condition: r.condition, language: r.lang, qty: r.qty, grade: null}).unit;
      return v == null ? null : v * r.qty;
    }
    const p = r.pid && catalog ? catalog.byId.get(r.pid) : null;
    if (!p) return null;
    const v = marketValue({productId: p.id, edition: r.edition, condition: r.condition, language: batch.language, qty: r.qty, grade: null}).unit;
    return v == null ? null : v * r.qty;
  }
  function batchRowHTML(r) {
    if (r.ocg) return batchOcgRowHTML(r);
    const p = r.pid && catalog ? catalog.byId.get(r.pid) : null;
    const label = p ? cleanName(p.name, p.rarity) : r.input;
    let info, cls = "batch-row";
    const cands = r.cands.map(id => catalog.byId.get(id)).filter(Boolean);
    const oneNumber = cands.every(c => c.number === (cands[0] && cands[0].number));
    const pick = cands.length > 1 ? '<select class="input b-pick" data-f="pid" aria-label="Which printing of ' + esc(label) + '">' +
      (p ? "" : '<option value="">Pick the printing (' + cands.length + " on TCGplayer)</option>") +
      cands.map(c => '<option value="' + c.id + '"' + (c.id === r.pid ? " selected" : "") + ">" +
        esc(oneNumber ? (c.rarity || "rarity unknown") + " · " + c.group.name : c.group.name + " · " + c.number + " · " + (c.rarity || "rarity unknown")) + "</option>").join("") + "</select>" : "";
    if (pick) cls += " has-pick";
    if (p) {
      info = "<b>" + esc(label) + "</b><span>" + esc(p.group.name) + " · " + esc(p.number) + " · " + esc(p.rarity || "") + "</span>";
    } else if (r.cands.length) {
      cls += " need";
      info = "<b>" + esc(r.input) + "</b><span>" + (oneNumber ? "This number has " + cands.length + " printings" : cands.length + " printings have this name") + ". Which one is yours?</span>";
    } else if (r.status === "ocgwait") {
      cls += " need";
      info = "<b>" + esc(r.input) + "</b><span>Loading Card Vault's Japanese and Korean card list…</span>";
    } else {
      cls += " bad";
      const why = r.status === "region" ? (ocgCd.data ? "This number isn't in Card Vault's Japanese and Korean card list yet (new sets fill in night by night). Add it with Add manually."
          : ocgCardsURL() ? "Card Vault's Japanese and Korean card list couldn't be loaded just now (it needs an internet connection), so add it with Add manually."
          : "TCGplayer only sells English cards, so this one isn't on it. Add it with Add manually.")
        : r.status === "nocatalog" ? "Card lookup needs TCGplayer's card list (" + (SITE ? "reload the page" : "run Update TCGplayer Data") + ")."
        : "No TCGplayer card has this number or name. Check it for typos, then type it again.";
      info = "<b>" + esc(r.input) + "</b><span>" + esc(why) + "</span>" +
        (r.status === "region" ? '<button type="button" class="link-btn" data-b="manual">Add manually</button>' : "");
    }
    const img = p ? '<span class="sleeve">' + imgTag(productPics(p, "in_400x400"), p.name) + "</span>" : '<span class="batch-blank" aria-hidden="true"></span>';
    const eds = p ? printingsFor(p).filter(k => k !== "Normal").concat(PRINTINGS) : [];
    const value = batchValue(r);
    return '<div class="' + cls + '" data-row="' + esc(r.key) + '">' + img + '<div class="batch-info">' + info + "</div>" + pick +
      '<div class="b-ctl">' + (p ? '<select class="input b-ed" data-f="edition" aria-label="Printing of ' + esc(label) + '">' + options(eds, r.edition) + "</select>" +
        '<select class="input b-cond" data-f="condition" aria-label="Condition of ' + esc(label) + '">' + options(CONDITIONS, r.condition) + "</select>" : "") +
      '<input class="input b-qty" data-f="qty" type="number" min="1" max="999" step="1" value="' + r.qty + '" aria-label="How many of ' + esc(label) + '"></div>' +
      '<span class="batch-price" data-price>' + (value == null ? (p ? "–" : "") : esc(usd(value))) + "</span>" +
      '<button type="button" class="icon-btn b-x" data-b="remove" aria-label="Remove ' + esc(label) + ' from the list">&times;</button></div>';
  }
  function batchOcgRowHTML(r) {
    const need = !batchReady(r);
    const pick = r.rarities.length > 1 ? '<select class="input b-pick" data-f="rarity" aria-label="Rarity of ' + esc(r.name) + '">' +
      (r.rarity ? "" : '<option value="">Pick the rarity (' + r.rarities.length + ")</option>") + options(r.rarities, r.rarity) + "</select>" : "";
    const value = batchValue(r);
    return '<div class="batch-row' + (pick ? " has-pick" : "") + (need ? " need" : "") + '" data-row="' + esc(r.key) + '">' +
      '<span class="sleeve"' + foilAttr(r.rarity) + ">" + imgTag({list: [batchOcgImg(r)].concat(namePics(r.name, "in_400x400", r.rarity).list)}, r.name) + "</span>" +
      '<div class="batch-info"><b>' + esc(r.name) + "</b><span>" + esc([r.setName, r.ocg, r.rarity || (r.rarities.length > 1 ? "which rarity?" : ""), r.lang].filter(Boolean).join(" · ")) + "</span></div>" + pick +
      '<div class="b-ctl"><select class="input b-ed" data-f="edition" aria-label="Printing of ' + esc(r.name) + '">' + options(PRINTINGS, r.edition) + "</select>" +
      '<select class="input b-cond" data-f="condition" aria-label="Condition of ' + esc(r.name) + '">' + options(CONDITIONS, r.condition) + "</select>" +
      '<input class="input b-qty" data-f="qty" type="number" min="1" max="999" step="1" value="' + r.qty + '" aria-label="How many of ' + esc(r.name) + '"></div>' +
      '<span class="batch-price" data-price>' + (value == null ? "–" : esc(usd(value))) + "</span>" +
      '<button type="button" class="icon-btn b-x" data-b="remove" aria-label="Remove ' + esc(r.name) + ' from the list">&times;</button></div>';
  }
  function batchTotalsHTML() {
    const ready = batch.rows.filter(batchReady);
    const cards = ready.reduce((s, r) => s + r.qty, 0);
    const value = ready.reduce((s, r) => s + (batchValue(r) || 0), 0);
    const waiting = batch.rows.length - ready.length;
    return (cards ? "<b>" + plural(cards, "card") + "</b> ready to add" + (value ? ", worth about <b>" + esc(usd(value)) + "</b> at today's market prices" : "") + "."
      : batch.rows.length ? "" : "The list is empty.") +
      (waiting ? " " + (waiting === 1 ? "1 line needs" : waiting + " lines need") + " a look first (they stay in the list)." : "");
  }
  function renderBatchList() {
    const box = $("batchList");
    if (!box) return;
    batchResolveWaiting();
    box.innerHTML = batch.rows.length ? batch.rows.map(batchRowHTML).join("") : "";
    refreshBatchTotals();
  }
  function refreshBatchTotals() {
    if ($("batchTotals")) $("batchTotals").innerHTML = batchTotalsHTML();
    const ready = batch.rows.filter(batchReady).reduce((s, r) => s + r.qty, 0);
    const where = batch.opening ? " to your collection and this opening" : " to your collection";
    if ($("batchGo")) { $("batchGo").textContent = ready ? "Add " + plural(ready, "card") + where : "Add" + where; $("batchGo").disabled = !ready; }
    if ($("batchClear")) $("batchClear").hidden = !batch.rows.length;
  }
  // opts.opening: the cards you pulled from a box or packs you opened (Insights > Box openings): they go into your
  // collection and onto that opening. Opening the list from Add card ({opening: null}) leaves that behind.
  function openBatch(opts) {
    // (each opening has a list of its own, and so does plain "Add several cards": cards typed for one never land in another)
    const want = opts && "opening" in opts ? opts.opening || null : batch.opening;
    if (want !== batch.opening) {
      batch.lists = batch.lists || {};
      batch.lists[batch.opening || ""] = batch.rows;
      batch.rows = batch.lists[want || ""] || [];
      delete batch.lists[want || ""];
      batch.opening = want;
    }
    const op = batch.opening ? openings.find(o => o.id === batch.opening) : null;
    if (!op && batch.opening) { batch.opening = null; batch.rows = (batch.lists && batch.lists[""]) || []; if (batch.lists) delete batch.lists[""]; }
    drawerCtx = {mode: "batch"};
    openDrawer(op ? "Cards you pulled" : "Add several cards",
      (op ? '<div class="notice batch-for"><b>' + esc(op.name) + "</b>, opened " + esc(fmtDate(parseDay(op.date))) + ". The cards you add here go into your collection and onto this opening" +
        (op.pulls.length ? " (" + plural(op.pulls.reduce((s, x) => s + x.qty, 0), "card") + " so far)" : "") + '. <button type="button" class="link-btn" id="batchNoOpening">Add them without the opening</button></div>' : "") +
      '<label class="field"><span>Card numbers or names</span><textarea class="input batch-text" id="batchText" rows="3" autofocus spellcheck="false" ' +
      'placeholder="MAMO-EN040&#10;3 RA05-EN019&#10;RD/KP15-JP001 x2">' + esc(batch.text) + "</textarea></label>" +
      '<p class="hint" style="margin:0">Type a card number and press Enter, or paste a whole list (one card per line). For more than one copy, put how many before or after it: "3 MAMO-EN040" or "MAMO-EN040 x3". ' +
      "Japanese and Korean numbers work too (QCCU-JP001, RD/KP15-KR001).</p>" +
      '<div class="btn-row"><button class="btn" type="button" id="batchParse">Add to the list</button>' +
      '<button class="btn" type="button" id="batchScan">Scan cards with the camera</button></div>' +
      '<div class="batch-list" id="batchList"></div>' +
      '<p class="batch-totals" id="batchTotals" role="status"></p>' +
      '<div class="batch-common"><h3>For every card in the list</h3><div class="grid-3">' +
      '<label class="field"><span>Condition</span><select class="input" id="batchCond">' + options(CONDITIONS, batch.condition) + "</select></label>" +
      '<label class="field"><span>Language (English cards)</span><select class="input" id="batchLang">' + options(LANGUAGES, batch.language) + "</select></label>" +
      '<label class="field"><span>Location (optional)</span><input class="input" id="batchLoc" data-loc="1" autocomplete="off" placeholder="e.g. Binder 1" value="' + esc(batch.location) + '"></label></div>' +
      '<p class="hint" style="margin:0">Changing the condition here sets it for every card in the list; you can still change single cards above. Japanese and Korean cards keep their own language.</p></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="button" id="batchGo">Add to your collection</button>' +
      '<button class="btn" type="button" id="batchClear">Clear the list</button></div>');
    $("drawer").classList.add("wide");
    renderBatchList();
    batchLoadOcg();
    const body = $("drawerBody");
    const text = $("batchText");
    const takeText = () => {
      const lines = text.value.split(/\r?\n/);
      const rows = [];
      for (const line of lines) for (const part of parseBatchLine(line)) rows.push(batchRowFor(part.text, part.qty, part.whole));
      if (!rows.length) { text.focus(); return; }
      addBatchRows(rows);
      text.value = batch.text = "";
      renderBatchList();
      text.focus();
    };
    if ($("batchNoOpening")) $("batchNoOpening").addEventListener("click", () => { const rows = batch.rows; batch.rows = []; openBatch({opening: null}); addBatchRows(rows); renderBatchList(); });
    text.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); takeText(); } });
    text.addEventListener("input", () => { batch.text = text.value; });
    $("batchParse").addEventListener("click", takeText);
    $("batchScan").addEventListener("click", () => openScanner({batch: true}));
    $("batchGo").addEventListener("click", addBatch);
    $("batchClear").addEventListener("click", () => {
      const before = batch.rows.slice();
      batch.rows = [];
      renderBatchList();
      toast("Cleared the list.", {action: "Undo", onAction: () => { batch.rows = before; renderBatchList(); }});
    });
    $("batchCond").addEventListener("change", e => { batch.condition = e.target.value; batch.rows.forEach(r => { r.condition = batch.condition; }); renderBatchList(); });
    $("batchLang").addEventListener("change", e => { batch.language = e.target.value; renderBatchList(); });
    $("batchLoc").addEventListener("input", e => { batch.location = e.target.value; });
    const rowOf = el => { const box = el.closest("[data-row]"); return box ? batch.rows.find(r => r.key === box.dataset.row) : null; };
    body.addEventListener("change", e => {
      const f = e.target.dataset && e.target.dataset.f;
      const r = f && rowOf(e.target);
      if (!r) return;
      if (f === "pid") {
        const p = catalog.byId.get(+e.target.value) || catalog.byId.get(e.target.value);
        if (p) setBatchProduct(r, p);
        renderBatchList();
        const again = body.querySelector('[data-row="' + r.key + '"] [data-f="edition"]');
        if (again) again.focus();
        return;
      }
      if (f === "rarity") {
        r.rarity = e.target.value;
        renderBatchList();
        const again = body.querySelector('[data-row="' + r.key + '"] [data-f="edition"]');
        if (again) again.focus();
        return;
      }
      if (f === "edition") r.edition = e.target.value;
      else if (f === "condition") r.condition = e.target.value;
      else if (f === "qty") { r.qty = Math.min(999, posInt(e.target.value) || 1); e.target.value = r.qty; }
      const value = batchValue(r);
      const cell = e.target.closest("[data-row]").querySelector("[data-price]");
      if (cell) cell.textContent = value == null ? (r.pid || r.ocg ? "–" : "") : usd(value);
      refreshBatchTotals();
    });
    body.addEventListener("input", e => {
      if (!(e.target.dataset && e.target.dataset.f === "qty")) return;
      const r = rowOf(e.target);
      const n = posInt(e.target.value);
      if (r && n) { r.qty = Math.min(999, n); refreshBatchTotals(); }
    });
    body.addEventListener("click", e => {
      const b = e.target.closest("[data-b]");
      const r = b && rowOf(b);
      if (!r) return;
      if (b.dataset.b === "remove") {
        batch.rows = batch.rows.filter(x => x !== r);
        renderBatchList();
        text.focus();
      } else if (b.dataset.b === "manual") {
        const m = r.input.toUpperCase().match(/-(JP|JA|KR|AE|TC|SC)/);
        batch.rows = batch.rows.filter(x => x !== r);
        openManual({number: normNumber(r.input), language: m ? OCG_REGIONS[m[1]] : "English"});
      }
    });
  }
  function addBatch() {
    const ready = batch.rows.filter(batchReady);
    if (!ready.length) { toast(batch.rows.length ? "Pick the printing (or rarity) for the cards in the list first." : "Add some cards to the list first.", {kind: "error"}); return; }
    const before = JSON.stringify(collection);
    const op = batch.opening ? openings.find(o => o.id === batch.opening) : null;
    const pullsBefore = op ? op.pulls.slice() : null;
    const now = new Date().toISOString();
    let cards = 0;
    for (const r of ready) {
      let rec;
      if (r.ocg) {
        rec = upgradeRecord({id: newId(), productId: null, name: r.name, productName: r.name, setName: r.setName, number: r.ocg, rarity: r.rarity, edition: r.edition || "No edition mark",
          condition: r.condition, language: r.lang, qty: r.qty, customImage: batchOcgImg(r) || null, location: batch.location, added: now});
      } else {
        const p = catalog.byId.get(r.pid);
        rec = upgradeRecord({id: newId(), productId: p.id, name: cleanName(p.name, p.rarity), productName: p.name, setName: p.group.name,
          number: p.number, rarity: p.rarity, edition: r.edition, condition: r.condition, language: batch.language, qty: r.qty,
          location: batch.location, snap: snapFromCatalog(p, r.edition), added: now});
      }
      if (op) op.pulls.push(pullFrom(rec, r.qty));
      addOrMerge(rec);
      cards += r.qty;
    }
    batch.rows = batch.rows.filter(r => !ready.includes(r));
    save();
    render();
    const left = batch.rows.length;
    if (left) renderBatchList(); else { closeDrawer(); if (op) { batch.opening = null; showOpening(op.id); } }
    toast("Added " + plural(cards, "card") + " (" + plural(ready.length, "printing") + ") to your collection" + (op ? " and to " + op.name : "") + "." +
      (left ? " " + plural(left, "line") + " still in the list." : ""), {action: "Undo", onAction: () => {
      collection = JSON.parse(before).map(upgradeRecord).filter(Boolean);
      if (op && pullsBefore) { const cur = openings.find(o => o.id === op.id); if (cur) cur.pulls = pullsBefore; batch.opening = op.id; }
      batch.rows = ready.concat(batch.rows);
      save(); render();
      toast("Undone. The cards are back in the " + (op ? "Cards you pulled" : "Add several cards") + " list.");
    }});
  }

  /* ======================= Camera scan ======================= */
  // The text reader (Tesseract.js) loads from a CDN the first time the scanner opens.
  const TESS = {script: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js",
    integrity: "sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM",
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"};
  let ocrPromise = null;
  let scan = null;   // the open scanner: {stream, active, busy, timer, tries, devices, deviceIndex}
  function loadScript(src, integrity) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; }   // (only this exact file runs)
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(s);
    });
  }
  function ocrWorker() {
    if (!ocrPromise) {
      ocrPromise = (async () => {
        if (!window.Tesseract) await loadScript(TESS.script, TESS.integrity);
        const worker = await window.Tesseract.createWorker("eng", 1, {workerPath: TESS.workerPath, corePath: TESS.corePath, langPath: TESS.langPath});
        await worker.setParameters({tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", user_defined_dpi: "300"});
        return worker;
      })();
      ocrPromise.catch(() => { ocrPromise = null; });
    }
    return ocrPromise;
  }
  const OCR_DIGIT = {O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", J: "1", T: "1", Z: "2", S: "5", B: "8", G: "6", A: "4"};
  const OCR_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A"};
  const OCR_SWAP = {O: "0", "0": "O", I: "1", "1": "I", S: "5", "5": "S", B: "8", "8": "B", Z: "2", "2": "Z", G: "6", "6": "G"};
  // Card numbers look like SET-RR123: a set code, a region (EN, JP, KR...) and 2-3 digits. Text readers mix up
  // look-alike characters (O and 0, I and 1...), so every likely reading is tried against TCGplayer's list.
  function numberVariants(set, rest) {
    const tails = [];
    for (const n of [3, 2]) {
      if (rest.length < n) continue;
      const tail = rest.slice(-n).split("").map(ch => OCR_DIGIT[ch] || ch).join("");
      const head = rest.slice(0, -n).split("").map(ch => OCR_LETTER[ch] || ch).join("");
      if (/^\d+$/.test(tail) && head.length <= 3 && /^[A-Z]*$/.test(head)) tails.push(head + tail);
    }
    const sets = [set];
    for (let i = 0; i < set.length && sets.length < 32; i++) {
      if (!OCR_SWAP[set[i]]) continue;
      for (const s of sets.slice()) sets.push(s.slice(0, i) + OCR_SWAP[set[i]] + s.slice(i + 1));
    }
    const out = [];
    for (const r of tails) for (const s of sets) if (/[A-Z]/.test(s)) out.push(s + "-" + r);
    return out;
  }
  // Reading card numbers is noisy (an extra O, a Q for a 0...). Compare what was read with every card number
  // TCGplayer has, treating look-alike characters as the same, and accept the closest one if it's close enough.
  const CONFUSE = {O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", J: "1", T: "1", Z: "2", S: "5", B: "8", G: "6"};
  const canon = str => str.replace(/[OQDUILJTZSBG]/g, ch => CONFUSE[ch]);
  function lev(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 9;
    let prev = Array.from({length: b.length + 1}, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function scanIndex() {
    if (!catalog.scanIndex) {
      catalog.scanIndex = new Map();   // set code -> its card numbers, split into parts
      for (const number of catalog.byNumber.keys()) {
        const m = number.match(/^([A-Z0-9]+)-([A-Z]{2})?([A-Z])?(\d+)$/);
        if (!m) continue;
        const tail = (m[3] || "") + m[4];
        pushMap(catalog.scanIndex, m[1], {number, set: m[1], region: m[2] || "", tail, canonRest: canon((m[2] || "") + tail)});
      }
      for (const [set, list] of catalog.scanIndex) list.canonSet = canon(set);
    }
    return catalog.scanIndex;
  }
  function ocgScanIndex() {
    const d = ocgCd.data;
    if (!d.scanIndex) {
      d.scanIndex = new Map();
      for (const number of d.byNumber.keys()) {
        const m = number.match(/^((?:RD\/)?[A-Z0-9]+)-(JP|KR|K)?([A-Z])?(\d+)$/);
        if (!m) continue;
        const region = m[2] || "", tail = (m[3] || "") + m[4];
        pushMap(d.scanIndex, m[1], {number, set: m[1], region, tail, canonRest: canon(region + tail), ocg: true});
      }
      // (a Rush Duel set is compared without its RD/, which the text reader often misses: RD/KP25 read as KP25)
      for (const [set, list] of d.scanIndex) list.canonSet = canon(set.replace(/^RD\//, ""));
    }
    return d.scanIndex;
  }
  const OCG_CODES = ["JP", "JA", "KR", "AE", "TC", "SC"];
  // "DUNE-KR0OO1" -> "DUNE-KR001": a region code, then an optional letter and 3 digits. Text readers
  // sometimes double a round character (0 read as "0O"), so one repeated character may be dropped.
  function ocgGuess(set, rest) {
    if (!/[A-Z]/.test(set)) return null;
    const region = rest.slice(0, 2).replace(/1/g, "J").replace(/5/g, "S");
    if (!OCG_CODES.includes(region)) return null;
    let body = rest.slice(2);
    const letter = /^[A-Z][0-9OQDUILJTZSBG]{3}$/.test(body) && !/^[OQDUILJTZSBG]/.test(body) ? body[0] : "";
    if (letter) body = body.slice(1);
    let digits = body.split("").map(ch => OCR_DIGIT[ch] || ch).join("");
    if (digits.length === 4) {
      const i = digits.split("").findIndex((ch, k) => k > 0 && ch === digits[k - 1]);
      if (i > 0) digits = digits.slice(0, i) + digits.slice(i + 1);
    }
    return /^\d{3}$/.test(digits) ? set + "-" + region + letter + digits : null;
  }
  // {number, products, sure}: "sure" when the number checks out against TCGplayer's list.
  function matchScanned(text) {
    // (Rush Duel's RD/ comes out as "RD/", "RD /", "RO/", "RD|"...: made "RD/" again)
    const up = String(text || "").toUpperCase().replace(/[‐-―−_=~]/g, "-").replace(/\bR[DO0] ?[\/|\\] ?(?=[A-Z0-9]{2,6} ?- ?[A-Z0-9])/g, "RD/");
    const re = /((?:RD\/)?[A-Z0-9]{2,6}) ?- ?([A-Z0-9]{2,8})/g;
    const tokens = [];
    let m;
    while ((m = re.exec(up))) tokens.push([m[1], m[2]]);
    // 1) an exact reading, allowing for look-alike characters (TCGplayer's numbers, and the Japanese and Korean list's)
    for (const [set, rest] of tokens) {
      for (const v of numberVariants(set, rest)) {
        const hits = catalog ? catalog.byNumber.get(v) : null;
        if (hits && hits.length) return {number: v, products: hits, sure: true};
        if (ocgCd.data && ocgCd.data.byNumber.has(v)) return {number: v, products: [], sure: true};
      }
    }
    // ... and a Rush Duel number whose RD/ wasn't read (KP25-JP001), or was read stuck to the set (RDKP25-JP001)
    if (ocgCd.data) {
      for (const [set, rest] of tokens) {
        if (set.startsWith("RD/")) continue;
        for (const bare of [set, set.replace(/^R[DO0][I1L]?(?=[A-Z0-9]{4})/, "")]) {
          for (const v of numberVariants(bare, rest)) if (ocgCd.data.byNumber.has("RD/" + v)) return {number: "RD/" + v, products: [], sure: true};
        }
      }
    }
    // 2) the closest known number, or 3) a Japanese/Korean print of a set TCGplayer also sells in English
    const indexes = (catalog ? [scanIndex()] : []).concat(ocgCd.data ? [ocgScanIndex()] : []);
    if (indexes.length) {
      let best = null;
      for (const [setRead, restRead] of tokens) {
        if (setRead.length + restRead.length < 6) continue;
        const cs = canon(setRead.replace(/^RD\//, "")), cr = canon(restRead);
        for (const [, list] of indexes.flatMap(ix => Array.from(ix))) {
          const ds = lev(cs, list.canonSet);
          if (ds > 1) continue;
          for (const e of list) {
            if (setRead.startsWith("RD/") && !(e.ocg && e.set.startsWith("RD/"))) continue;   // (a Rush Duel number is a Rush Duel card)
            if (e.ocg && e.region && canon(restRead.slice(0, e.region.length)) !== canon(e.region)) continue;
            let d = ds + lev(cr, e.canonRest), number = e.number;
            if (e.region === "EN") {
              for (const code of OCG_CODES) {
                const d2 = ds + lev(cr, canon(code + e.tail));
                if (d2 < d) { d = d2; number = e.set + "-" + code + e.tail; }
              }
            }
            if (d <= 2 && (!best || d < best.d)) best = {d, number, amb: false};
            else if (best && d === best.d && number !== best.number) best.amb = true;
          }
        }
      }
      if (best && !best.amb) return {number: best.number, products: (catalog && catalog.byNumber.get(best.number)) || [], sure: true};
    }
    // 4) a number that looks right but can't be checked (a set TCGplayer doesn't sell, or no TCGplayer data)
    for (const [set, rest] of tokens) {
      const guess = ocgGuess(set, rest);
      if (guess) return {number: guess, products: [], sure: false};
      const vars = numberVariants(set, rest);
      const ocg = vars.find(v => /^[A-Z0-9]{2,5}-(JP|JA|KR|AE|TC|SC)[A-Z]?\d{3}$/.test(v));
      if (ocg) return {number: ocg, products: [], sure: false};
      if (!catalog) { const any = vars.find(v => /^[A-Z0-9]{3,5}-[A-Z]{0,2}[A-Z]?\d{3}$/.test(v)); if (any) return {number: any, products: [], sure: false}; }
    }
    return null;
  }
  // Turn the picture into clean black text on white: grayscale, enlarge small crops, then compare each pixel
  // with its neighborhood (so dark text on a colored card frame survives, whatever the lighting).
  // opts.invert reads light text on a dark frame instead; opts.radius is the neighborhood size in pixels.
  function prepCanvas(src, sx, sy, sw, sh, maxW, opts) {
    opts = opts || {};
    const k = Math.min(Math.max(900 / sw, 1), (maxW || 1800) / sw);
    const c = document.createElement("canvas");
    const w = c.width = Math.max(1, Math.round(sw * k));
    const h = c.height = Math.max(1, Math.round(sh * k));
    const g = c.getContext("2d", {willReadFrequently: true});
    g.imageSmoothingQuality = "high";
    g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const gray = new Uint8Array(w * h), sum = new Uint32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
        gray[y * w + x] = v;
        row += v;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(8, Math.round(opts.radius || h / 6));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const total = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
        const mean = total / ((y1 - y0) * (x1 - x0)), v = gray[y * w + x];
        const ink = opts.invert ? v > mean * 1.18 + 4 : v < mean * 0.82 - 4;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  async function readCanvas(canvas, mode) {
    const worker = await ocrWorker();
    await worker.setParameters({tessedit_pageseg_mode: mode});
    const res = await worker.recognize(canvas);
    return (res && res.data && res.data.text) || "";
  }
  // The part of the camera picture inside the guide box (the video fills its frame, cropped at the edges).
  function boxCrop(video) {
    const view = $("scanView").getBoundingClientRect(), box = $("scanBox").getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.max(view.width / vw, view.height / vh);
    const offX = (view.width - vw * k) / 2, offY = (view.height - vh * k) / 2;
    const sx = Math.max(0, (box.left - view.left - offX) / k), sy = Math.max(0, (box.top - view.top - offY) / k);
    return {sx, sy, sw: Math.min(vw - sx, box.width / k), sh: Math.min(vh - sy, box.height / k)};
  }
  // opts.batch: scan one card after another into the "Add several cards" list.
  // opts.batch: several cards into the add list; opts.check: just see what each card is worth (Card search)
  function openScanner(opts) {
    const many = !!(opts && opts.batch), check = !many && !!(opts && opts.check);
    drawerCtx = {mode: "scan", batch: many, check};
    ocgCardsReady();   // (so a Japanese or Korean card is known right away)
    openDrawer(many ? "Scan several cards" : check ? "Scan to check a price" : "Scan a card",
      '<div class="scan-view" id="scanView"><video id="scanVideo" playsinline muted autoplay></video><div class="scan-box" id="scanBox" aria-hidden="true"></div></div>' +
      '<p class="scan-status" id="scanStatus" role="status">Starting the camera…</p>' +
      (many ? '<p class="hint" style="margin:4px 0 0">Hold up one card at a time, with its number inside the box. Each card it reads goes into the list; ' +
          "then hold up the next one. For more copies of the same card, change how many in the list.</p>" +
          '<div class="btn-row"><button class="btn btn-primary" type="button" id="scanList">' + batchListLabel() + "</button></div>"
        : check ? '<p class="hint" style="margin:4px 0 0">Hold the card close, with its number (just under the picture, on the right) inside the box. Its prices show here; nothing is added to your collection.</p>'
        : '<p class="hint" style="margin:4px 0 0">Hold the card close, with its number (just under the picture, on the right) inside the box. Good light helps. ' +
          'Have a stack? <button type="button" class="link-btn" id="scanMany">Scan several in a row</button></p>') +
      '<div class="btn-row"><button class="btn' + (many ? "" : " btn-primary") + '" type="button" id="scanRead" disabled>Read it now</button>' +
      '<button class="btn" type="button" id="scanPhoto">Use a photo instead</button><input type="file" id="scanFile" accept="image/*" hidden>' +
      '<button class="btn" type="button" id="scanSwitch" hidden>Switch camera</button><button class="btn" type="button" id="scanAgain" hidden>Scan again</button></div>' +
      '<form id="scanForm" class="lookup-row" style="margin-top:14px"' + (check ? "" : " hidden") + ' autocomplete="off"><input class="input" id="scanNumber" aria-label="Card number"' +
      (check ? ' placeholder="Or type its number, like LOB-EN001"' : "") + ">" +
      '<button class="btn" type="submit">Find</button></form><div id="lookupOut"></div>' + (check ? '<div id="scanChecks"></div>' : ""));
    scan = {stream: null, active: true, busy: false, timer: null, tries: 0, devices: [], deviceIndex: -1, batch: many, check, recent: {}};
    if (check) renderScanChecks();
    if ($("scanList")) $("scanList").addEventListener("click", () => openBatch());
    if ($("scanMany")) $("scanMany").addEventListener("click", () => openScanner({batch: true}));
    $("scanRead").addEventListener("click", () => scanOnce(true));
    $("scanPhoto").addEventListener("click", () => $("scanFile").click());
    $("scanFile").addEventListener("change", () => { const f = $("scanFile").files[0]; $("scanFile").value = ""; if (f) scanPhoto(f); });
    $("scanSwitch").addEventListener("click", () => {
      if (!scan || !scan.devices.length) return;
      scan.deviceIndex = (scan.deviceIndex + 1) % scan.devices.length;
      startCamera(scan.devices[scan.deviceIndex].deviceId);
    });
    $("scanAgain").addEventListener("click", resumeScan);
    $("scanForm").addEventListener("submit", e => {
      e.preventDefault();
      const typed = $("scanNumber").value;
      if (scan && scan.check) { if (normNumber(typed)) { scan.active = false; clearTimeout(scan.timer); showScanPrice({number: normNumber(typed), products: findByNumber(typed)}); } return; }
      if (!(scan && scan.batch)) { runNumberLookup(typed); return; }
      if (!normNumber(typed)) return;
      addBatchRows([batchRowFor(typed, 1)]);
      $("scanStatus").textContent = "Added " + normNumber(typed) + " to the list.";
      $("scanList").textContent = batchListLabel();
      $("scanNumber").value = "";
    });
    startCamera();
  }
  function stopScanner() {
    if (!scan) return;
    scan.active = false;
    clearTimeout(scan.timer);
    if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
    scan = null;
  }
  async function startCamera(deviceId) {
    const status = $("scanStatus");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scan.noCamera = true;
      status.textContent = "This browser can't use a camera here. Use a photo instead.";
      return;
    }
    if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
    scan.stream = null;
    // Only the latest start counts: closing the scanner, reopening it or switching cameras while the browser
    // is still asking for the camera leaves an older start waiting, and its camera must not stay on.
    const mine = scan, gen = scan.camGen = (scan.camGen || 0) + 1;
    const current = () => scan === mine && scan.camGen === gen;
    let stream;
    try {
      const size = {width: {ideal: 1920}, height: {ideal: 1080}};
      stream = await navigator.mediaDevices.getUserMedia({audio: false,
        video: Object.assign(deviceId ? {deviceId: {exact: deviceId}} : {facingMode: {ideal: "environment"}}, size)});
    } catch (e) {
      if (!current()) return;
      scan.noCamera = true;
      status.textContent = e && e.name === "NotAllowedError" ? "Card Vault isn't allowed to use the camera. Allow it with the camera icon in the address bar, or use a photo instead."
        : e && (e.name === "NotFoundError" || e.name === "OverconstrainedError") ? "No camera found. Use a photo instead." : "Couldn't start the camera. Use a photo instead.";
      return;
    }
    if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
    scan.stream = stream;
    const video = $("scanVideo");
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay keeps trying */ }
    if (!current()) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (!current()) return;
      scan.devices = devices;
      $("scanSwitch").hidden = devices.length < 2;
    } catch (e) { /* only for the Switch camera button */ }
    $("scanRead").disabled = false;
    // (a number typed while the camera started keeps its "Found" message)
    if (scan.active) status.textContent = "Loading the text reader (the first time takes a few seconds)…";
    try { await ocrWorker(); } catch (e) {
      if (current() && scan.active) status.textContent = "Couldn't load the text reader. It needs an internet connection the first time.";
      return;
    }
    if (!current() || !scan.active) return;
    status.textContent = "Looking for a card number…";
    scanLoop();
  }
  async function scanOnce(manual) {
    const mine = scan;
    if (!mine || mine.busy) return null;
    const video = $("scanVideo");
    if (!video || !video.videoWidth) return null;
    mine.busy = true;
    let found = null, failed = false;
    try {
      const b = boxCrop(video);
      // every other try looks for light text on a dark frame (Xyz monsters, for one)
      const invert = !manual && mine.tries % 2 === 1;
      found = matchScanned(await readCanvas(prepCanvas(video, b.sx, b.sy, b.sw, b.sh, 1800, {invert}), "6"));
      if (!found && manual && scan === mine) found = matchScanned(await readCanvas(prepCanvas(video, b.sx, b.sy, b.sw, b.sh, 1800, {invert: true}), "6"));
    } catch (e) {
      failed = true;
    }
    mine.busy = false;
    // the scanner was closed (or opened again), or a photo was picked, while this was being read
    if (scan !== mine || (!manual && !mine.active)) return null;
    // A number that can't be checked against TCGplayer's list has to be read the same way twice. So does every
    // number when scanning several cards, where nobody checks each one before it goes into the list.
    if (found && !manual && (!found.sure || mine.batch)) {
      if (mine.pending !== found.number) { mine.pending = found.number; found = null; }
    }
    if (found) showScanResult(found);
    else if (manual) $("scanStatus").textContent = failed ? "Couldn't read that. Try again, or use a photo." : "No card number found. Move the card so the number sits inside the box.";
    return found;
  }
  // One reading loop at a time: starting it again (another camera, "Scan again") replaces the one running.
  function scanLoop() {
    if (!scan) return;
    clearTimeout(scan.timer);
    scanStep(scan.loopId = (scan.loopId || 0) + 1);
  }
  async function scanStep(id) {
    const mine = scan;
    if (!mine || !mine.active || mine.loopId !== id) return;
    const found = mine.busy ? null : await scanOnce(false);
    if (scan !== mine || !mine.active || found || mine.loopId !== id) return;
    mine.tries++;
    if (mine.tries === 10) $("scanStatus").textContent = "Still looking. Move the card a little closer or further away, and keep the number inside the box.";
    mine.timer = setTimeout(() => scanStep(id), 300);
  }
  const batchListLabel = () => batch.rows.length ? "Back to the list (" + plural(batchCards(), "card") + ")" : "Go to the list";
  function showScanResult(found) {
    if (!scan) return;
    scan.active = false;
    clearTimeout(scan.timer);
    if (scan.batch) { addScanToBatch(found); return; }
    if (scan.check) { showScanPrice(found); return; }
    $("scanStatus").textContent = "Found " + found.number + (found.products.length ? ". Pick the printing that matches your card." : ".");
    $("scanForm").hidden = false;
    $("scanNumber").value = found.number;
    $("scanAgain").hidden = false;
    runNumberLookup(found.number);
  }
  // Scanning into the list: add the card, then keep looking for the next one. The same card held up
  // for a while (or read again right away) is only added once.
  function addScanToBatch(found) {
    const mine = scan, now = Date.now();
    // any card seen in the last 6 seconds is still the same card being held up
    const again = now - (mine.recent[found.number] || 0) < 6000;
    mine.recent[found.number] = now;
    if (again) $("scanStatus").textContent = "Still seeing " + found.number + " (it's in the list). Hold up the next card.";
    else {
      const row = batchRowFor(found.number, 1);
      addBatchRows([row]);
      const p = row.pid && catalog ? catalog.byId.get(row.pid) : null;
      $("scanStatus").textContent = "Added " + found.number + (p ? ", " + cleanName(p.name, p.rarity) : "") +
        (row.ocg ? ", " + row.name + (row.rarity ? "" : " (pick its rarity in the list)") : row.pid ? "" : row.cands.length ? " (pick its printing in the list)" : row.status === "ocgwait" ? "" : " (it isn't on TCGplayer)") + ". Next card…";
      $("scanList").textContent = batchListLabel();
      $("scanForm").hidden = true;
    }
    mine.timer = setTimeout(() => {
      if (scan !== mine) return;
      mine.active = true;
      mine.tries = 0;
      scanLoop();
    }, again ? 300 : 1200);
  }
  // Scan to check (Card search): the card's prices right here, and a running list of what you've checked
  const scanChecks = [];   // (this visit: cleared when the page is reloaded or with Clear)
  function showScanPrice(found) {
    const out = $("lookupOut");
    if (!out) return;
    const number = normNumber(found.number);
    $("scanStatus").textContent = "Found " + number + ".";
    $("scanForm").hidden = false;
    $("scanNumber").value = number;
    $("scanAgain").hidden = false;
    $("scanAgain").textContent = "Scan the next card";
    $("scanAgain").classList.add("btn-primary");
    $("scanRead").classList.remove("btn-primary");
    const products = ((found.products && found.products.length) ? found.products : findByNumber(number)).filter(p => !p.sealed);
    if (!products.length) {
      const m = ocgKey(ocgRegion(number));
      // (in a box of its own: a newer scan replaces it, and this lookup's answer then goes nowhere)
      if (m) { out.innerHTML = "<div></div>"; showOcgLookup(out.firstChild, number, m, {search: true}); return; }
      out.innerHTML = '<div class="notice">No TCGplayer printing has the number ' + esc(number) + ". Check it, or type it below.</div>";
      return;
    }
    const owned = csOwnedMap();
    let top = null;
    out.innerHTML = '<div class="scan-prices">' + products.map(p => {
      const eds = printingsFor(p), name = cleanName(p.name, p.rarity), have = owned.get(p.id) || 0;
      let best = null;
      const lines = eds.map(ed => {
        const sub = p.prices[ed], v = firstPrice(sub);
        if (v != null && (!best || v > best.v)) best = {ed, v};
        const chg = sub.market != null && sub.m30 != null ? changeHTML(sub.market - sub.m30, sub.m30 > 0 ? (sub.market - sub.m30) / sub.m30 : null, true) : "";
        return '<div class="scan-ed"><span>' + esc(eds.length > 1 ? csPrinting(ed) : "Market price") + "</span><b>" + esc(sub.market == null ? "no sales" : usd(sub.market)) + "</b>" +
          (sub.low != null ? '<span class="small">lowest ' + esc(usd(sub.low)) + "</span>" : "") + (chg ? '<span class="small">30 days: ' + chg + "</span>" : "") + "</div>";
      }).join("");
      if (best && (!top || best.v > top.v)) top = {name, v: best.v, number};
      return '<div class="scan-card"><span class="sleeve"' + foilAttr(p.rarity) + ">" + imgTag(productPics(p, "200w"), name) + "</span>" +
        '<div class="scan-info"><b class="scan-name">' + esc(name) + '</b><span class="small">' + esc([p.group.name, p.rarity].filter(Boolean).join(" · ")) + "</span>" +
        (have ? '<span class="cs-own">You have ' + have + "</span>" : "") + lines +
        '<button type="button" class="link-btn" data-scan-open="' + esc(p.id + "|" + (best ? best.ed : eds[0] || "")) + '">Details, price over time, PSA 10</button></div></div>';
    }).join("") + "</div>" + (products.length > 1 ? '<p class="small" style="margin:6px 0 0">' + products.length + " printings have this number: compare the rarity and set with your card.</p>" : "") +
      '<div class="btn-row"><button class="btn btn-primary" type="button" data-scan-next>Scan the next card</button></div>';
    out.querySelector("[data-scan-next]").addEventListener("click", () => resumeScan());
    $("scanAgain").hidden = true;   // (its own button is under the prices)
    // (on a phone the camera fills the screen: bring the prices into view)
    if (out.scrollIntoView) out.scrollIntoView({block: "start", behavior: "smooth"});
    out.querySelectorAll("[data-scan-open]").forEach(b => b.addEventListener("click", () => {
      const at = b.dataset.scanOpen.indexOf("|");
      openPriceCard(b.dataset.scanOpen.slice(0, at), b.dataset.scanOpen.slice(at + 1), {fromScan: true});
    }));
    if (top && !(scanChecks[0] && scanChecks[0].number === number)) scanChecks.unshift(top);
    renderScanChecks();
  }
  function renderScanChecks() {
    const box = $("scanChecks");
    if (!box) return;
    if (!scanChecks.length) { box.innerHTML = ""; return; }
    const total = scanChecks.reduce((t, x) => t + x.v, 0);
    box.innerHTML = '<div class="scan-log"><div class="box-head"><h3>Checked so far</h3><button type="button" class="link-btn" id="scanClear">Clear</button></div>' +
      '<p class="small" style="margin:0 0 6px">' + plural(scanChecks.length, "card") + ", " + esc(usd(total)) + " together (the most valuable printing of each).</p>" +
      '<ul class="scan-log-list">' + scanChecks.slice(0, 20).map(x => "<li><span>" + esc(x.name) + ' <span class="small">' + esc(x.number) + "</span></span><b>" + esc(usd(x.v)) + "</b></li>").join("") + "</ul></div>";
    $("scanClear").addEventListener("click", () => { scanChecks.length = 0; renderScanChecks(); });
  }
  function resumeScan() {
    if (!scan) return;
    scan.active = true;
    scan.tries = 0;
    $("scanAgain").hidden = true;
    $("lookupOut").innerHTML = "";
    if (scan.check) $("drawerBody").scrollTop = 0;   // (back to the camera)
    if (scan.noCamera) {   // (no camera to read from: the number box and the photo button still work)
      scan.active = false;
      $("scanForm").hidden = false;
      $("scanStatus").textContent = "The camera isn't available. Type the card number below, or use a photo.";
      $("scanNumber").focus();
      return;
    }
    $("scanStatus").textContent = "Looking for a card number…";
    scanLoop();
  }
  async function scanPhoto(file) {
    const mine = scan;
    if (!mine) return;
    const status = $("scanStatus");
    mine.active = false;
    clearTimeout(mine.timer);
    status.textContent = "Reading the photo…";
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { status.textContent = "That file isn't a photo Card Vault can read."; return; }
    let found = null;
    try {
      const w = bmp.width, h = bmp.height;
      const whole = invert => prepCanvas(bmp, 0, 0, w, h, 1600, {invert, radius: Math.max(w, h) * Math.min(1, 1600 / w) / 80});
      // The whole photo, then the same for light text on a dark frame, then the area where the number
      // sits on a card photographed on its own.
      found = matchScanned(await readCanvas(whole(false), "11")) || matchScanned(await readCanvas(whole(true), "11")) ||
        matchScanned(await readCanvas(prepCanvas(bmp, w * 0.35, h * 0.55, w * 0.65, h * 0.35, 1800, {radius: 24}), "11"));
    } catch (e) {
      status.textContent = "Couldn't load the text reader. It needs an internet connection the first time.";
      return;
    }
    if (scan !== mine) return;
    if (found) showScanResult(found);
    else {
      status.textContent = "No card number found in that photo. Try a closer, sharper photo of the card, or type the number below.";
      $("scanForm").hidden = false;
      $("scanAgain").hidden = !scan.stream;
    }
  }

  /* ======================= Delete & undo ======================= */
  function deleteRecords(ids) {
    const idSet = new Set(ids);
    const doomed = collection.filter(r => idSet.has(r.id));
    if (!doomed.length) return;
    const cards = doomed.reduce((s, r) => s + r.qty, 0);
    const what = doomed.length === 1 ? '"' + doomed[0].name + '"' + (doomed[0].qty > 1 ? " (all " + doomed[0].qty + " copies)" : "")
      : doomed.length + " printings (" + plural(cards, "card") + ")";
    if (!confirm("Delete " + what + " from your collection?")) return;
    const before = collection.slice();
    collection = collection.filter(r => !idSet.has(r.id));
    ids.forEach(id => selected.delete(id));
    save();
    if (!$("drawer").hidden) closeDrawer();
    render();
    toast("Deleted " + what + ".", {action: "Undo", onAction: () => { collection = before; save(); render(); toast("Restored."); }});
  }

