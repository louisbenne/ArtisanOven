/**
 * Artisan Oven Admin Events & Special Event Orders Management
 * Version: 2.3.0
 */

const STORAGE_KEY_TOKEN = "ao_admin_session_token";
const STORAGE_KEY_LOCAL_EVENTS = "AO_LOCAL_EVENTS";
const STORAGE_KEY_EVENT_ORDERS = "AO_CACHED_EVENT_ORDERS";

const DEFAULT_EVENTS = [
  {
    id: "summer-popup-2026",
    name: "Summer Pizza Pop-Up",
    description: "Wood-fired sourdough pizza pop-up event with seasonal local toppings.",
    date: "12 July 2026",
    time: "17:00 - 21:00",
    location: "Village Green, Guilden Morden",
    status: "Open",
    customerInstructions: "Please arrive 5 mins before your chosen pickup slot.",
    emailSubject: "Your Summer Pop-Up Pizza Order Confirmation",
    emailMessage: "Thank you for ordering for our Summer Pop-Up!",
    active: true
  },
  {
    id: "autumn-feast-2026",
    name: "Autumn Harvest Feast",
    description: "Seasonal sourdough specials and wood-fired appetizers.",
    date: "18 September 2026",
    time: "18:00 - 21:30",
    location: "Town Hall Yard",
    status: "Open",
    customerInstructions: "Bring your order confirmation email on arrival.",
    emailSubject: "Autumn Feast Order Confirmation",
    emailMessage: "We look forward to serving you!",
    active: true
  }
];

let cachedEvents = [];
let cachedEventOrders = [];
let currentEventsSubTab = 'manage'; // 'manage' | 'orders'
let isLocalFallback = false;
let pendingDeleteEventId = null;

function getApiUrl() {
  return (typeof ORDER_API_URL !== 'undefined' && ORDER_API_URL) 
    ? ORDER_API_URL 
    : (window.ORDER_API_URL || "");
}

function escapeAdminHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getStoredLocalEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOCAL_EVENTS);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch(e) {}
  
  localStorage.setItem(STORAGE_KEY_LOCAL_EVENTS, JSON.stringify(DEFAULT_EVENTS));
  return DEFAULT_EVENTS;
}

function saveStoredLocalEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY_LOCAL_EVENTS, JSON.stringify(events || []));
  } catch(e) {}
}

// ----------------------------------------------------------------------------
// TAB & SUBTAB NAVIGATION
// ----------------------------------------------------------------------------

window.initEventsTab = function() {
  console.log("Admin: Initializing Events Tab");
  cachedEvents = getStoredLocalEvents();
  renderEventsList(cachedEvents);
  populateEventDropdown(cachedEvents);
  loadRemoteEvents();
  loadEventOrdersData('', true); // background load
};

window.switchEventsSubTab = function(subtab) {
  currentEventsSubTab = subtab;
  
  const btnManage = document.getElementById('btn-subtab-events-manage');
  const btnOrders = document.getElementById('btn-subtab-events-orders');
  const viewManage = document.getElementById('events-subtab-manage-view');
  const viewOrders = document.getElementById('events-subtab-orders-view');

  if (btnManage && btnOrders && viewManage && viewOrders) {
    if (subtab === 'manage') {
      btnManage.classList.add('active');
      btnOrders.classList.remove('active');
      viewManage.style.display = 'block';
      viewOrders.style.display = 'none';
      renderEventsList(cachedEvents);
    } else {
      btnOrders.classList.add('active');
      btnManage.classList.remove('active');
      viewOrders.style.display = 'block';
      viewManage.style.display = 'none';
      loadEventOrdersData();
    }
  }
};

// Immediate render on script execution if DOM ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    const container = document.getElementById("events-list-container");
    if (container && container.innerHTML.includes("Loading events")) {
      window.initEventsTab();
    }
    setupEventOrdersSearch();
  }, 100);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("events-list-container");
    if (container && container.innerHTML.includes("Loading events")) {
      window.initEventsTab();
    }
    setupEventOrdersSearch();
  });
}

function setupEventOrdersSearch() {
  const searchInput = document.getElementById('event-orders-search-input');
  if (searchInput && !searchInput.dataset.listenerAttached) {
    searchInput.dataset.listenerAttached = "true";
    let timer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        renderEventOrders(cachedEventOrders);
      }, 150);
    });
  }
}

// ----------------------------------------------------------------------------
// REMOTE EVENTS LOADER
// ----------------------------------------------------------------------------

