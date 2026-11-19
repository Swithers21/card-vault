  /* ======================= Sales from SortSwift ======================= */
  // Cards your shop sold, brought back: SortSwift's orders (in SortSwift, Orders, then export a CSV) or a TCGplayer
  // order export. Each line is matched to your cards like Import CSV matches them (TCGplayer product, card number,
  // name and set), the copies come out of your collection (the ones you sent to SortSwift first, then ones on your sell
  // list) and each sale goes in the sales log with its price, date and fees. Fees come from the file when it has
  // them, else from your selling fees (Settings). A line already brought in is never brought in twice (sale.ref), so
  // an export that overlaps the last one is fine. Cancelled and refunded orders stay out; buyers' names aren't read.
  // SortSwift lets you choose the export's columns, so they're found by their names (below), like Import CSV's.
  const SALE_ALIASES = {
    order: ["ordernumber", "orderno", "ordernum", "orderid", "order"],
    date: ["orderdate", "solddate", "saledate", "datesold", "dateordered", "orderedat", "placedat", "orderplaced", "paiddate", "createdat", "created", "date"],
    price: ["price", "saleprice", "soldprice", "unitprice", "itemprice", "priceeach", "soldfor", "sellprice", "sellingprice", "listingprice"],
    total: ["linetotal", "itemtotal", "extendedprice", "producttotal", "subtotal", "total", "amount"],
    fees: ["fees", "fee", "totalfees", "sellingfees", "sellerfees", "sellerfee", "marketplacefees", "marketplacefee", "platformfees", "platformfee", "commission"],
    channel: ["channel", "saleschannel", "salechannel", "marketplace", "platform", "source", "store"],
    status: ["status", "orderstatus"]
  };
  const SALE_NOT = /cancel|refund|void|return/i;   // (orders that didn't go through, by their status)
  function saleCols(headers) {
    const norm = headers.map(h => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    const idx = {};
    for (const f in SALE_ALIASES) { idx[f] = -1; for (const a of SALE_ALIASES[f]) { const at = norm.indexOf(a); if (at >= 0) { idx[f] = at; break; } } }
    return idx;
  }
  // "2026-10-14", "10/14/2026 3:22 PM", "2026-10-14T19:22:00Z", "Oct 14, 2026" → "2026-10-14" (your own day)
  function saleDay(raw) {
    const s = String(raw || "").trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/.exec(s);
    if (m && !/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s)) return m[1] + "-" + m[2] + "-" + m[3];
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(s);
    if (m) return localDay(new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]));
    const d = parseDate(s);
    return d ? localDay(d) : "";
  }
  const money = v => { const n = num(v); return n == null ? null : round2(Math.abs(n)); };
  // Your cards that could be the one sold: the same TCGplayer printing (else card number, else name and set), the
  // same printing (1st Edition and the rest) and language; any condition, the same one first
  function saleCands(rec) {
    const same = r => {
      if (!!r.sealed !== !!rec.sealed || r.grade || r.grading) return false;
      if (rec.productId) return r.productId === rec.productId;
      if (rec.number && r.number) return normNumber(r.number) === normNumber(rec.number) && (!rec.rarity || !r.rarity || r.rarity.toLowerCase() === rec.rarity.toLowerCase());
      return r.name.toLowerCase() === rec.name.toLowerCase() && (!rec.setName || r.setName.toLowerCase() === rec.setName.toLowerCase());
    };
    const ed = rec.edition, lang = rec.language || "English";
    return collection.filter(r => same(r) && (!ed || !r.edition || r.edition === ed) && (r.language || "English") === lang)
      .sort((a, b) => (+(b.condition === rec.condition) - +(a.condition === rec.condition)) || ((b.ssSent ? 1 : 0) - (a.ssSent ? 1 : 0)) || ((b.sell ? 1 : 0) - (a.sell ? 1 : 0)));
  }
  // What a file would do: {lines: [{n (line in the file), order, date, channel, rec (the card), qty, price, fees,
  // feesFrom ("file" or "settings"), ref, state ("new", "done": brought in before, "off": cancelled or refunded,
  // "bad": no card or price), why, takes: [{id, n, ss (of them sent to SortSwift), cond (true if the condition differs)}],
  // short (copies not in your collection)}], cols (the file's columns used), fileFees (whether it has fees)} or {error}
  function ssSalesPlan(text, opts) {
    opts = opts || {};
    const rows = parseCSV(String(text || ""));
    if (rows.length < 2) return {error: "That file has no order lines."};
    const headers = rows[0], idx = mapHeaders(headers), sx = saleCols(headers);
    if (idx.productId < 0 && idx.name < 0 && idx.productName < 0 && idx.number < 0) return {error: "Card Vault couldn't find a card name, card number or Product ID column. The columns in this file are: " + headers.map(h => '"' + String(h).trim() + '"').join(", ") + "."};
    if (sx.price < 0 && sx.total < 0) return {error: "Card Vault couldn't find the price the cards sold for (a Price or Total column). The columns in this file are: " + headers.map(h => '"' + String(h).trim() + '"').join(", ") + "."};
    const used = Object.keys(sx).filter(k => sx[k] >= 0).map(k => sx[k]).concat(["productId", "name", "productName", "number", "setName", "rarity", "condition", "edition", "language", "qtyTotal"].filter(k => idx[k] >= 0).map(k => idx[k]));
    const cols = Array.from(new Set(used)).sort((a, b) => a - b).map(i => String(headers[i]).trim());
    const left = new Map(collection.map(r => [r.id, {qty: r.qty, ss: Math.min(r.qty, r.ssSent || 0)}]));
    const seen = new Map(), done = new Set(sales.map(x => x.ref).filter(Boolean)), now = new Date().toISOString(), lines = [];
    rows.slice(1).forEach((row, i) => {
      const get = f => sx[f] >= 0 && row[sx[f]] != null ? String(row[sx[f]]).trim() : "";
      const line = {n: i + 2, order: get("order"), date: saleDay(get("date")) || localDay(new Date()), channel: get("channel"), takes: [], short: 0};
      lines.push(line);
      const res = rowToRecord(row, idx, now);
      if (res.skip) { line.state = "bad"; line.why = res.skip; return; }
      const rec = line.rec = res.rec;
      line.qty = rec.qty;
      const unit = money(get("price")), total = money(get("total"));
      line.price = unit != null ? unit : total != null ? round2(total / line.qty) : null;
      if (line.price == null) { line.state = "bad"; line.why = "no price"; return; }
      const fee = money(get("fees"));
      if (fee != null) { line.fees = fee; line.feesFrom = "file"; }
      else if (opts.estimate !== false) { line.fees = round2(line.price * line.qty * sellPct() / 100 + sellFlat() * line.qty); line.feesFrom = "settings"; }
      else { line.fees = 0; line.feesFrom = ""; }
      // (the same line twice in one order, two copies sold separately, say, stays two lines)
      const key = ["ss", line.order || line.date, rec.productId || normNumber(rec.number) + "/" + rec.name.toLowerCase(), rec.condition, rec.edition, rec.language, line.qty, line.price].join("|");
      const k = (seen.get(key) || 0) + 1;
      seen.set(key, k);
      line.ref = key + "|" + k;
      if (SALE_NOT.test(get("status"))) { line.state = "off"; line.why = get("status").toLowerCase(); return; }
      if (done.has(line.ref)) { line.state = "done"; return; }
      line.state = "new";
      let need = line.qty;
      for (const r of saleCands(rec)) {
        const l = left.get(r.id);
        if (!need) break;
        if (!l || !l.qty) continue;
        const n = Math.min(need, l.qty), ss = Math.min(n, l.ss);
        l.qty -= n; l.ss -= ss; need -= n;
        line.takes.push({id: r.id, n, ss, cond: r.condition !== rec.condition});
      }
      line.short = need;
    });
    return {lines, cols, fileFees: sx.fees >= 0, orders: new Set(lines.map(x => x.order).filter(Boolean)).size};
  }
  // Brings a plan in: the copies come out, the sales go in the log (with the ones not in your collection too, when
  // opts.missing). Returns {sales, copies, out (copies taken out), missing, gross, undo}
  function ssSalesApply(plan, opts) {
    opts = opts || {};
    const beforeCollection = collection.map(r => Object.assign({}, r, {sell: r.sell ? Object.assign({}, r.sell) : r.sell})), beforeSales = sales.slice();
    const res = {sales: 0, copies: 0, out: 0, missing: 0, gross: 0};
    for (const line of plan.lines) {
      if (line.state !== "new") continue;
      const note = "SortSwift" + (line.channel ? " (" + line.channel + ")" : "") + (line.order ? ", order " + line.order : "");
      const feeFor = n => round2((line.fees || 0) * n / line.qty);
      const f = n => ({date: line.date, price: line.price, fees: feeFor(n), notes: note, ref: line.ref});
      for (const t of line.takes) {
        const r = collection.find(x => x.id === t.id);
        if (!r) continue;
        const n = Math.min(t.n, r.qty);
        if (!n) continue;
        sales.push(saleEntry(r, n, f(n)));
        takeSold(r, n);
        res.sales++; res.copies += n; res.out += n; res.gross += line.price * n;
      }
      if (line.short && opts.missing !== false) {
        const r = line.rec;
        sales.push(upgradeSale(Object.assign({id: newId(), qty: line.short, name: r.name, productId: r.productId, number: r.number, setName: r.setName, rarity: r.rarity,
          edition: r.edition, condition: r.condition, language: r.language, paid: r.paid, market: marketValue(Object.assign({}, r, {qty: 1})).unit, image: imageFor(r, "200w"), record: null}, f(line.short))));
        res.sales++; res.copies += line.short; res.missing += line.short; res.gross += line.price * line.short;
      }
    }
    res.gross = round2(res.gross);
    if (!res.sales) return res;
    noteChange("Sold " + plural(res.out, "card") + " (SortSwift orders)");
    save();
    render();
    res.undo = () => {
      collection = beforeCollection;
      sales = beforeSales;
      for (const sid of Array.from(selected)) if (!collection.some(r => r.id === sid)) selected.delete(sid);
      noteChange("Took back the SortSwift sales");
      save();
      render();
    };
    return res;
  }

  const sso = {text: "", name: "", estimate: true, missing: true, plan: null, done: null};
  function openSsSales() {
    Object.assign(sso, {text: "", name: "", plan: null, done: null});
    drawerCtx = {mode: "ss-sales"};
    openDrawer("Sales from SortSwift", '<div id="ssoBody"></div>');
    renderSsSales();
  }
  function renderSsSales() {
    const box = $("ssoBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "ss-sales") return;
    if (!catalog) { box.innerHTML = '<div class="notice">This needs TCGplayer\'s card list, which hasn\'t loaded yet. Try again in a moment.</div>'; return; }
    const intro = '<p class="small" style="margin:0 0 10px">The cards your shop sold, back in Card Vault: they come out of your collection (the copies you sent to SortSwift first) ' +
      "and go in your sales log with what they sold for, so your profit is right. In SortSwift, open <b>Orders</b>, choose the dates, and export them as a CSV; a TCGplayer order export works too. " +
      "Bringing in a file that overlaps the last one is fine: a sale already here isn't added again.</p>";
    const pick = '<label class="btn" style="position:relative;overflow:hidden">' + (sso.text ? "Choose another file" : "Choose the orders file") +
      '<input type="file" id="ssoFile" accept=".csv,text/csv" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>' + (sso.name ? ' <span class="small">' + esc(sso.name) + "</span>" : "");
    if (sso.done) {
      const d = sso.done;
      box.innerHTML = intro + '<div class="notice good" role="status">Recorded ' + plural(d.sales, "sale") + " (" + plural(d.copies, "card") + ", " + esc(usd(d.gross)) + "). " +
        (d.out ? plural(d.out, "card") + " came out of your collection. " : "") + (d.missing ? plural(d.missing, "card wasn't", "cards weren't") + " in Card Vault, so just the sale is logged. " : "") +
        '<button type="button" class="link-btn" id="ssoUndo">Undo</button></div>' +
        '<div class="form-actions"><button type="button" class="btn" id="ssoLog">See the sales log</button>' + pick + "</div>";
      $("ssoUndo").addEventListener("click", () => { if (d.undo) d.undo(); sso.done = null; sso.plan = sso.text ? ssSalesPlan(sso.text, {estimate: sso.estimate}) : null; renderSsSales(); toast("Taken back."); });
      $("ssoLog").addEventListener("click", () => { settings.salesView = "log"; closeDrawer(); setTab("sales", true); renderSalesTab(); });
      wireSsoFile();
      return;
    }
    const p = sso.plan;
    if (!p) { box.innerHTML = intro + '<div class="form-actions">' + pick + "</div>"; wireSsoFile(); return; }
    if (p.error) { box.innerHTML = intro + '<div class="notice bad" role="alert">' + esc(p.error) + '</div><div class="form-actions">' + pick + "</div>"; wireSsoFile(); return; }
    const L = p.lines, sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
    const fresh = L.filter(x => x.state === "new"), done = L.filter(x => x.state === "done"), off = L.filter(x => x.state === "off"), bad = L.filter(x => x.state === "bad");
    const out = sum(fresh, x => sum(x.takes, t => t.n)), ss = sum(fresh, x => sum(x.takes, t => t.ss)), short = sum(fresh, x => x.short);
    const copies = sum(fresh, x => x.qty), gross = sum(fresh, x => x.price * x.qty), feesNow = sum(fresh, x => x.fees || 0);
    const days = fresh.map(x => x.date).sort(), span = days.length ? (days[0] === days[days.length - 1] ? fmtDate(parseDay(days[0])) : fmtShortDate(parseDay(days[0])) + " to " + fmtDate(parseDay(days[days.length - 1]))) : "";
    const condDiff = sum(fresh, x => sum(x.takes.filter(t => t.cond), t => t.n));
    const est = fresh.some(x => x.feesFrom === "settings");
    const where = x => {
      if (x.state === "done") return "Already in your sales log";
      if (x.state === "off") return "Left out: " + x.why;
      if (x.state === "bad") return "Left out: " + x.why;
      const parts = x.takes.map(t => { const r = collection.find(c => c.id === t.id); return t.n + " from " + (r && String(r.location || "").trim() ? r.location : "no location") + (t.cond && r ? " (" + r.condition + " in Card Vault)" : ""); });
      if (x.short) parts.push(x.short + " not in Card Vault");
      return parts.join("; ");
    };
    const row = x => '<li class="sso-line sso-' + x.state + '"><div><b>' + esc(x.rec ? x.rec.name : "Line " + x.n) + "</b>" +
      (x.rec ? ' <span class="small">' + esc([x.rec.number, x.rec.edition === "No edition mark" ? "" : x.rec.edition, x.rec.condition].filter(Boolean).join(" · ")) + "</span>" : "") +
      '<div class="small">' + esc(where(x)) + "</div></div>" +
      (x.price != null ? '<div class="sso-amt">' + (x.qty > 1 ? x.qty + " × " : "") + esc(usd(x.price)) + '<div class="small">' + esc(fmtShortDate(parseDay(x.date))) + "</div></div>" : "") + "</li>";
    box.innerHTML = intro +
      '<div class="pcx-sum">' +
      '<p class="pcx-line"><b>' + (fresh.length ? plural(copies, "card") + " sold for " + esc(usd(gross)) : "Nothing new to bring in") + "</b>" +
      (fresh.length ? " (" + plural(fresh.length, "line") + (p.orders ? " from " + plural(new Set(fresh.map(x => x.order).filter(Boolean)).size, "order") : "") + (span ? ", " + esc(span) : "") + ")" : "") + "</p>" +
      (out ? '<p class="pcx-line small">' + plural(out, "card comes", "cards come") + " out of your collection" + (ss ? ", " + (ss === out ? "all of them" : ss) + " sent to SortSwift" : "") + "." + (condDiff ? " " + plural(condDiff, "is", "are") + " in a different condition in Card Vault; the closest copies go." : "") + "</p>" : "") +
      (short ? '<p class="pcx-line small">' + plural(short, "card isn't", "cards aren't") + " in Card Vault.</p>" : "") +
      (done.length ? '<p class="pcx-line small">' + plural(done.length, "line was", "lines were") + " brought in before, so " + (done.length === 1 ? "it's" : "they're") + " left out.</p>" : "") +
      (off.length ? '<p class="pcx-line small">' + plural(off.length, "cancelled or refunded line") + " left out.</p>" : "") +
      (bad.length ? '<p class="pcx-line small">' + plural(bad.length, "line") + " Card Vault couldn't read, left out.</p>" : "") +
      "</div>" +
      (short ? '<label class="check-row" style="margin-top:10px"><input type="checkbox" class="check" id="ssoMissing"' + (sso.missing ? " checked" : "") + "> <span>Log the " + plural(short, "sale") + " of cards not in Card Vault too (nothing to take out)</span></label>" : "") +
      (p.fileFees ? '<p class="hint" style="margin:8px 0 0">Fees from the file: ' + esc(usd(feesNow)) + ".</p>"
        : '<label class="check-row" style="margin-top:10px"><input type="checkbox" class="check" id="ssoEst"' + (sso.estimate ? " checked" : "") + "> <span>The file has no fees: work them out from your selling fees (" + esc(feeWords()) + ")" + (est ? ", " + esc(usd(feesNow)) + " in all" : "") + "</span></label>") +
      (L.length ? '<ul class="sso-list">' + L.slice(0, 200).map(row).join("") + (L.length > 200 ? '<li class="small">…and ' + (L.length - 200) + " more lines</li>" : "") + "</ul>" : "") +
      '<details class="more"><summary>Columns Card Vault used</summary><p class="small">' + esc(p.cols.join(", ")) + ". Anything else in the file, like buyers' names and addresses, isn't read.</p></details>" +
      '<div class="form-actions"><button type="button" class="btn btn-primary" id="ssoGo"' + (fresh.length ? "" : " disabled") + ">Record " + (fresh.length ? plural(fresh.length, "sale") : "the sales") + "</button>" + pick + "</div>";
    if ($("ssoMissing")) $("ssoMissing").addEventListener("change", e => { sso.missing = e.target.checked; });
    if ($("ssoEst")) $("ssoEst").addEventListener("change", e => { sso.estimate = e.target.checked; sso.plan = ssSalesPlan(sso.text, {estimate: sso.estimate}); renderSsSales(); });
    $("ssoGo").addEventListener("click", () => {
      const fresh2 = ssSalesPlan(sso.text, {estimate: sso.estimate});      // (afresh: in case anything changed since)
      sso.done = ssSalesApply(fresh2, {missing: sso.missing});
      sso.plan = null;
      renderSsSales();
    });
    wireSsoFile();
  }
  function wireSsoFile() {
    const inp = $("ssoFile");
    if (!inp) return;
    inp.addEventListener("change", async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      sso.text = await file.text();
      sso.name = file.name;
      sso.done = null;
      sso.plan = ssSalesPlan(sso.text, {estimate: sso.estimate});
      renderSsSales();
    });
  }
