// =========================================
// ARTISAN OVEN — Site script
// Deliberately minimal: no framework, no
// build step. Two small, self-contained jobs.
// =========================================

document.addEventListener("DOMContentLoaded", function () {
  // Keep the footer copyright year current automatically.
  var yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = "\u00A9 " + new Date().getFullYear();
  }
});

// =========================================
// OPTIONAL: PayPal SDK hook
// If you use the PayPal JavaScript SDK, its
// render call (e.g. paypal.Buttons().render(...))
// can be placed here instead of inline in
// payment.html, to keep the HTML clean.
// Leave this section empty if you're using a
// simple PayPal button/link instead.
// =========================================