async function loadRemoteEvents() {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
  const apiUrl = getApiUrl();

  if (!apiUrl) {
    isLocalFallback = true;
    renderEventsList(cachedEvents);
    populateEventDropdown(cachedEvents);
    return;
  }

  try {
    const fetchUrl = apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + "action=adminGetEvents&token=" + encodeURIComponent(token || "demo") + "&_t=" + Date.now();
    const response = await fetch(fetchUrl);
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.events)) {
        cachedEvents = data.events;
        saveStoredLocalEvents(cachedEvents);
        isLocalFallback = false;
        renderEventsList(cachedEvents);
        populateEventDropdown(cachedEvents);
        return;
      }
    }
  } catch (e) {
    console.warn("Using stored events mode:", e.message);
  }
  
  isLocalFallback = true;
  renderEventsList(cachedEvents);
  populateEventDropdown(cachedEvents);
}

// ----------------------------------------------------------------------------
// RENDER EVENTS MANAGEMENT LIST
// ----------------------------------------------------------------------------

function renderEventsList(events) {
  const container = document.getElementById("events-list-container");
  if (!container) return;

  const totalCount = events ? events.length : 0;
  const activeCount = events ? events.filter(e => e.active).length : 0;
  const openCount = events ? events.filter(e => e.status === 'Open').length : 0;

  let html = `
    <!-- Top Summary Stats -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 24px;">
      <div class="metric-card">
        <span class="metric-label">Total Events</span>
        <div class="metric-value-wrap">
          <span class="metric-number">${totalCount}</span>
        </div>
      </div>
      <div class="metric-card">
        <span class="metric-label">Open for Orders</span>
        <div class="metric-value-wrap">
          <span class="metric-number" style="color: #2D5832;">${openCount}</span>
        </div>
      </div>
      <div class="metric-card">
        <span class="metric-label">Published on Web</span>
        <div class="metric-value-wrap">
          <span class="metric-number" style="color: var(--terracotta);">${activeCount}</span>
        </div>
      </div>
    </div>

    <!-- Toolbar Header -->
    <div style="margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
      <div>
        <h3 style="margin: 0; font-size: 1.3rem; color: var(--forest); font-family: var(--font-display);">Special Events & Pop-ups</h3>
        <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-soft);">Configure pop-up locations, dates, pickup instructions and ordering availability.</p>
      </div>
      <button type="button" class="admin-primary-btn" onclick="openEventModal()" style="display: inline-flex; align-items: center; gap: 8px; width: auto; padding: 12px 22px; font-size: 0.92rem; border-radius: 999px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        Create New Event
      </button>
    </div>
  `;

  if (!events || events.length === 0) {
    html += `
      <div style="background: var(--white); border: 1.5px dashed rgba(31,58,46,0.2); border-radius: var(--radius-md); padding: 52px 24px; text-align: center; box-shadow: var(--shadow-soft);">
        <div style="font-size: 2.8rem; margin-bottom: 12px;">🍕</div>
        <h4 style="margin: 0 0 8px 0; color: var(--forest); font-size: 1.3rem; font-family: var(--font-display);">No Special Events Scheduled</h4>
        <p style="margin: 0 0 24px 0; color: var(--text-soft); font-size: 0.95rem;">You haven't created any special events or pop-ups yet.</p>
        <button type="button" class="admin-primary-btn" onclick="openEventModal()" style="width: auto; display: inline-flex; padding: 12px 26px; border-radius: 999px;">+ Create Your First Event</button>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  // Render Event Cards Grid
  html += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 24px;">`;

  events.forEach(evt => {
    const isOpen = (evt.status === 'Open');
    const statusBg = isOpen ? 'rgba(111, 143, 114, 0.18)' : 'rgba(198, 93, 59, 0.15)';
    const statusColor = isOpen ? '#2D5832' : 'var(--terracotta-deep)';

    html += `
      <div class="admin-card" style="margin-bottom: 0; padding: 24px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: var(--shadow-soft);">
        <div>
          <!-- Card Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px;">
            <h4 style="margin: 0; font-size: 1.25rem; font-family: var(--font-display); font-weight: 600; color: var(--forest); line-height: 1.3;">${escapeAdminHtml(evt.name)}</h4>
            <span style="font-size: 0.74rem; font-weight: 700; padding: 5px 12px; border-radius: 999px; letter-spacing: 0.05em; text-transform: uppercase; background: ${statusBg}; color: ${statusColor}; white-space: nowrap; border: 1px solid ${isOpen ? 'rgba(111, 143, 114, 0.4)' : 'rgba(198, 93, 59, 0.3)'};">
              ${isOpen ? '● OPEN' : '○ CLOSED'}
            </span>
          </div>

          <!-- Description -->
          ${evt.description ? `<p style="margin: 0 0 16px 0; font-size: 0.92rem; color: var(--text-soft); line-height: 1.45;">${escapeAdminHtml(evt.description)}</p>` : ''}

          <!-- Details List -->
          <div style="display: flex; flex-direction: column; gap: 10px; font-size: 0.88rem; color: var(--forest); margin-bottom: 18px; background: var(--cream); padding: 14px 16px; border-radius: var(--radius-sm); border: 1px solid rgba(31, 58, 46, 0.06);">
            <div style="display: flex; align-items: center; gap: 9px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta); flex-shrink: 0;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span><strong>Date:</strong> ${escapeAdminHtml(evt.date || 'TBD')} ${evt.time ? `(${escapeAdminHtml(evt.time)})` : ''}</span>
            </div>
            ${evt.location ? `
            <div style="display: flex; align-items: center; gap: 9px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta); flex-shrink: 0;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span><strong>Location:</strong> ${escapeAdminHtml(evt.location)}</span>
            </div>` : ''}
            <div style="display: flex; align-items: center; gap: 9px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta); flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              <span><strong>Website Status:</strong> ${evt.active ? '<span style="color: #2D5832; font-weight: 700;">Published</span>' : '<span style="color: var(--text-soft);">Draft / Hidden</span>'}</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div class="event-card-actions" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid rgba(31,58,46,0.08);">
          <div class="event-action-group" style="display: flex; gap: 6px;">
            <button 
              type="button" 
              class="event-action-btn ${isOpen ? 'event-action-btn-toggle-closed' : 'event-action-btn-toggle-open'}" 
              onclick="toggleEventStatus('${escapeAdminHtml(evt.id)}')"
              title="${isOpen ? 'Close ordering for this event' : 'Open ordering for this event'}"
            >
              ${isOpen ? `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Close Orders
              ` : `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                Open Orders
              `}
            </button>
            <button 
              type="button" 
              class="event-action-btn event-action-btn-secondary" 
              onclick="viewEventOrders('${escapeAdminHtml(evt.id)}')"
              title="View special event orders for ${escapeAdminHtml(evt.name)}"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
              View Orders
            </button>
          </div>

          <div class="event-action-group" style="display: flex; gap: 6px;">
            <button 
              type="button" 
              class="event-action-btn event-action-btn-primary" 
              onclick="editEventById('${escapeAdminHtml(evt.id)}')"
              title="Edit event settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit
            </button>
            <button 
              type="button" 
              class="event-action-btn event-action-btn-danger" 
              onclick="openDeleteEventModal('${escapeAdminHtml(evt.id)}')"
              title="Permanently delete this event"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ----------------------------------------------------------------------------
// EVENT ORDERS LOADER & RENDERER (SEPARATE FROM SCHOOL LUNCHES)
// ----------------------------------------------------------------------------

window.loadEventOrdersData = async function(targetEventId = '', silent = false) {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
  const container = document.getElementById('event-orders-list-container');
  if (!token) return;

  if (!silent) {
    // Check cached event orders in session storage
    const cached = sessionStorage.getItem(STORAGE_KEY_EVENT_ORDERS);
    if (cached) {
      try {
        cachedEventOrders = JSON.parse(cached);
        renderEventOrders(cachedEventOrders);
      } catch (e) {}
    }
    if ((!cachedEventOrders || !cachedEventOrders.length) && container) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px 0;">Loading event orders from Event Customers...</p>';
    }
  }

  try {
    const apiUrl = getApiUrl();
    if (!apiUrl) throw new Error("Backend URL not configured.");

    const url = new URL(apiUrl);
    url.searchParams.set("action", "adminGetEventOrders");
    url.searchParams.set("token", token);
    if (targetEventId) url.searchParams.set("eventId", targetEventId);
    url.searchParams.set("_t", Date.now());

    const response = await fetch(url.toString(), { method: "GET", mode: "cors" });
    if (!response.ok) throw new Error("Network request failed (" + response.status + ")");
    const data = await response.json();

    if (data.unauthorized) {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      if (typeof window.showLoginView === 'function') window.showLoginView();
      if (typeof window.showLoginError === 'function') window.showLoginError("Session expired.");
      return;
    }

    if (data.success && Array.isArray(data.orders)) {
      cachedEventOrders = data.orders;
      sessionStorage.setItem(STORAGE_KEY_EVENT_ORDERS, JSON.stringify(data.orders));
      
      // Update badge
      const badge = document.getElementById('badge-event-orders-count');
      if (badge) {
        badge.textContent = data.orders.length;
        badge.style.display = data.orders.length > 0 ? 'inline-block' : 'none';
      }

      if (targetEventId) {
        const select = document.getElementById('event-orders-filter-select');
        if (select) select.value = targetEventId;
      }

      renderEventOrders(cachedEventOrders);
    } else {
      if (container) container.innerHTML = `<p style="color: var(--terracotta); text-align: center; padding: 40px 0;">${data.message || "Failed to load event orders."}</p>`;
    }
  } catch (err) {
    console.error("Event orders load error:", err);
    if ((!cachedEventOrders || !cachedEventOrders.length) && container) {
      container.innerHTML = '<p style="color: var(--terracotta); text-align: center; padding: 40px 0;">Connection error fetching event orders.</p>';
    }
  }
};

function populateEventDropdown(events) {
  const select = document.getElementById('event-orders-filter-select');
  if (!select) return;

  const currentVal = select.value;
  let optionsHtml = '<option value="">All Special Events</option>';
  if (events && events.length > 0) {
    events.forEach(e => {
      optionsHtml += `<option value="${escapeAdminHtml(e.id)}">${escapeAdminHtml(e.name)} (${escapeAdminHtml(e.date || 'TBD')})</option>`;
    });
  }
  select.innerHTML = optionsHtml;
  if (currentVal) select.value = currentVal;
}

window.filterEventOrdersByDropdown = function() {
  renderEventOrders(cachedEventOrders);
};

window.renderEventOrders = function(orders) {
  const container = document.getElementById('event-orders-list-container');
  if (!container) return;

  const filterSelect = document.getElementById('event-orders-filter-select');
  const selectedEventId = (filterSelect && filterSelect.value || '').toLowerCase();

  const searchInputEl = document.getElementById('event-orders-search-input');
  const searchTerm = (searchInputEl && searchInputEl.value || '').toLowerCase();

  let totalOrders = 0;
  let totalPizzas = 0;
  let pendingCount = 0;
  let paidCount = 0;
  let totalRevenue = 0;

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div style="background: var(--white); border: 1.5px dashed rgba(31,58,46,0.15); border-radius: var(--radius-md); padding: 44px 20px; text-align: center;">
        <p style="color: var(--text-soft); margin: 0; font-size: 1rem;">No special event orders found.</p>
        <p style="color: var(--text-soft); font-size: 0.85rem; margin-top: 6px;">Orders submitted for pop-ups and events will appear here.</p>
      </div>
    `;
    updateEventOrderStats(0, 0, 0, 0, 0);
    return;
  }

  // Filter orders by event ID and search term
  const filtered = orders.filter(o => {
    const orderEventId = (o.eventId || '').toLowerCase();
    if (selectedEventId && orderEventId !== selectedEventId) {
      return false;
    }
    const customerName = (o.customer && o.customer.name) || '';
    const customerEmail = (o.customer && o.customer.email) || '';
    const eventName = o.eventName || '';
    const pizzaItems = (o.pizzas && o.pizzas.map(p => `${p.size} ${p.quantity}`).join(' ')) || '';
    const matchString = `${o.orderId} ${customerName} ${customerEmail} ${eventName} ${pizzaItems}`.toLowerCase();
    return matchString.includes(searchTerm);
  });

  // Calculate stats for current filter selection
  filtered.forEach(o => {
    totalOrders++;
    if (o.pizzas && Array.isArray(o.pizzas)) {
      o.pizzas.forEach(p => {
        totalPizzas += (parseInt(p.quantity, 10) || 1);
      });
    }
    totalRevenue += (parseFloat(o.total) || 0);
    const isPaid = (o.paymentStatus || '').toLowerCase() === 'paid';
    if (isPaid) paidCount++;
    else pendingCount++;
  });

  updateEventOrderStats(totalOrders, totalPizzas, pendingCount, paidCount, totalRevenue);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="background: var(--white); border: 1px solid rgba(31,58,46,0.1); border-radius: var(--radius-md); padding: 36px 20px; text-align: center;">
        <p style="color: var(--text-soft); margin: 0;">No event orders match the current filter or search criteria.</p>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(order => {
    const isPaid = (order.paymentStatus || '').toLowerCase() === 'paid';
    const statusLabel = isPaid ? 'PAID' : 'UNPAID';
    const customerName = (order.customer && order.customer.name) || 'Customer';
    const customerEmail = (order.customer && order.customer.email) || '';
    const eventDisplayName = order.eventName || (order.eventId ? `Event (${order.eventId})` : 'Special Event');

    let pizzasHtml = '';
    let pizzaCount = 0;
    if (order.pizzas && Array.isArray(order.pizzas)) {
      order.pizzas.forEach(p => {
        const qty = parseInt(p.quantity, 10) || 1;
        pizzaCount += qty;
        pizzasHtml += `
          <div class="order-pizza-item" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed rgba(31,58,46,0.08);">
            <div>
              <span style="font-weight: 700; color: var(--forest);">${escapeAdminHtml(p.size)}</span>
              <span style="font-size: 0.85rem; color: var(--text-soft); margin-left: 6px;">× ${qty}</span>
            </div>
            <div style="font-weight: 700; color: var(--forest);">
              £${((parseFloat(p.price) || (parseFloat(p.unitPrice) * qty)) || 0).toFixed(2)}
            </div>
          </div>
        `;
      });
    }

    html += `
      <div class="order-card" data-order-id="${escapeAdminHtml(order.orderId)}" style="background: var(--white); border: 1px solid rgba(31,58,46,0.12); border-radius: var(--radius-md); margin-bottom: 16px; box-shadow: var(--shadow-soft);">
        <div class="order-card-header" onclick="this.parentElement.classList.toggle('expanded')" style="padding: 16px 20px; cursor: pointer; display: flex; justify-content: space-between; align-items: flex-start; gap: 14px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="order-card-title" style="font-weight: 800; color: var(--forest); font-size: 1.05rem;">Order #${escapeAdminHtml(order.orderId)}</span>
              <span class="event-tag-pill">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                ${escapeAdminHtml(eventDisplayName)}
              </span>
            </div>
            <div class="order-card-customer" style="font-weight: 700; color: var(--forest); margin-top: 4px; font-size: 0.95rem;">${escapeAdminHtml(customerName)}</div>
            <div class="order-card-email" style="font-size: 0.85rem; color: var(--text-soft);">${escapeAdminHtml(customerEmail)}</div>
          </div>
          <div class="paid-toggle-wrap" onclick="event.stopPropagation()" style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 0.82rem; font-weight: 800; letter-spacing: 0.05em; color: ${isPaid ? '#2D5832' : 'var(--terracotta-deep)'};">${statusLabel}</span>
            <label class="switch">
              <input type="checkbox" class="event-paid-toggle" data-order-id="${escapeAdminHtml(order.orderId)}" ${isPaid ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <div class="order-card-summary" style="display: flex; justify-content: space-between; font-size: 0.9rem; padding: 10px 20px; background: var(--cream); border-top: 1px solid rgba(31,58,46,0.06); cursor: pointer;" onclick="this.parentElement.classList.toggle('expanded')">
          <span>${pizzaCount} pizza${pizzaCount === 1 ? '' : 's'} (${escapeAdminHtml(order.paymentMethod || 'Bank Transfer')})</span>
          <span style="font-weight: 800; color: var(--forest);">Total: £${(order.total || 0).toFixed(2)}</span>
        </div>
        
        <div class="order-card-details" style="padding: 16px 20px; border-top: 1px solid rgba(31,58,46,0.06);">
          <div style="font-size: 0.8rem; color: var(--text-soft); margin-bottom: 12px; background: #f8f8f8; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <span><strong>Ordered:</strong> ${escapeAdminHtml(order.timestamp || '--')}</span>
            <span><strong>Event Date:</strong> ${escapeAdminHtml(order.eventDate || 'Upcoming')}</span>
          </div>

          ${order.allergy ? `<div style="background: #fff3cd; color: #856404; padding: 10px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 12px; font-weight: 600; border: 1px solid rgba(133, 100, 4, 0.2);">⚠️ Dietary / Allergy Notes: ${escapeAdminHtml(order.allergy)}</div>` : ''}

          <div class="pizzas-list" style="margin-bottom: 12px;">${pizzasHtml}</div>

          <div class="order-card-total" style="display: flex; justify-content: space-between; padding-top: 12px; margin-top: 12px; border-top: 2px solid #eee; font-weight: 800; color: var(--forest); align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <span style="display: block; font-size: 0.8rem; color: var(--text-soft); font-weight: 400; margin-bottom: 2px;">Total Due</span>
              <span style="font-size: 1.15rem; color: var(--forest);">£${(order.total || 0).toFixed(2)}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="resend-event-btn-inline" data-order-id="${escapeAdminHtml(order.orderId)}" onclick="event.stopPropagation()" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 0.8rem; font-weight: 700; border: 1px solid rgba(31,58,46,0.15); border-radius: 6px; background: var(--white); color: var(--forest); cursor: pointer;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
                  <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
                </svg>
                RESEND EMAIL
              </button>
              <button type="button" class="delete-event-btn-inline" data-order-id="${escapeAdminHtml(order.orderId)}" onclick="event.stopPropagation()" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; font-size: 0.8rem; font-weight: 700; border: 1px solid rgba(198,93,59,0.2); border-radius: 6px; background: #fff5f2; color: var(--terracotta-deep); cursor: pointer;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                DELETE
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add event listeners for event order paid status toggles
  container.querySelectorAll('.event-paid-toggle').forEach(checkbox => {
    checkbox.addEventListener('change', async function() {
      const orderId = this.getAttribute('data-order-id');
      const isChecked = this.checked;
      const newStatus = isChecked ? 'Paid' : 'Pending Payment';
      const label = this.parentElement.previousElementSibling;
      const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
      
      label.textContent = isChecked ? 'PAID' : 'UNPAID';
      label.style.color = isChecked ? '#2D5832' : 'var(--terracotta-deep)';
      
      try {
        const apiUrl = getApiUrl();
        const url = new URL(apiUrl);
        url.searchParams.set("action", "adminUpdatePaidStatus");
        url.searchParams.set("source", "event");
        url.searchParams.set("token", token);
        url.searchParams.set("orderId", orderId);
        url.searchParams.set("status", newStatus);

        const res = await fetch(url.toString(), { method: "GET", mode: "cors" });
        const data = await res.json();
        if (data.success) {
          if (typeof window.showToast === 'function') window.showToast(`Event Order #${orderId} marked as ${newStatus}`, "success");
          const target = cachedEventOrders.find(o => String(o.orderId) === String(orderId));
          if (target) target.paymentStatus = newStatus;
          sessionStorage.setItem(STORAGE_KEY_EVENT_ORDERS, JSON.stringify(cachedEventOrders));
        } else {
          if (typeof window.showToast === 'function') window.showToast("Error: " + data.message, "error");
          this.checked = !isChecked;
          label.textContent = !isChecked ? 'PAID' : 'UNPAID';
        }
      } catch (err) {
        console.error(err);
        if (typeof window.showToast === 'function') window.showToast("Failed to update payment status.", "error");
        this.checked = !isChecked;
        label.textContent = !isChecked ? 'PAID' : 'UNPAID';
      }
    });
  });

  // Resend confirmation email listener
  container.querySelectorAll('.resend-event-btn-inline').forEach(btn => {
    btn.addEventListener('click', async function() {
      const orderId = this.getAttribute('data-order-id');
      const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
      if (!confirm(`Resend confirmation email for Event Order #${orderId}?`)) return;

      this.disabled = true;
      const originalHtml = this.innerHTML;
      this.innerHTML = 'Sending...';

      try {
        const apiUrl = getApiUrl();
        const url = new URL(apiUrl);
        url.searchParams.set("action", "adminResendConfirmation");
        url.searchParams.set("source", "event");
        url.searchParams.set("token", token);
        url.searchParams.set("orderId", orderId);

        const res = await fetch(url.toString(), { method: "GET", mode: "cors" });
        const data = await res.json();
        if (data.success) {
          if (typeof window.showToast === 'function') window.showToast(data.message, "success");
        } else {
          if (typeof window.showToast === 'function') window.showToast("Error: " + data.message, "error");
        }
      } catch (err) {
        console.error(err);
        if (typeof window.showToast === 'function') window.showToast("Failed to resend confirmation email.", "error");
      } finally {
        this.disabled = false;
        this.innerHTML = originalHtml;
      }
    });
  });

  // Delete event order listener
  container.querySelectorAll('.delete-event-btn-inline').forEach(btn => {
    btn.addEventListener('click', async function() {
      const orderId = this.getAttribute('data-order-id');
      const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
      if (!orderId) return;

      const existingOrder = cachedEventOrders.find(o => String(o.orderId) === String(orderId));
      const customerName = (existingOrder && existingOrder.customer && existingOrder.customer.name) ? ` (${existingOrder.customer.name})` : '';

      if (!confirm(`Are you sure you want to PERMANENTLY DELETE Event Order #${orderId}${customerName}?\n\nThis will mark the order as deleted in Event Customers.`)) return;

      this.disabled = true;
      const originalHtml = this.innerHTML;
      this.innerHTML = 'Deleting...';

      try {
        const apiUrl = getApiUrl();
        const url = new URL(apiUrl);
        url.searchParams.set("action", "adminDeleteOrder");
        url.searchParams.set("source", "event");
        url.searchParams.set("token", token);
        url.searchParams.set("orderId", orderId);

        const res = await fetch(url.toString(), { method: "GET", mode: "cors" });
        const data = await res.json();
        if (data.success) {
          if (typeof window.showToast === 'function') window.showToast(data.message || `Event Order #${orderId} deleted.`, "success");
          cachedEventOrders = cachedEventOrders.filter(o => String(o.orderId) !== String(orderId));
          sessionStorage.setItem(STORAGE_KEY_EVENT_ORDERS, JSON.stringify(cachedEventOrders));
          renderEventOrders(cachedEventOrders);
        } else {
          if (typeof window.showToast === 'function') window.showToast("Error: " + (data.message || "Failed to delete order."), "error");
          this.disabled = false;
          this.innerHTML = originalHtml;
        }
      } catch (err) {
        console.error(err);
        if (typeof window.showToast === 'function') window.showToast("Failed to delete event order due to connection issue.", "error");
        this.disabled = false;
        this.innerHTML = originalHtml;
      }
    });
  });
};

