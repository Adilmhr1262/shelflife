# ShelfLife — Personal Food Freshness Tracker

ShelfLife helps people track opened food products, watch their freshness windows, and waste less food. It is a single-page progressive web app with no backend, no accounts, and no external requests.

Live site: https://adilmhr1262.github.io/shelflife/

## Features

- Add, edit, mark used, discard, and delete products.
- Freshness math on calendar days: use-by date is the earlier of opened date plus freshness days and the printed expiry date.
- Statuses: Fresh, Use Soon, Use Today, Past Date. The reminder threshold is configurable from 1 to 7 days (default 3).
- Dashboard with Active, Use Soon, and Past Date counts, a Needs Attention list, and a Recently Opened list.
- My Products with search (name and notes), category, location, and status filters, plus Soonest Due, Recently Opened, and Name A–Z sorting.
- History for used and discarded products, with restore and permanent delete.
- Backup and restore as JSON, with full validation before any data is replaced.
- Clear all data, guarded by typing DELETE.
- Light, Dark, and System themes. System follows the operating system and reacts to changes.
- Offline support through a service worker and a web manifest.
- Keyboard-accessible navigation and menus, visible focus, dialog focus handling, and screen reader announcements.

## Local setup

Serve the folder over HTTP (service workers need a secure context or localhost):

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/ in a browser.

## Storage model

- Products live in IndexedDB, database `shelflife-db`, version 1, object store `products`, key path `id`.
- Each product record holds: `id`, `name`, `category`, `location`, `openedDate`, `freshnessDays`, `printedExpiryDate`, `notes`, `status` (`active`, `used`, `discarded`), `completedAt`, `createdAt`, `updatedAt`.
- Settings live in localStorage under `shelflife-settings-v1`: theme and reminder threshold.
- The app starts empty. No sample products are created.

## Privacy

All data stays in the browser. There are no accounts, no analytics, no third-party scripts, and no network requests beyond same-origin app assets.

ShelfLife is an organizational reminder only. It does not determine whether food is safe to eat. Always check food yourself and follow local food-safety guidance.

## Offline behavior

On first load the service worker caches the app shell (versioned cache `shelflife-v1`). After that, the app loads and works offline, including adding, editing, filtering, and completing products. Old caches are removed when a new service worker activates.

## GitHub Pages deployment

Push the files in this folder to the `main` branch of the `shelflife` repository and enable GitHub Pages with the source set to the `main` branch, root folder. The site is served at https://adilmhr1262.github.io/shelflife/.
