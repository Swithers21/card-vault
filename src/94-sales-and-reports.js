  /* ======================= Sales ======================= */
  function openSoldForm(id) {
    const r = collection.find(x => x.id === id);
    if (!r) return;
    drawerCtx = {mode: "sold", id};
    const mv = marketValue(r).unit;
    openDrawer("Record a sale",
      '<div class="picked"><span class="sleeve">' + imgTag(recordPics(r, "in_400x400"), r.name, true) + "</span><div><h3>" + esc(r.name) + "</h3><p>" +
      esc(r.setName) + "</p><p>" + esc([r.number, r.rarity].filter(Boolean).join(", ")) + "</p><p>" +
      esc([r.edition, r.grade ? gradeLabel(r.grade) : r.condition].filter(Boolean).join(", ")) + ". You have " + r.qty + ".</p></div></div>" +
      '<form id="soldForm" class="stack" novalidate>' +
      '<div class="grid-2"><label class="field"><span>How many you sold</span><input class="input" id="sQty" type="number" min="1" max="' + r.qty + '" step="1" value="1"></label>' +
      '<label class="field"><span>Sold for, each (US$)</span><input class="input" id="sPrice" type="number" min="0" step="0.01" autofocus' +
      (mv != null ? ' placeholder="' + esc(mv.toFixed(2)) + '"' : "") + (sellAsk(r) != null ? ' value="' + sellAsk(r) + '"' : "") + "></label></div>" +
      '<div class="grid-2"><label class="field"><span>Date</span><input class="input" id="sDate" type="date" value="' + localDay(new Date()) + '"></label>' +
      '<label class="field"><span>Fees and shipping, total (optional)</span><input class="input" id="sFees" type="number" min="0" step="0.01" placeholder="$"></label></div>' +
      '<label class="field"><span>Where, or who bought it (optional)</span><input class="input" id="sNotes" placeholder="e.g. eBay, a local store, a trade"></label>' +
      '<div class="price-line" id="soldInfo"></div>' +
      '<p class="hint" style="margin:0">For a trade or a gift, enter what the card was worth to you, or 0.</p>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Record the sale</button><button class="btn" type="button" id="soldBack">Back</button></div></form>');
    const info = () => {
      const qty = Math.min(Math.max(posInt($("sQty").value) || 1, 1), r.qty);
      const price = num($("sPrice").value), fees = num($("sFees").value) || 0;
      const parts = [];
      if (mv != null) parts.push("Market value now: <b>" + esc(usd(mv)) + "</b> each");
      if (sellAsk(r) != null) parts.push("your asking price " + esc(usd(sellAsk(r))));
      if (r.paid != null) parts.push("you paid " + esc(usd(r.paid)) + " each");
      let html = parts.length ? parts.join(", ") + "." : '<span class="small">No market value or price paid to compare with.</span>';
      if (price != null && r.paid != null) html += "<br>Profit: " + changeHTML(price * qty - fees - r.paid * qty, null, true);
      else if (price != null && mv != null) html += "<br>Compared with market value: " + changeHTML((price - mv) * qty, null, true);
      $("soldInfo").innerHTML = html;
    };
    ["sQty", "sPrice", "sFees"].forEach(k => $(k).addEventListener("input", info));
    info();
    $("soldBack").addEventListener("click", () => openDetails(r.id));
    $("soldForm").addEventListener("submit", e => {
      e.preventDefault();
      const price = num($("sPrice").value);
      if (price == null || price < 0) { toast("Enter what you sold it for (0 for a gift).", {kind: "error"}); $("sPrice").focus(); return; }
      recordSale(r, {qty: posInt($("sQty").value) || 1, price, fees: num($("sFees").value) || 0, date: $("sDate").value, notes: $("sNotes").value.trim()});
    });
  }
  function recordSale(r, f) {
    if (!collection.includes(r)) r = collection.find(x => x.id === r.id);
    if (!r) return;
    const qty = Math.min(Math.max(1, f.qty), r.qty);
    const sale = upgradeSale({id: newId(), date: parseDay(f.date) ? f.date : localDay(new Date()), qty, price: f.price, fees: f.fees, notes: f.notes,
      name: r.name, productId: r.productId, number: r.number, setName: r.setName, rarity: r.rarity, edition: r.edition, condition: r.condition,
      language: r.language, grade: r.grade, paid: r.paid, market: marketValue(r).unit, image: imageFor(r, "200w"),
      record: JSON.parse(JSON.stringify(Object.assign({}, r, {qty, sell: null})))});
    const beforeCollection = collection.slice(), beforeQty = r.qty, beforeSales = sales.slice(), beforeSell = r.sell ? Object.assign({}, r.sell) : null;
    r.qty -= qty;
    if (r.qty <= 0) { collection = collection.filter(x => x !== r); selected.delete(r.id); }
    else if (r.sell && r.sell.qty) { r.sell.qty -= qty; if (r.sell.qty <= 0) r.sell = null; else if (r.sell.qty >= r.qty) r.sell.qty = null; }
    sales.push(sale);
    save(); closeDrawer(); render();
    toast("Recorded the sale of " + (qty > 1 ? qty + " × " : "") + r.name + " for " + usd(f.price * qty) + ".", {action: "Undo", onAction: () => {
      r.qty = beforeQty; r.sell = beforeSell; collection = beforeCollection; sales = beforeSales; save(); render();
    }});
  }
  function saleNumbers(x) {
    const gross = x.price * x.qty, net = gross - (x.fees || 0);
    return {gross, net, profit: x.paid != null ? net - x.paid * x.qty : null, vsMarket: x.market != null ? gross - x.market * x.qty : null};
  }
  function salesShown() {
    return sales.filter(x => !settings.salesYear || x.date.startsWith(settings.salesYear))
      .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  }
  function renderSales() {
    const panel = $("salesBody") || $("panel-sales");
    const years = Array.from(new Set(sales.map(x => x.date.slice(0, 4)))).sort().reverse();
    if (settings.salesYear && !years.includes(settings.salesYear)) settings.salesYear = "";
    const list = salesShown();
    let cards = 0, net = 0, profit = 0, profitCards = 0, vsMarket = 0, marketCards = 0;
    for (const x of list) {
      const n = saleNumbers(x);
      cards += x.qty; net += n.net;
      if (n.profit != null) { profit += n.profit; profitCards += x.qty; }
      if (n.vsMarket != null) { vsMarket += n.vsMarket; marketCards += x.qty; }
    }
    const head = '<div class="panel-head sub-head"><div><h3 class="sub-h">Sales log</h3><p>' + (sales.length
      ? "Cards you've sold or traded away" + (settings.salesYear ? " in " + esc(settings.salesYear) : "") + "."
      : "Cards you've sold or traded away, and what you made on them.") + "</p></div>" +
      (sales.length ? '<div class="panel-tools"><label class="basis">Year <select class="select" id="salesYear"><option value="">All years</option>' +
        years.map(y => '<option value="' + y + '"' + (y === settings.salesYear ? " selected" : "") + ">" + y + "</option>").join("") + "</select></label>" +
        '<button class="btn btn-small" type="button" id="salesExport">Export sales CSV</button></div>' : "") + "</div>";
    if (!sales.length) {
      panel.innerHTML = head + emptyPanel("No sales yet", "When you sell or trade away a card, open it in your collection and choose <b>Sold</b>. " +
        "Card Vault takes it out of your collection, keeps the sale here, and works out your profit.");
      return;
    }
    const fact = (value, label) => '<div class="fact"><b>' + value + "</b><span>" + label + "</span></div>";
    panel.innerHTML = head + '<div class="facts sales-facts">' +
      fact(cards.toLocaleString(), "cards sold") + fact(esc(usd(net)), "you received, after fees") +
      (profitCards ? fact(changeHTML(profit, null, true), "profit on the " + plural(profitCards, "card") + " with a price paid") : "") +
      (marketCards ? fact(changeHTML(vsMarket, null, true), "compared with market value") : "") + "</div>" +
      '<div class="table-wrap"><table class="table stack-table sales-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>Card</th><th>Date</th>' +
      '<th class="num">Qty</th><th class="num">Sold for, each</th><th class="num">Fees</th><th class="num">Paid, each</th><th class="num">Profit</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(x => {
        const n = saleNumbers(x);
        return '<tr><td class="c-thumb"><span class="sleeve">' + imgTag(salePics(x), x.name) + "</span></td>" +
          '<td><b>' + esc(x.name) + '</b><span class="cell-sub">' + esc([x.setName, x.number, x.edition, x.grade ? gradeLabel(x.grade) : x.condition].filter(Boolean).join(", ")) +
          (x.notes ? ". " + esc(x.notes) : "") + "</span></td>" +
          '<td data-label="Date">' + esc(fmtDate(parseDay(x.date))) + '</td><td class="num" data-label="Qty">' + x.qty +
          '</td><td class="num" data-label="Sold for, each">' + esc(usd(x.price)) + '</td><td class="num" data-label="Fees"' + (x.fees ? "" : " data-empty") + ">" + esc(x.fees ? usd(x.fees) : "") +
          '</td><td class="num" data-label="Paid, each"' + (x.paid == null ? " data-empty" : "") + ">" + esc(x.paid == null ? "" : usd(x.paid)) +
          '</td><td class="num" data-label="Profit"' + (n.profit == null ? " data-empty" : "") + ">" + (n.profit == null ? "" : changeHTML(n.profit, null, true)) + "</td>" +
          '<td><div class="want-actions"><button class="btn btn-small" type="button" data-sale-action="back" data-id="' + esc(x.id) + '">Put back</button>' +
          '<button class="btn btn-small" type="button" data-sale-action="delete" data-id="' + esc(x.id) + '" aria-label="Delete this sale of ' + esc(x.name) + '">Delete</button></div></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="small">Profit is what you received after fees, minus what you paid. "Put back" returns the card to your collection and removes the sale.</p>';
  }
  function putBackSale(id) {
    const x = sales.find(s => s.id === id);
    if (!x) return;
    const beforeCollection = collection.slice(), beforeSales = sales.slice();
    const base = x.record || {name: x.name, productId: x.productId, number: x.number, setName: x.setName, rarity: x.rarity, edition: x.edition,
      condition: x.condition, language: x.language, grade: x.grade, paid: x.paid};
    const rec = upgradeRecord(Object.assign({}, base, {id: newId(), qty: x.qty}));
    // a copy you still have takes it back, and may take its price paid or notes: Undo puts those back too
    const target = collection.find(r => recordKey(r) === recordKey(rec));
    const targetWas = target && {paid: target.paid, notes: target.notes};
    const res = addOrMerge(rec);
    sales = sales.filter(s => s !== x);
    save(); render();
    toast("Put " + (x.qty > 1 ? x.qty + " × " : "") + x.name + " back in your collection.", {action: "Undo", onAction: () => {
      if (res.merged) { res.record.qty -= x.qty; if (res.record === target) Object.assign(res.record, targetWas); }
      collection = beforeCollection; sales = beforeSales; save(); render();
    }});
  }
  function deleteSale(id) {
    const x = sales.find(s => s.id === id);
    if (!x) return;
    const before = sales.slice();
    sales = sales.filter(s => s !== x);
    save(); render();
    toast("Deleted the sale of " + x.name + ". The card stays out of your collection.", {action: "Undo", onAction: () => { sales = before; save(); render(); }});
  }
  const csvCell = v => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportSalesCSV() {
    const list = salesShown();
    if (!list.length) { toast("There are no sales to export."); return; }
    const money2 = v => v == null ? "" : (Math.round(v * 100) / 100).toFixed(2);
    const cols = [["Date", x => x.date], ["Card Name", x => x.name], ["Set Name", x => x.setName], ["Number", x => x.number], ["Rarity", x => x.rarity],
      ["Printing", x => x.edition], ["Condition", x => x.condition], ["Graded", x => x.grade ? gradeLabel(x.grade) : ""], ["Language", x => x.language],
      ["Quantity", x => x.qty], ["Sold For Each (USD)", x => money2(x.price)], ["Fees (USD)", x => money2(x.fees)], ["Received After Fees (USD)", x => money2(saleNumbers(x).net)],
      ["Paid Each (USD)", x => money2(x.paid)], ["Profit (USD)", x => money2(saleNumbers(x).profit)], ["Market Value Each (USD)", x => money2(x.market)], ["Notes", x => x.notes]];
    const lines = [cols.map(c => csvCell(c[0])).join(",")].concat(list.map(x => cols.map(c => csvCell(c[1](x))).join(",")));
    download(new Blob(["\ufeff" + lines.join("\r\n")], {type: "text/csv;charset=utf-8"}), "card-vault-sales" + (settings.salesYear ? "-" + settings.salesYear : "") + ".csv");
    toast("Exported " + plural(list.length, "sale") + ".");
  }

  /* ======================= Selling: the sell list and listings ======================= */
  // Cards you mean to sell go on your sell list (Trades & sales > Selling), each with an asking price and how many.
  // Card Vault suggests prices from today's market, works out what you'd keep after the selling site's fees
  // (Settings > Selling fees), notices when the market moves away from your price, and writes a listing's title
  // and description to paste into eBay, TCGplayer or a post.
  const COND_SHORT = {"Near Mint": "NM", "Lightly Played": "LP", "Moderately Played": "MP", "Heavily Played": "HP", "Damaged": "DMG"};
  const sellPct = () => { const v = num(settings.sellFeePct); return v == null ? 13 : Math.min(Math.max(v, 0), 60); };
  const sellFlat = () => { const v = num(settings.sellFeeFlat); return v == null ? 0.3 : Math.min(Math.max(v, 0), 50); };
  const afterFees = price => price == null ? null : round2(Math.max(0, price * (1 - sellPct() / 100) - sellFlat()));
  const feeWords = () => [sellPct() ? +sellPct().toFixed(2) + "%" : "", sellFlat() ? usd(sellFlat()) + " a card" : ""].filter(Boolean).join(" + ") || "no fees";
  const sellQty = r => r.sell && r.sell.qty ? Math.min(r.sell.qty, r.qty) : r.qty;
  const sellAsk = r => r.sell && r.sell.price != null ? r.sell.price : null;
  const sellingList = () => collection.filter(r => r.sell).map(r => ({r, v: marketValue(r).unit})).sort((a, b) => ((b.v || 0) - (a.v || 0)) || a.r.name.localeCompare(b.r.name)).map(x => x.r);
  // Prices to start from, for one copy
  function sellSuggestions(r) {
    const out = [];
    const mv = marketValue(r).unit;
    const slabNoValue = r.grade && r.grade.value == null;
    if (mv != null) out.push({k: "market", label: r.grade && r.grade.value != null ? "Your graded value" : slabNoValue ? "Ungraded market value" : "Market value", price: round2(mv)});
    const p = catalog && r.productId ? catalog.byId.get(r.productId) : null;
    const sub = p ? catalogPrice(p, r.edition) : null;
    if (sub && sub.low != null && !r.grade) out.push({k: "low", label: "Lowest TCGplayer listing", price: round2(sub.low)});
    if (mv != null && mv >= 1 && !slabNoValue) out.push({k: "quick", label: "Quick sale (10% under)", price: round2(mv * 0.9)});
    if (r.paid != null && r.paid > 0) out.push({k: "even", label: "Break even", price: Math.ceil((r.paid + sellFlat()) / Math.max(0.01, 1 - sellPct() / 100) * 100) / 100});
    return out;
  }
  // What you'd keep at this price, and against what you paid
  function sellKeepHTML(r, price) {
    if (price == null) return "Choose an asking price to see what you'd keep after fees.";
    const keep = afterFees(price);
    let html = "At " + esc(usd(price)) + " you'd keep about <b>" + esc(usd(keep)) + "</b> a card after fees (" + esc(feeWords()) + '; <button type="button" class="link-btn" data-sell="fees">change</button>)';
    if (r.paid != null) html += ", " + changeHTML(keep - r.paid, null, true) + " against the " + esc(usd(r.paid)) + " you paid";
    if (r.grade && r.grade.value == null) html += ". Enter its graded value below for a better price to start from";
    return html + ".";
  }
  // The title: eBay allows 80 characters, so the parts buyers need least go first when it's too long.
  function listingTitle(r) {
    const ed = r.edition === "1st Edition" ? "1st Edition" : r.edition === "Limited" ? "Limited Edition" : "";
    const parts = [r.grade ? gradeLabel(r.grade) : "", "Yu-Gi-Oh!", r.language && r.language !== "English" ? r.language : "",
      !r.sealed && isRushNo(r.number) && !/rush/i.test(r.name) ? "Rush Duel" : "", r.name, r.sealed ? "" : r.number, r.sealed ? "" : r.rarity, r.sealed ? "" : ed,
      r.sealed ? "Sealed" : r.grade ? "" : COND_SHORT[r.condition] || ""];
    const text = () => parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    for (const i of [1, 8, 3, 6]) { if (text().length <= 80) break; parts[i] = ""; }
    // still too long: the name is shortened (at a word), so the number stays
    if (text().length > 80) { const room = 80 - (text().length - parts[4].length); parts[4] = parts[4].slice(0, Math.max(10, room)).replace(/\s+\S*$/, ""); }
    return text().slice(0, 80);
  }
  function listingText(r) {
    const lines = [listingTitle(r), ""];
    const row = (k, v) => { if (v) lines.push(k + ": " + v); };
    row(r.sealed ? "Product" : "Card", r.name);
    row("Set", r.setName);
    if (!r.sealed) {
      row("Card number", r.number);
      row("Rarity", r.rarity);
      row("Printing", r.edition && r.edition !== "No edition mark" ? r.edition : "");
      if (isRushNo(r.number)) row("Game", "Rush Duel");
      if (isOverframeRec(r)) row("Frame", "Overframe (extended art)");
      if (isMangaRec(r)) row("Artwork", "Manga-Style, " + (mangaOf(r.rarity) === "Color" ? "color" : "black and white") + " version");
    }
    if (r.grade) row("Graded", gradeLabel(r.grade) + (r.grade.cert ? " (cert " + r.grade.cert + ")" : ""));
    else row("Condition", r.sealed ? "Factory sealed" : r.condition);
    row("Language", r.language);
    const q = sellQty(r), a = sellAsk(r);
    if (q > 1) row("Quantity", q + " available");
    if (a != null) row("Price", usd(a) + (q > 1 ? " each" : ""));
    if (r.photos && r.photos.length) lines.push("", "The photos are of the actual " + (r.sealed ? "item" : "card") + ".");
    return lines.join("\n");
  }
  const ebaySoldURL = r => "https://www.ebay.com/sch/i.html?_nkw=" + encodeURIComponent(r.sealed ? r.name : ((r.number || "") + " " + lookupName(r.name) + (r.grade ? " " + gradeLabel(r.grade) : "")).trim()) + "&LH_Sold=1&LH_Complete=1";
  // The market moved away from your price
  function sellDrift(r) {
    const a = sellAsk(r), mv = marketValue(r).unit;
    if (a == null || a <= 0 || mv == null || mv <= 0 || (r.grade && r.grade.value == null)) return "";
    if (mv >= a * 1.1) return "The market is up to " + usd(mv) + ": you may be asking too little.";
    if (mv <= a / 1.25) return "You're asking " + Math.round((a - mv) / mv * 100) + "% over the market (" + usd(mv) + ").";
    return "";
  }
  // Card details > Selling
  function sellBoxHTML(r) {
    const on = !!r.sell, sugg = sellSuggestions(r), price = sellAsk(r);
    let html = on ? '<div class="grid-2"><label class="field"><span>Asking price, each (US$)</span><input class="input" id="sellPrice" type="number" min="0" step="0.01" value="' + (price == null ? "" : price) + '"></label>' +
        '<label class="field"><span>How many to sell (you have ' + r.qty + ')</span><input class="input" id="sellQty" type="number" min="1" max="' + r.qty + '" step="1" value="' + sellQty(r) + '"></label></div>'
      : '<p class="small" style="margin:0 0 8px">Put it on your sell list (Trades &amp; sales &gt; Selling) with an asking price, and Card Vault tells you when the market moves away from it. Pick a price to start from:</p>';
    if (sugg.length) html += '<div class="sell-sugg">' + sugg.map(s => '<button type="button" class="chip" data-sell-pick="' + s.price + '"' + (on && s.price === price ? ' aria-pressed="true"' : "") + ">" + esc(s.label) + " <b>" + esc(usd(s.price)) + "</b></button>").join("") + "</div>";
    else if (!on) html += '<div class="btn-row" style="margin-top:0"><button type="button" class="btn btn-small" data-sell="on">Put it on my sell list</button></div>';
    const drift = on ? sellDrift(r) : "";
    html += (drift ? '<p class="small sell-drift">' + esc(drift) + "</p>" : "") +
      '<p class="small" id="sellKeep" style="margin:8px 0 0">' + sellKeepHTML(r, on ? price : sugg[0] ? sugg[0].price : null) + "</p>" +
      '<label class="field" style="margin-top:10px"><span>Listing title</span><input class="input" id="sellTitle" readonly value="' + esc(listingTitle(r)) + '"></label>' +
      '<div class="btn-row"><button type="button" class="btn btn-small" data-sell="copy-title">Copy title</button><button type="button" class="btn btn-small" data-sell="copy-text">Copy listing</button>' +
      '<a class="btn btn-small" target="_blank" rel="noopener" href="' + esc(ebaySoldURL(r)) + '">What it sold for on eBay</a></div>' +
      (on ? '<p class="small" style="margin:8px 0 0">On your sell list since ' + esc(fmtDate(parseDate(r.sell.since))) + '. <button type="button" class="link-btn" data-sell="off">Take it off the list</button></p>' : "");
    return html;
  }
  function setSell(r, sell, words) {
    const was = r.sell;
    r.sell = sell;
    save(); renderSoon();
    if (words) toast(words, {action: "Undo", onAction: () => { const cur = collection.find(x => x.id === r.id); if (!cur) return; cur.sell = was; save(); renderSoon(); redrawSellBox(cur.id); }});
  }
  function redrawSellBox(id) {
    const r = collection.find(x => x.id === id);
    if (r && $("sellBox") && drawerCtx && drawerCtx.mode === "details" && drawerCtx.id === id) $("sellBox").innerHTML = sellBoxHTML(r);
  }
  function wireSellBox(id) {
    const box = $("sellBox");
    if (!box) return;
    const cur = () => collection.find(x => x.id === id);
    box.addEventListener("click", e => {
      const r = cur();
      if (!r) return;
      const pick = e.target.closest("[data-sell-pick]");
      if (pick) {
        const v = round2(num(pick.dataset.sellPick));
        if (!r.sell) setSell(r, normSell({price: v}), "Put " + r.name + " on your sell list at " + usd(v) + ".");
        else { r.sell.price = v; save(); renderSoon(); }
        redrawSellBox(id);
        return;
      }
      const b = e.target.closest("[data-sell]");
      if (!b) return;
      const a = b.dataset.sell;
      if (a === "on") { setSell(r, normSell({price: null}), "Put " + r.name + " on your sell list."); redrawSellBox(id); }
      else if (a === "off") { setSell(r, null, "Took " + r.name + " off your sell list."); redrawSellBox(id); }
      else if (a === "copy-title") copyText(listingTitle(r), () => toast("Copied the listing title."));
      else if (a === "copy-text") copyText(listingText(r), () => toast("Copied the listing: paste it into the description."));
      else if (a === "fees") openSettings({section: "selling"});
    });
    box.addEventListener("change", e => {
      const r = cur();
      if (!r || !r.sell) return;
      if (e.target.id === "sellPrice") { const v = num(e.target.value); r.sell.price = v != null && v >= 0 ? round2(v) : null; }
      else if (e.target.id === "sellQty") { const q = posInt(e.target.value); r.sell.qty = q && q < r.qty ? q : null; e.target.value = sellQty(r); }
      else return;
      save(); renderSoon();
      if ($("sellKeep")) $("sellKeep").innerHTML = sellKeepHTML(r, sellAsk(r));
      if ($("sellTitle")) $("sellTitle").value = listingTitle(r);
    });
    box.addEventListener("input", e => {
      if (e.target.id !== "sellPrice") return;
      const r = cur();
      if (r && $("sellKeep")) $("sellKeep").innerHTML = sellKeepHTML(r, num(e.target.value));
    });
  }
  // Trades & sales > Selling
  function renderSelling() {
    const panel = $("salesBody") || $("panel-sales");
    const list = sellingList();
    const head = '<div class="panel-head sub-head"><div><h3 class="sub-h">Selling</h3><p>' + (list.length
      ? "Your sell list: your asking prices next to today's market, and what you'd keep after fees (" + esc(feeWords()) + ', <button type="button" class="link-btn" data-sell-act="fees">change</button>).'
      : "Cards you mean to sell, with your asking prices.") + "</p></div>" +
      (list.length ? '<div class="panel-tools"><button class="btn btn-small" type="button" data-sell-act="copy-all">Copy all listings</button>' +
        '<button class="btn btn-small" type="button" data-sell-act="export">Export CSV</button></div>' : "") + "</div>";
    if (!list.length) {
      panel.innerHTML = head + emptyPanel("Nothing on your sell list", "Open a card in your collection and pick a price under <b>Selling</b>, or select several cards and choose <b>Sell list</b>. " +
        "Card Vault suggests a price from today's market, works out what you'd keep after fees and writes the listing for you.");
      return;
    }
    panel.innerHTML = head + '<div class="facts sales-facts" id="sellFacts">' + sellFactsHTML(list) + "</div>" +
      '<div class="table-wrap"><table class="table stack-table sales-table sell-table"><thead><tr><th class="c-thumb"><span class="sr">Image</span></th><th>Card</th>' +
      '<th class="num">To sell</th><th class="num">Asking, each</th><th class="num">Market, each</th><th class="num">You\'d keep, each</th><th class="num">Paid, each</th><th><span class="sr">Actions</span></th></tr></thead><tbody>' +
      list.map(r => {
        const a = sellAsk(r), mv = marketValue(r).unit, drift = sellDrift(r);
        return '<tr><td class="c-thumb"><span class="sleeve' + (r.sealed ? " boxed" : "") + '">' + imgTag(recordPics(r, "200w"), r.name) + "</span></td>" +
          '<td><button type="button" class="cell-name" data-open="' + esc(r.id) + '">' + esc(r.name) + '</button><span class="cell-sub">' +
          esc([r.sealed ? "Sealed" : r.number, r.sealed ? "" : r.rarity, r.edition === "No edition mark" ? "" : r.edition, r.grade ? gradeLabel(r.grade) : r.sealed ? "" : r.condition].filter(Boolean).join(", ")) +
          ". Listed " + esc(fmtShortDate(parseDate(r.sell.since))) + '</span><span class="cell-sub sell-drift" data-drift="' + esc(r.id) + '"' + (drift ? "" : " hidden") + ">" + esc(drift) + "</span></td>" +
          '<td class="num" data-label="To sell"><input class="input sell-in" type="number" min="1" max="' + r.qty + '" step="1" data-sell-qty="' + esc(r.id) + '" value="' + sellQty(r) + '" aria-label="How many ' + esc(r.name) + ' to sell"></td>' +
          '<td class="num" data-label="Asking, each"><input class="input sell-in" type="number" min="0" step="0.01" data-sell-price="' + esc(r.id) + '" value="' + (a == null ? "" : a) + '" placeholder="' + esc(mv == null ? "$" : mv.toFixed(2)) + '" aria-label="Asking price for ' + esc(r.name) + '"></td>' +
          '<td class="num" data-label="Market, each"' + (mv == null ? " data-empty" : "") + ">" + esc(mv == null ? "" : usd(mv)) + "</td>" +
          '<td class="num" data-label="You\'d keep, each" data-keep="' + esc(r.id) + '"' + (a == null ? " data-empty" : "") + ">" + esc(a == null ? "" : usd(afterFees(a))) + "</td>" +
          '<td class="num" data-label="Paid, each"' + (r.paid == null ? " data-empty" : "") + ">" + esc(r.paid == null ? "" : usd(r.paid)) + "</td>" +
          '<td><div class="want-actions"><button class="btn btn-small" type="button" data-sell-act="sold" data-id="' + esc(r.id) + '">Sold…</button>' +
          '<button class="btn btn-small" type="button" data-sell-act="copy" data-id="' + esc(r.id) + '">Copy listing</button>' +
          '<button class="btn btn-small" type="button" data-sell-act="off" data-id="' + esc(r.id) + '" aria-label="Take ' + esc(r.name) + ' off the sell list">Remove</button></div></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="small">Market is today\'s value of your copy (TCGplayer, or the Japanese and Korean shops, with your condition percentages). "Sold…" records the sale in the Sales log and takes the card out of your collection.</p>';
  }
  function sellFactsHTML(list) {
    let cards = 0, asking = 0, keep = 0, market = 0, noPrice = 0, profit = 0, paidCards = 0;
    for (const r of list) {
      const q = sellQty(r), a = sellAsk(r), mv = marketValue(r).unit;
      cards += q;
      if (a != null) { asking += a * q; keep += afterFees(a) * q; if (r.paid != null) { profit += (afterFees(a) - r.paid) * q; paidCards += q; } } else noPrice += q;
      if (mv != null) market += mv * q;
    }
    const fact = (value, label) => '<div class="fact"><b>' + value + "</b><span>" + label + "</span></div>";
    return fact(cards.toLocaleString(), (cards === 1 ? "card" : "cards") + " to sell") +
      fact(esc(usd(asking)), "asking" + (noPrice ? " (" + noPrice + " without a price)" : "")) + fact(esc(usd(keep)), "you'd keep after fees") +
      fact(esc(usd(market)), "market value") + (paidCards ? fact(changeHTML(profit, null, true), "profit on the " + plural(paidCards, "card") + " with a price paid") : "");
  }
  function sellAction(act, id) {
    if (act === "copy-all") {
      const list = sellingList();
      copyText(list.map(listingText).join("\n\n----------\n\n"), () => toast("Copied " + plural(list.length, "listing") + "."));
    } else if (act === "export") exportSellCSV();
    else if (act === "fees") openSettings({section: "selling"});
    else {
      const r = collection.find(x => x.id === id);
      if (!r) return;
      if (act === "sold") openSoldForm(r.id);
      else if (act === "copy") copyText(listingText(r), () => toast("Copied the listing for " + r.name + "."));
      else if (act === "off") { setSell(r, null, "Took " + r.name + " off your sell list."); render(); }
    }
  }
  function sellInput(el) {
    const id = el.dataset.sellPrice || el.dataset.sellQty, r = collection.find(x => x.id === id);
    if (!r || !r.sell) return;
    if (el.dataset.sellPrice) { const v = num(el.value); r.sell.price = v != null && v >= 0 ? round2(v) : null; }
    else { const q = posInt(el.value); r.sell.qty = q && q < r.qty ? q : null; el.value = sellQty(r); }
    save();
    // (updated where they are, so the next tap or Tab lands where you meant)
    const a = sellAsk(r), keepCell = document.querySelector('[data-keep="' + id + '"]'), drift = document.querySelector('[data-drift="' + id + '"]');
    if (keepCell) { keepCell.textContent = a == null ? "" : usd(afterFees(a)); if (a == null) keepCell.setAttribute("data-empty", ""); else keepCell.removeAttribute("data-empty"); }
    if (drift) { drift.textContent = sellDrift(r); drift.hidden = !drift.textContent; }
    if ($("sellFacts")) $("sellFacts").innerHTML = sellFactsHTML(sellingList());
  }
  function exportSellCSV() {
    const list = sellingList();
    if (!list.length) { toast("Your sell list is empty."); return; }
    const money2 = v => v == null ? "" : (Math.round(v * 100) / 100).toFixed(2);
    const cols = [["Card Name", r => r.name], ["Set Name", r => r.setName], ["Number", r => r.sealed ? "" : r.number], ["Rarity", r => r.sealed ? "" : r.rarity],
      ["Printing", r => r.sealed ? "" : r.edition], ["Condition", r => r.sealed ? "Sealed" : r.condition], ["Graded", r => r.grade ? gradeLabel(r.grade) : ""], ["Language", r => r.language],
      ["Quantity To Sell", r => sellQty(r)], ["Asking Each (USD)", r => money2(sellAsk(r))], ["Keep After Fees Each (USD)", r => money2(afterFees(sellAsk(r)))],
      ["Market Value Each (USD)", r => money2(marketValue(r).unit)], ["Paid Each (USD)", r => money2(r.paid)], ["Listing Title", r => listingTitle(r)], ["On The List Since", r => String(r.sell.since).slice(0, 10)]];
    const lines = [cols.map(c => csvCell(c[0])).join(",")].concat(list.map(r => cols.map(c => csvCell(c[1](r))).join(",")));
    download(new Blob(["﻿" + lines.join("\r\n")], {type: "text/csv;charset=utf-8"}), "card-vault-sell-list.csv");
    toast("Exported " + plural(list.length, "card") + " on your sell list.");
  }
  // Several selected cards at once: each at its market value (or no price yet)
  function bulkSell(ids) {
    const list = ids.map(id => collection.find(r => r.id === id)).filter(r => r && !r.sell);
    if (!list.length) { toast("Those are on your sell list already."); return; }
    const was = list.map(r => [r.id, r.sell]);
    for (const r of list) { const s = sellSuggestions(r).find(x => x.k === "market"); r.sell = normSell({price: s && !(r.grade && r.grade.value == null) ? s.price : null}); }
    save(); render();
    toast("Put " + plural(list.length, "card") + " on your sell list at market value. Trades & sales > Selling has them.", {action: "Undo", onAction: () => {
      for (const [id, s] of was) { const r = collection.find(x => x.id === id); if (r) r.sell = s; }
      save(); render();
    }});
  }

  /* ======================= Printed report ======================= */
  function openReport() {
    drawerCtx = {mode: "report"};
    const shown = visibleRecords().length;
    const filtered = filtersActive() && settings.tab === "collection";
    openDrawer("Print a report",
      '<form id="reportForm" class="stack">' +
      '<fieldset class="plain"><legend>What it\'s for</legend>' +
      '<label class="check-row"><input type="radio" name="rKind" value="inventory" checked><span>An inventory: every card with its value</span></label>' +
      '<label class="check-row" style="margin-top:6px"><input type="radio" name="rKind" value="insurance"><span>An insurance record: photos, condition, where each value comes from, ' +
      "the most valuable cards listed on their own, and a dated total to sign</span></label></fieldset>" +
      '<div id="rInsurance" class="stack" hidden><div class="grid-2"><label class="field"><span>Owner\'s name (printed on it)</span><input class="input" id="rOwner" maxlength="80" value="' + esc(settings.reportOwner || "") + '"></label>' +
      '<label class="field"><span>Policy number (optional)</span><input class="input" id="rPolicy" maxlength="60" value="' + esc(settings.reportPolicy || "") + '"></label></div>' +
      '<label class="field"><span>List cards worth this much or more on their own, with a larger photo</span><span class="pct">$<input class="input" type="number" min="0" step="25" id="rOver" value="' +
      esc(String(settings.reportOver != null ? settings.reportOver : 250)) + '"></span></label></div>' +
      '<fieldset class="plain"><legend>Which cards</legend>' +
      '<label class="check-row"><input type="radio" name="rWhich" value="all" checked><span>Your whole collection (' + plural(collection.length, "printing") + ")</span></label>" +
      (filtered ? '<label class="check-row" style="margin-top:6px"><input type="radio" name="rWhich" value="shown"><span>Only the cards shown now (' + plural(shown, "printing") + ")</span></label>" : "") +
      "</fieldset>" +
      '<label class="field"><span>Order</span><select class="input" id="rSort"><option value="value">Most valuable first</option><option value="set">Set and card number</option>' +
      '<option value="location">By location, then set</option><option value="name">Card name</option></select></label>' +
      '<label class="check-row"><input type="checkbox" class="check" id="rPaid" checked><span>Include what I paid</span></label>' +
      '<label class="check-row"><input type="checkbox" class="check" id="rNotes"><span>Include notes</span></label>' +
      '<label class="check-row"><input type="checkbox" class="check" id="rPhotos"><span>Include small photos (uses more paper)</span></label>' +
      '<p class="hint" style="margin:0">Your browser\'s print window opens next. To make a PDF, choose "Save as PDF" or "Microsoft Print to PDF" as the printer.</p>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Print or save as PDF</button></div></form>');
    // (an insurance record: photos on, most valuable first, and its own few questions)
    document.querySelectorAll('#reportForm input[name="rKind"]').forEach(x => x.addEventListener("change", () => {
      const ins = document.querySelector('#reportForm input[name="rKind"]:checked').value === "insurance";
      $("rInsurance").hidden = !ins;
      if (ins) { $("rPhotos").checked = true; $("rSort").value = "value"; }
    }));
    $("reportForm").addEventListener("submit", async e => {
      e.preventDefault();
      const which = document.querySelector('#reportForm input[name="rWhich"]:checked');
      const kind = (document.querySelector('#reportForm input[name="rKind"]:checked') || {}).value || "inventory";
      if (kind === "insurance") {
        settings.reportOwner = $("rOwner").value.trim().slice(0, 80);
        settings.reportPolicy = $("rPolicy").value.trim().slice(0, 60);
        settings.reportOver = num($("rOver").value) != null ? Math.max(0, num($("rOver").value)) : 250;
        saveSettings();
      }
      buildReport({which: which ? which.value : "all", sort: $("rSort").value, paid: $("rPaid").checked, notes: $("rNotes").checked, photos: $("rPhotos").checked,
        kind, owner: settings.reportOwner, policy: settings.reportPolicy, over: settings.reportOver});
      reportPrint.chosen = true;
      closeDrawer();
      await reportPhotosLoaded();
      setTimeout(() => window.print(), 60);
    });
  }
  // Card photos have to be loaded before the print window opens, or they print blank.
  async function reportPhotosLoaded() {
    const waiting = Array.from(document.querySelectorAll("#report img")).filter(img => !img.complete);
    if (!waiting.length) return;
    toast("Getting the card photos ready to print…");
    const loaded = img => new Promise(done => { img.addEventListener("load", done, {once: true}); img.addEventListener("error", done, {once: true}); });
    await Promise.race([Promise.all(waiting.map(loaded)), new Promise(done => setTimeout(done, 15000))]);
  }
  // Printing any other way (Ctrl+P, the browser menu) prints the inventory report with the usual choices,
  // instead of a blank page or an older report.
  const reportPrint = {chosen: false};
  window.addEventListener("beforeprint", () => {
    if (reportPrint.chosen) return;
    try { buildReport({which: "all", sort: "value", paid: true, notes: false, photos: false}); } catch (e) { /* prints what's there */ }
  });
  window.addEventListener("afterprint", () => { reportPrint.chosen = false; });
  // Where a copy's value comes from, for the insurance record
  function valueSource(r) {
    if (r.grade) {
      const gv = gradedValue(r);
      if (gv && gv.from === "yours") return "owner's value for the graded card";
      if (gv && gv.from === "pricecharting") return "PriceCharting, recent sales at this grade";
    }
    const mv = marketValue(r);
    const cond = mv.factor != null && mv.factor < 1 ? ", " + Math.round(mv.factor * 100) + "% for " + r.condition : "";
    if (mv.from === "tcgplayer") return (mv.kind === "low" ? "TCGplayer lowest listing" : "TCGplayer market price") + (catalog ? " (" + fmtDate(catalog.generated) + ")" : "") + cond;
    if (mv.from === "saved") return "TCGplayer price saved " + fmtDate(mv.date) + cond;
    if (mv.from === "ocg") return (mv.src || "shop") + (mv.note ? ", " + mv.note : "") + (mv.local != null ? " (" + fmtLocal(mv.local, mv.cur) + ")" : "") + cond;
    if (mv.from === "manual") return "owner's estimate";
    if (mv.from === "local") return "owner's price (" + fmtLocal(mv.local, mv.cur) + ")";
    return "no price found";
  }
  // What a copy counts for in the insurance record: a graded card at its graded value when there is one
  function insuredValue(r) {
    if (r.grade && !r.sealed) { const gv = gradedValue(r); if (gv && (gv.from === "yours" || gv.from === "pricecharting")) return gv.unit; }
    return marketValue(r).unit;
  }
  function buildReport(opts) {
    const list = (opts.which === "shown" ? visibleRecords() : collection).slice();
    if (opts.kind === "insurance") return buildInsuranceReport(list, opts);
    const val = r => marketValue(r).unit;
    const byStr = (a, b) => String(a || "").localeCompare(String(b || ""), undefined, {numeric: true, sensitivity: "base"});
    const bySet = (a, b) => byStr(a.setName, b.setName) || byStr(a.number, b.number) || byStr(a.name, b.name);
    if (opts.sort === "value") list.sort((a, b) => ((val(b) == null ? -1 : val(b)) - (val(a) == null ? -1 : val(a))) || byStr(a.name, b.name));
    else if (opts.sort === "location") list.sort((a, b) => (!a.location - !b.location) || byStr(a.location, b.location) || bySet(a, b));
    else if (opts.sort === "name") list.sort((a, b) => byStr(a.name, b.name) || bySet(a, b));
    else list.sort(bySet);
    let total = 0, cards = 0, paid = 0, paidCards = 0, unpriced = 0;
    for (const r of list) {
      const u = val(r);
      cards += r.qty;
      if (u == null) unpriced += r.qty; else total += u * r.qty;
      if (r.paid != null) { paid += r.paid * r.qty; paidCards += r.qty; }
    }
    const cols = (opts.photos ? 1 : 0) + 10 + (opts.paid ? 1 : 0);
    const row = r => {
      const u = val(r);
      const cond = r.grade ? gradeLabel(r.grade) + (r.grade.cert ? " (cert " + r.grade.cert + ")" : "") : r.condition;
      const img = imageFor(r, "200w");
      return "<tr>" + (opts.photos ? "<td>" + (img ? '<img src="' + esc(img) + '" alt="">' : "") + "</td>" : "") +
        "<td><b>" + esc(r.name) + "</b><br><span>" + esc(r.number) + "</span>" + (opts.notes && r.notes ? "<br><i>" + esc(r.notes) + "</i>" : "") + "</td>" +
        "<td>" + esc(r.setName) + "</td><td>" + esc(r.rarity) + "</td><td>" + esc(r.edition) + "</td><td>" + esc(cond) + "</td><td>" + esc(r.language) +
        "</td><td>" + esc(r.location) + '</td><td class="num">' + r.qty + '</td><td class="num">' + esc(u == null ? "" : usd(u)) + '</td><td class="num">' +
        esc(u == null ? "" : usd(u * r.qty)) + "</td>" + (opts.paid ? '<td class="num">' + esc(r.paid == null ? "" : usd(r.paid)) + "</td>" : "") + "</tr>";
    };
    let body = "", group = null;
    for (const r of list) {
      if (opts.sort === "location" && (r.location || "") !== group) {
        group = r.location || "";
        const inGroup = list.filter(x => (x.location || "") === group);
        const gv = inGroup.reduce((s, x) => s + (val(x) || 0) * x.qty, 0), gc = inGroup.reduce((s, x) => s + x.qty, 0);
        body += '<tr class="grp"><th colspan="' + cols + '">' + esc(group || "No location") + " (" + plural(gc, "card") + ", " + esc(usd(gv)) + ")</th></tr>";
      }
      body += row(r);
    }
    const adjusted = settings.condAdjust && list.some(r => marketValue(r).factor < 1);
    $("report").innerHTML = "<header><h1>Card Vault inventory</h1><p>" + esc(fmtDate(new Date())) +
      (catalog ? ". Values are TCGplayer market prices from " + esc(fmtDate(catalog.generated)) + (adjusted ? ", adjusted for condition" : "") : "") + ".</p></header>" +
      '<div class="rep-sum"><div><b>' + esc(usd(total)) + "</b><span>total value</span></div><div><b>" + cards.toLocaleString() + "</b><span>cards</span></div><div><b>" +
      list.length.toLocaleString() + "</b><span>printings</span></div>" + (opts.paid && paidCards ? "<div><b>" + esc(usd(paid)) + "</b><span>paid (for " + plural(paidCards, "card") + ")</span></div>" : "") +
      "</div><table><thead><tr>" + (opts.photos ? "<th></th>" : "") + '<th>Card</th><th>Set</th><th>Rarity</th><th>Printing</th><th>Condition</th><th>Language</th><th>Location</th><th class="num">Qty</th>' +
      '<th class="num">Value each</th><th class="num">Total</th>' + (opts.paid ? '<th class="num">Paid each</th>' : "") + "</tr></thead><tbody>" + body +
      '</tbody><tfoot><tr><td colspan="' + (cols - (opts.paid ? 4 : 3)) + '">Total</td><td class="num">' + cards.toLocaleString() + '</td><td></td><td class="num">' + esc(usd(total)) + "</td>" +
      (opts.paid ? "<td></td>" : "") + "</tr></tfoot></table>" +
      '<p class="rep-note">Market prices are for Near Mint copies' + (adjusted ? "; played cards are valued at a share of them" : "") +
      ". Graded cards are valued at the amount entered for them, and cards added by hand at their owner's estimate." +
      (unpriced ? " " + plural(unpriced, "card") + " had no price and count as $0." : "") + "</p>";
    return list.length;
  }

  function buildInsuranceReport(list, opts) {
    const val = r => insuredValue(r);
    list.sort((a, b) => ((val(b) == null ? -1 : val(b)) - (val(a) == null ? -1 : val(a))) || String(a.name).localeCompare(String(b.name)));
    const over = num(opts.over) != null ? num(opts.over) : 250;
    const today = new Date();
    let total = 0, cards = 0, unpriced = 0;
    const groups = {singles: {label: "Ungraded cards", v: 0, n: 0}, graded: {label: "Graded cards", v: 0, n: 0}, sealed: {label: "Sealed products", v: 0, n: 0}};
    for (const r of list) {
      const u = val(r), g = r.sealed ? groups.sealed : r.grade ? groups.graded : groups.singles;
      cards += r.qty; g.n += r.qty;
      if (u == null) unpriced += r.qty; else { total += u * r.qty; g.v += u * r.qty; }
    }
    const big = over > 0 ? list.filter(r => (val(r) || 0) >= over) : [];
    const desc = r => [r.setName, r.number, r.rarity, r.edition, r.language && r.language !== "English" ? r.language : "", isRushNo(r.number) && !r.sealed ? "Rush Duel" : ""].filter(Boolean).join(" · ");
    const cond = r => r.grade ? gradeLabel(r.grade) + (r.grade.cert ? ", certification " + r.grade.cert : "") : r.sealed ? "Sealed" : r.condition || "";
    let n = 0;
    const item = r => {
      const u = val(r), img = opts.photos ? imageFor(r, "200w") : "";
      n++;
      return '<tr><td class="num">' + n + "</td>" + (opts.photos ? "<td>" + (img ? '<img src="' + esc(img) + '" alt="">' : "") + "</td>" : "") +
        "<td><b>" + esc(r.name) + "</b><br><span>" + esc(desc(r)) + "</span>" + (opts.notes && r.notes ? "<br><i>" + esc(r.notes) + "</i>" : "") + "</td>" +
        "<td>" + esc(cond(r)) + "</td><td>" + esc(valueSource(r)) + "</td>" + '<td class="num">' + r.qty + '</td><td class="num">' + esc(u == null ? "" : usd(u)) +
        '</td><td class="num">' + esc(u == null ? "" : usd(u * r.qty)) + "</td>" + (opts.paid ? '<td class="num">' + esc(r.paid == null ? "" : usd(r.paid)) + "</td>" : "") + "</tr>";
    };
    const head = "<thead><tr><th class=\"num\">#</th>" + (opts.photos ? "<th></th>" : "") + "<th>Item</th><th>Condition</th><th>Value from</th><th class=\"num\">Qty</th><th class=\"num\">Value each</th>" +
      '<th class="num">Total</th>' + (opts.paid ? '<th class="num">Paid each</th>' : "") + "</tr></thead>";
    const bigHTML = big.length ? "<h2>Cards worth " + esc(usd(over)) + " or more each (" + big.length + ")</h2>" +
      '<div class="rep-big">' + big.map(r => {
        const u = val(r), img = imageFor(r, "400w") || imageFor(r, "200w");
        return '<div class="rep-item">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="rep-noimg"></div>') + "<div><b>" + esc(r.name) + "</b><br>" + esc(desc(r)) + "<br>" +
          esc(cond(r)) + (r.qty > 1 ? " · " + r.qty + " copies" : "") + "<br><b>" + esc(u == null ? "No price found" : usd(u) + (r.qty > 1 ? " each, " + usd(u * r.qty) + " in all" : "")) + "</b><br><span>" + esc(valueSource(r)) + "</span>" +
          (r.location ? "<br><span>Kept in: " + esc(r.location) + "</span>" : "") + "</div></div>";
      }).join("") + "</div>" : "";
    $("report").innerHTML = '<header><h1>Collectible card inventory for insurance</h1><p>' +
      [opts.owner ? "Owner: " + esc(opts.owner) : "", opts.policy ? "Policy: " + esc(opts.policy) : "", "Prepared " + esc(fmtDate(today))].filter(Boolean).join(" · ") + "</p></header>" +
      '<div class="rep-sum"><div><b>' + esc(usd(total)) + "</b><span>total value</span></div><div><b>" + cards.toLocaleString() + "</b><span>cards and products</span></div>" +
      Object.values(groups).filter(g => g.n).map(g => "<div><b>" + esc(usd(g.v)) + "</b><span>" + esc(g.label) + " (" + g.n.toLocaleString() + ")</span></div>").join("") + "</div>" +
      bigHTML + "<h2>Every item</h2><table>" + head + "<tbody>" + list.map(item).join("") + "</tbody>" +
      '<tfoot><tr><td colspan="' + (opts.photos ? 5 : 4) + '">Total</td><td class="num">' + cards.toLocaleString() + '</td><td></td><td class="num">' + esc(usd(total)) + "</td>" + (opts.paid ? "<td></td>" : "") + "</tr></tfoot></table>" +
      '<p class="rep-note">Values are current market prices from the sources listed for each item, as of ' + esc(fmtDate(today)) + ': TCGplayer for English cards (what Near Mint copies have recently sold for' +
      (settings.condAdjust ? ", reduced for played copies" : "") + "), BIGWEB and Fullahead (Japanese card shops; Fullahead for Rush Duel) and Bunjang (a Korean marketplace) for Japanese and Korean cards, and PriceCharting's recent sales for graded cards where available. " +
      "They are not a professional appraisal. Photos are of the card printing, not necessarily the owner's copy." + (unpriced ? " " + plural(unpriced, "item") + " had no price and count as $0." : "") + "</p>" +
      '<div class="rep-sign"><div>Signature</div><div>Date</div></div>';
    return list.length;
  }

  /* ======================= Phone copy ======================= */
  // A read-only page to look through on a phone. It shows everything even where scripts don't run
  // (some phone file previews), and carries a full backup inside, so it can also be restored.
  const phone = {handle: null, state: "off", timer: null, busy: false, again: false, error: ""};
  const PHONE_CSS = "*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#14100d;color:#f3eadf;" +
    "font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}header{padding:18px 16px 10px;border-bottom:1px solid #3b3026}" +
    "h1{margin:0;font-size:22px;letter-spacing:.5px}h2{font-size:17px;margin:22px 16px 8px}.m{margin:4px 0;color:#baab99;font-size:13px}" +
    ".tot{font-size:34px;font-weight:700;margin:10px 0 2px}nav{display:flex;gap:16px;margin:12px 0 4px}nav a{color:#f1cf82;font-weight:600}" +
    ".tools{display:flex;gap:8px;margin-top:10px}.tools input,.tools select{font:inherit;color:inherit;background:#211a14;border:1px solid #4d3f32;border-radius:8px;padding:9px 10px}" +
    ".tools input{flex:1;min-width:0}.list{border-top:1px solid #3b3026}details{border-bottom:1px solid #3b3026}" +
    "summary{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 16px;cursor:pointer;list-style:none}" +
    "summary::-webkit-details-marker{display:none}summary img,.noimg{width:44px;height:62px;object-fit:cover;border-radius:3px;background:#2a2119;display:block}" +
    ".t b{display:block;font-size:14.5px;line-height:1.25}.t small{display:block;color:#baab99;font-size:12.5px;line-height:1.35}" +
    ".p{text-align:right;font-weight:600;white-space:nowrap}.p small{display:block;color:#baab99;font-weight:400;font-size:12px}" +
    ".ok{color:#0ca30c}dl{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;margin:0;padding:4px 16px 14px 70px;font-size:13.5px}" +
    "dt{color:#baab99}dd{margin:0}.foot{color:#948472;font-size:12.5px;padding:18px 16px 40px;margin:0}";
  const PHONE_JS = "(function(){var t=document.querySelector('.tools'),l=document.getElementById('cl');if(!t||!l)return;t.hidden=false;" +
    "var q=document.getElementById('q'),s=document.getElementById('sort'),items=Array.prototype.slice.call(l.children);" +
    "q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();items.forEach(function(e){e.hidden=!!v&&e.getAttribute('data-s').indexOf(v)<0;});});" +
    "s.addEventListener('change',function(){var k=s.value;items.sort(function(a,b){if(k==='v')return parseFloat(b.getAttribute('data-v'))-parseFloat(a.getAttribute('data-v'));" +
    "var x=k==='n'?'data-n':'data-set';return a.getAttribute(x).localeCompare(b.getAttribute(x),undefined,{numeric:true});});" +
    "items.forEach(function(e){l.appendChild(e);});});})();";
  function phoneCopyHTML() {
    const now = new Date();
    const val = r => marketValue(r).unit;
    const list = collection.slice().sort((a, b) => ((val(b) == null ? -1 : val(b)) - (val(a) == null ? -1 : val(a))) || a.name.localeCompare(b.name));
    let total = 0, cards = 0;
    for (const r of collection) { cards += r.qty; const u = val(r); if (u != null) total += u * r.qty; }
    const dl = (label, v) => (v === "" || v == null) ? "" : "<dt>" + esc(label) + "</dt><dd>" + esc(v) + "</dd>";
    const pic = src => src ? '<img loading="lazy" src="' + esc(src) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<span class="noimg"></span>';
    const card = r => {
      const u = val(r);
      const find = [r.name, r.number, r.setName, r.rarity, r.edition, r.location, r.language].join(" ").toLowerCase();
      return '<details data-s="' + esc(find) + '" data-v="' + (u == null ? -1 : u) + '" data-n="' + esc(r.name.toLowerCase()) + '" data-set="' +
        esc((r.setName + " " + r.number).toLowerCase()) + '"><summary>' + pic(imageFor(r, "200w")) +
        '<span class="t"><b>' + esc(r.name) + "</b><small>" + esc([r.number, r.rarity].filter(Boolean).join(" · ")) + "</small><small>" +
        esc([r.edition, r.grade ? gradeLabel(r.grade) : r.condition, r.language !== "English" ? r.language : ""].filter(Boolean).join(" · ")) + "</small></span>" +
        '<span class="p">' + esc(u == null ? "–" : usd(u)) + (r.qty > 1 ? "<small>×" + r.qty + "</small>" : "") + "</span></summary><dl>" +
        dl("Set", r.setName) + dl("Card number", r.number) + dl("Rarity", r.rarity) + dl("Printing", r.edition) + dl("Condition", r.condition) +
        (r.grade ? dl("Graded", gradeLabel(r.grade) + (r.grade.cert ? ", cert " + r.grade.cert : "")) : "") + dl("Language", r.language) +
        dl("Copies", r.qty) + dl("Value each", u == null ? "" : usd(u)) + dl("Total value", u == null ? "" : usd(u * r.qty)) +
        dl("Paid each", r.paid == null ? "" : usd(r.paid)) + dl("Location", r.location) + dl("Notes", r.notes) + "</dl></details>";
    };
    const want = w => {
      const st = wantStatus(w);
      return "<details><summary>" + pic(w.productId ? tcgImg(w.productId, "200w") : w.image || "") + '<span class="t"><b>' + esc(w.name) + (w.qty > 1 ? " ×" + w.qty : "") +
        "</b><small>" + esc([w.number, w.rarity].filter(Boolean).join(" · ")) + "</small><small>" + esc(w.edition === "Any" ? "Any printing" : w.edition) + "</small></span>" +
        '<span class="p">' + esc(st.price == null ? "–" : usd(st.price)) + "<small" + (st.hit ? ' class="ok">✓ at target' : ">" +
          (w.target != null ? "target " + esc(usd(w.target)) : "")) + "</small></span></summary><dl>" + dl("Set", w.setName) + dl("Card number", w.number) +
        dl("Your target", w.target == null ? "" : usd(w.target)) + dl("Notes", w.notes) + "</dl></details>";
    };
    const phonePayload = backupPayload(now.toISOString());
    phonePayload.settings = Object.assign({}, phonePayload.settings, {pcToken: "", cloudAlerts: null});   // (the phone copy is just for looking: no keys)
    const data = JSON.stringify(phonePayload).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>Card Vault phone copy</title><style>" + PHONE_CSS + "</style></head><body><header><h1>Card Vault</h1>" +
      '<p class="m">Phone copy saved ' + esc(fmtDateTime(now)) + (catalog ? ". TCGplayer prices from " + esc(fmtDate(catalog.generated)) : "") + ".</p>" +
      '<div class="tot">' + esc(usd(total) || "$0.00") + '</div><p class="m">' + cards.toLocaleString() + " cards, " + plural(collection.length, "printing") +
      (wants.length ? ", " + wants.length + " on your want list" : "") + "</p>" +
      (wants.length ? '<nav><a href="#collection">Collection</a><a href="#wants">Want list</a></nav>' : "") + '<div class="tools" hidden><input type="search" id="q" placeholder="Search name, number, set, location" aria-label="Search">' +
      '<select id="sort" aria-label="Sort"><option value="v">Most valuable</option><option value="n">Name</option><option value="s">Set</option></select></div></header>' +
      '<main><h2 id="collection">Collection</h2><div class="list" id="cl">' + list.map(card).join("") + "</div>" +
      (wants.length ? '<h2 id="wants">Want list</h2><div class="list">' + wants.map(want).join("") + "</div>" : "") +
      '<p class="foot">A read-only copy of Card Vault. Make changes in Card Vault on your computer. This file also works as a backup: in Card Vault, choose Settings, then Restore from a backup.</p></main>' +
      '<script type="application/json" id="cardvault-backup">' + data + "<\/script><script>" + PHONE_JS + "<\/script></body></html>";
  }
  function schedulePhoneCopy(now) {
    if (phone.state !== "active") return;
    clearTimeout(phone.timer);
    phone.timer = setTimeout(() => writePhoneCopy(), now ? 0 : 1500);
  }
  async function writePhoneCopy() {
    clearTimeout(phone.timer);
    phone.timer = null;
    const h = phone.handle;
    if (!h) return false;
    if (phone.busy) { phone.again = true; return false; }
    if (loadProblem && !collection.length) return false;
    phone.busy = true;
    let ok = false, w = null;
    try {
      w = await h.createWritable();
      await w.write(phoneCopyHTML());
      await w.close();
      w = null;
      if (phone.handle === h) { phone.state = "active"; phone.error = ""; settings.phoneSavedAt = new Date().toISOString(); saveSettings(); }
      ok = true;
    } catch (e) {
      if (w) { try { await w.abort(); } catch (e2) { /* nothing more to undo */ } }
      if (phone.handle === h) {
        phone.state = e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "paused" : "error";
        phone.error = (e && e.message) || String(e);
      }
    }
    phone.busy = false;
    renderBackupBanner();
    refreshBackupSection();
    const again = phone.again;
    phone.again = false;
    if (again && phone.state === "active") schedulePhoneCopy();
    return ok;
  }
  // Must run straight from a click (the browser's save window needs one).
  async function savePhoneCopy() {
    if (!backup.supported) {
      download(new Blob([phoneCopyHTML()], {type: "text/html"}), "Card Vault phone copy.html");
      toast("Saved a phone copy. Put it in OneDrive, Google Drive or Dropbox to open it on your phone.");
      return;
    }
    let h;
    try {
      h = await window.showSaveFilePicker({suggestedName: "Card Vault phone copy.html", types: [{description: "Web page", accept: {"text/html": [".html"]}}]});
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("Couldn't save the phone copy: " + ((e && e.message) || e), {kind: "error"});
      return;
    }
    while (phone.busy) await pause(50);
    phone.handle = h;
    phone.state = "active";
    try { await idbPut("phoneFile", h); } catch (e) { /* still updated until Card Vault is closed */ }
    if (await writePhoneCopy()) toast("Saved " + h.name + ". Card Vault keeps it up to date whenever you make a change.");
    else toast("Couldn't write " + h.name + ": " + phone.error, {kind: "error"});
  }
  async function stopPhoneCopy() {
    clearTimeout(phone.timer);
    phone.handle = null;
    phone.state = "off";
    try { await idbPut("phoneFile", undefined); } catch (e) { /* nothing stored */ }
    refreshBackupSection();
    renderBackupBanner();
    toast("The phone copy won't be updated anymore. The file is still there.");
  }
  function phoneSectionHTML() {
    const last = parseDate(settings.phoneSavedAt);
    const lastText = last ? "Last saved " + esc(fmtDateTime(last)) + "." : "";
    const name = phone.handle ? "<b>" + esc(phone.handle.name) + "</b>" : "the phone copy";
    const btn = (act, label, primary) => '<button class="btn btn-small' + (primary ? " btn-primary" : "") + '" type="button" data-bk="' + act + '">' + label + "</button>";
    let cls, text, buttons;
    if (phone.state === "active") {
      cls = "on"; text = "Kept up to date: " + name + " is saved again a moment after every change. " + lastText;
      buttons = btn("phone-now", "Update now") + btn("phone-save", "Use a different file") + btn("phone-stop", "Stop updating it");
    } else if (phone.state === "paused") {
      cls = "warn"; text = "Paused. The browser asks your OK again after it restarts before Card Vault can update " + name + ". " + lastText;
      buttons = btn("resume", "Resume", true) + btn("phone-stop", "Stop updating it");
    } else if (phone.state === "error") {
      cls = "off"; text = "Couldn't save " + name + " (" + esc(phone.error) + "). " + lastText;
      buttons = btn("phone-now", "Try again", true) + btn("phone-save", "Choose a file") + btn("phone-stop", "Stop updating it");
    } else {
      cls = "off"; text = backup.supported ? "Not set up yet." : "This browser can't update the file by itself, so save a new copy when you want to refresh it.";
      buttons = btn("phone-save", "Save a phone copy", true);
    }
    return '<div class="status-line ' + cls + '"><span class="dot" aria-hidden="true"></span><span>' + text + '</span></div><div class="btn-row">' + buttons + "</div>";
  }

