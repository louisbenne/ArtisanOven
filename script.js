// ============================================================================
// ARTISAN OVEN — Site & Order Lookup Script
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURATION: Replace with your deployed Google Apps Script Web App URL
// Example: "https://script.google.com/macros/s/AKfycbx.../exec"
// ----------------------------------------------------------------------------
const ORDER_API_URL = "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

document.addEventListener("DOMContentLoaded", function () {
  // Keep footer year updated
  const yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = "\u00A9 " + new Date().getFullYear();
  }

  // Setup Order Lookup Form
  initOrderLookup();
});

function initOrderLookup() {
  const form = document.getElementById("order-lookup-form");
  const queryInput = document.getElementById("order-query-input");
  const submitBtn = document.getElementById("lookup-btn");
  const feedbackEl = document.getElementById("lookup-feedback");
  const resultSection = document.getElementById("order-result-section");

  if (!form || !queryInput || !submitBtn) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const query = (queryInput.value || "").trim();

    // Reset states
    hideFeedback();
    if (resultSection) resultSection.hidden = true;

    if (!query) {
      showFeedback("Please enter your email address or Order ID.", "error");
      queryInput.focus();
      return;
    }

    // Check if configuration placeholder is still there
    if (!ORDER_API_URL || ORDER_API_URL === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      showFeedback(
        "Order lookup API is not configured yet. Please paste your Google Apps Script Web App URL into script.js.",
        "info"
      );
      return;
    }

    // Set loading state
    setLoading(true);

    try {
      // Build request URL
      const url = new URL(ORDER_API_URL);
      url.searchParams.set("action", "getOrder");
      url.searchParams.set("query", query);

      const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors"
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();

      if (data.success) {
        renderOrderResult(data);
      } else {
        showFeedback(
          data.message || "We couldn't find an order associated with that email address. Please check the email and try again.",
          "error"
        );
      }
    } catch (err) {
      console.error("Order lookup error:", err);
      showFeedback(
        "We couldn't find an order associated with that email address. Please check the email and try again.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    if (isLoading) {
      submitBtn.classList.add("is-loading");
      submitBtn.disabled = true;
      queryInput.disabled = true;
    } else {
      submitBtn.classList.remove("is-loading");
      submitBtn.disabled = false;
      queryInput.disabled = false;
    }
  }

  function showFeedback(message, type) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.className = "lookup-feedback feedback-" + (type || "error");
    feedbackEl.hidden = false;
  }

  function hideFeedback() {
    if (!feedbackEl) return;
    feedbackEl.textContent = "";
    feedbackEl.hidden = true;
  }

  function renderOrderResult(orderData) {
    const resultSection = document.getElementById("order-result-section");
    const orderIdEl = document.getElementById("result-order-id");
    const statusEl = document.getElementById("result-order-status");
    const customerNameEl = document.getElementById("result-customer-name");
    const itemsListEl = document.getElementById("result-items-list");
    const totalPriceEl = document.getElementById("result-total-price");
    const paypalBtn = document.getElementById("result-paypal-btn");
    const paypalAmountSpan = document.getElementById("result-paypal-amount");
    const paypalNcpBtn = document.getElementById("result-paypal-ncp");

    if (!resultSection) return;

    if (orderIdEl) orderIdEl.textContent = orderData.orderId || "Order Details";
    if (statusEl) {
      const isPaid = (orderData.paid || "").toLowerCase() === "yes";
      statusEl.textContent = isPaid ? "Paid" : "Payment Pending";
      statusEl.className = "badge-status " + (isPaid ? "status-paid" : "status-pending");
    }

    if (customerNameEl) {
      customerNameEl.textContent = "Order for " + (orderData.customerName || "Customer");
    }

    if (itemsListEl && Array.isArray(orderData.order)) {
      itemsListEl.innerHTML = "";
      orderData.order.forEach(function (item) {
        const li = document.createElement("li");
        li.className = "order-item-row";

        const childInfo = item.childName ? item.childName + (item.class ? " (" + item.class + ")" : "") : "";
        li.innerHTML = `
          <div class="item-main">
            <span class="item-quantity">1 &times;</span>
            <span class="item-name">${escapeHtml(item.item || "Pizza")}</span>
            ${childInfo ? `<span class="item-child">${escapeHtml(childInfo)}</span>` : ""}
          </div>
          <span class="item-price">${item.priceFormatted || "£" + (item.price || 0).toFixed(2)}</span>
        `;
        itemsListEl.appendChild(li);
      });
    }

    const formattedTotal = orderData.totalFormatted || "£" + (orderData.total || 0).toFixed(2);
    if (totalPriceEl) totalPriceEl.textContent = formattedTotal;
    if (paypalAmountSpan) paypalAmountSpan.textContent = formattedTotal;

    if (paypalBtn) {
      paypalBtn.href = orderData.paypalMeUrl || "https://paypal.me/ArtisanOven";
    }

    if (paypalNcpBtn && orderData.paypalNcpUrl) {
      paypalNcpBtn.href = orderData.paypalNcpUrl;
    }

    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

