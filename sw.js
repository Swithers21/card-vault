// Card Vault works offline once it has been opened: this keeps a copy of the app and of the latest
// TCGplayer prices. It tries the internet first, so updates and new prices show up right away, but on a
// slow connection (a card shop, say) it uses the saved copy after a few seconds.
const CACHE = "cardvault-v2";
const KEEP = ["./", "index.html", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "icons/apple-touch-icon.png", "tcgplayer-data.js"];
const PATIENCE = 3500;   // ms to wait for the internet before using the saved copy

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(KEEP.map(path => cache.add(path).catch(() => null)))));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  // Only Card Vault's own older copies are removed (other sites at the same address keep theirs).
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("cardvault-") && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Google, TCGplayer photos, fonts and the text reader go straight to the internet.
  if (url.origin !== self.location.origin) return;
  // Only this website's own files (not other sites at the same address).
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  // Always fresh: the "are there new prices?" check and the Google sign-in page.
  if (/tcgplayer-data-version\.js$|oauth\.html$/.test(url.pathname)) return;
  event.respondWith(fromNetworkOrSaved(request, event));
});

function fromNetworkOrSaved(request, event) {
  const saved = () => caches.match(request, {ignoreSearch: true})
    .then(hit => hit || (request.mode === "navigate" ? caches.match("./") : undefined));
  const network = fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  });
  return new Promise(resolve => {
    let settled = false;
    const use = response => { if (!settled && response) { settled = true; resolve(response); } };
    // slow connection: the saved copy (the download carries on and updates it for next time)
    const timer = setTimeout(() => saved().then(use), PATIENCE);
    network.then(response => { clearTimeout(timer); use(response); })
      .catch(() => { clearTimeout(timer); saved().then(hit => use(hit || Response.error())); });
  });
}