function updateEventOrderStats(total, pizzas, pending, paid, revenue) {
  const elTotal = document.getElementById('stat-event-total-orders');
  const elPizzas = document.getElementById('stat-event-total-pizzas');
  const elPending = document.getElementById('stat-event-pending');
  const elPaid = document.getElementById('stat-event-paid');
  const elRevenue = document.getElementById('stat-event-revenue');

  if (elTotal) elTotal.textContent = total;
  if (elPizzas) elPizzas.textContent = pizzas;
  if (elPending) elPending.textContent = pending;
  if (elPaid) elPaid.textContent = paid;
  if (elRevenue) elRevenue.textContent = `£${revenue.toFixed(2)}`;
}

// ----------------------------------------------------------------------------
// VIEW ORDERS SHORTCUT FROM AN EVENT CARD
// ----------------------------------------------------------------------------

window.viewEventOrders = function(eventId) {
  const btnTabEvents = document.getElementById('btn-tab-events');
  if (btnTabEvents) {
    btnTabEvents.click();
  }
  switchEventsSubTab('orders');
  loadEventOrdersData(eventId);
};

// ----------------------------------------------------------------------------
// EVENT ACTIONS: TOGGLE, EDIT, DELETE, SAVE
// ----------------------------------------------------------------------------

window.toggleEventStatus = function(eventId) {
  const event = cachedEvents.find(e => e.id === eventId);
  if (!event) return;
  event.status = (event.status === 'Open') ? 'Closed' : 'Open';
  saveStoredLocalEvents(cachedEvents);
  renderEventsList(cachedEvents);
  syncEventToRemote(event);
};

