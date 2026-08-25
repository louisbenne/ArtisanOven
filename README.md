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


## . Connect your custom domain (artisanoven.shop)

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




## . Add a logo or photos (optional)

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
