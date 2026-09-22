# Artisan Oven — Website & Ordering System

Ordering system and marketing site for **[artisanoven.shop](http://www.artisanoven.shop/)**, a school pizza business. The frontend is a static, no-build HTML/CSS/JS site hosted on GitHub Pages; the backend is a Google Apps Script web app bound to a Google Sheet, providing a JSON API, capacity and session management, an admin dashboard, and transactional email.


This project was built through rapid, iterative, conversation-driven development rather than a conventional up-front design and engineering process. Features, fixes, and structure emerged incrementally in response to real-world needs as the business operated, rather than being planned out in advance. As a result:

- Code style and structure are pragmatic rather than uniform, and may not follow strict conventions throughout.
- Documentation and tests are minimal; behavior is best verified by reading the relevant script directly.
- Some legacy or exploratory files may remain in the repository from earlier iterations.

Contributors and reviewers should expect a working, actively maintained system optimized for shipping quickly, rather than a heavily architected reference implementation. Changes are welcome, but please review the current behavior in `apps-script.js` and the relevant HTML/JS files before assuming intended design.

## 
Artisan Oven is a static HTML/CSS/JS website (hosted free on GitHub Pages) backed entirely by a Google Sheet acting as a database, with a Google Apps Script project as the server: customers place orders through an embedded, branching Google Form, which writes a row into the sheet and fires an `onFormSubmit` trigger that emails a confirmation and rebuilds a human-readable order report; every other page (homepage availability tracker, payment/lookup page, admin dashboard, kitchen checklist, special-events flow, and a discounted internal-parent flow) talks to that same Apps Script backend over plain `fetch()` GET requests carrying an `?action=...` parameter, which a single dispatcher function routes to one of ~40 handlers that read/write the Sheet directly (tracking pizza capacity, payment status, discounts, and event/parent orders in separate tabs), all gated by one shared admin password that doubles as the session token, with no real database, framework, or build step anywhere in the system.


 ## Architecture

```
┌──────────────┐  iframe   ┌──────────────┐  on submit  ┌───────────────────┐
│  order.html  │──────────▶│ Google Form  │────────────▶│ Form Responses 1  │
└──────┬───────┘           └──────────────┘              │  (Google Sheet)   │
       │  JSONP/fetch                                    └─────────┬─────────┘
       │  ?action=getStatus                                        │ onFormSubmit trigger
       ▼                                                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     Apps Script Web App (apps-script.js)                  │
│  doGet/doPost → JSON API · settings · capacity math · confirmation emails │
│  Sheets: Form Responses 1 · Admin_Settings · Admin Log · Order Updates    │
│  State: Script Properties (settings, admin credentials) · CacheService    │
└───────────────────────────────────────┬───────────────────────────────────┘
                                         │ ?action=admin* (token auth)
                                         ▼
                                  ┌──────────────┐
                                  │  admin.html  │
                                  └──────────────┘
```

## Repository Structure

| File / Folder     | Purpose |
|--------------------|---------|
| `index.html`       | Landing page — choose to pay or place an order |
| `order.html`       | Order page with an embedded Google Form |
| `Payment.html`     | Payment details page (PayPal placeholder) |
| `admin.html`       | Token-authenticated admin dashboard |
| `apps-script.js`   | Server-side logic deployed to Google Apps Script |
| `script.js`        | Small frontend helper script |
| `style.css`        | Site-wide styling and theme variables |
| `patch.js`         | Utility/patch script (see file for current use) |
| `server.js`        | Local/development server helper |
| `metadata.json`    | Site metadata |
| `lines.txt`        | Supplementary data file |
| `.env.example`     | Example environment configuration |
| `CNAME`            | Custom domain configuration for GitHub Pages |
| `LICENSE`          | MIT license |

## Deployment

### Custom domain (artisanoven.shop)

1. The `CNAME` file already contains `artisanoven.shop`; GitHub Pages reads it automatically. Confirm it also appears under **Settings → Pages → Custom domain** once DNS is configured.
2. At your domain registrar, add:
   - **A records** for the apex domain pointing to GitHub Pages:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - An optional **CNAME record** for `www.artisanoven.shop` pointing to `YOUR-USERNAME.github.io`.
3. In **Settings → Pages**, enable **Enforce HTTPS** once the certificate has issued.

### Apps Script backend

The backend is a Google Apps Script project bound to a Google Sheet. It is deployed via `clasp`. Settings and admin credentials are stored in Script Properties; live status data is cached via `CacheService`.

## Assets

Place logos or photos in an `assets/` folder and reference them normally:

```html
<img src="assets/logo.png" alt="Artisan Oven" />
```

## Design Notes

- Color and typography values are defined once as CSS custom properties at the top of `style.css` (e.g. `--forest`, `--terracotta`); update these to retheme the site globally.
- The homepage cards use an arched "oven doorway" motif with a warm hover glow, and the hero tagline has a hand-drawn scorch-mark underline, both referencing the wood-fired oven rather than a generic template look.
- Fonts (Fraunces for headings, Work Sans for body text) are loaded from Google Fonts via a `<link>` tag; no build tooling is required.

## License

Distributed under the MIT License. See `LICENSE` for details.

## AI Disclaimer

100% of the code in this project was created using AI.
