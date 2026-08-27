// ============================================================================
// ARTISAN OVEN — Site & Order Lookup Script
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURATION: Replace with your deployed Google Apps Script Web App URL
// Example: "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec"
// ----------------------------------------------------------------------------
const ORDER_API_URL = "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec";

document.addEventListener("DOMContentLoaded", function () {
  // Keep footer year updated
  const yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = "\u00A9 " + new Date().getFullYear();
  }

  // Setup Order Lookup Form
  initOrderLookup();
  // Setup Availability Tracker
  initAvailabilityTracker();
});

function initAvailabilityTracker() {
  const trackerEl = document.getElementById("availability-tracker");
  const orderButtons = document.querySelectorAll('a[href="order.html"]');
  const googleFormContainer = document.getElementById("order-form-container");
  const closedMessage = document.getElementById("closed-message");
  const closedMessageText = document.getElementById("closed-message-text");

  // If there's no API URL, just show the form directly (assuming open)
  if (!ORDER_API_URL || ORDER_API_URL === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
    if (googleFormContainer) googleFormContainer.style.display = "block";
    return;
  }

  async function fetchStatus() {
    try {
      const url = new URL(ORDER_API_URL);
      url.searchParams.set("action", "getStatus");
      const response = await fetch(url.toString(), {
        method: "GET",
        mode: "cors"
      });
      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();
      
      updateTrackerUI(data);
    } catch (err) {
      console.error("Availability lookup error:", err);
      // On error, let them try ordering or hide the tracker
      if (trackerEl) trackerEl.style.display = "none";
      if (googleFormContainer) googleFormContainer.style.display = "block";
    }
  }

  function updateTrackerUI(data) {
    if (trackerEl) {
      trackerEl.style.display = "block";
      
      const statusText = document.getElementById("tracker-status-text");
      const progressFill = document.getElementById("tracker-progress-fill");
      const ordersTaken = document.getElementById("tracker-orders-taken");
      const ordersRemaining = document.getElementById("tracker-orders-remaining");

      if (data.orderingOpen) {
        statusText.textContent = "Taking Orders";
        statusText.style.color = "var(--sage)";
      } else {
        statusText.textContent = "Fully Booked";
        statusText.style.color = "var(--terracotta)";
      }

      if (typeof data.currentOrders === 'number' && typeof data.maxOrders === 'number') {
        const pct = Math.min(100, Math.max(0, (data.currentOrders / data.maxOrders) * 100));
        progressFill.style.width = pct + "%";
        progressFill.style.opacity = "1";
        ordersTaken.textContent = data.currentOrders + " of " + data.maxOrders + " orders taken";
        
        if (data.remainingOrders > 0 && data.orderingOpen) {
          ordersRemaining.textContent = data.remainingOrders + " orders remaining";
        } else {
          ordersRemaining.textContent = "No orders remaining";
        }
      }
    }

    if (data.orderingOpen === false) {
      // Disable buttons
      orderButtons.forEach(btn => {
        btn.classList.add("btn-disabled");
        const btnText = btn.querySelector('.choice-btn');
        if (btnText) {
          btnText.textContent = "FULLY BOOKED";
        }
        btn.href = "javascript:void(0)";
      });

      // Show fully booked message on order page
      if (googleFormContainer) googleFormContainer.style.display = "none";
      if (closedMessage) {
        closedMessage.style.display = "block";
        if (data.message && closedMessageText) {
           closedMessageText.textContent = data.message;
        }
      }
    } else {
      // Ordering is open
      orderButtons.forEach(btn => {
        btn.classList.remove("btn-disabled");
        // Keep original text from HTML ideally, but we don't store it. We assume it's PLACE AN ORDER
        // Actually, let's just leave the href and not override text unless it was changed
      });
      if (googleFormContainer) googleFormContainer.style.display = "block";
      if (closedMessage) closedMessage.style.display = "none";
    }
  }

  // Initial fetch
  fetchStatus();
  // Poll every 45 seconds
  setInterval(fetchStatus, 45000);
}

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

    if (orderIdEl) {
      let displayId = orderData.orderId || "Order Details";
      if (typeof displayId === "string") {
        displayId = displayId.replace(/^A[O0]-/i, "");
      }
      // If the ID is e.g. 1001, subtract 1000 to start at 1
      let idNum = parseInt(displayId, 10);
      if (!isNaN(idNum) && idNum > 1000 && idNum < 100000) {
        displayId = (idNum - 1000).toString();
      }
      orderIdEl.textContent = "Order #" + displayId;
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

    // Move methods container into result card
    const methodsContainer = document.getElementById("payment-methods-container");
    const defaultTear = document.getElementById("default-tear");
    const resultCard = document.querySelector(".order-result-card");
    
    if (methodsContainer && resultCard) {
      if (defaultTear) defaultTear.style.display = "none";
      
      const methodsPaypalMe = document.getElementById("methods-paypal-me");
      const methodsPaypalNcp = document.getElementById("methods-paypal-ncp");
      
      if (methodsPaypalMe) {
        methodsPaypalMe.href = orderData.paypalMeUrl || "https://paypal.me/ArtisanOven";
        methodsPaypalMe.textContent = "paypal.me/ArtisanOven (" + formattedTotal + ")";
      }
      if (methodsPaypalNcp && orderData.paypalNcpUrl) {
        methodsPaypalNcp.href = orderData.paypalNcpUrl;
      }
      
      methodsContainer.classList.remove("is-merged");
      methodsContainer.style.marginTop = "20px";
      resultCard.appendChild(methodsContainer);
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

