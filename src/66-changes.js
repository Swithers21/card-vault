  /* ======================= Recent changes, with Undo ======================= */
  // Every save that changes your cards (not the quiet ones: photos found in the background, changes arriving from your
  // other devices) is kept here as one change: what each card was before and after, and a few words saying what
  // happened (added, moved, edited, removed). Any of the last 100 can be undone, card by card: a card that has changed
  // again since is left as it is, and said so. Kept on this device, in its database (10-storage's big store).
  // The cards only: the want list, decks and sales have their own Undo when you change them.
  const CHANGES_KEY = "cardvault.v2.changes", CHANGES_MAX = 100, CHANGE_CARDS_MAX = 3000;
  // (fields that change without you changing the card: when sent to PriceCharting or SortSwift, the price kept with it)
  const CHANGE_QUIET = new Set(["mod", "pcSent", "ssSent", "snap"]);
  const CHANGE_FIELDS = {qty: "how many", condition: "condition", edition: "printing", language: "language", paid: "price paid", location: "location", notes: "notes",
    grade: "grade", grading: "grading", sell: "sell list", customImage: "photo", rarity: "rarity", number: "card number", name: "name", productId: "TCGplayer printing", tags: "tags"};
  const locKey = l => String(l || "").trim().toLowerCase();
  let changeNote = "";   // (a change that can say what it was in its own words: a sale, an Undo)
  const noteChange = words => { changeNote = String(words || ""); };
  const changesList = () => { const l = bigGet(CHANGES_KEY, []); return Array.isArray(l) ? l : []; };
  // From stampChanges (10-storage), with [{id, b: the card before (its print) or null, a: after or null}]
  function logChanges(items) {
    const note = changeNote;
    changeNote = "";
    const real = items.filter(it => !(it.b && it.a && sameBut(it.b, it.a)));
    if (!real.length) return;
    const entry = {id: newId(), at: new Date().toISOString(), label: note || changeLabel(real), n: real.length};
    if (real.length <= CHANGE_CARDS_MAX) entry.items = real; else entry.tooBig = true;
    const list = changesList().slice(0, CHANGES_MAX - 1);
    list.unshift(entry);
    bigSet(CHANGES_KEY, list);
    if (drawerCtx && drawerCtx.mode === "changes") renderChanges();
  }
  // (the same card apart from the fields that change by themselves)
  function sameBut(b, a) {
    const x = JSON.parse(b), y = JSON.parse(a);
    for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) if (!CHANGE_QUIET.has(k) && JSON.stringify(x[k]) !== JSON.stringify(y[k])) return false;
    return true;
  }
  const changeName = r => r.name + (r.number ? " (" + r.number + ")" : "");
  // A few words for a change: "Added Time Wizard ×2", "Moved 12 cards to Binder 3", "Edited Dark Magician (condition)"
  function changeLabel(items) {
    const B = items.map(it => it.b ? JSON.parse(it.b) : null), A = items.map(it => it.a ? JSON.parse(it.a) : null);
    const qty = list => list.reduce((t, r) => t + (r ? num(r.qty) || 0 : 0), 0);
    const before = qty(B), after = qty(A);
    const names = new Set(A.concat(B).filter(Boolean).map(changeName));
    const one = names.size === 1 ? Array.from(names)[0] : "";
    const cards = n => one ? one + (n > 1 ? " ×" + n : "") : plural(n, "card");
    // where copies went: the places that gained more than they lost
    const by = new Map();
    B.forEach(r => { if (r) by.set(locKey(r.location), (by.get(locKey(r.location)) || 0) - (num(r.qty) || 0)); });
    A.forEach(r => { if (r) by.set(locKey(r.location), (by.get(locKey(r.location)) || 0) + (num(r.qty) || 0)); });
    const gained = Array.from(by.entries()).filter(([, n]) => n > 0);
    const placeName = k => { const r = A.find(x => x && locKey(x.location) === k); return r && String(r.location || "").trim() ? String(r.location).trim() : "no location"; };
    if (after === before && gained.length) {
      const n = gained.reduce((t, [, x]) => t + x, 0);
      return "Moved " + cards(n) + " to " + (gained.length === 1 ? placeName(gained[0][0]) : gained.length + " places");
    }
    if (after > before && !B.some(Boolean)) return "Added " + cards(after - before);
    if (after < before && !A.some(Boolean)) return "Removed " + cards(before - after);
    if (after !== before && items.length === 1) return (after > before ? "Added " : "Took away ") + cards(Math.abs(after - before));
    // edits: which fields
    const fields = new Set();
    items.forEach((it, i) => {
      if (!B[i] || !A[i]) return;
      for (const k of new Set(Object.keys(B[i]).concat(Object.keys(A[i])))) if (!CHANGE_QUIET.has(k) && JSON.stringify(B[i][k]) !== JSON.stringify(A[i][k])) fields.add(CHANGE_FIELDS[k] || "details");
    });
    const what = Array.from(fields).slice(0, 3).join(", ");
    if (after !== before) return (after > before ? "Added " + (after - before) : "Took away " + (before - after)) + " and edited " + plural(items.length, "card") + (what ? " (" + what + ")" : "");
    return "Edited " + (one || plural(items.length, "card")) + (what ? " (" + what + ")" : "");
  }
  // Puts back how the cards were before a change. Ones changed again since are left alone.
  function undoChange(id) {
    const list = changesList(), e = list.find(x => x.id === id);
    if (!e || !e.items || e.undone) return {done: 0, skipped: 0};
    let done = 0, skipped = 0;
    for (const it of e.items) {
      const i = collection.findIndex(r => r.id === it.id), cur = i >= 0 ? printOf(collection[i]) : null;
      if (cur !== it.a) { skipped++; continue; }
      if (it.b == null) collection.splice(i, 1);
      else if (i >= 0) collection[i] = upgradeRecord(JSON.parse(it.b));
      else collection.push(upgradeRecord(JSON.parse(it.b)));
      done++;
    }
    for (const sid of Array.from(selected)) if (!collection.some(r => r.id === sid)) selected.delete(sid);
    e.undone = new Date().toISOString();
    bigSet(CHANGES_KEY, list);
    if (done) { noteChange("Undid: " + e.label); save(); render(); }
    return {done, skipped};
  }
  function openChanges() {
    drawerCtx = {mode: "changes"};
    openDrawer("Recent changes", '<div id="chBody"></div>');
    renderChanges();
  }
  function renderChanges() {
    const box = $("chBody");
    if (!box || !drawerCtx || drawerCtx.mode !== "changes") return;
    const list = changesList();
    const dayOf = iso => { const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 864e5);
      return d.toDateString() === t.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : fmtDate(d); };
    const detail = it => {
      const b = it.b ? JSON.parse(it.b) : null, a = it.a ? JSON.parse(it.a) : null, r = a || b;
      const loc = x => String((x && x.location) || "").trim() || "no location";
      const what = !b ? "added, " + (a.qty || 1) + " in " + loc(a) : !a ? "removed, " + (b.qty || 1) + " from " + loc(b)
        : [b.qty !== a.qty ? "how many " + b.qty + " → " + a.qty : "", loc(b) !== loc(a) ? loc(b) + " → " + loc(a) : "",
           b.condition !== a.condition ? b.condition + " → " + a.condition : "", b.paid !== a.paid ? "paid " + (b.paid == null ? "none" : usd(b.paid)) + " → " + (a.paid == null ? "none" : usd(a.paid)) : ""].filter(Boolean).join("; ") || "edited";
      return "<li>" + esc(changeName(r)) + ' <span class="small">' + esc(what) + "</span></li>";
    };
    let day = "";
    box.innerHTML = '<p class="small" style="margin:0 0 10px">Your last ' + CHANGES_MAX + " changes to your cards on this device. Undo puts the cards back as they were; a card that has changed again since stays as it is.</p>" +
      (list.length ? '<ol class="ch-list">' + list.map(e => {
        const d = dayOf(e.at), head = d !== day ? '<li class="ch-day">' + esc(d) + "</li>" : "";
        day = d;
        return head + '<li class="ch-row' + (e.undone ? " ch-undone" : "") + '"><div class="ch-main"><span class="ch-time">' + esc(new Date(e.at).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"})) + "</span>" +
          '<span class="ch-label">' + esc(e.label) + "</span>" +
          (e.undone ? '<span class="small">Undone</span>' : e.items ? '<button type="button" class="btn btn-small" data-ch-undo="' + esc(e.id) + '">Undo</button>' : '<span class="small">Too big to undo</span>') + "</div>" +
          (e.items && e.items.length ? '<details class="more"><summary>What changed</summary><ul class="ch-cards">' + e.items.slice(0, 30).map(detail).join("") +
            (e.items.length > 30 ? "<li>…and " + (e.items.length - 30) + " more</li>" : "") + "</ul></details>" : "") + "</li>";
      }).join("") + "</ol>" : '<p class="small">No changes yet. Each change to your cards shows here, with an Undo.</p>');
    box.querySelectorAll("[data-ch-undo]").forEach(b => b.addEventListener("click", () => {
      const res = undoChange(b.dataset.chUndo);
      renderChanges();
      toast(res.done ? "Undone" + (res.skipped ? ": " + plural(res.skipped, "card has", "cards have") + " changed since, so " + (res.skipped === 1 ? "it stays" : "they stay") + " as " + (res.skipped === 1 ? "it is" : "they are") : "") + "."
        : "Nothing to undo: those cards have all changed since.");
    }));
  }
