# Card Vault website: setup

Card Vault as a website you can add to your iPhone's home screen, with your collection synced through
Google Drive and TCGplayer prices updated every evening by GitHub.

In this guide, `YOUR-USERNAME` is your GitHub username. The website's address will be
`https://YOUR-USERNAME.github.io/card-vault/`.

## What lives where

- **This repository** (public): the website's code and this guide. Your collection is never in it.
- **Your devices**: your collection, saved in each browser (and in the home-screen app on your iPhone).
- **Your Google Drive**: `Card Vault/Card Vault backup.json`, which every device syncs with, and (if you use them)
  your photos of cards in `Card Vault/Photos` and the locked phone-alerts file. Card Vault can only see files it
  created itself in your Drive.
- **GitHub Actions**: every evening it downloads the day's TCGplayer prices (through TCGCSV), the Japanese and Korean
  prices, the grading companies' fees and the Forbidden & Limited lists, sends your phone alerts (once you've set that
  up: see "Phone alerts without the PC" below), and publishes the website with them. It checks again overnight in
  case TCGCSV was late. An open Card Vault picks up new prices by itself (within half an hour, or as soon as you
  switch back to it): nothing to reload or tap.

## 1. GitHub: the website

1. Sign in at [github.com](https://github.com) (or create a free account).
2. Click **+** (top right) > **New repository**. Name: `card-vault`. Choose **Public** (free GitHub Pages
   websites need a public repository). Don't add a README. Click **Create repository**.
3. In the new repository: **Settings** > **Pages** > **Build and deployment** > **Source**: **GitHub Actions**.
4. Upload the files from the `card-vault` folder: on the repository's main page, click
   **uploading an existing file**, drag in everything from the folder (including the `icons` folder), and click
   **Commit changes**.
5. Windows often hides the `.github` folder, so make the price-update file by hand: **Add file** >
   **Create new file**, name it `.github/workflows/daily-prices.yml`, paste in the contents of that file from
   the folder, and click **Commit changes**.
6. Open the **Actions** tab. "Daily TCGplayer prices" starts by itself; the first run takes a few minutes
   (it downloads every set's card list once). When it shows a green check, the website is live at
   `https://YOUR-USERNAME.github.io/card-vault/`.

Keep this GitHub account for Card Vault only, or at least don't publish other websites from it: all
GitHub Pages websites of one account share the address `YOUR-USERNAME.github.io`, and a page on another
one could read Card Vault's Google sign-in.

## 2. Google Cloud: signing in to Google Drive

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account
   whose Drive you want to use.
2. Project picker (top left) > **New project**. Name: `Card Vault`. **Create**, then select it.
3. **APIs & Services** > **Library**, search for **Google Drive API**, open it and click **Enable**.
4. **Google Auth Platform** (search for it at the top if you don't see it) > **Get started**:
   - App name: `Card Vault`, user support email: yours. **Next**.
   - Audience: **External**. **Next**.
   - Contact information: your email. **Next**, agree, **Create**.
5. **Audience** > **Test users** > **Add users**: your Gmail address. **Save**. (Leave the app in
   "Testing": only the test users you add can sign in.)
6. **Data Access** > **Add or remove scopes**: tick
   `.../auth/drive.file` ("See, edit, create, and delete only the specific Google Drive files you use with
   this app"). **Update**, then **Save**.
7. **Clients** > **Create client**:
   - Application type: **Web application**. Name: `Card Vault website`.
   - Authorized JavaScript origins: `https://YOUR-USERNAME.github.io`
   - Authorized redirect URIs: `https://YOUR-USERNAME.github.io/card-vault/oauth.html`
   - **Create**. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). The client secret isn't
     used; don't share it.
8. On GitHub, open `config.js` in the repository, click the pencil (**Edit**), paste the Client ID between the
   quotes after `googleClientId:`, and click **Commit changes**. The website updates within a couple of
   minutes.

When you sign in, Google shows **"Google hasn't verified this app"**. That's expected for your own
personal app: click **Continue**.

## 3. Move your collection to the website (on the PC)

1. In the Card Vault you use now, open **Settings** > **Download a backup file** (or use your existing
   `Card Vault backup.json`).
2. In Chrome or Edge, open `https://YOUR-USERNAME.github.io/card-vault/`, then **Settings** >
   **Restore from a backup…** and pick that file.
3. **Settings** > **Sync with Google Drive**, sign in, and allow access. Card Vault saves your collection to
   your Google Drive.
4. Optional: install it as an app. In Chrome: the install icon at the right of the address bar (or menu >
   **Cast, save and share** > **Install page as app**).
5. From now on, use the website on the PC too, so there's one collection.

## 4. iPhone

1. Open `https://YOUR-USERNAME.github.io/card-vault/` in **Safari**.
2. Tap **Share** > **Add to Home Screen** > **Add**.
3. Open Card Vault from the home screen, then **Settings** > **Sync with Google Drive**, sign in, and choose
   **OK** when it offers to load your collection.
4. If you see "Still waiting for Google sign-in", tap **Sign in here**.

## Good to know

- **Google's sign-in lasts an hour, and Card Vault renews it by itself.** When the hour has run out, Card
  Vault goes to Google and straight back (it looks like a quick reload) the next time you open it or switch back
  to it, or when it has sat untouched for a few minutes. It never does this while you're in the middle of
  something (a card's details open, a search showing, a deck list not yet saved). This works as long as you're
  still signed in to Google in that browser or home-screen app. If Google wants you to sign in yourself (say you
  signed out of Google), Card Vault shows "Sign in to Google Drive again": tap **Resume** (usually no typing).
  Until then, changes are kept on the device and sync afterwards. To turn the automatic part off:
  **Settings** > **Backup** > untick "Renew the Google Drive sign-in by itself".
- **No internet** (at a card shop, say): Card Vault opens and works; changes sync when you're back online.
- **Syncing**: each device checks Google Drive every 15 seconds while Card Vault is open, and before every
  save. If the same card is changed on two devices, the later change wins.
- **Camera scanning** works on the iPhone (Add card > Scan with camera; allow the camera).
- **Sealed products**: Add card > **Add a sealed product** (booster boxes and packs, tins, structure decks). They're priced
  with TCGplayer's market price like cards, and listed under **Sealed products** in the Show menu.
- **Japanese and Korean cards** work like English ones. The website keeps a daily list of every card in every Japanese
  and Korean set (`ocg-cards.js`, a few MB, loaded the first time it's needed): each rarity with its price, photo, how
  many are in stock, its Japanese name, and the price a day, a week and a month before. Type the card number (like
  `DUNE-JP004` or `DUNE-KR004`) in Add card and its rarities show right away with prices and photos; **Search by name**
  finds them too. **Ask the shop now** asks Yugipedia and the shop instead (and that's what happens for a card the list
  doesn't have yet, like a set out this week). Owned cards are priced from the list, show their changes and a price
  chart (from `ocg-history/`, a file per set with each day's prices), count in the Insights change, the Sets tab (how
  much of the set you have, what the rest costs, with Want and I have it) and Price movers (Every Japanese card, Every
  Korean card). Japanese prices and photos come from BIGWEB (a large Japanese card shop): a shop's selling price for a
  copy in stock. Korean prices are from Bunjang (a Korean marketplace): what a card sold for (the middle of its sales in
  the last four months) once it has sold twice, else the middle of the asking prices, only for cards with listings or
  sales, so treat them as a rough guide; a Korean card shows the Japanese print's photo. Both are converted to US$. The shop's
  price is used whenever there is one, like TCGplayer's for English cards; an estimate or ¥/₩ price you typed on a card
  only counts while the shop has none (cards you priced by hand before switch over by themselves). A card's changes
  compare its set's latest earlier check at least that long ago (new sets are checked daily, older ones weekly), so a
  week's change can be a little older than a week.
- **Rush Duel cards** (numbers like `RD/KP25-JP001` and `RD/KP25-KR001`) work like the other Japanese and Korean cards:
  Add card, Card search, the scanner, the want list, the Sets tab, Price movers (boxes of their own), the Market and the
  insurance record. They wear a **Rush Duel** badge and have a **Rush Duel cards** choice in the Show menu. BIGWEB
  doesn't sell Rush Duel singles, so Japanese ones are priced from **Fullahead** (a Japanese card shop), whose whole
  Rush Duel list (about 6,500 singles) the nightly update reads; it can't be asked from the browser, so these cards have
  no "Ask the shop now". Korean ones come from Bunjang like the others (searched without the `RD/`, which sellers often
  leave out). Yugipedia's "(Rush Duel)" in some card names is left out. Rush Duel cards don't count toward OCG/TCG decks
  (Deck check, Decks I can build) or toward the 3 copies of an OCG card with the same name.
- **Overframe** printings (Yugipedia: "extended art"; the artwork breaks out of the frame: Limit Over Collection,
  Original Artwork Collection, Utility Selection and others) have their own prices, so Japanese and Korean ones carry it
  in the rarity: **Ultra Rare (Overframe)**, **Prismatic Secret Rare (Overframe)**; Grand Master Rares always are one.
  The nightly update reads which lines of a set's Yugipedia list are extended art (only for sets with a card number on
  two lines), takes BIGWEB's 【オーバーフレーム】 copies for them, and Korean listings that say 오버프레임 or 오버울레. A card you
  added before as just "Prismatic Secret Rare" is matched with the Overframe one when the card has no other. English
  Extended Art printings are TCGplayer's own products ("... (Extended Art)") and show with the card in Card search. They
  all wear an **Overframe** badge, with an **Overframe cards** choice in the Show menu.
- **PSA 10 value**: the switch under your collection's value shows what one gem-mint copy of each card would be worth,
  and cards you've had graded at their grade. Without more, it's a rough estimate from the raw price (Settings > Graded
  values). For real graded prices from eBay sales, add a PriceCharting key in Settings (it needs PriceCharting's
  Legendary plan, $49 a month as of October 2026). The key is saved with your Card Vault data in your Google Drive.
- **Dated backups**: every day, the first save also keeps a dated copy in **Card Vault > Backups** in your Google Drive
  (the last 30 days). Settings lists them; Restore puts one back on every device.
- **Card search** tab: what any card is worth. Type a name (or part of one), a card number or a set; more words narrow it
  (`dark magician lob`). Each card lists every printing with TCGplayer's market price, lowest listing and 30-day change,
  most valuable first, plus every Japanese and Korean printing with that name (price, 30-day change, Want, I have it,
  Details). **Details** opens a card's price page: every printing, its price over time, a PSA 10 value, other markets,
  and buttons to add it or want it; a Japanese or Korean card's page shows every rarity, its changes and its chart. A
  Japanese or Korean number (like DUNE-JP004) shows that card's rarities from the daily list, with **Ask the shop now**
  for the Yugipedia/BIGWEB/Bunjang lookup. A name only a Japanese or Korean card has is found too. It only uses data
  Card Vault already has, so it works offline once the prices are loaded (except that lookup).
  Switch to **Sets** to find a set by name or code (`MAMO`, or a card number) and see every card in it: card number,
  rarity, each printing's price, which you have, how many of its cards you have and what the rest would cost, its
  booster box price, with a filter by rarity and "Ones I don't have". Japanese and Korean sets work the same from the
  daily list (every card and rarity, prices, which you have, the rest's cost, the booster box). Sets matching a card search show on top of it, and a
  set's name on a card's price page, the Sets tab and the Market open the set here.
  **Scan a card** (next to the search box) points the camera at a card and shows what it's worth right in the scanner,
  without adding it: every printing with that number, market price and lowest listing, and a running "Checked so far"
  list with the total (handy at a card shop). You can also type the number there.
- **Set goals**: open a set in Card search (or in the Sets tab) and tap **Make this set a goal**. Goals show at the top of
  the Collection tab, folded to the set's name and progress bar; tap one to see its numbers (each card number once),
  about what the rest would cost, and its buttons. Nothing is added to
  your want list by itself: **Add the missing cards to my want list** (on the goal or the set) adds one of each, the
  cheapest printing, any edition, and Undo takes them off again. Up to 12 goals; they sync with your other devices.
- **Market** tab: every set on TCGplayer with its 25 most valuable cards, and every sealed product (booster packs and
  boxes, Structure Decks, Special and Deluxe Editions, tins…) with the cheapest TCGplayer listing next to the market price.
  Filter by set type (core sets, side sets, Deck Build Packs, Battles of Legend, all-foil sets, Speed Duel, OTS
  Tournament Packs…) and sort by biggest discount. Each product has one-tap searches at eBay, Amazon, Walmart and Target,
  sorted cheapest first. **Want** puts a card or sealed product on your want list.
- **Want list** sections: cards, booster boxes, booster packs, and other sealed products (decks, tins, collections), each
  with its count and total, and a switch at the top to show just one. **Sort** orders each section: at target first,
  closest to target, price (highest or lowest), biggest price drop this week, name, set and card number, or recently
  added (remembered on each device). Add from the Market (English sealed products,
  Yugi-Market's Japanese boxes and packs, a Korean set's booster box), or with **Add sealed** on the want list. A
  Yugi-Market item follows that shop's price; a Korean box follows the middle of the Bunjang boxes; if the shop stops
  listing it, the price when you added it shows, marked "when added". **I got it** adds it to your collection as a sealed
  product (valued at that price unless you enter your own) and takes it off the list.
- **Japanese and Korean sets** (Market tab > **Japanese** or **Korean**): every OCG and Rush Duel set with its most
  valuable cards, by English name, rarity and price in US$ (with the yen or won price), and its sealed products; the
  **OCG and Rush Duel** menu shows one game or both. **Want** and **I have it** work as for English cards. Where the
  numbers come from:
  - Japanese cards: BIGWEB (a large card shop in Japan), the cheapest copy for play it has in stock. Rush Duel cards:
    Fullahead (another Japanese card shop), read once a day.
  - Japanese sealed products: Yugi-Market (based in Japan, ships worldwide), read by the website when you open the
    Japanese market (twice a day at most), because that shop turns away GitHub's computers.
  - Korean cards: Bunjang (a Korean marketplace): what each card sold for once it sold twice in the last four months
    (Bunjang's search with `status=SOLD_OUT` brings sold listings along), else the middle of the asking prices. Unopened
    boxes: asking prices. Listings of several copies, graded cards and wanted posts are left out; treat them as a rough
    guide.
  - Korean sealed products at God of Cards: its prices can't be read from another website, so each Korean set has a
    link to it.
  - Sets and English card names: Yugipedia.

  The daily workflow puts this together (`ocg_market.py`, up to 25 minutes a run, reading the four sites side by side
  at a gentle pace; everything is kept between runs like the prices, with each day's prices per set; Fullahead's whole
  Rush Duel list, about 130 pages, once a day). New sets are
  checked every day, recent ones every few days, older ones weekly. The first runs fill it in, newest sets first; the
  day, week and month changes appear as those days go by. It writes `ocg-market.js` (the sets and their most valuable
  cards), `ocg-cards.js` (every card) and `ocg-history/` (each set's prices by day). The run's last line shows in the
  workflow's summary ("Japanese sets: 590 (…cards)…").
- **Deck check** can move the cards you own for a deck into a location named after it ("Deck: Blue-Eyes").
- **Decks I can build** (in the Deck check tab): looks up every card you own on YGOPRODeck and shows the archetypes your
  collection is closest to: which of each archetype's key cards you have, your cards that support it, the key cards
  you're missing and their TCGplayer price. "Build a starter list" turns one into a 40-card list you can check and save.
- **Missing photos**: when TCGplayer has no photo of a printing (new sets, promos, some older box variants), Card Vault
  shows the closest one it has, tagged "Similar photo": the same card from another set, the 1st Edition box for an
  Unlimited one, a Field Center Token's card. Cards TCGplayer has no photo of at all get a picture from YGOPRODeck,
  which the daily update downloads once and publishes with the website. Anything left is drawn as a card or a box.
- **Trades & sales** tab: the trade checker adds up both sides of a trade at TCGplayer prices (cards from your collection
  against any TCGplayer printing, plus cash) and, when you complete it, moves the cards in and out. The sales log is next to it.
- **Insights** tab: price history, where your value is (by set, rarity, location), cards worth grading, and Tidy up
  (duplicates to merge, cards with no printing, price, location or TCGplayer link). **Price movers** lists the biggest
  TCGplayer price changes since the last update, 7 or 30 days ago, by dollars or percent: your cards, your want list
  (what got cheaper), every card on TCGplayer, and sealed products, with a price floor (default $1 and up) to leave out
  cheap cards whose prices jump around.
- **Get it graded** (in a card's details): links to start a submission at PSA, Beckett, CGC, SGC and TAG, the card's
  details to paste into their form, and tracking while it's away ("I sent it", with the service level, then "It's back"
  with the grade). A card at the grader shows when it should be back (the date sent plus the level's wait in business
  days, the long end of "90–100"); once it's past that, its tile says "late", a notice appears at the top, and the PC's
  daily update sends a phone alert (once per card).
- **Grading fees** (Settings): each company's price list (PSA, Beckett, CGC, SGC, TAG) is built in (`GRADING_FEE_TABLE`
  in `index.html`: level, fee, declared-value cap, business days, paused, minimum cards), and the nightly update reads
  their own pages again (`grading_fees.py` → `grading-fees.json`/`.js` on the website: PSA's and CGC's pages, Beckett's
  temporary submission form, SGC's price table inside its site's program, TAG's pricing widget; PSA turns GitHub's
  computers away, so its page is read from the Internet Archive's copy when there's one from the last 30 days, and the
  check asks the Archive to save one each week; until then PSA uses the built-in list). Card Vault uses the
  newest: changed fees, levels pausing or reopening, new levels. A fee change shows as a notice and a phone alert. If a
  page can't be read, that company keeps its last good list (Settings says so). Pick the service level you use and its
  fee fills in; until then each company's usual level is assumed (the cheapest open one if that's paused). A fee you
  type wins. Add shipping per card. Worth grading lets you pick the company to estimate with, each card's details show
  every company's cost and gain at a 10, and "I sent it" fills in that company's cost. They sync to your other devices.
- **Grading plan** (Insights > Worth grading: tick cards, then **Plan a grading order**; or **Add to a grading plan** in a
  card): what sending those cards costs at each company, the level each card needs for its declared value (its PSA 10
  value unless you change it; levels take cards up to a value), minimums (CGC's Bulk Economy needs 25 cards), when
  they'd be back, and the gain if they all get a 10; plus the cheapest mix of companies when that saves money.
- **Insurance record** (Export > Print inventory or insurance report > An insurance record): every item numbered, with
  photo, condition (graded cards with their certification number), where its value comes from, quantity and value; the
  cards worth more than an amount you choose (default $250) listed on their own with a larger photo; totals for
  ungraded, graded and sealed; your name and policy number; and a line to sign. Print it or save it as a PDF.
- **Price over time** (in a card's details): a chart of its TCGplayer market price. The daily update keeps every
  evening's prices (120 days, then monthly) and publishes them with the website, so the charts fill in day by day.
- **Phone alerts** (Settings): the want-list and big-move alerts on your iPhone through the free ntfy app. Your PC's
  daily update sends them, so that PC needs the latest Card Vault folder. It also sends, once each: a part of the
  website's nightly update that stopped working, grading fee changes, and cards late back from the grader.
- **Phone alerts without the PC** (Settings > Phone alerts > Without your PC, on the website): the nightly update on
  GitHub sends the price, want-list, late-at-the-grader and ban list alerts itself, so the PC needn't be on. Set it up
  once:
  1. In Card Vault's Settings (website, syncing with Google Drive), tap **Send alerts without the PC**. Card Vault puts
     a locked file, `Card Vault phone alerts (locked).json`, in the Card Vault folder of your Google Drive, shared as
     "anyone with the link" so GitHub can read it without your Google sign-in. It holds only what the alerts need
     (your cards and want list, your alert settings and ntfy topic; no notes, places or prices paid), locked with a key
     (AES-GCM) that only you and GitHub have.
  2. Tap **Copy** next to the key, then on GitHub: your `card-vault` repository > **Settings** > **Secrets and variables**
     > **Actions** > **New repository secret**. Name: `CARDVAULT_ALERTS`. Secret: paste the key. **Add secret**.
  3. That's it. Each night the **Phone alerts** step (`cloud_alerts.py`) reads the file, sends what's new, and Settings
     shows whether it worked. The website writes the file again whenever it syncs. Your PC stops sending phone alerts
     (it still shows Windows notifications) while the nightly ones work and know your latest changes; a change made in
     Card Vault.html on the PC reaches them the next time a website syncs, and until then the PC sends them as before.
  The key is a secret: GitHub never shows it in the run's log (which is public), and the log never names your cards.
  **Stop sending alerts without the PC** writes "off" into the file first; you can then delete the secret on GitHub.
- **Selling** (in a card's details, and Trades & sales > Selling): pick a price to start from (market value, TCGplayer's
  lowest listing, a quick sale at 10% under, or break even after fees) to put the card on your sell list, with how many
  to sell. The list shows each asking price next to today's market, what you'd keep after the selling site's fees
  (Settings > Selling fees, 13% + 30 cents to start), and flags a price the market has moved away from. **Copy listing**
  writes a title (80 characters at most, for eBay) and a description; **Copy all listings** and **Export CSV** do the
  whole list. **Sold…** fills in your asking price. Several selected cards go on the list at once with **Sell list** in
  the bar at the bottom; Show: On my sell list filters to them, and their tiles say "Selling".
- **Box openings** (Insights > Box openings > **Log an opening**): what you opened (or pick one of your sealed products,
  which takes one out of your collection and fills in what you paid), packs, date and price. Then type or scan the cards
  you pulled: they go into your collection and onto the opening. Each opening shows what its cards are worth today
  against what you paid, per pack too, and its best pull. **Add several cards** now takes Japanese and Korean card
  numbers as well (from Card Vault's daily list, with every rarity to pick from), for openings and anything else.
- **Ban list & reprints** (Insights): your cards, wanted cards and saved decks' cards that are Forbidden, Limited or
  Semi-Limited (English cards on the TCG list, Japanese and Korean ones on the OCG list; Rush Duel's own list isn't
  covered), and changes noticed lately. The nightly update reads both lists from YGOPRODeck (`banlist.py` →
  `banlist.json`/`.js`) and keeps the changes it notices for 400 days; a change to one of your cards shows as a notice
  at the top and a phone alert. **Reprints** lists cards you own with a newer printing out in the last 90 days or coming
  soon (TCGplayer's sets, and the Japanese and Korean sets in the Market), with your copies' value and 30-day change.
- **Your photos** (in a card's details, website only): a front and a back photo of your own copy, taken or chosen on the
  phone, made smaller and kept in your Google Drive (Card Vault > Photos). They sync with the card, show on every device
  signed in to the same Google account, and **Save** downloads one for a listing. Remove puts the file in Drive's trash.
  Deleting a card leaves its photos in Drive.
- **The nightly update's report** (Settings > Daily price updates): `site_status.py` runs last in the workflow and writes
  `update-status.json`/`.js`: TCGplayer prices' date, how many Japanese and Korean cards are priced, which sites answered,
  the grading fee reads, and anything that went wrong in plain words (a site that stopped answering, far fewer cards
  priced than the night before, prices not updated in over two days). Card Vault shows a notice at the top when
  something broke (Dismiss hides it until it breaks again) and when the update hasn't run for a day and a half.
- **The sync safety check**: if changes from another device would take away 10 or more cards (cards removed, or
  quantities going down, after anything it adds), 5 or more want-list cards, or your whole want list, syncing stops on
  that device and asks: **Keep them** (they stay, and go back to your other devices) or **Remove them here too**. It
  names the device that last saved the backup (Settings > This device's name sets what your other devices see) and
  can list the cards. Nothing syncs either way until you choose; if the file is put right on the other device first,
  syncing carries on by itself.
- **Share…** (select cards, or Show: Extras > Share trade binder, or the Want list tab) makes a link to a page with those
  cards, their photos and TCGplayer prices. The cards are in the link itself; nothing else of yours is shared.
- **Moving cards** between binders, boxes and decks: open a card and tap **Move** (next to where it's kept), or tick
  several cards and tap **Move…** in the bar at the bottom. Choose where they're going and how many of each.
- **Windows notifications** still come from the Card Vault folder on your PC (Turn On Daily Updates). It
  reads your cards from `Card Vault backup.json` in your Google Drive, so install
  [Google Drive for desktop](https://www.google.com/drive/download/) on that PC, signed in to the same
  account. The old OneDrive backup file isn't updated anymore.

## If prices stop updating

1. On GitHub, open the repository's **Actions** tab and click **Daily TCGplayer prices**.
2. If a run failed, open it to see why (TCGCSV being down for a day fixes itself). **Run workflow** runs it
   again by hand.
3. GitHub pauses scheduled workflows in repositories without new commits for 60 days. The workflow writes a
   one-line note twice a month to prevent that, but if GitHub shows "This scheduled workflow is disabled",
   click **Enable workflow**.
4. Price comparisons (since the last update, 7 days, 30 days) are kept between runs in GitHub's cache. If the
   updates stopped for more than a week, they start over and fill in again day by day.

## Turning it off

- **Settings** > **Turn off** (under Backup and sync) stops syncing on that device; the file stays in your
  Google Drive.
- To remove Card Vault's access to your Google account completely:
  [myaccount.google.com/connections](https://myaccount.google.com/connections) > Card Vault > remove access.
