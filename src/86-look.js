  /* ======================= Look: light or dark, and the size of the words ======================= */
  // Settings, Look. Kept on this device only (a phone and a computer can differ), in its settings. The little script at
  // the top of index.html reads the same two settings before the page is drawn, so it never flashes the other colours.
  const LOOK_THEMES = [["dark", "Dark"], ["light", "Light"], ["auto", "Match my phone"]];
  const LOOK_TEXT = [["smaller", "Smaller"], ["normal", "Normal"], ["larger", "Larger"], ["largest", "Largest"]];
  const LOOK_BAR = {dark: "#0f0b1c", light: "#f4eee2"};   // (the phone's bar above the page)
  const lightQuery = () => { try { return window.matchMedia ? matchMedia("(prefers-color-scheme: light)") : null; } catch (e) { return null; } };
  const lookTheme = () => LOOK_THEMES.some(([k]) => k === settings.theme) ? settings.theme : "dark";
  const lookText = () => LOOK_TEXT.some(([k]) => k === settings.textSize) ? settings.textSize : "normal";
  // the colours actually showing: Match my phone follows the phone's own light or dark setting
  function shownTheme() {
    const t = lookTheme();
    if (t !== "auto") return t;
    const q = lightQuery();
    return q && q.matches ? "light" : "dark";
  }
  function applyLook() {
    const d = document.documentElement, t = shownTheme(), x = lookText();
    if (t === "light") d.dataset.theme = "light"; else delete d.dataset.theme;
    if (x === "normal") delete d.dataset.text; else d.dataset.text = x;
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", LOOK_BAR[t]);
  }
  let lookWired = false;
  function initLook() {
    applyLook();
    if (lookWired) return;
    lookWired = true;
    // (the phone switching to light or dark by itself, at sunset say, while Card Vault is open)
    const q = lightQuery(), follow = () => { if (lookTheme() === "auto") applyLook(); };
    if (q && q.addEventListener) q.addEventListener("change", follow);
    else if (q && q.addListener) q.addListener(follow);
  }
  function lookHTML() {
    const seg = (id, label, list, cur) => '<div class="seg look-seg" role="group" aria-label="' + label + '" id="' + id + '">' +
      list.map(([k, l]) => '<button type="button" data-look="' + k + '" aria-pressed="' + (k === cur) + '">' + esc(l) + "</button>").join("") + "</div>";
    return '<div class="section" id="lookSection"><h3>Look</h3>' +
      '<p class="small look-label">Colours</p>' + seg("sTheme", "Colours", LOOK_THEMES, lookTheme()) +
      '<p class="small look-label">Text size</p>' + seg("sTextSize", "Text size", LOOK_TEXT, lookText()) +
      '<p class="small" style="margin:10px 0 0">Just on this ' + (/iPhone|iPad|Android/i.test(navigator.userAgent || "") ? "phone" : "device") +
      ". Match my phone switches between light and dark when your phone does.</p></div>";
  }
  function wireLook() {
    const pick = (id, key) => {
      const box = $(id);
      if (!box) return;
      box.addEventListener("click", e => {
        const b = e.target.closest("[data-look]");
        if (!b) return;
        settings[key] = b.dataset.look;
        box.querySelectorAll("[data-look]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        saveSettings();
        applyLook();
      });
    };
    pick("sTheme", "theme");
    pick("sTextSize", "textSize");
  }
