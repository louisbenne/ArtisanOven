/**
 * Artisan Oven Admin Events Management
 */

const STORAGE_KEY_TOKEN = "ao_admin_session_token";
const STORAGE_KEY_LOCAL_EVENTS = "AO_LOCAL_EVENTS";

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
let isLocalFallback = false;

function getApiUrl() {
  return (typeof ORDER_API_URL !== 'undefined' && ORDER_API_URL) 
    ? ORDER_API_URL 
    : (window.ORDER_API_URL || "");
}

function escapeAdminHtml(str) {
  if (!str) return '';
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
      if (Array.isArray(parsed)) return parsed;
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

window.initEventsTab = function() {
  console.log("Admin: Initializing Events Tab");
  cachedEvents = getStoredLocalEvents();
  renderEventsList(cachedEvents);
  loadRemoteEvents();
};

// Immediate render on script execution if DOM ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    const container = document.getElementById("events-list-container");
    if (container && container.innerHTML.includes("Loading events")) {
      window.initEventsTab();
    }
  }, 100);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("events-list-container");
    if (container && container.innerHTML.includes("Loading events")) {
      window.initEventsTab();
    }
  });
}

async function loadRemoteEvents() {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN) || (window.currentAdminToken || "");
  const apiUrl = getApiUrl();

  if (!apiUrl) {
    isLocalFallback = true;
    renderEventsList(cachedEvents);
    return;
  }

  try {
    const fetchUrl = apiUrl + (apiUrl.indexOf('?') >= 0 ? '&' : '?') + "action=adminGetEvents&token=" + encodeURIComponent(token || "demo");
    const response = await fetch(fetchUrl);
    
    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.events)) {
        cachedEvents = data.events;
        saveStoredLocalEvents(cachedEvents);
        isLocalFallback = false;
        renderEventsList(cachedEvents);
        return;
      }
    }
  } catch (e) {
    console.warn("Using stored events mode:", e.message);
  }
  
  isLocalFallback = true;
  renderEventsList(cachedEvents);
}

let pendingDeleteEventId = null;

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
        <p style="margin: 4px 0 0 0; font-size: 0.88rem; color: var(--text-soft);">Configure pop-up locations, dates, pickup slots and ordering status.</p>
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
      <div style="background: var(--white); border: 1px solid rgba(31,58,46,0.12); border-radius: var(--radius-md); padding: 24px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: var(--shadow-soft); transition: transform 0.2s, box-shadow 0.2s;">
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

        <!-- Action Footer with Design System Buttons -->
        <div class="event-card-actions">
          <div class="event-action-group">
            <button 
              type="button" 
              class="event-action-btn ${isOpen ? 'event-action-btn-toggle-closed' : 'event-action-btn-toggle-open'}" 
              onclick="toggleEventStatus('${escapeAdminHtml(evt.id)}')"
              title="${isOpen ? 'Close ordering for this event' : 'Open ordering for this event'}"
            >
              ${isOpen ? `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Close Orders
              ` : `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                Open Orders
              `}
            </button>
            <button 
              type="button" 
              class="event-action-btn event-action-btn-secondary" 
              onclick="viewEventOrders('${escapeAdminHtml(evt.id)}')"
              title="View all orders for this event"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              Orders
            </button>
          </div>

          <div class="event-action-group">
            <button 
              type="button" 
              class="event-action-btn event-action-btn-primary" 
              onclick="editEventById('${escapeAdminHtml(evt.id)}')"
              title="Edit event settings and details"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              Edit
            </button>
            <button 
              type="button" 
              class="event-action-btn event-action-btn-danger" 
              onclick="openDeleteEventModal('${escapeAdminHtml(evt.id)}')"
              title="Permanently delete this event"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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
    // Fallback if modal not present
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
    closeDeleteEventModal();

    // Notify user via toast
    if (typeof window.showToast === 'function') {
      window.showToast("Event deleted successfully.");
    }

    // Remote sync
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

window.viewEventOrders = function(eventId) {
  const btnOrders = document.getElementById('btn-tab-orders');
  if (btnOrders) {
    btnOrders.click();
  }
  const searchInput = document.getElementById('orders-search-input');
  if (searchInput) {
    searchInput.value = eventId;
    searchInput.dispatchEvent(new Event('input'));
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
        active: eventObj.active ? 'true' : 'false'
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
