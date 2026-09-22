// ============================================================================
// ARTISAN OVEN — Site & Order Lookup Script
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURATION: Replace with your deployed Google Apps Script Web App URL
// Example: "https://script.google.com/macros/s/AKfycbwIZ9GTLcelcZUdXuprJBRJlB2mnlXYC36jJdFoNdzbAeALf66Y__Wf1fMFKpVQmocQoA/exec"
// ----------------------------------------------------------------------------
var ORDER_API_URL = window.ORDER_API_URL;

function runInit() {
  // Keep footer year updated
  const yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = "\u00A9 " + new Date().getFullYear();
  }

  // Setup Order Lookup Form
  initOrderLookup();
  // Setup Availability Tracker
  initAvailabilityTracker();
  // Setup Special Events Banner Check
  initOrderEventsBanner();
  // Setup Quick Copy Buttons
  initCopyButtons();
  // Setup PWA Service Worker
  initPWAServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runInit);
  // Also eagerly run availability tracker as soon as script evaluates if DOM nodes already exist
  if (document.getElementById("availability-tracker") || document.getElementById("order-form-container")) {
    initAvailabilityTracker();
  }
} else {
  runInit();
}

function initAvailabilityTracker() {
  const trackerEl = document.getElementById("availability-tracker");
  const orderButtons = document.querySelectorAll('a[href="order.html"]');
  const googleFormContainer = document.getElementById("order-form-container");
  const closedMessage = document.getElementById("closed-message");
  const closedMessageText = document.getElementById("closed-message-text");

  // Skip entirely if current page has no availability UI elements (e.g. admin or events pages)
  if (!trackerEl && !googleFormContainer && !closedMessage && (!orderButtons || orderButtons.length === 0)) {
    return;
  }

  const STATUS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  function fallbackToOpen() {
    // Only use cache if it was saved recently (< 2 minutes) to prevent showing stale last-week status
    try {
      const cacheTimeStr = sessionStorage.getItem('STATUS_CACHE_TIME') || localStorage.getItem('STATUS_CACHE_TIME');
      const cacheTime = cacheTimeStr ? parseInt(cacheTimeStr, 10) : 0;
      if (cacheTime && (Date.now() - cacheTime) < STATUS_CACHE_TTL_MS) {
        const existingCache = sessionStorage.getItem('STATUS_CACHE_DATA') || localStorage.getItem('STATUS_CACHE_DATA');
        if (existingCache) {
          const parsed = JSON.parse(existingCache);
          if (parsed && parsed.success) {
            updateTrackerUI(parsed);
            return;
          }
        }
      }
    } catch (e) {}

    // If no valid recent cache, default to a safe neutral loading state
    if (trackerEl) {
      trackerEl.classList.add("is-loading");
      trackerEl.style.display = "block";
    }
  }

  // 1. Immediate render from window.INITIAL_STATUS (injected in <head> by /config.js)
  if (window.INITIAL_STATUS && window.INITIAL_STATUS.success) {
    updateTrackerUI(window.INITIAL_STATUS);
    const serialized = JSON.stringify(window.INITIAL_STATUS);
    const nowStr = Date.now().toString();
    sessionStorage.setItem('STATUS_CACHE_DATA', serialized);
    sessionStorage.setItem('STATUS_CACHE_TIME', nowStr);
    try {
      localStorage.setItem('STATUS_CACHE_DATA', serialized);
      localStorage.setItem('STATUS_CACHE_TIME', nowStr);
    } catch (e) {}
  } else {
    // 2. Immediate render from client cache ONLY if recent (< 2 minutes) to prevent UI flash
    try {
      const cacheTimeStr = sessionStorage.getItem('STATUS_CACHE_TIME') || localStorage.getItem('STATUS_CACHE_TIME');
      const cacheTime = cacheTimeStr ? parseInt(cacheTimeStr, 10) : 0;
      const isCacheRecent = cacheTime > 0 && (Date.now() - cacheTime) < STATUS_CACHE_TTL_MS;

      if (isCacheRecent) {
        const immediateCache = sessionStorage.getItem('STATUS_CACHE_DATA') || localStorage.getItem('STATUS_CACHE_DATA');
        if (immediateCache) {
          const parsed = JSON.parse(immediateCache);
          if (parsed && parsed.success) {
            updateTrackerUI(parsed);
          }
        }
      } else {
        // Clear stale cache from old sessions or previous days
        sessionStorage.removeItem('STATUS_CACHE_DATA');
        sessionStorage.removeItem('STATUS_CACHE_TIME');
        try {
          localStorage.removeItem('STATUS_CACHE_DATA');
          localStorage.removeItem('STATUS_CACHE_TIME');
        } catch (e) {}
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // If there's no API URL, show neutral state
  if (!ORDER_API_URL || ORDER_API_URL === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
    fallbackToOpen();
    return;
  }

  let isFetching = false;
  let pollTimer = null;

  function scheduleNextPoll(delayMs = 20000) {
    if (pollTimer) clearTimeout(pollTimer);
    if (document.hidden) return; // Do not poll when page is in background
    pollTimer = setTimeout(() => {
      if (!document.hidden) {
        fetchStatus(false);
      }
    }, delayMs);
  }

  async function fetchStatus(force = false) {
    if (isFetching) return;

    const apiUrl = (typeof ORDER_API_URL !== 'undefined') ? ORDER_API_URL : (window.ORDER_API_URL || "");
    const statusApiUrl = (typeof window.STATUS_API_URL !== 'undefined') ? window.STATUS_API_URL : "/api/status";

    if (!statusApiUrl && (!apiUrl || apiUrl.indexOf('http') !== 0 || apiUrl === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE")) {
      fallbackToOpen();
      return;
    }

    isFetching = true;
    let fetchSucceeded = false;

    // Helper to perform fetch with AbortController timeout
    const doFetch = async (targetUrl, timeoutMs = 4000) => {
      let controller = null;
      let timeoutId = null;
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          try { controller.abort(); } catch (e) {}
        }, timeoutMs);
      }
      try {
        return await fetch(targetUrl, {
          method: "GET",
          mode: "cors",
          redirect: "follow",
          signal: controller ? controller.signal : undefined
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    try {
      let response = null;

      // 1. Try local status endpoint first (instant sub-5ms local cache)
      if (statusApiUrl) {
        try {
          const localUrl = new URL(statusApiUrl, window.location.origin);
          localUrl.searchParams.set("_t", Date.now().toString());
          if (force) localUrl.searchParams.set("force", "true");
          response = await doFetch(localUrl.toString(), 2500);
        } catch (e) {
          // Fall back to direct upstream
        }
      }

      // 2. Fall back to upstream Apps Script endpoint if local endpoint not present or failed
      if ((!response || !response.ok) && apiUrl && apiUrl.indexOf('http') === 0 && apiUrl !== "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
        const url = new URL(apiUrl);
        url.searchParams.set("action", "getStatus");
        url.searchParams.set("_t", Date.now().toString());
        response = await doFetch(url.toString(), 5000);
      }

      if (response && response.ok) {
        const data = await response.json();
        if (data && data.success) {
          fetchSucceeded = true;
          const serialized = JSON.stringify(data);
          const nowStr = Date.now().toString();
          sessionStorage.setItem('STATUS_CACHE_DATA', serialized);
          sessionStorage.setItem('STATUS_CACHE_TIME', nowStr);
          try {
            localStorage.setItem('STATUS_CACHE_DATA', serialized);
            localStorage.setItem('STATUS_CACHE_TIME', nowStr);
          } catch (e) {}
          updateTrackerUI(data);
        } else {
          fallbackToOpen();
        }
      } else {
        fallbackToOpen();
      }
    } catch (err) {
      // Graceful fallback for network aborts or transient errors
      fallbackToOpen();
    } finally {
      isFetching = false;
      // Keep availability live with periodic light background refreshes
      scheduleNextPoll(20000);
    }
  }

  function updateTrackerUI(data) {
    // Dynamic text replacements across the page
    if (data.serviceNoticeDate) {
      const noticeDateEl = document.getElementById("service-notice-date-text");
      if (noticeDateEl && noticeDateEl.textContent !== data.serviceNoticeDate) {
        noticeDateEl.textContent = data.serviceNoticeDate;
      }
    }
    if (data.serviceTitle) {
      const titleEls = document.querySelectorAll(".tracker-title, #tracker-service-title");
      titleEls.forEach(el => {
        if (el.textContent !== data.serviceTitle) el.textContent = data.serviceTitle;
      });
    }
    if (data.capacityMessage) {
      const capEls = document.querySelectorAll(".tracker-disclaimer, #tracker-capacity-disclaimer");
      capEls.forEach(el => {
        if (el.textContent !== data.capacityMessage) el.textContent = data.capacityMessage;
      });
    }
    if (data.deadlineMessage) {
      const deadEls = document.querySelectorAll("#tracker-deadline-text");
      deadEls.forEach(el => {
        if (el.innerHTML !== data.deadlineMessage) el.innerHTML = data.deadlineMessage;
      });
    }

    if (trackerEl) {
      trackerEl.classList.remove("is-loading");
      trackerEl.style.display = "block";

      const statusText = document.getElementById("tracker-status-text");
      const progressFill = document.getElementById("tracker-progress-fill");
      const ordersTaken = document.getElementById("tracker-orders-taken");
      const ordersRemaining = document.getElementById("tracker-orders-remaining");

      if (data.orderingOpen) {
        if (statusText) {
          statusText.textContent = (data.remainingPizzas > 0 && data.remainingPizzas <= 5) ? ("Only " + formatPizzaAmount(data.remainingPizzas) + " Left!") : "Taking Orders";
          statusText.style.color = "var(--forest)";
        }
      } else {
        if (statusText && statusText.textContent !== "Fully Booked") {
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
          progressFill.style.backgroundColor = (!data.orderingOpen) ? "var(--terracotta)" : (remaining <= 5 ? "#d97706" : "var(--forest)");
        }

        const isMaxReached = current >= max || remaining <= 0 || !data.orderingOpen;

        if (ordersTaken) {
          const takenText = formatPizzaAmount(current) + " of " + formatPizzaAmount(max) + " pizzas claimed";
          if (ordersTaken.textContent !== takenText) ordersTaken.textContent = takenText;
        }
        if (ordersRemaining) {
          const remText = isMaxReached ? "0 remaining" : (formatPizzaAmount(Math.max(0, remaining)) + " remaining");
          if (ordersRemaining.textContent !== remText) ordersRemaining.textContent = remText;
          ordersRemaining.style.display = (!data.orderingOpen) ? "none" : "inline-block";
        }
      }
    }

    if (data.orderingOpen === false) {
      // Disable buttons
      orderButtons.forEach(btn => {
        btn.classList.add("btn-disabled");
        const btnText = btn.querySelector('.choice-btn');
        if (btnText && btnText.textContent !== "FULLY BOOKED") {
          btnText.textContent = "FULLY BOOKED";
        }
        btn.href = "javascript:void(0)";
      });

      // Show fully booked message on order page
      if (googleFormContainer) googleFormContainer.style.display = "none";
      if (closedMessage) {
        closedMessage.style.display = "block";
        const msg = data.closedMessage || data.message;
        if (msg && closedMessageText && closedMessageText.textContent !== msg) {
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

  // Real-time visibility and focus triggers for instant status updates
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchStatus(true);
    }
  });

  window.addEventListener("focus", () => {
    fetchStatus(true);
  });

  // Re-check status immediately on order button click
  orderButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      fetchStatus(true);
    });
  });

  // On order page: when Google Form iframe loads or records a submission, refresh immediately
  const formIframe = document.querySelector("#order-form-container iframe");
  if (formIframe) {
    let iframeLoadCount = 0;
    formIframe.addEventListener("load", () => {
      iframeLoadCount++;
      if (iframeLoadCount > 1) {
        // Submission completed inside iframe
        setTimeout(() => fetchStatus(true), 500);
        setTimeout(() => fetchStatus(true), 2500);
      }
    });
  }

  // Initial fetch triggers the live status update immediately
  fetchStatus(false);

  // When tab becomes active or user refocuses, revalidate status
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      fetchStatus(false);
    }
  });
  window.addEventListener("focus", function () {
    fetchStatus(false);
  });
}