window.editEventById = function(eventId) {
  const event = cachedEvents.find(e => e.id === eventId);
  if (event) openEventModal(event);
};

window.openDeleteEventModal = function(eventId) {
  pendingDeleteEventId = eventId;
  const event = cachedEvents.find(e => e.id === eventId);
  const modal = document.getElementById("delete-event-modal");
  
  if (modal) {
    const nameEl = document.getElementById("modal-delete-event-name");
    const dateEl = document.getElementById("modal-delete-event-date");
    if (nameEl) nameEl.textContent = event ? event.name : eventId;
    if (dateEl) dateEl.textContent = event ? (event.date || "TBD") : "--";
    modal.style.display = "flex";
  } else {
    window.confirmDeleteEventFallback(eventId);
  }
};

window.closeDeleteEventModal = function() {
  pendingDeleteEventId = null;
  const modal = document.getElementById("delete-event-modal");
  if (modal) modal.style.display = "none";
};

window.confirmDeleteEvent = async function() {
  if (!pendingDeleteEventId) return;
  const eventId = pendingDeleteEventId;
  const btn = document.getElementById("btn-confirm-delete-event");
  if (btn) btn.classList.add("is-loading");

  try {
    cachedEvents = cachedEvents.filter(e => e.id !== eventId);
    saveStoredLocalEvents(cachedEvents);
    renderEventsList(cachedEvents);
    populateEventDropdown(cachedEvents);
    closeDeleteEventModal();

    if (typeof window.showToast === 'function') {
      window.showToast("Event deleted successfully.");
    }

    const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
    const apiUrl = getApiUrl();
    if (apiUrl && token) {
      const url = new URL(apiUrl);
      url.searchParams.set("action", "adminDeleteEvent");
      url.searchParams.set("token", token);
      url.searchParams.set("eventId", eventId);
      await fetch(url.toString(), { method: "GET", mode: "cors" });
    }
  } catch (err) {
    console.warn("Delete event completed locally:", err.message);
  } finally {
    if (btn) btn.classList.remove("is-loading");
    pendingDeleteEventId = null;
  }
};

