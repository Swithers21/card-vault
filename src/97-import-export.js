  /* ======================= CSV import ======================= */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ""));
  }
  // Columns are matched by exact name only (no partial matches), so a column like
  // "TCGplayer Id" can never be mistaken for a price.
  const HEADER_ALIASES = {
    productId: ["productid", "tcgplayerproductid"],
    sku: ["tcgplayerid", "skuid", "sku"],
    productLine: ["productline", "game"],
    name: ["cardname", "name", "simplename"],
    productName: ["productname"],
    setName: ["setname", "set", "expansion"],
    number: ["number", "cardnumber", "collectornumber", "setcode"],
    rarity: ["rarity"],
    condition: ["condition"],
    edition: ["printing", "edition", "variant"],
    language: ["language", "lang"],
    qtyAdd: ["addtoquantity"],
    qtyTotal: ["totalquantity", "quantity", "qty", "count"],
    market: ["tcgmarketprice", "marketprice", "tcgplayermarketprice"],
    low: ["tcglowprice", "lowprice"],
    paid: ["pricepaid", "purchaseprice", "paid", "cost"],
    manualPrice: ["valueestimateusd", "valueestimate"],
    jp: ["japanpricejpy", "japanprice"],
    kr: ["koreapricekrw", "koreaprice"],
    image: ["imageurl"],
    photo: ["photourl"],
    notes: ["notes", "note"],
    added: ["dateadded", "createdat"],
    location: ["location", "storagelocation", "storage", "binder"],
    gradedBy: ["gradedby", "gradingcompany", "grader"],
    grade: ["grade"],
    cert: ["certnumber", "cert", "certificationnumber"],
    gradedValue: ["gradedvalueusd", "gradedvalue"],
    sealed: ["sealed", "sealedproduct"],
    g10: ["psa10valueusd", "psa10value", "psa10"]
  };
  function mapHeaders(headers) {
    const norm = headers.map(h => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    const idx = {};
    for (const field in HEADER_ALIASES) {
      idx[field] = -1;
      for (const alias of HEADER_ALIASES[field]) {
        const at = norm.indexOf(alias);
        if (at >= 0) { idx[field] = at; break; }
      }
    }
    return idx;
  }
  function rowToRecord(row, idx, importedAt) {
    const get = f => idx[f] >= 0 && row[idx[f]] != null ? String(row[idx[f]]).trim() : "";
    const line = get("productLine");
    if (line && !/yu\W*gi\W*oh/i.test(line)) return {skip: "not Yu-Gi-Oh! (" + line + ")"};
    let productId = idOrNull(get("productId"));
    let product = productId && catalog ? catalog.byId.get(productId) : null;
    let rarity = get("rarity"), number = get("number");
    const setName = get("setName");
    if (!productId && catalog && number) {
      let cands = catalog.byNumber.get(normNumber(number)) || [];
      if (cands.length > 1 && rarity) cands = cands.filter(p => p.rarity.toLowerCase() === rarity.toLowerCase());
      if (cands.length > 1 && setName) cands = cands.filter(p => p.group.name.toLowerCase() === setName.toLowerCase());
      if (cands.length === 1) { product = cands[0]; productId = product.id; }
    }
    if (product) { rarity = rarity || product.rarity; number = number || product.number; }
    const fullName = get("productName") || (product ? product.name : "") || get("name");
    const name = get("name") || cleanName(fullName, rarity);
    if (!name) return {skip: productId ? "needs TCGplayer data to find the card's name" : "no card name"};
    const cond = parseCondition(get("condition"));
    let edition = normEdition(get("edition")) || cond.edition;
    if (!edition && product) {
      const eds = printingsFor(product).filter(k => k !== "Normal");
      if (eds.length === 1) edition = eds[0];
    }
    const market = num(get("market")), low = num(get("low"));
    const added = parseDate(get("added"));
    return {rec: upgradeRecord({
      id: newId(), productId, sku: get("sku") || null, name, productName: fullName || name,
      setName: setName || (product ? product.group.name : ""), number, rarity, edition: edition || "",
      condition: cond.condition, language: normLanguage(get("language")) || "English",
      qty: (posInt(get("qtyAdd")) + posInt(get("qtyTotal"))) || 1,
      paid: num(get("paid")), manualPrice: num(get("manualPrice")), jp: num(get("jp")), kr: num(get("kr")),
      customImage: safeImg(get("image")) || (productId ? "" : safeImg(get("photo"))) || null,
      snap: (market != null || low != null) ? {market, low, date: importedAt} : null,
      location: get("location"),
      grade: get("gradedBy") ? {company: get("gradedBy"), grade: get("grade"), cert: get("cert"), value: get("gradedValue")} : null,
      sealed: /^(yes|true|1|sealed)$/i.test(get("sealed")) || (!!product && product.sealed), g10: num(get("g10")),
      notes: get("notes"), added: added ? added.toISOString() : importedAt
    })};
  }
  function analyzeCSV(text, fileName) {
    const rows = parseCSV(text);
    if (rows.length < 2) return {error: "That file has no card rows."};
    const headers = rows[0];
    const idx = mapHeaders(headers);
    if (idx.productId < 0 && idx.name < 0 && idx.productName < 0 && idx.number < 0) {
      return {error: "Card Vault couldn't find a card name, card number or Product ID column. The columns in this file are: " +
        headers.map(h => '"' + String(h).trim() + '"').join(", ") + "."};
    }
    const importedAt = new Date().toISOString();
    const skipped = {};
    const byKey = new Map();
    let rowCount = 0;
    for (const row of rows.slice(1)) {
      rowCount++;
      const res = rowToRecord(row, idx, importedAt);
      if (res.skip) { skipped[res.skip] = (skipped[res.skip] || 0) + 1; continue; }
      const key = recordKey(res.rec);
      const dup = byKey.get(key);
      if (dup) dup.qty += res.rec.qty; else byKey.set(key, res.rec);
    }
    const records = Array.from(byKey.values());
    const isTCG = idx.productId >= 0 && (idx.sku >= 0 || idx.productLine >= 0 || idx.market >= 0);
    return {records, skipped, rowCount, isTCG, fileName, headers, idx};
  }

  // "Already in my collection" means the same printing: the same TCGplayer product and
  // edition (1st Edition / Unlimited / Limited), whatever its condition. Cards without a
  // TCGplayer product match on card number, name and edition instead.
  function printingKey(r) {
    return r.productId ? "p|" + r.productId + "|" + (r.edition || "")
      : "n|" + normNumber(r.number) + "|" + r.name.toLowerCase() + "|" + (r.edition || "");
  }
  function groupByPrinting(list) {
    const map = new Map();
    for (const r of list) {
      const key = printingKey(r);
      const group = map.get(key) || {qty: 0, recs: []};
      group.qty += r.qty;
      group.recs.push(r);
      map.set(key, group);
    }
    return map;
  }
  function importPlan(records) {
    const have = groupByPrinting(collection);
    const incoming = groupByPrinting(records);
    const newRecs = records.filter(r => !have.has(printingKey(r)));
    const dupKeys = Array.from(incoming.keys()).filter(k => have.has(k));
    const more = dupKeys.filter(k => incoming.get(k).qty > have.get(k).qty).map(k => {
      const r = incoming.get(k).recs[0];
      return {key: k, name: r.name, number: r.number, have: have.get(k).qty, file: incoming.get(k).qty};
    });
    return {have, incoming, newRecs, dupKeys, more};
  }
  function importChoice() {
    const picked = document.querySelector('#importBody input[name="impMode"]:checked');
    return {mode: picked ? picked.value : "add", raise: !!($("raiseQty") && $("raiseQty").checked)};
  }
  function updateImportButton() {
    const go = $("importGo");
    if (!go || !pendingImport || !pendingImport.plan) return;
    const plan = pendingImport.plan;
    const choice = importChoice();
    if ($("raiseQty")) $("raiseQty").disabled = choice.mode !== "new";
    let label;
    if (!collection.length) label = "Import " + plural(pendingImport.records.length, "printing");
    else if (choice.mode === "replace") label = "Replace collection";
    else if (choice.mode === "add") label = plan.dupKeys.length ? "Add everything" : "Add " + plural(pendingImport.records.length, "printing");
    else {
      const parts = [];
      if (plan.newRecs.length) parts.push("add " + plural(plan.newRecs.length, "new printing"));
      if (choice.raise && plan.more.length) parts.push("raise " + plural(plan.more.length, "quantity", "quantities"));
      label = parts.length ? parts.join(" and ") : "";
      label = label ? label.charAt(0).toUpperCase() + label.slice(1) : "Nothing new to add";
    }
    go.textContent = label;
    go.disabled = label === "Nothing new to add";
  }

  function openImport(analysis) {
    pendingImport = analysis;
    $("importTitle").textContent = analysis.isTCG ? "Import from TCGplayer" : "Import CSV";
    const body = $("importBody"), foot = $("importFoot");
    if (analysis.error) {
      body.innerHTML = '<div class="notice" style="margin:0"><strong>This file can\'t be imported.</strong> ' + esc(analysis.error) + "</div>";
      foot.innerHTML = '<button class="btn" type="button" data-imp="cancel">Close</button>';
    } else {
      const recs = analysis.records;
      const t = totals(recs, r => marketValue(r).unit);
      const linked = catalog ? recs.filter(r => r.productId && catalog.byId.has(r.productId)).length : 0;
      const plan = importPlan(recs);
      analysis.plan = plan;
      let modes = "";
      if (collection.length) {
        const opt = (value, checked, title, text, extra) => '<label class="mode"><input type="radio" name="impMode" value="' + value + '"' +
          (checked ? " checked" : "") + "><b>" + esc(title) + "</b><span>" + esc(text) + "</span></label>" + (extra || "");
        const replaceText = "Removes your current " + plural(collection.length, "printing") + " and keeps only this file's cards." +
          (backup.state === "active" && settings.syncId ? " Your other computers that use the same backup file switch to it too." : "");
        if (plan.dupKeys.length) {
          const newCards = plan.newRecs.reduce((s, r) => s + r.qty, 0);
          const moreList = plan.more.slice(0, 4).map(m => m.name + " " + m.number + " (you have " + m.have + ", this file has " + m.file + ")").join("; ") +
            (plan.more.length > 4 ? "; and " + (plan.more.length - 4) + " more" : "");
          const raise = plan.more.length ? '<label class="raise"><input type="checkbox" class="check" id="raiseQty"><span>Also raise my quantity where this file has more copies than I do: ' +
            esc(moreList) + ".</span></label>" : "";
          modes = '<fieldset class="import-modes"><legend>You already have ' + plural(plan.dupKeys.length, "printing") + " from this file</legend>" +
            opt("new", true, "Add only new cards", plan.newRecs.length
              ? "Adds the " + plural(plan.newRecs.length, "new printing") + " (" + plural(newCards, "card") + ") and skips the " + plural(plan.dupKeys.length, "printing") + " you already have."
              : "Everything in this file is already in your collection, so there's nothing new to add.", raise) +
            opt("add", false, "Add everything", "Also adds this file's copies of cards you already have, raising their quantities. Use this when the file only lists cards you just got, including extra copies.") +
            opt("replace", false, "Replace my collection", replaceText) + "</fieldset>";
        } else {
          modes = '<fieldset class="import-modes"><legend>None of these cards are in your collection yet</legend>' +
            opt("add", true, "Add them to my collection", "Keeps your current " + plural(collection.length, "printing") + " and adds these.") +
            opt("replace", false, "Replace my collection", replaceText) + "</fieldset>";
        }
      }
      const warnings = [];
      for (const reason in analysis.skipped) warnings.push("Skipped " + plural(analysis.skipped[reason], "row") + ": " + reason + ".");
      const noProduct = recs.filter(r => !r.productId).length;
      if (noProduct) warnings.push(plural(noProduct, "printing") + " couldn't be matched to a TCGplayer product, so " + (noProduct === 1 ? "it has" : "they have") + " no TCGplayer photo. You can fix that later with Change printing.");
      const high = recs.filter(r => (priceInfo(r).unit || 0) > 5000);
      if (high.length) warnings.push(plural(high.length, "card") + " priced over $5,000 each. Check " + (high.length === 1 ? "it" : "them") + " after importing: " + high.slice(0, 3).map(r => r.name).join(", ") + ".");
      // With cards already in the collection, list the new ones first and tag each row.
      const isNew = r => !plan.have.has(printingKey(r));
      const ordered = collection.length ? recs.slice().sort((a, b) => isNew(b) - isNew(a)) : recs;
      const tag = r => !collection.length ? "" : isNew(r) ? ' <span class="ed tag-new">New</span>' : ' <span class="ed">Have it</span>';
      const shown = ordered.slice(0, 14);
      body.innerHTML =
        '<p class="preview-summary">' + esc(analysis.fileName || "Your file") + ": <b>" + plural(recs.length, "printing") + "</b>, <b>" + plural(t.cards, "card") +
        "</b>, worth <b>" + esc(usd(t.value)) + "</b> at " + (catalog ? "today's TCGplayer market prices" : "the prices in the file") + "." +
        (catalog ? " " + linked + " of " + recs.length + " matched TCGplayer's current catalog." : "") + "</p>" +
        (warnings.length ? '<ul class="warn-list">' + warnings.map(w => "<li>" + esc(w) + "</li>").join("") + "</ul>" : "") + modes +
        '<div class="table-wrap"><table class="preview-table"><thead><tr><th></th><th>Card</th><th>Set</th><th>Printing</th><th>Condition</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>' +
        shown.map(r => {
          const u = priceInfo(r).unit;
          return '<tr><td><span class="sleeve">' + imgTag(recordPics(r, "200w"), r.name) + "</span></td><td><b>" + esc(r.name) + "</b>" + tag(r) + '<span class="cell-sub">' +
            esc(r.number) + (r.rarity ? ", " + esc(r.rarity) : "") + "</span></td><td>" + esc(r.setName) + "</td><td>" + esc(r.edition) + "</td><td>" + esc(r.condition) +
            '</td><td class="num">' + r.qty + '</td><td class="num">' + esc(u == null ? "" : usd(u)) + '</td><td class="num">' + esc(u == null ? "" : usd(u * r.qty)) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (recs.length > shown.length ? '<p class="small">Showing ' + shown.length + " of " + recs.length + (collection.length && plan.newRecs.length ? ", new cards first" : "") + ".</p>" : "");
      foot.innerHTML = '<button class="btn" type="button" data-imp="cancel">Cancel</button>' +
        '<button class="btn btn-primary" type="button" data-imp="go" id="importGo">Import</button>';
      updateImportButton();
    }
    lastFocus = document.activeElement;
    $("importModal").hidden = false;
    syncBackdrop();
    $("scrim").hidden = false;
    document.body.classList.add("no-scroll");
    setTimeout(() => ($("importFoot").querySelector(".btn-primary") || $("importClose")).focus(), 20);
  }
  function closeImport() {
    $("importModal").hidden = true;
    syncBackdrop();
    pendingImport = null;
    if ($("drawer").hidden) { $("scrim").hidden = true; document.body.classList.remove("no-scroll"); }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    if (dataLoad.raw) setTimeout(applyNewData, 400);
  }
  function commitImport(mode, opts) {
    opts = opts || {};
    const analysis = pendingImport;
    if (!analysis || analysis.error) return closeImport();
    if (mode === "replace" && collection.length && !confirm("Replace your whole collection (" + plural(collection.length, "printing") + ") with this file?")) return;
    const before = JSON.parse(JSON.stringify(collection));
    const copy = r => JSON.parse(JSON.stringify(r));
    let message;
    if (mode === "new") {
      const plan = importPlan(analysis.records);
      let added = 0, addedCards = 0, raised = 0;
      for (const rec of plan.newRecs) { addOrMerge(copy(rec)); added++; addedCards += rec.qty; }
      if (opts.raise) {
        for (const m of plan.more) {
          const mine = plan.have.get(m.key).recs;
          const fileCondition = plan.incoming.get(m.key).recs[0].condition;
          const target = mine.find(r => r.condition === fileCondition) || mine[0];
          target.qty += m.file - m.have;
          raised++;
        }
      }
      if (!added && !raised) { closeImport(); toast("Everything in that file is already in your collection."); return; }
      message = (added ? "Added " + plural(added, "new printing") + " (" + plural(addedCards, "card") + ")" : "Added no new cards") +
        (plan.dupKeys.length ? ", skipped " + plural(plan.dupKeys.length, "printing") + " you already had" : "") +
        (raised ? ", raised " + plural(raised, "quantity", "quantities") : "") + ".";
    } else {
      if (mode === "replace") { collection = []; selected.clear(); }
      let merged = 0;
      for (const rec of analysis.records) if (addOrMerge(copy(rec)).merged) merged++;
      const t = totals(analysis.records);
      message = (mode === "replace" ? "Replaced your collection with " : "Imported ") + plural(analysis.records.length, "printing") +
        " (" + plural(t.cards, "card") + ")" + (merged ? ", " + merged + " merged with cards you already had" : "") + ".";
    }
    save();
    closeImport();
    render();
    toast(message, {action: "Undo", onAction: () => { collection = before.map(upgradeRecord).filter(Boolean); save(); render(); toast("Import undone."); }});
  }

  /* ======================= CSV export ======================= */
  function exportCSV() {
    if (!collection.length) { toast("There's nothing to export yet."); return; }
    const cols = [
      ["Product ID", r => r.productId || ""], ["Product Name", r => r.productName], ["Card Name", r => r.name],
      ["Set Name", r => r.setName], ["Number", r => r.number], ["Rarity", r => r.rarity], ["Printing", r => r.edition],
      ["Condition", r => r.condition], ["Language", r => r.language], ["Quantity", r => r.qty],
      ["TCG Market Price", r => { const pi = priceInfo(r); return pi.from === "manual" || pi.unit == null ? "" : pi.unit.toFixed(2); }],
      ["Price Paid", r => r.paid == null ? "" : r.paid], ["Value Estimate (USD)", r => r.manualPrice == null ? "" : r.manualPrice],
      ["Japan Price (JPY)", r => r.jp == null ? "" : r.jp], ["Korea Price (KRW)", r => r.kr == null ? "" : r.kr],
      ["Image URL", r => r.customImage || ""], ["Location", r => r.location], ["Graded By", r => r.grade ? r.grade.company : ""],
      ["Grade", r => r.grade ? r.grade.grade : ""], ["Cert Number", r => r.grade ? r.grade.cert : ""],
      ["Graded Value (USD)", r => r.grade && r.grade.value != null ? r.grade.value : ""],
      ["PSA 10 Value (USD)", r => r.g10 == null ? "" : r.g10], ["Sealed", r => r.sealed ? "yes" : ""],
      ["Notes", r => r.notes], ["Date Added", r => r.added]];
    const cell = v => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map(c => cell(c[0])).join(",")].concat(collection.map(r => cols.map(c => cell(c[1](r))).join(",")));
    download(new Blob(["﻿" + lines.join("\r\n")], {type: "text/csv;charset=utf-8"}), "card-vault-" + localDay(new Date()) + ".csv");
    toast("Exported " + plural(collection.length, "printing") + ". Import this file anytime to restore them.");
  }

