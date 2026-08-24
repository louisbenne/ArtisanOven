# Artisan Oven — Website

Simple 3-page static site (HTML/CSS/JS, no build step) for **artisanoven.shop**.

```
index.html     Landing page — choose Pay or Order
payment.html   Payment page — details + PayPal placeholder
order.html     Order page — embedded Google Form
style.css      All styling
script.js      Small helper script (footer year)
assets/        Put images (logo, photos) here
CNAME          Tells GitHub Pages your custom domain
```

## 1. Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `artisan-oven-site`) and push these
   files to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Artisan Oven website"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Branch: `main`, folder: `/ (root)`. Save.
5. GitHub will publish the site at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## 2. Connect your custom domain (artisanoven.shop)

1. The `CNAME` file in this repo already contains `artisanoven.shop` — GitHub
   Pages reads this automatically, so you don't need to retype it in the
   Pages settings (though the **Settings → Pages → Custom domain** field
   should show it once DNS is set up).
2. At your domain registrar (wherever `artisanoven.shop` is registered), add
   these DNS records:
   - **A records** for the apex domain (`artisanoven.shop`) pointing to
     GitHub's IPs:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - Optional **CNAME record** for `www.artisanoven.shop` pointing to
     `YOUR-USERNAME.github.io`.
3. Back in **Settings → Pages**, tick **Enforce HTTPS** once the certificate
   has been issued (can take a few minutes to a few hours).

## 3. Configure PayPal (payment.html)

Open `payment.html` and find the block marked:

```html
<!-- PAYPAL PAYMENT INTEGRATION START -->
...
<!-- PAYPAL PAYMENT INTEGRATION END -->
```

Replace the placeholder `<div class="paypal-placeholder">` with whichever
PayPal integration you're using:

- **PayPal button code** (from paypal.com/buttons) — paste it directly in.
- **PayPal JavaScript SDK** — add the SDK `<script>` tag near the top of
  `payment.html` (or in `<head>`), then place the `paypal.Buttons().render(...)`
  call either inline or inside `script.js` (there's a marked spot for it).
- **A PayPal payment link** — turn the placeholder into a normal link/button,
  e.g. `<a class="choice-btn" href="YOUR_PAYPAL_LINK">Pay with PayPal</a>`.

Also update the placeholder text higher up on the same page:
- `£XX.XX` → the actual amount due
- `[Payment description goes here]` → what the payment is for
- `[Reference goes here, if applicable]` → order number or customer name
- the notes paragraph, if you want to add anything (collection time, etc.)

## 4. Configure the Google Form (order.html)

1. Open your Google Form → **Send** → the `< >` embed tab → copy the URL
   inside the `src="..."` attribute of the generated `<iframe>`.
2. In `order.html`, find:
   ```html
   <!-- GOOGLE FORM EMBED START -->
   <iframe src="PASTE_GOOGLE_FORM_EMBED_URL_HERE" ...>
   <!-- GOOGLE FORM EMBED END -->
   ```
3. Replace `PASTE_GOOGLE_FORM_EMBED_URL_HERE` with that URL.
4. If the form is noticeably longer or shorter than usual, adjust the
   `height="1200"` attribute to reduce empty space or scrolling.

Google continues to host and process all form submissions — nothing about
form handling changes by embedding it.

## 5. Footer details

In all three pages, replace:
- `[INSERT EMAIL]` with your contact email
- `[INSERT HOURS]` with your opening hours

(Optional) social links are intentionally left out. If you want them, there's
a commented-out example block in `index.html`'s footer you can uncomment and
edit.

## 6. Add a logo or photos (optional)

Drop image files into `assets/`, then reference them normally, e.g.:
```html
<img src="assets/logo.png" alt="Artisan Oven" />
```

## Design notes

- Colours and fonts are defined once as CSS custom properties at the top of
  `style.css` — change `--forest`, `--terracotta`, etc. there to retheme the
  whole site.
- The two homepage cards use an arched "oven doorway" shape with a warm glow
  on hover, and the hero tagline has a hand-drawn scorch-mark underline —
  both nod to the wood-fired oven rather than using a generic template look.
- Fonts are loaded from Google Fonts (Fraunces for headings, Work Sans for
  body text) via a `<link>` tag — no build tooling required.
