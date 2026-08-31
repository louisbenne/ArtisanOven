// ============================================================================
// ARTISAN OVEN — Site & Order Lookup Script
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURATION: Replace with your deployed Google Apps Script Web App URL
// Example: "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec"
// ----------------------------------------------------------------------------
var ORDER_API_URL = "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec";

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
  // Setup Quick Copy Buttons
  initCopyButtons();
});

function initAvailabilityTracker() {
  const trackerEl = document.getElementById("availability-tracker");
  const orderButtons = document.querySelectorAll('a[href="order.html"]');
  const googleFormContainer = document.getElementById("order-form-container");
  const closedMessage = document.getElementById("closed-message");
  const closedMessageText = document.getElementById("closed-message-text");

  // Immediate render from cache if available to prevent UI flash
  try {
    const immediateCache = sessionStorage.getItem('STATUS_CACHE_DATA') || localStorage.getItem('STATUS_CACHE_DATA');
    if (immediateCache) {
      const parsed = JSON.parse(immediateCache);
      if (parsed && parsed.success) {
        updateTrackerUI(parsed);
      }
    }
  } catch (e) {
    // Ignore JSON parse errors
  }

  // If there's no API URL, just show the form directly (assuming open)
  if (!ORDER_API_URL || ORDER_API_URL === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
    if (googleFormContainer) googleFormContainer.style.display = "block";
    return;
  }

  let isFetching = false;

  async function fetchStatus(force = false) {
    if (isFetching) return;
    try {
      // Client-side cache: if we fetched successfully in the last 20 seconds, reuse unless forced
      const cachedStatus = sessionStorage.getItem('STATUS_CACHE_DATA');
      const cachedTime = sessionStorage.getItem('STATUS_CACHE_TIME');
      if (!force && cachedStatus && cachedTime && (Date.now() - parseInt(cachedTime, 10) < 20000)) {
        updateTrackerUI(JSON.parse(cachedStatus));
        return;
      }

      const apiUrl = (typeof ORDER_API_URL !== 'undefined') ? ORDER_API_URL : (window.ORDER_API_URL || "");
      if (!apiUrl || apiUrl.indexOf('http') !== 0) {
        throw new Error("API URL not configured");
      }

      isFetching = true;
      const url = new URL(apiUrl);
      url.searchParams.set("action", "getStatus");
      url.searchParams.set("_t", Date.now().toString()); // Cache busting

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 9000) : null;

      const fetchOptions = {
        method: "GET",
        mode: "cors",
        cache: "no-store"
      };
      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      const response = await fetch(url.toString(), fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn("Availability lookup returned non-OK status:", response.status);
        throw new Error("HTTP Status " + response.status);
      }

      const data = await response.json();

      if (data.success) {
        const serialized = JSON.stringify(data);
        sessionStorage.setItem('STATUS_CACHE_DATA', serialized);
        sessionStorage.setItem('STATUS_CACHE_TIME', Date.now().toString());
        try {
          localStorage.setItem('STATUS_CACHE_DATA', serialized);
        } catch (e) {}
        updateTrackerUI(data);
      }
    } catch (err) {
      console.error("Availability lookup error:", err.message || err);
      // If we don't already have rendered data, fallback safely
      const hasRendered = sessionStorage.getItem('STATUS_CACHE_DATA') || localStorage.getItem('STATUS_CACHE_DATA');
      if (!hasRendered) {
        if (trackerEl) trackerEl.style.display = "none";
        if (googleFormContainer) googleFormContainer.style.display = "block";
      }
    } finally {
      isFetching = false;
    }
  }

  function updateTrackerUI(data) {
    // Dynamic text replacements across the page
    if (data.serviceNoticeDate) {
      const noticeDateEl = document.getElementById("service-notice-date-text");
      if (noticeDateEl) noticeDateEl.textContent = data.serviceNoticeDate;
    }
    if (data.serviceTitle) {
      const titleEls = document.querySelectorAll(".tracker-title, #tracker-service-title");
      titleEls.forEach(el => { el.textContent = data.serviceTitle; });
    }
    if (data.capacityMessage) {
      const capEls = document.querySelectorAll(".tracker-disclaimer, #tracker-capacity-disclaimer");
      capEls.forEach(el => { el.textContent = data.capacityMessage; });
    }
    if (data.deadlineMessage) {
      const deadEls = document.querySelectorAll("#tracker-deadline-text");
      deadEls.forEach(el => { el.innerHTML = data.deadlineMessage; });
    }

    if (trackerEl) {
      trackerEl.style.display = "block";

      const statusText = document.getElementById("tracker-status-text");
      const progressFill = document.getElementById("tracker-progress-fill");
      const ordersTaken = document.getElementById("tracker-orders-taken");
      const ordersRemaining = document.getElementById("tracker-orders-remaining");

      if (data.orderingOpen) {
        if (statusText) {
          statusText.textContent = "Taking Orders";
          statusText.style.color = "var(--sage)";
        }
      } else {
        if (statusText) {
          statusText.textContent = "Fully Booked";
          statusText.style.color = "var(--terracotta)";
        }
      }

      const current = typeof data.currentPizzas === 'number' ? data.currentPizzas : data.currentOrders;
      const max = typeof data.maxPizzas === 'number' ? data.maxPizzas : data.maxOrders;
      const remaining = typeof data.remainingPizzas === 'number' ? data.remainingPizzas : data.remainingOrders;

      if (typeof current === 'number' && typeof max === 'number' && max > 0) {
        const pct = Math.min(100, Math.max(0, (current / max) * 100));
        if (progressFill) {
          progressFill.style.width = pct + "%";
          progressFill.style.opacity = "1";
        }

        const isMaxReached = current >= max || remaining <= 0 || !data.orderingOpen;

        if (ordersTaken) {
          ordersTaken.textContent = formatPizzaAmount(current) + " of " + formatPizzaAmount(max) + " pizzas claimed";
        }
        if (ordersRemaining) {
          if (isMaxReached) {
            ordersRemaining.textContent = "Fully booked";
          } else {
            ordersRemaining.textContent = formatPizzaAmount(Math.max(0, remaining)) + " pizzas remaining";
          }
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
        const msg = data.closedMessage || data.message;
        if (msg && closedMessageText) {
          closedMessageText.textContent = msg;
        }
      }
    } else {
      // Ordering is open
      orderButtons.forEach(btn => {
        btn.classList.remove("btn-disabled");
        const btnText = btn.querySelector('.choice-btn');
        if (btnText && btnText.textContent === "FULLY BOOKED") {
          btnText.textContent = "PLACE AN ORDER";
        }
        if (btn.getAttribute('href') === "javascript:void(0)") {
          btn.href = "order.html";
        }
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

  let activeLookupController = null;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const query = (queryInput.value || "").trim();
    performLookup(query, null);
  });

  async function performLookup(query, token) {
    // Reset states
    hideFeedback();
    if (resultSection) resultSection.hidden = true;

    if (!query) {
      showFeedback("Please enter your email address or Order ID.", "error");
      queryInput.focus();
      return;
    }

    const apiUrl = (typeof ORDER_API_URL !== 'undefined') ? ORDER_API_URL : (window.ORDER_API_URL || "");
    if (!apiUrl || apiUrl === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      showFeedback(
        "Order lookup API is not configured yet. Please paste your Google Apps Script Web App URL into script.js.",
        "info"
      );
      return;
    }

    // Cancel previous inflight lookup
    if (activeLookupController) {
      activeLookupController.abort();
    }
    activeLookupController = typeof AbortController !== 'undefined' ? new AbortController() : null;

    // Set loading state
    setLoading(true);

    try {
      // Build request URL
      const url = new URL(apiUrl);
      url.searchParams.set("action", "getOrder");
      url.searchParams.set("query", query);

      if (token) {
        url.searchParams.set("token", token);
      }
      url.searchParams.set("t", Date.now().toString());

      const fetchOpts = {
        method: "GET",
        mode: "cors",
        cache: "no-store"
      };
      let timeoutId = null;
      if (activeLookupController) {
        fetchOpts.signal = activeLookupController.signal;
        timeoutId = setTimeout(() => activeLookupController.abort(), 12000);
      }

      const response = await fetch(url.toString(), fetchOpts);
      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn("Order lookup returned non-OK status:", response.status);
        throw new Error("HTTP Status " + response.status);
      }

      const data = await response.json();

      if (data.success) {
        renderOrderResult(data);
      } else {
        showFeedback(
          data.message || "We couldn't find your order. Please check your details and try again.",
          "error"
        );
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showFeedback("Request took too long. Please check your connection and try again.", "error");
      } else {
        console.error("Order lookup error:", err);
        showFeedback(
          "We couldn't find your order. Please check your details and try again.",
          "error"
        );
      }
    } finally {
      setLoading(false);
      activeLookupController = null;
    }
  }

  // Auto-lookup logic from URL parameters
  const params = new URLSearchParams(window.location.search);
  const urlOrder = params.get("order");
  const urlToken = params.get("token");

  if (urlOrder && urlToken) {
    queryInput.value = urlOrder;
    performLookup(urlOrder, urlToken);
  }

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

function initCopyButtons() {
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const textToCopy = btn.getAttribute('data-copy');
    if (!textToCopy) return;

    const copySuccess = function () {
      btn.classList.add('copied');
      setTimeout(function () {
        btn.classList.remove('copied');
      }, 1800);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textToCopy)
        .then(copySuccess)
        .catch(function () {
          fallbackCopyText(textToCopy, copySuccess);
        });
    } else {
      fallbackCopyText(textToCopy, copySuccess);
    }
  });

  function fallbackCopyText(text, cb) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      if (cb) cb();
    } catch (e) {
      console.warn('Clipboard copy fallback error:', e);
    }
    document.body.removeChild(textarea);
  }
}

function formatPizzaAmount(value) {
  if (typeof value !== 'number' || isNaN(value)) return '0';
  var rounded = Math.round(value * 100) / 100;

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  var whole = Math.floor(rounded);
  var prefix = whole > 0 ? String(whole) : '';

  if (rounded % 1 === 0.5) {
    return prefix ? (prefix + '½') : '½';
  }

  if (rounded % 1 === 0.25) {
    return prefix ? (prefix + '¼') : '¼';
  }

  if (rounded % 1 === 0.75) {
    return prefix ? (prefix + '¾') : '¾';
  }

  return String(rounded);
}