window.confirmDeleteEventFallback = async function(eventId) {
  const event = cachedEvents.find(e => e.id === eventId);
  const name = event ? event.name : "this event";
  if (!confirm(`Are you sure you want to PERMANENTLY DELETE "${name}"?`)) {
    return;
  }

  cachedEvents = cachedEvents.filter(e => e.id !== eventId);
  saveStoredLocalEvents(cachedEvents);
  renderEventsList(cachedEvents);
  populateEventDropdown(cachedEvents);

  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
  const apiUrl = getApiUrl();
  if (apiUrl && token) {
    try {
      const url = new URL(apiUrl);
      url.searchParams.set("action", "adminDeleteEvent");
      url.searchParams.set("token", token);
      url.searchParams.set("eventId", eventId);
      await fetch(url.toString(), { method: "GET", mode: "cors" });
    } catch(e) {}
  }
};

window.openEventModal = function(event = null) {
  const modal = document.getElementById("event-modal");
  const form = document.getElementById("form-save-event");
  if (!modal || !form) return;
  form.reset();

  if (event) {
    document.getElementById("event-id").value = event.id || "";
    document.getElementById("event-name").value = event.name || "";
    document.getElementById("event-date").value = event.date || "";
    if (document.getElementById("event-time")) document.getElementById("event-time").value = event.time || "";
    if (document.getElementById("event-location")) document.getElementById("event-location").value = event.location || "";
    if (document.getElementById("event-description")) document.getElementById("event-description").value = event.description || "";
    if (document.getElementById("event-instructions")) document.getElementById("event-instructions").value = event.customerInstructions || "";
    document.getElementById("event-status").value = event.status || "Open";
    document.getElementById("event-active").checked = !!event.active;
    document.getElementById("event-modal-title").textContent = "Edit Event Details";
  } else {
    document.getElementById("event-id").value = "";
    document.getElementById("event-status").value = "Open";
    document.getElementById("event-active").checked = true;
    document.getElementById("event-modal-title").textContent = "Create Special Event";
  }
  modal.style.display = "flex";
};

