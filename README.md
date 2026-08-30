# Artisan Oven

Website and ordering system for **artisanoven.shop** — a school pizza shop run as a
static site on GitHub Pages, with a Google Apps Script backend for orders, capacity
tracking, and payment confirmation emails.

## How it works

Customers order via an embedded Google Form on the Order page. Responses land in a
Google Sheet. A Google Apps Script web app (`apps-script.js`) sits on top of that
sheet and provides the public API and admin dashboard:

- **Ordering** — the order page queries the web app (`doGet`) for live availability
  (open/closed, pizzas remaining) and capacity limits per session.
- **Capacity & sessions** — max pizzas per service, auto-close (e.g. Sundays 21:00),
  and a "fully booked" state are managed in settings stored in Script Properties and
  mirrored to an `Admin_Settings` sheet.
- **Admin dashboard** (`admin.html` + `admin_orders.js`) — password-protected view of
  orders, with delete/restore, payment status marking, and email re-sends.
- **Emails** — order confirmations with payment instructions (bank transfer, PayPal,
  or cash) are sent automatically; payment status updates can be re-sent manually.

## Repo layout

| File | Purpose |
| --- | --- |
| `index.html` | Landing page — choose Pay or Order |
| `Payment.html` | Payment page — bank transfer, PayPal, and cash details |
| `order.html` | Order page — Google Form + live availability from the API |
| `admin.html` | Admin dashboard |
| `admin_orders.js` | Browser JS for the admin dashboard |
| `style.css` | All styling |
| `script.js` | Small helpers (footer year, etc.) |
| `CNAME` | Custom domain for GitHub Pages |
| `apps-script.js` | The Google Apps Script backend (API, settings, admin, email) |
| `apps-script/` | clasp project files (`.clasp.json`, `appsscript.json`) for deployment |
| `server.js` | Optional local dev server (Express, serves the static site) |
| `GEMINI.md` | Notes/rules for AI coding assistants working in this repo |

## Deployment (CI/CD)

Two GitHub Actions workflows run on push to `main`:

- **`deploy-pages.yml`** — publishes the static site to GitHub Pages on every push
  to `main` (also runnable manually via `workflow_dispatch`).
- **`deploy-apps-script.yml`** — when files under `apps-script/` change, authenticates
  clasp with the `CLASPRC_JSON` secret and pushes to the Apps Script project,
  creating a version and updating the deployment.

Required repository secrets:

- `CLASPRC_JSON` — contents of `~/.clasprc.json` (Google OAuth tokens) so Actions
  can deploy the Apps Script backend.

## Local development

```bash
npm install
npm run dev   # serves the site at http://localhost:3000
```

There is no build step — it's plain HTML/CSS/JS.

## License

MIT
