# Artisan Oven

Ordering system and website for [artisanoven.shop](https://www.artisanoven.shop).

Static frontend on GitHub Pages + Google Apps Script backend (bound to a Google Sheet)
providing a JSON API, session/capacity management, an admin dashboard, and transactional
email. No build step — plain HTML/CSS/JS on the frontend, server-side logic entirely in
Apps Script.

## Architecture

```
┌──────────────┐   iframe    ┌──────────────┐   on submit   ┌──────────────────┐
│  order.html  │────────────▶│  Google Form │──────────────▶│ Form Responses 1 │
└──────┬───────┘             └──────────────┘               │ (Google Sheet)   │
       │ JSONP/fetch                                        └────────┬─────────┘
       │?action=getStatus                                             │ onFormSubmitTrigger
       ▼                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Apps Script Web App (apps-script.js)                       │
│  doGet/doPost → JSON API · settings · capacity math · confirmation emails   │
│  Sheets: Form Responses 1 · Admin_Settings · Admin Log · Pizza Order Update │
│  State: Script Properties (settings, admin creds) · CacheService (status)   │
└─────────────────────────────────────────────────────────────────────────────┘
       ▲                                    ▲
       │ ?action=admin* (token auth)        │ deploy via clasp (CI)
┌──────┴───────┐                    ┌──────┴────────┐
│  admin.html  │                    │ GitHub Actions│
│ admin_orders │                    │  (this repo)  │
└──────────────┘                    └───────────────┘
```

**Data flow:** customers submit the embedded Google Form → the response row lands in the
`Form Responses 1` sheet → `onFormSubmitTrigger` invalidates the status cache, generates an
order ID, computes the total from the per-pizza branch columns, and emails a confirmation
with payment instructions → the frontend's live availability and the admin dashboard read
everything back through the web app API.

## Frontend

| File | Purpose |
| --- | --- |
| `index.html` | Landing page — route to Pay or Order |
| `Payment.html` | Payment methods: bank transfer, PayPal (paypal.me + NCP link), cash |
| `order.html` | Embedded Google Form + live capacity/status banner |
| `admin.html` | Admin dashboard (token-authenticated against the API) |
| `admin_orders.js` | Admin dashboard client logic |
| `script.js` | Shared client logic; holds `ORDER_API_URL` (web app endpoint) |
| `style.css` | Styling |
| `CNAME` | Custom domain for GitHub Pages |

`ORDER_API_URL` in `script.js` points at the deployed Apps Script web app
(`.../macros/s/<DEPLOYMENT_ID>/exec`) and is the single point of coupling between the
static site and the backend.

## Backend (`apps-script.js`)

Single-file Apps Script web app, deployed with `access: ANYONE_ANONYMOUS`,
`executeAs: USER_DEPLOYING`.

### API

All endpoints are `GET`/`POST` against the web app URL with an `action` parameter;
responses are JSON.

| Action | Auth | Purpose |
| --- | --- | --- |
| `getOrder` | search token or matching email/order ID | Public order lookup — returns order lines, total, paid status, PayPal links |
| `getStatus` | none | Live system status: ordering open/closed, pizzas remaining, session info (cached 120 s; `_t` busts cache) |
| `adminLogin` | admin password | Returns a session token |
| `adminGetSettings` / `adminUpdateSettings` | token | Read/modify service date, max pizzas, manual open/close, auto-close day/time, messages |
| `adminStartNewSession` | token | Archives the current session and starts a fresh one |
| `adminGetOrders` | token | Combined order view for the dashboard |
| `adminUpdatePaidStatus` | token | Mark an order paid (triggers update email) |
| `adminResendConfirmation` | token | Re-send an order's confirmation email |
| `adminDeleteOrder` | token | Soft-delete / restore an order |
| `adminChangePassword` / `adminLogout` | token | Credential and session management |

### State

- **Sheets** — `Form Responses 1` (raw orders; hidden bookkeeping columns 60–63 for
  confirmation-sent flag, order token, payment status, deleted flag), `Admin_Settings`
  (human-readable mirror of settings), `Admin Log` (audit trail), `Pizza Order Update`
  (working sheet for update emails).
- **Script Properties** — `ARTISAN_SETTINGS` JSON (all session/capacity settings) and the
  hashed admin credential. `getSettings()` merges over defaults on read, so adding a new
  setting key is backward-compatible.
- **CacheService** — `SYSTEM_STATUS_CACHE` (120 s) keeps `getStatus` cheap; invalidated on
  form submit and on any admin mutation.

### Order parsing

The Google Form branches on "how many pizzas" (1–5); each branch writes into a distinct
block of columns. `BRANCHES` maps branch → `[sizeCol, nameCol, classCol]` triples, and the
total is computed from `PRICE_MAP` (£8 whole 12″ / £5 half / £3 quarter). Legacy dropdown
labels are normalized via `SIZE_MAP` / `PAYMENT_MAP`.

## CI/CD

Both workflows live in `.github/workflows/` and run on `main`.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `deploy-pages.yml` | push to `main`, `workflow_dispatch` | Rsyncs the repo (excluding `.git`, `.github`, `apps-script/`) into `_site/` and deploys to GitHub Pages |
| `deploy-apps-script.yml` | push to `main` touching `apps-script/**` | Installs clasp, auths with the `CLASPRC_JSON` secret, runs `clasp push --force`, creates a version, and updates the existing deployment |

**Required secrets:** `CLASPRC_JSON` — the contents of a local `~/.clasprc.json`
(Google OAuth tokens for the account that owns the Apps Script project).

## Local development

```bash
npm install
npm run dev      # Express static server on http://localhost:3000
npm run lint     # node --check on server.js and script.js
```

Note the frontend is a static mirror of production; backend behavior requires the
deployed Apps Script project and its connected Sheet. Apps Script changes are made in
`apps-script.js` / `apps-script/` and flow out through the `deploy-apps-script.yml`
workflow.
