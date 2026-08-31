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
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch(e) {}
  
  localStorage.setItem(STORAGE_KEY_LOCAL_EVENTS, JSON.stringify(DEFAULT_EVENTS));
  return DEFAULT_EVENTS;
}

function saveStoredLocalEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY_LOCAL_EVENTS, JSON.stringify(events));
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
      if (data.success && Array.isArray(data.events) && data.events.length > 0) {
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

function renderEventsList(events) {
  const container = document.getElementById("events-list-container");
  if (!container) return;

  const totalCount = events ? events.length : 0;
  const activeCount = events ? events.filter(e => e.active).length : 0;
  const openCount = events ? events.filter(e => e.status === 'Open').length : 0;

  let html = `
    <!-- Top Summary Stats -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
      <div style="background: var(--white, #fff); border: 1px solid rgba(31,58,46,0.1); border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary, #666); text-transform: uppercase; letter-spacing: 0.5px;">Total Events</div>
        <div style="font-size: 1.8rem; font-weight: 800; color: var(--forest, #1F3A2E); margin-top: 4px;">${totalCount}</div>
      </div>
      <div style="background: var(--white, #fff); border: 1px solid rgba(31,58,46,0.1); border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary, #666); text-transform: uppercase; letter-spacing: 0.5px;">Open for Orders</div>
        <div style="font-size: 1.8rem; font-weight: 800; color: #2D5832; margin-top: 4px;">${openCount}</div>
      </div>
      <div style="background: var(--white, #fff); border: 1px solid rgba(31,58,46,0.1); border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary, #666); text-transform: uppercase; letter-spacing: 0.5px;">Published on Web</div>
        <div style="font-size: 1.8rem; font-weight: 800; color: var(--terracotta, #C65D3B); margin-top: 4px;">${activeCount}</div>
      </div>
    </div>

    <!-- Toolbar Header -->
    <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--white, #fff); padding: 16px 20px; border-radius: 12px; border: 1px solid rgba(31,58,46,0.1);">
      <div>
        <h3 style="margin: 0; font-size: 1.15rem; color: var(--forest, #1F3A2E); font-weight: 700;">Special Events & Pop-ups</h3>
        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--text-secondary, #666);">Configure pop-up locations, dates, pickup slots and ordering status.</p>
      </div>
      <button type="button" class="admin-primary-btn" onclick="openEventModal()" style="display: inline-flex; align-items: center; gap: 6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        Create New Event
      </button>
    </div>
  `;

  if (!events || events.length === 0) {
    html += `
      <div style="background: var(--white, #fff); border: 1px dashed rgba(31,58,46,0.2); border-radius: 12px; padding: 48px 20px; text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🍕</div>
        <h4 style="margin: 0 0 8px 0; color: var(--forest, #1F3A2E); font-size: 1.2rem;">No Events Found</h4>
        <p style="margin: 0 0 20px 0; color: var(--text-secondary, #666);">You haven't created any special events or pop-ups yet.</p>
        <button type="button" class="admin-primary-btn" onclick="openEventModal()">+ Create Your First Event</button>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  // Render Event Cards Grid
  html += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px;">`;

  events.forEach(evt => {
    const isOpen = (evt.status === 'Open');
    const statusBg = isOpen ? 'rgba(111, 143, 114, 0.15)' : 'rgba(198, 93, 59, 0.15)';
    const statusColor = isOpen ? '#2D5832' : '#C65D3B';

    html += `
      <div style="background: var(--white, #fff); border: 1px solid rgba(31,58,46,0.12); border-radius: 14px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 12px rgba(0,0,0,0.03); transition: transform 0.2s, box-shadow 0.2s;">
        <div>
          <!-- Card Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--forest, #1F3A2E); line-height: 1.3;">${escapeAdminHtml(evt.name)}</h4>
            <span style="font-size: 0.72rem; font-weight: 800; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; background: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
              ${isOpen ? '● OPEN' : '○ CLOSED'}
            </span>
          </div>

          <!-- Description -->
          ${evt.description ? `<p style="margin: 0 0 14px 0; font-size: 0.88rem; color: var(--text-secondary, #555); line-height: 1.4;">${escapeAdminHtml(evt.description)}</p>` : ''}

          <!-- Details List -->
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; color: var(--forest, #1F3A2E); margin-bottom: 16px; background: #F9FAFB; padding: 12px 14px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.04);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta);"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <span><strong>Date:</strong> ${escapeAdminHtml(evt.date || 'TBD')} ${evt.time ? `(${escapeAdminHtml(evt.time)})` : ''}</span>
            </div>
            ${evt.location ? `
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta);"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span><strong>Location:</strong> ${escapeAdminHtml(evt.location)}</span>
            </div>` : ''}
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--terracotta);"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
              <span><strong>Website Status:</strong> ${evt.active ? '<span style="color: #2D5832; font-weight: 700;">Published</span>' : '<span style="color: #888;">Draft / Hidden</span>'}</span>
            </div>
          </div>
        </div>

        <!-- Action Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; pt-12px; border-top: 1px solid rgba(0,0,0,0.06); padding-top: 14px; margin-top: 8px;">
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-small" onclick="toggleEventStatus('${escapeAdminHtml(evt.id)}')" style="background: #F3F4F6; color: #374151; font-weight: 600;">
              ${isOpen ? 'Close Orders' : 'Open Orders'}
            </button>
            <button type="button" class="btn-small" onclick="viewEventOrders('${escapeAdminHtml(evt.id)}')" style="background: rgba(31,58,46,0.08); color: var(--forest, #1F3A2E); font-weight: 600;">
              Orders
            </button>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-small" onclick="editEventById('${escapeAdminHtml(evt.id)}')" style="background: var(--forest, #1F3A2E); color: #fff;">
              Edit
            </button>
            <button type="button" class="btn-small" onclick="deleteEventById('${escapeAdminHtml(evt.id)}')" style="background: rgba(198,93,59,0.1); color: #C65D3B; border: none;" title="Delete Event">
              🗑️
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

window.deleteEventById = function(eventId) {
  const event = cachedEvents.find(e => e.id === eventId);
  const name = event ? event.name : "this event";
  if (confirm(`Are you sure you want to delete "${name}"?`)) {
    cachedEvents = cachedEvents.filter(e => e.id !== eventId);
    saveStoredLocalEvents(cachedEvents);
    renderEventsList(cachedEvents);
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
