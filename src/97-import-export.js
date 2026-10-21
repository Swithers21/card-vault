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
    g10: ["psa10valueusd", "psa10value", "psa10"],
    shopRef: ["shopproduct", "shopref"], shop: ["shop"], shopLink: ["shoplink"], shopPrice: ["shopprice", "shoppriceusd"]
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
      ref: get("shopRef") || null, shop: get("shop"), link: get("shopLink"), shopPrice: num(get("shopPrice")),   // (a Japanese or Korean box from a shop)
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
      : r.ref ? "s|" + r.ref
      : "n|" + normNumber(r.number) + "|" + r.name.toLowerCase() + "|" + (r.edition || "") + (mangaOf(r.rarity) ? "|" + r.rarity.toLowerCase() : "");   // (a Manga-Style card's two versions are two printings)
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
    armBack();
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
      ["Shop Product", r => r.ref || ""], ["Shop", r => r.shop || ""], ["Shop Link", r => r.link || ""], ["Shop Price (USD)", r => r.shopPrice == null ? "" : r.shopPrice],
      ["Notes", r => r.notes], ["Date Added", r => r.added]];
    const cell = v => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map(c => cell(c[0])).join(",")].concat(collection.map(r => cols.map(c => cell(c[1](r))).join(",")));
    download(new Blob(["﻿" + lines.join("\r\n")], {type: "text/csv;charset=utf-8"}), "card-vault-" + localDay(new Date()) + ".csv");
    toast("Exported " + plural(collection.length, "printing") + ". Import this file anytime to restore them.");
  }

  /* ======================= Export for PriceCharting ======================= */
  // A file for PriceCharting's CSV collection importer (pricecharting.com/collection-import-csv). It matches every row by
  // PriceCharting's own product id, which Card Vault already has for each card it matched for graded values (or that you
  // matched yourself), so the cards come across exactly: graded ones at their grade (PriceCharting's condition-id list),
  // with the grading company and cert number, what you paid per copy (in pennies), your notes, and your locations as
  // folders. PriceCharting adds every row and never replaces anything, so each card remembers how many of its copies
  // went to PriceCharting (r.pcSent, kept with the card, so on every device), and the next file has only the rest: new
  // cards, extra copies, cards looked up since. (Its columns, from its importer's own documentation: id is required; product-name
  // and console-name are only for reading and ignored there.)
  const PC_IMPORT_URL = "https://www.pricecharting.com/collection-import-csv";
  const PC_GRADE_IDS = {"9.5": 6, "9": 5, "8": 2, "7": 3, "6": 16, "5": 15, "4": 14, "3": 13, "2": 10, "1": 9};
  // (csvCell: in 94-sales-and-reports)
  function pcCompany(company) {
    const c = String(company || "").trim().toUpperCase();
    return !c ? "" : c === "BGS" || c.startsWith("BECKETT") ? "Beckett" : ["PSA", "CGC", "SGC", "TAG", "ACE"].includes(c) ? c : "Other";
  }
  // A grade as PriceCharting has it: {condition (its condition-id), company, note}. A 10 is the grading company's own 10
  // (BGS 10, BGS 10 Black, CGC 10, CGC 10 Pristine, SGC 10, TAG 10, ACE 10; PSA's is "Grade 10"); a half grade it doesn't
  // list for cards (8.5) goes down to the one below, and the notes keep the real one.
  function pcGrade(g) {
    if (!g || !g.company) return {condition: 1, company: "", note: ""};
    const company = pcCompany(g.company), text = String(g.grade || "").trim();
    const n = num(text.replace(/[^0-9.]/g, ""));
    if (n == null || n < 1) return {condition: 1, company, note: text ? "Grade " + text : "Graded, grade not entered"};
    if (n >= 10) {
      const id = company === "Beckett" ? (/black/i.test(text) ? 20 : 8) : company === "CGC" ? (/pristine/i.test(text) ? 19 : 17)
        : company === "SGC" ? 18 : company === "TAG" ? 21 : company === "ACE" ? 22 : 7;
      return {condition: id, company, note: ""};
    }
    const step = n >= 9.5 ? 9.5 : Math.floor(n);
    return {condition: PC_GRADE_IDS[String(step)], company, note: step !== n ? "Grade " + text : ""};
  }
  // Which PriceCharting item a card of yours is: {id, p} or {skip: why}
  function pcExportId(r) {
    if (r.sealed) return {skip: "sealed"};
    if (r.pcId === "none") return {skip: "marked"};
    const h = pcCache()[pcKey(r)];
    if (/^\d+$/.test(String(r.pcId || ""))) return {id: String(r.pcId), p: h && h.p && String(h.p.id) === String(r.pcId) ? h.p : null};
    if (r.language === "Korean") return {skip: "korean"};
    if (!normNumber(r.number)) return {skip: "nonumber"};
    if (!h || (!h.p && !h.t)) return {skip: "unknown"};          // (never asked, or to be asked again)
    if (!h.p) return {skip: "nomatch"};
    if (!/^\d+$/.test(String(h.p.id || ""))) return {skip: "unknown"};
    return {id: String(h.p.id), p: h.p};
  }
  // Your cards for the file (every copy, or only the copies not sent to PriceCharting yet): {rows: [{r, id, p, qty}],
  // copies, sent (copies already sent), skipped: {why: [records]}}
  const pcUnsent = r => Math.max(0, r.qty - (r.pcSent || 0));
  function pcExportPlan(onlyNew) {
    const out = {rows: [], copies: 0, sent: 0, skipped: {unknown: [], nomatch: [], korean: [], marked: [], sealed: [], nonumber: []}};
    for (const r of collection) {
      const x = pcExportId(r);
      if (x.skip) { out.skipped[x.skip].push(r); continue; }
      out.sent += Math.min(r.qty, r.pcSent || 0);
      const qty = onlyNew ? pcUnsent(r) : r.qty;
      if (!qty) continue;
      out.rows.push({r, id: x.id, p: x.p, qty});
      out.copies += qty;
    }
    return out;
  }
  // Copies moving from one entry to another (moved to a location, one sent for grading, duplicates joined): the ones
  // already sent to PriceCharting go first, so the count of sent copies stays right.
  function pcSentShift(from, to, n) {
    const moved = Math.min(n, from.pcSent || 0);
    if (!moved) return;
    from.pcSent -= moved;
    if (!from.pcSent) delete from.pcSent;
    to.pcSent = (to.pcSent || 0) + moved;
  }
  // From before cards remembered it: an export made then sent every card it could (each one added before it, matched then)
  function pcSentFromLastExport() {
    if (settings.pcSentKept || !settings.pcExportAt) return 0;
    settings.pcSentKept = true;
    saveSettings();
    if (collection.some(r => r.pcSent)) return 0;
    const at = parseDate(settings.pcExportAt);
    let n = 0;
    for (const r of collection) { const a = parseDate(r.added); if (at && a && a <= at && pcExportId(r).id) { r.pcSent = r.qty; n++; } }
    if (n) save({quiet: true});
    return n;
  }
  function pcExportText(rows, folders) {
    const head = ["id", "product-name", "console-name", "condition-id", "quantity", "cost-basis-in-pennies", "notes", "grading-company", "grading-cert-id", "folder"];
    const lines = rows.map(({r, id, p, qty}) => {
      const g = pcGrade(r.grade);
      const cond = !r.grade && r.condition && r.condition !== "Near Mint" ? r.condition : "";
      const notes = [cond, g.note, String(r.notes || "").replace(/\s+/g, " ")].map(s => String(s).trim()).filter(Boolean).join(" · ").slice(0, 300);
      return [id, p ? p.name : [r.name, r.number].filter(Boolean).join(" "), p ? p.set : r.setName, g.condition, qty == null ? r.qty : qty,
        r.paid != null && r.paid > 0 ? Math.round(r.paid * 100) : "", notes, g.company, r.grade ? r.grade.cert : "", folders ? r.location : ""].map(csvCell).join(",");
    });
    // (no byte-order mark: the first column's name must read exactly "id")
    return [head.join(",")].concat(lines).join("\r\n") + "\r\n";
  }

  const pcx = {busy: false, stop: false, done: 0, total: 0, err: "", onlyNew: null, folders: true, saved: null};
  const PCX_WHY = {
    nomatch: n => plural(n, "printing") + " PriceCharting had no match for.",
    korean: n => plural(n, "Korean card") + ": PriceCharting doesn't list Korean cards.",
    marked: n => plural(n, "printing") + " you marked as not on PriceCharting.",
    sealed: n => plural(n, "sealed product") + ": Card Vault doesn't match those with PriceCharting.",
    nonumber: n => plural(n, "card") + " without a card number."};
  function openPcExport() {
    drawerCtx = {mode: "pc-export"};
    pcSentFromLastExport();
    pcx.onlyNew = true;
    pcx.saved = null;
    openDrawer("Export for PriceCharting", '<div id="pcxBody"></div>');
    renderPcExport();
  }
  function renderPcExport() {
    const box = $("pcxBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "pc-export") return;
    const last = parseDate(settings.pcExportAt);
    const all = pcExportPlan(false), sentAny = all.sent > 0;
    const onlyNew = sentAny && pcx.onlyNew;
    const plan = onlyNew ? pcExportPlan(true) : all;
    const sk = plan.skipped, unknown = new Set(sk.unknown.map(pcKey)).size;
    const left = Object.keys(sk).reduce((n, k) => n + sk[k].length, 0);
    const hasLoc = plan.rows.some(x => x.r.location);
    const mins = Math.max(1, Math.round(unknown * 1.6 / 60));
    let look = "";
    if (pcx.busy) look = '<p class="pcx-line">Looking them up on PriceCharting: ' + pcx.done + " of " + pcx.total + '… <button type="button" class="link-btn" id="pcxStop">Stop</button></p>';
    else if (unknown) look = '<p class="pcx-line">' + plural(unknown, "printing") + " not looked up on PriceCharting yet" + (pcOn() && !pcBad()
      ? '. <button type="button" class="btn btn-small" id="pcxLook">Look them up now</button> <span class="small">(about ' + plural(mins, "minute") + ")</span>"
      : ': Card Vault needs your PriceCharting key for that. <button type="button" class="link-btn" id="pcxKey">Settings &gt; Graded values</button>') + "</p>";
    box.innerHTML =
      '<p class="small" style="margin:0 0 12px">A file for PriceCharting\'s collection importer. Each card is matched by its PriceCharting ID, the one Card Vault found when it looked up graded values, ' +
      "so it comes across exactly: graded cards at their grade with the grading company and cert number, what you paid, and your notes.</p>" +
      (pcx.saved ? '<div class="notice good" role="status">Saved ' + plural(pcx.saved.copies, "card") + " for PriceCharting at " + esc(fmtDateTime(pcx.saved.at)) +
        '. Upload that file once on <a target="_blank" rel="noopener" href="' + PC_IMPORT_URL + '">PriceCharting\'s importer</a>. ' +
        'Didn\'t upload it? <button type="button" class="link-btn" id="pcxUndo">Take it back</button> and Card Vault offers those cards again next time.</div>' : "") +
      (pcx.err ? '<div class="notice" role="alert">' + esc(pcx.err) + "</div>" : "") +
      (sentAny ? '<div class="field"><span>Which cards</span><div class="theme-langs">' +
        '<label class="check-row"><input type="radio" name="pcxWhich" value="new"' + (onlyNew ? " checked" : "") + "> <span>Only what PriceCharting doesn't have yet</span></label>" +
        '<label class="check-row"><input type="radio" name="pcxWhich" value="all"' + (onlyNew ? "" : " checked") + "> <span>Everything, again</span></label></div>" +
        '<p class="hint" style="margin:4px 0 0">' + plural(all.sent, "card") + " already went to PriceCharting" + (last ? " (last file " + esc(fmtDateTime(last)) + ")" : "") + "." +
        (onlyNew ? "" : " <b>Uploading them again counts them twice.</b>") + "</p></div>" : "") +
      '<div class="pcx-sum">' +
      '<p class="pcx-line"><b>' + (plan.rows.length ? plural(plan.copies, "card") + " ready" : onlyNew ? "Nothing new for PriceCharting" : "No cards ready yet") + "</b>" +
      (plan.rows.length ? " (" + plural(plan.rows.length, "printing") + ")" : "") + "</p>" + look +
      ["nomatch", "korean", "marked", "sealed", "nonumber"].filter(k => sk[k].length).map(k => '<p class="pcx-line small">' + esc(PCX_WHY[k](sk[k].length)) +
        (k === "nomatch" ? ' <button type="button" class="link-btn" id="pcxFix">Fix the matches</button>' : "") + "</p>").join("") +
      (left ? '<details class="more"><summary>Which cards are left out</summary><ul class="pcx-left">' +
        Object.keys(sk).flatMap(k => sk[k]).slice(0, 150).map(r => "<li>" + esc([r.name, r.number, r.language !== "English" ? r.language : ""].filter(Boolean).join(" · ")) + "</li>").join("") +
        (left > 150 ? "<li>…and " + (left - 150) + " more</li>" : "") + "</ul></details>" : "") +
      "</div>" +
      (hasLoc ? '<label class="check-row" style="margin-top:12px"><input type="checkbox" class="check" id="pcxFolders"' + (pcx.folders ? " checked" : "") + "> <span>Put each card in a folder named after its location (Binder 1, Deck box…)</span></label>" +
        '<p class="hint" style="margin:2px 0 0">Free PriceCharting accounts can only make a few folders.</p>' : "") +
      '<p class="hint" style="margin:12px 0 0"><b>Upload the file once.</b> PriceCharting adds every row to your collection and never replaces anything, so uploading it twice counts your cards twice. ' +
      "Each card remembers how many of its copies went (on every device you use), so next time the file has only what PriceCharting doesn't have yet: new cards, extra copies, and cards looked up since.</p>" +
      '<div class="form-actions"><button type="button" class="btn btn-primary" id="pcxGo"' + (plan.rows.length ? "" : " disabled") + '>Download the file</button>' +
      '<a class="btn" target="_blank" rel="noopener" href="' + PC_IMPORT_URL + '">Open PriceCharting\'s importer</a></div>';
    box.querySelectorAll("[name=pcxWhich]").forEach(b => b.addEventListener("change", () => { pcx.onlyNew = b.value === "new"; renderPcExport(); }));
    if ($("pcxFolders")) $("pcxFolders").addEventListener("change", e => { pcx.folders = e.target.checked; });
    if ($("pcxLook")) $("pcxLook").addEventListener("click", pcExportLookup);
    if ($("pcxStop")) $("pcxStop").addEventListener("click", () => { pcx.stop = true; });
    if ($("pcxKey")) $("pcxKey").addEventListener("click", () => openSettings({section: "graded"}));
    if ($("pcxFix")) $("pcxFix").addEventListener("click", () => openSettings({section: "graded"}));
    if ($("pcxUndo")) $("pcxUndo").addEventListener("click", pcExportUndo);
    $("pcxGo").addEventListener("click", () => pcExportDownload(plan));
  }
  // The cards never looked up on PriceCharting, one printing at a time (its limit: one request a second)
  async function pcExportLookup() {
    if (pcx.busy || !pcOn() || pcBad()) return;
    const plan = pcExportPlan(false), seen = new Set(), todo = [];
    for (const r of plan.skipped.unknown) { const k = pcKey(r); if (!seen.has(k)) { seen.add(k); todo.push(r); } }
    Object.assign(pcx, {busy: true, stop: false, done: 0, total: todo.length, err: ""});
    renderPcExport();
    let failed = 0;
    try {
      for (const r of todo) {
        if (pcx.stop) break;
        try { await pcLookup(r, true); failed = 0; }
        catch (e) {
          if (e && e.name === "TokenError") { pcx.err = "PriceCharting didn't accept your key (Settings > Graded values)."; break; }
          if (++failed >= 5 || (typeof navigator !== "undefined" && navigator.onLine === false)) { pcx.err = "Couldn't reach PriceCharting right now. Try again in a while."; break; }
        }
        pcx.done++;
        renderPcExport();
      }
    } finally { pcx.busy = false; renderPcExport(); if (settings.gradedView) renderSoon(); }
  }
  function pcExportDownload(plan) {
    if (!plan.rows.length) return;
    const folders = pcx.folders && plan.rows.some(x => x.r.location);
    download(new Blob([pcExportText(plan.rows, folders)], {type: "text/csv;charset=utf-8"}), "card-vault-for-pricecharting-" + localDay(new Date()) + ".csv");
    const at = new Date(), was = new Map();
    for (const {r} of plan.rows) { was.set(r.id, r.pcSent || 0); r.pcSent = r.qty; }
    settings.pcExportAt = at.toISOString();
    settings.pcSentKept = true;
    saveSettings();
    save();
    pcx.saved = {copies: plan.copies, at, was};
    pcx.onlyNew = true;
    renderPcExport();
    renderPcBanner();
    toast("Saved " + plural(plan.copies, "card") + " for PriceCharting. Upload the file once on PriceCharting's importer.");
  }
  // Once you keep a collection on PriceCharting (you've exported to it): the cards it doesn't have yet, those ready to go
  // and those not looked up there yet, for a reminder on the Collection tab and a count on the Export menu.
  function pcWaiting() {
    if (!big.settled) return {copies: 0, ready: 0, unknown: 0};   // (until the saved PriceCharting matches are read)
    if (!settings.pcExportAt && !collection.some(r => r.pcSent)) return {copies: 0, ready: 0, unknown: 0};
    // (cards not looked up on this device count only where they can be looked up: with your PriceCharting key here; and
    // not the copies already sent, from a device that had them looked up)
    const plan = pcExportPlan(true), unknown = pcOn() && !pcBad() ? plan.skipped.unknown.reduce((t, r) => t + pcUnsent(r), 0) : 0;
    return {copies: plan.copies + unknown, ready: plan.copies, unknown};
  }
  function renderPcBanner() {
    const b = $("pcBanner");
    if (!b) return;
    const w = pcWaiting();
    // ("Not now" until more cards wait than when you said it; fewer since, say after sending them, starts the count again)
    if (w.copies < (num(settings.pcNudgeSeen) || 0)) { settings.pcNudgeSeen = w.copies; saveSettings(); }
    const show = w.copies > 0 && w.copies > (num(settings.pcNudgeSeen) || 0);
    b.hidden = !show;
    b.innerHTML = show ? "<strong>" + plural(w.copies, "card") + (w.copies === 1 ? " isn't" : " aren't") + " on PriceCharting yet.</strong> " +
      (w.unknown ? (w.unknown === w.copies ? (w.copies === 1 ? "It needs" : "They need") + " looking up there first; Card Vault does that for you. " : w.unknown + " of them need looking up there first. ") : "") +
      "Card Vault makes a file with just these, to upload once." +
      '<div class="banner-actions"><button class="btn btn-small btn-primary" type="button" data-banner="pc-send">Send them to PriceCharting</button>' +
      '<button class="btn btn-small" type="button" data-banner="pc-later">Not now</button></div>' : "";
    const item = $("pcExportBtn");
    if (item) item.dataset.waiting = w.copies ? String(w.copies) : "";
    syncBanners();
  }
  // The file wasn't uploaded after all: those copies count as not sent again
  function pcExportUndo() {
    if (!pcx.saved || !pcx.saved.was) return;
    for (const r of collection) if (pcx.saved.was.has(r.id)) { const v = pcx.saved.was.get(r.id); if (v) r.pcSent = v; else delete r.pcSent; }
    save();
    pcx.saved = null;
    renderPcExport();
    renderPcBanner();
    toast("Taken back: Card Vault offers those cards again next time.");
  }

  /* ======================= Want list to a TCGplayer cart ======================= */
  // TCGplayer's Mass Entry (tcgplayer.com/massentry) makes a cart from a list, one card a line: "2 Dark Magician Girl [MVP1]"
  // (how many, the card's name, the set's code in brackets, as its own help describes). It opens with the list filled in,
  // the way TCGplayer's own "Buy Deck" links do (productline, and the lines joined by ||). There you choose the printings
  // and conditions you'll take and TCGplayer finds the cheapest sellers; nothing is bought until you check out yourself.
  const TCG_MASS_ENTRY = "https://www.tcgplayer.com/massentry";
  const tcgx = {onlyHits: false};
  function tcgCartPlan(onlyHits) {
    const byLine = new Map(), left = {away: [], sealed: [], unmatched: []};
    let picky = 0, hits = 0;
    for (const w of wants) {
      if (wantKind(w) !== "card") { left.sealed.push(w); continue; }
      const p = w.productId && catalog ? catalog.byId.get(w.productId) : null;
      if (!p) { (!w.productId && ocgRegion(w.number) ? left.away : left.unmatched).push(w); continue; }
      const hit = wantStatus(w).hit;
      if (hit) hits++;
      if (onlyHits && !hit) continue;
      const text = lookupName(p.name) + (p.group && p.group.abbr ? " [" + p.group.abbr + "]" : "");
      byLine.set(text, (byLine.get(text) || 0) + w.qty);
      if (w.edition && w.edition !== "Any") picky++;
    }
    const lines = Array.from(byLine, ([text, n]) => n + " " + text);
    return {lines, left, picky, hits};
  }
  const tcgCartURL = lines => TCG_MASS_ENTRY + "?productline=yugioh&c=" + encodeURIComponent(lines.join("||"));
  function openTcgCart() {
    drawerCtx = {mode: "tcg-cart"};
    openDrawer("Buy your wants on TCGplayer", '<div id="tcgxBody"></div>');
    renderTcgCart();
  }
  function renderTcgCart() {
    const box = $("tcgxBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "tcg-cart") return;
    if (!catalog) { box.innerHTML = '<div class="notice">This needs TCGplayer\'s card list, which hasn\'t loaded yet. Try again in a moment.</div>'; return; }
    const plan = tcgCartPlan(tcgx.onlyHits && tcgCartPlan(false).hits > 0);
    const onlyHits = tcgx.onlyHits && plan.hits > 0;
    const copies = plan.lines.reduce((n, l) => n + parseInt(l, 10), 0);
    const lf = plan.left, leftText = [lf.away.length ? plural(lf.away.length, "Japanese or Korean card") + " (TCGplayer doesn't sell them)" : "",
      lf.sealed.length ? plural(lf.sealed.length, "sealed product") + " (Mass Entry is for single cards)" : "",
      lf.unmatched.length ? plural(lf.unmatched.length, "card") + " not matched to a TCGplayer card" : ""].filter(Boolean);
    box.innerHTML =
      '<p class="small" style="margin:0 0 12px">TCGplayer\'s Mass Entry turns this list into a cart from the cheapest sellers. On TCGplayer, choose the printings (1st Edition, Unlimited…) and conditions you\'ll take, ' +
      "then Add to Cart. Nothing is bought until you check out yourself.</p>" +
      (plan.hits ? '<div class="field"><span>Which cards</span><div class="theme-langs">' +
        '<label class="check-row"><input type="radio" name="tcgxWhich" value="all"' + (onlyHits ? "" : " checked") + "> <span>Every card on your want list</span></label>" +
        '<label class="check-row"><input type="radio" name="tcgxWhich" value="hits"' + (onlyHits ? " checked" : "") + "> <span>Only the " + plan.hits + " at or below your target</span></label></div></div>" : "") +
      (plan.lines.length
        ? '<label class="field" style="margin-top:12px"><span>' + plural(copies, "card") + " for TCGplayer</span>" +
          '<textarea class="input" id="tcgxList" rows="' + Math.min(12, Math.max(3, plan.lines.length)) + '" readonly>' + esc(plan.lines.join("\n")) + "</textarea></label>" +
          (plan.picky ? '<p class="hint" style="margin:4px 0 0">' + plural(plan.picky, "card") + " on your list " + (plan.picky === 1 ? "is" : "are") + " for one printing (like 1st Edition): TCGplayer's printing choice is for the whole list.</p>" : "")
        : '<div class="notice">None of the cards on your want list are TCGplayer cards yet.</div>') +
      (leftText.length ? '<p class="small" style="margin:10px 0 0">Left out: ' + esc(leftText.join("; ")) + ".</p>" : "") +
      (plan.lines.length ? '<div class="form-actions"><a class="btn btn-primary" id="tcgxOpen" target="_blank" rel="noopener" href="' + esc(tcgCartURL(plan.lines)) + '">Open the list on TCGplayer</a>' +
        '<button type="button" class="btn" id="tcgxCopy">Copy the list</button></div>' : "");
    box.querySelectorAll("[name=tcgxWhich]").forEach(b => b.addEventListener("change", () => { tcgx.onlyHits = b.value === "hits"; renderTcgCart(); }));
    if ($("tcgxCopy")) $("tcgxCopy").addEventListener("click", () => copyText(plan.lines.join("\n"), () => toast("Copied " + plural(plan.lines.length, "line") + ". On TCGplayer's Mass Entry, pick Yu-Gi-Oh! and paste them.")));
  }