window.closeEventModal = function() {
  const modal = document.getElementById("event-modal");
  if (modal) modal.style.display = "none";
};

window.saveEvent = async function() {
  const form = document.getElementById("form-save-event");
  if (!form) return;

  const formData = new FormData(form);
  const eventId = formData.get('eventId') || ('event-' + Date.now().toString(36));
  const name = (formData.get('name') || '').trim();
  const date = (formData.get('date') || '').trim();
  const time = (formData.get('time') || '').trim();
  const location = (formData.get('location') || '').trim();
  const description = (formData.get('description') || '').trim();
  const customerInstructions = (formData.get('customerInstructions') || '').trim();
  const status = formData.get('status') || 'Open';
  const active = form.querySelector('#event-active')?.checked ?? true;

  if (!name) {
    alert("Please enter an event name.");
    return;
  }

  const newEventObj = {
    id: eventId,
    name: name,
    date: date,
    time: time,
    location: location,
    description: description,
    customerInstructions: customerInstructions,
    status: status,
    active: active
  };

  const existingIdx = cachedEvents.findIndex(e => e.id === eventId);
  if (existingIdx >= 0) {
    cachedEvents[existingIdx] = { ...cachedEvents[existingIdx], ...newEventObj };
  } else {
    cachedEvents.unshift(newEventObj);
  }
  
  saveStoredLocalEvents(cachedEvents);
  closeEventModal();
  renderEventsList(cachedEvents);
  populateEventDropdown(cachedEvents);

  syncEventToRemote(newEventObj);
};

async function syncEventToRemote(eventObj) {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
  const apiUrl = getApiUrl();
  if (apiUrl && token) {
    try {
      const payload = {
        token: token,
        action: 'adminSaveEvent',
        eventId: eventObj.id,
        name: eventObj.name,
        date: eventObj.date,
        time: eventObj.time,
        location: eventObj.location,
        status: eventObj.status,
        active: eventObj.active ? 'true' : 'false',
        description: eventObj.description || '',
        customerInstructions: eventObj.customerInstructions || ''
      };

      const url = new URL(apiUrl);
      for (let key in payload) {
        url.searchParams.set(key, payload[key]);
      }
      
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.success) {
        console.log("Remote event sync successful");
      }
    } catch (e) {
      console.warn("Background remote sync skipped:", e.message);
    }
  }
}