function initOrderEventsBanner() {
  const banner = document.getElementById("order-events-banner") || document.querySelector(".order-events-banner");
  if (!banner) return;

  const introText = document.getElementById("page-order-intro");

  function setBannerVisibility(hasEvents) {
    if (hasEvents) {
      banner.style.display = "block";
      if (introText) {
        introText.textContent = "Place your Tuesday school lunch order below or explore upcoming special events.";
      }
    } else {
      banner.style.display = "none";
      if (introText) {
        introText.textContent = "Place your Tuesday school lunch order below.";
      }
    }
  }

  // Check local storage cache first for instant render
  try {
    const raw = localStorage.getItem("AO_LOCAL_EVENTS");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const active = parsed.filter(e => e && e.active !== false && e.active !== 'false' &&
          e.id !== 'summer-popup-2026' && e.id !== 'autumn-feast-2026' &&
          e.name !== 'Autumn Harvest Feast' && e.name !== 'Summer Pizza Pop-Up'
        );
        setBannerVisibility(active.length > 0);
      }
    }
  } catch (e) {}

  const apiUrl = (typeof ORDER_API_URL !== 'undefined') ? ORDER_API_URL : (window.ORDER_API_URL || "");
  if (!apiUrl || apiUrl.indexOf('http') !== 0 || apiUrl === "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
    return;
  }

  const url = new URL(apiUrl);
  url.searchParams.set("action", "getEvents");
  url.searchParams.set("_t", Date.now().toString());

  fetch(url.toString(), {
    method: "GET",
    mode: "cors",
    redirect: "follow"
  })
    .then(r => r.json())
    .then(data => {
      if (data && data.success && Array.isArray(data.events)) {
        const active = data.events.filter(e => e && e.active !== false && e.active !== 'false' &&
          e.id !== 'summer-popup-2026' && e.id !== 'autumn-feast-2026' &&
          e.name !== 'Autumn Harvest Feast' && e.name !== 'Summer Pizza Pop-Up'
        );
        try {
          localStorage.setItem("AO_LOCAL_EVENTS", JSON.stringify(active));
        } catch (e) {}
        setBannerVisibility(active.length > 0);
      } else {
        setBannerVisibility(false);
      }
    })
    .catch(() => {});
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
        timeoutId = setTimeout(() => {
          try {
            activeLookupController.abort(new Error("Lookup timeout"));
          } catch (e) {
            activeLookupController.abort();
          }
        }, 15000);
      }

      let response;
      try {
        response = await fetch(url.toString(), fetchOpts);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

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
      const isAbort = err.name === 'AbortError' || 
                      err.name === 'TimeoutError' || 
                      (err.message && err.message.toLowerCase().includes('abort'));
      if (isAbort) {
        showFeedback("Request took too long. Please check your connection and try again.", "error");
      } else {
        console.warn("Order lookup note:", err.message || err);
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

      if (orderData.discountCode) {
        const discountLi = document.createElement("li");
        discountLi.className = "order-item-row";
        const discountAmount = Number(orderData.discountAmount || 0);
        discountLi.innerHTML = `
          <div class="item-main">
            <span class="item-name">Discount code: ${escapeHtml(orderData.discountCode)}</span>
          </div>
          <span class="item-price">−£${discountAmount.toFixed(2)}</span>
        `;
        itemsListEl.appendChild(discountLi);
      }
    }

    const totalForDisplay = orderData.totalAfterDiscount !== undefined ? Number(orderData.totalAfterDiscount) : Number(orderData.total || 0);
    const formattedTotal = orderData.totalFormatted || "£" + totalForDisplay.toFixed(2);
    if (totalPriceEl) totalPriceEl.textContent = formattedTotal;
    if (paypalAmountSpan) paypalAmountSpan.textContent = formattedTotal;

    if (paypalBtn) {
      paypalBtn.href = orderData.paypalMeUrl || "https://paypal.me/ArtisanOven";
    }

    if (paypalNcpBtn && orderData.paypalNcpUrl) {
      paypalNcpBtn.href = orderData.paypalNcpUrl;
    }

    // Move methods container into result card if not already there
    const methodsContainer = document.getElementById("payment-methods-container");
    const defaultTear = document.getElementById("default-tear");
    const resultCard = document.querySelector(".order-result-card");

    if (methodsContainer && resultCard && resultSection) {
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
      
      // Only append if it's not already a child of the result card
      if (methodsContainer.parentNode !== resultCard) {
        resultCard.appendChild(methodsContainer);
      }
      
      resultSection.hidden = false;
      resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

function initPWAServiceWorker() {
  if ('serviceWorker' in navigator) {
    const loc = (window.location.pathname || "").toLowerCase();
    // Only register parent-sw if on parent-order page to avoid overriding admin-sw or kitchen-sw
    if (loc.includes('parent-order') || loc.includes('parent')) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('./parent-sw.js').catch(function(err) {
          console.debug('Service worker registration error:', err);
        });
      });
    }
  }
}

function initIOSBottomNav() {
  if (document.getElementById('ios-bottom-nav')) return;

  const currentPath = window.location.pathname.split('/').pop() || 'index.html';

  const nav = document.createElement('nav');
  nav.id = 'ios-bottom-nav';
  nav.className = 'ios-bottom-nav';
  nav.setAttribute('aria-label', 'iOS App Navigation');

  const items = [
    { name: 'Home', href: 'index.html', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>' },
    { name: 'Order', href: 'order.html', icon: '<circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>' },
    { name: 'Pay', href: 'Payment.html', icon: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>' },
    { name: 'Kitchen', href: 'kitchen.html', icon: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1z"></path>' },
    { name: 'Admin', href: 'admin.html', icon: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>' }
  ];

  let html = '';
  items.forEach(item => {
    const isActive = (currentPath === item.href || (currentPath === '' && item.href === 'index.html'));
    html += `<a href="${item.href}" class="ios-nav-item ${isActive ? 'active' : ''}">
      <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
      <span>${item.name}</span>
    </a>`;
  });

  nav.innerHTML = html;
  document.body.appendChild(nav);
}

