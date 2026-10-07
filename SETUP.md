# Card Vault website: setup

Card Vault as a website you can add to your iPhone's home screen, with your collection synced through
Google Drive and TCGplayer prices updated every evening by GitHub.

In this guide, `YOUR-USERNAME` is your GitHub username. The website's address will be
`https://YOUR-USERNAME.github.io/card-vault/`.

## What lives where

- **This repository** (public): the website's code and this guide. Your collection is never in it.
- **Your devices**: your collection, saved in each browser (and in the home-screen app on your iPhone).
- **Your Google Drive**: `Card Vault/Card Vault backup.json`, which every device syncs with. Card Vault can
  only see files it created itself in your Drive.
- **GitHub Actions**: every evening it downloads the day's TCGplayer prices (through TCGCSV) and publishes
  the website with them. It checks again overnight in case TCGCSV was late. An open Card Vault picks up new
  prices by itself (within half an hour, or as soon as you switch back to it): nothing to reload or tap.

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
- **Japanese and Korean cards**: type the card number (like `DUNE-JP004` or `DUNE-KR004`) in Add card. Card Vault looks the
  card up on Yugipedia and shows each rarity it was printed in. Japanese prices and photos come from BIGWEB (a large
  Japanese card shop); Korean prices are Bunjang (a Korean marketplace) asking prices, so treat them as a rough guide.
  Both are converted to US$ and refreshed once a day. A ¥ or ₩ price you type on a card wins over them.
- **PSA 10 value**: the switch under your collection's value shows what one gem-mint copy of each card would be worth,
  and cards you've had graded at their grade. Without more, it's a rough estimate from the raw price (Settings > Graded
  values). For real graded prices from eBay sales, add a PriceCharting key in Settings (it needs PriceCharting's
  Legendary plan, $49 a month as of October 2026). The key is saved with your Card Vault data in your Google Drive.
- **Dated backups**: every day, the first save also keeps a dated copy in **Card Vault > Backups** in your Google Drive
  (the last 30 days). Settings lists them; Restore puts one back on every device.
- **Card search** tab: what any card is worth. Type a name (or part of one), a card number or a set; more words narrow it
  (`dark magician lob`). Each card lists every printing with TCGplayer's market price, lowest listing and 30-day change,
  most valuable first, plus its Japanese and Korean prices when the Market has them. **Details** opens a card's price
  page: every printing, its price over time, a PSA 10 value, other markets, and buttons to add it or want it. A
  Japanese or Korean number (like DUNE-JP004) gets the same Yugipedia/BIGWEB/Bunjang lookup as Add card. It only uses
  data Card Vault already has, so it works offline once the prices are loaded (except that lookup).
- **Market** tab: every set on TCGplayer with its 25 most valuable cards, and every sealed product (booster packs and
  boxes, Structure Decks, Special and Deluxe Editions, tins…) with the cheapest TCGplayer listing next to the market price.
  Filter by set type (core sets, side sets, Deck Build Packs, Battles of Legend, all-foil sets, Speed Duel, OTS
  Tournament Packs…) and sort by biggest discount. Each product has one-tap searches at eBay, Amazon, Walmart and Target,
  sorted cheapest first. **Want** puts a card or sealed product on your want list.
- **Want list** sections: cards, booster boxes, booster packs, and other sealed products (decks, tins, collections), each
  with its count and total, and a switch at the top to show just one. Add from the Market (English sealed products,
  Yugi-Market's Japanese boxes and packs, a Korean set's booster box), or with **Add sealed** on the want list. A
  Yugi-Market item follows that shop's price; a Korean box follows the middle of the Bunjang boxes; if the shop stops
  listing it, the price when you added it shows, marked "when added". **I got it** adds it to your collection as a sealed
  product (valued at that price unless you enter your own) and takes it off the list.
- **Japanese and Korean sets** (Market tab > **Japanese** or **Korean**): every OCG set with its most valuable cards, by
  English name, rarity and price in US$ (with the yen or won price), and its sealed products. **Want** and **I have it**
  work as for English cards. Where the numbers come from:
  - Japanese cards: BIGWEB (a large card shop in Japan), the cheapest copy for play it has in stock.
  - Japanese sealed products: Yugi-Market (based in Japan, ships worldwide), read by the website when you open the
    Japanese market (twice a day at most), because that shop turns away GitHub's computers.
  - Korean cards and unopened boxes: Bunjang asking prices (a Korean marketplace), the middle of the listings. Listings of
    several copies, graded cards and wanted posts are left out; treat them as a rough guide.
  - Korean sealed products at God of Cards: its prices can't be read from another website, so each Korean set has a
    link to it.
  - Sets and English card names: Yugipedia.

  The daily workflow puts this together in a few minutes at most (`ocg_market.py`, kept between runs like the prices).
  New sets are checked every day, older ones every week or two. The first few days fill it in, newest sets first.
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
  (duplicates to merge, cards with no printing, price, location or TCGplayer link).
- **Get it graded** (in a card's details): links to start a submission at PSA, Beckett, CGC, SGC and TAG, the card's
  details to paste into their form, and tracking while it's away ("I sent it", then "It's back" with the grade).
- **Grading fees** (Settings): for each company, the service level you use, its fee per card and shipping per card. Worth
  grading lets you pick the company to estimate with, each card's details show every company's cost and gain at a 10,
  and "I sent it" fills in that company's cost. They sync to your other devices.
- **Price over time** (in a card's details): a chart of its TCGplayer market price. The daily update keeps every
  evening's prices (120 days, then monthly) and publishes them with the website, so the charts fill in day by day.
- **Phone alerts** (Settings): the want-list and big-move alerts on your iPhone through the free ntfy app. Your PC's
  daily update sends them, so that PC needs the latest Card Vault folder.
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
