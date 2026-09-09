(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const COMPLETE_PREFIX = 'AO_KITCHEN_COMPLETE::';
  const DATA_KEY = 'AO_KITCHEN_DATA';
  const TOKEN_KEY = 'AO_KITCHEN_TOKEN';
  const META_KEY = 'AO_KITCHEN_META';

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalise(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function paymentIcon(method) {
    const value = text(method).toLowerCase();
    if (value.includes('paypal')) return '🅿️';
    if (value.includes('bank')) return '🏦';
    if (value.includes('cash')) return '💵';
    return '📝';
  }

  function classInfo(value) {
    const match = text(value).match(/^Class\s*(\d+)$/i);
    return match ? { name: `Class ${Number(match[1])}`, number: Number(match[1]) } : { name: 'Misc', number: null };
  }

  function isDateValue(value) {
    return Object.prototype.toString.call(value) === '[object Date]' ||
      (value && typeof value === 'object' && value.t === 'd');
  }

  function findHeader(row) {
    const names = row.map(normalise);
    const required = ['order id', 'pizza item id', 'child name', 'class', 'size'];
    return required.every((name) => names.includes(name)) ? names : null;
  }

  function findSheetRows(workbook) {
    const sheets = workbook && workbook.Sheets ? workbook.Sheets : {};
    const firstSheet = workbook && workbook.SheetNames && workbook.SheetNames[0];
    if (!firstSheet || !sheets[firstSheet]) throw new Error('The workbook does not contain a readable sheet.');
    if (!root.XLSX || !root.XLSX.utils || !root.XLSX.utils.sheet_to_json) {
      throw new Error('The spreadsheet parser is unavailable. Reload the page and try again.');
    }
    return root.XLSX.utils.sheet_to_json(sheets[firstSheet], { header: 1, raw: true, defval: '' });
  }

  function parseWorkbook(workbook) {
    const rows = findSheetRows(workbook);
    let sessionTitle = '';
    const items = [];

    rows.forEach((row) => {
      const first = text(row[0]);
      const sessionMatch = first.match(/^CURRENT ACTIVE SESSION:\s*(.+)$/i);
      if (sessionMatch && !sessionTitle) sessionTitle = sessionMatch[1].trim();
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (normalise(rows[rowIndex][0]) !== 'pizza orders') continue;

      let headerIndex = rowIndex + 1;
      while (headerIndex < rows.length && rows[headerIndex].every((cell) => text(cell) === '')) headerIndex += 1;
      const headers = headerIndex < rows.length ? findHeader(rows[headerIndex]) : null;
      if (!headers) continue;
      const columns = Object.fromEntries(headers.map((name, index) => [name, index]));

      for (let dataIndex = headerIndex + 1; dataIndex < rows.length; dataIndex += 1) {
        const row = rows[dataIndex];
        if (!row || row.every((cell) => text(cell) === '')) continue;
        if (normalise(row[0]) === 'pizza orders' || normalise(row[0]) === 'order summary' ||
            normalise(row[0]) === 'internal parent orders') break;

        const orderId = text(row[columns['order id']]);
        const itemId = text(row[columns['pizza item id']]);
        const childName = text(row[columns['child name']]);
        if (!orderId || !itemId || !childName) continue;

        const literalPickup = row[columns['pickup id']];
        const reconstructed = `${orderId}-${itemId}`;
        const pickupId = reconstructed || (!isDateValue(literalPickup) ? text(literalPickup) : '');
        if (!pickupId) continue;
        const classData = classInfo(row[columns.class]);
        const paymentMethod = text(row[columns['payment method']]);
        const allergyFlag = text(row[columns['allergy flag']]).toLowerCase() === 'yes';

        items.push({
          pickupId,
          orderId,
          childName,
          className: classData.name,
          classNumber: classData.number,
          size: text(row[columns.size]),
          paymentMethod,
          paymentIcon: paymentIcon(paymentMethod),
          paid: text(row[columns.paid]),
          allergyFlag,
          allergyDetails: text(row[columns['allergy details']]),
          payerName: text(row[columns['payer name']])
        });
      }
    }

    const deduped = Array.from(new Map(items.map((item) => [item.pickupId, item])).values());
    if (!sessionTitle) throw new Error('No active session title was found in the workbook.');
    if (!deduped.length) throw new Error('No PIZZA ORDERS tables with usable pizza items were found.');
    return { sessionTitle, items: deduped };
  }

  function storageGet(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      console.warn('Kitchen storage read failed:', error);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Kitchen storage write failed:', error);
    }
  }

  function apiUrl() {
    return typeof ORDER_API_URL !== 'undefined' ? ORDER_API_URL : (root.ORDER_API_URL || '');
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    const screens = { gate: $('kitchen-gate'), board: $('kitchen-board') };
    let current = storageGet(DATA_KEY, null);
    let meta = storageGet(META_KEY, {});
    let completed = new Set();
    let filter = 'all';
    let sort = 'class';
    let selected = null;
    let timerHandle = null;

    function show(id) {
      Object.values(screens).forEach((screen) => { if (screen) screen.hidden = screen !== screens[id]; });
    }

    function setGateError(message) {
      $('kitchen-gate-error').textContent = message || '';
      $('kitchen-gate-error').hidden = !message;
    }

    function loadSessionState(sessionTitle) {
      completed = new Set(storageGet(COMPLETE_PREFIX + sessionTitle, []));
      meta = storageGet(META_KEY, {});
      if (meta.sessionTitle !== sessionTitle) meta = { sessionTitle };
    }

    function saveSessionState() {
      if (!current) return;
      storageSet(COMPLETE_PREFIX + current.sessionTitle, Array.from(completed));
      storageSet(DATA_KEY, current);
      storageSet(META_KEY, meta);
    }

    function updateTimer() {
      const timer = $('kitchen-timer');
      if (!timer) return;
      if (!meta.cutoff) {
        timer.textContent = '⏱ Set cutoff';
        timer.className = 'kitchen-timer';
        return;
      }
      const remaining = new Date(meta.cutoff).getTime() - Date.now();
      const seconds = Math.max(0, Math.floor(remaining / 1000));
      const minutes = Math.floor(seconds / 60);
      timer.textContent = `⏱ ${minutes}:${String(seconds % 60).padStart(2, '0')} left`;
      timer.className = `kitchen-timer${seconds < 120 ? ' is-danger' : seconds < 600 ? ' is-warning' : ''}`;
    }

    function render() {
      if (!current) {
        $('kitchen-list').innerHTML = '';
        $('kitchen-progress').textContent = '0 / 0 pizzas ready';
        $('kitchen-session').textContent = 'No data uploaded yet';
        $('kitchen-empty').hidden = false;
        return;
      }
      const list = $('kitchen-list');
      const visible = current.items.filter((item) => filter === 'all' ||
        (filter === 'complete' ? completed.has(item.pickupId) : !completed.has(item.pickupId)));
      visible.sort((a, b) => sort === 'class'
        ? ((a.classNumber ?? 99) - (b.classNumber ?? 99)) || a.childName.localeCompare(b.childName)
        : a.pickupId.localeCompare(b.pickupId, undefined, { numeric: true }));
      list.innerHTML = visible.map((item) => {
        const done = completed.has(item.pickupId);
        return `<button class="kitchen-item${done ? ' is-complete' : ''}" data-pickup-id="${encodeURIComponent(item.pickupId)}">
          <span class="kitchen-item-main"><strong>${escapeHtml(item.childName)}</strong><span>${escapeHtml(item.className)} · ${escapeHtml(item.size)}</span></span>
          <span class="kitchen-item-meta"><span title="${escapeHtml(item.paymentMethod || 'Other')}">${item.paymentIcon}</span>${item.allergyFlag ? '<span class="allergy-badge" title="Allergy information available">⚠️</span>' : ''}<span class="item-check">${done ? '✓' : '○'}</span></span>
        </button>`;
      }).join('');
      $('kitchen-empty').hidden = visible.length > 0;
      const doneCount = current.items.filter((item) => completed.has(item.pickupId)).length;
      $('kitchen-progress').textContent = `${doneCount} / ${current.items.length} pizzas ready`;
      $('kitchen-session').textContent = current.sessionTitle;
      document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('is-active', button.dataset.filter === filter));
      document.querySelectorAll('[data-sort]').forEach((button) => button.classList.toggle('is-active', button.dataset.sort === sort));
    }

    function showDetail(item) {
      selected = item;
      $('kitchen-detail-content').innerHTML = `<p class="detail-kicker">${escapeHtml(item.pickupId)} · ${escapeHtml(item.className)}</p>
        <h2>${escapeHtml(item.childName)}</h2><p class="detail-size">${escapeHtml(item.size)}</p>
        ${item.allergyFlag ? `<div class="detail-allergy">⚠️ ${escapeHtml(item.allergyDetails || 'Allergy information supplied')}</div>` : ''}
        <button id="kitchen-complete" class="complete-btn">${completed.has(item.pickupId) ? 'UNDO COMPLETE' : 'ORDER COMPLETE'}</button>
        <details><summary>More info</summary><dl><dt>Payer</dt><dd>${escapeHtml(item.payerName || '—')}</dd><dt>Payment</dt><dd>${escapeHtml(item.paymentMethod || 'Other')} (${escapeHtml(item.paid || 'Unknown')})</dd><dt>Order ID</dt><dd>${escapeHtml(item.orderId)}</dd>${item.allergyFlag ? `<dt>Allergy details</dt><dd>${escapeHtml(item.allergyDetails || '—')}</dd>` : ''}</dl></details>`;
      $('kitchen-detail').hidden = false;
      $('kitchen-complete').addEventListener('click', () => {
        if (completed.has(item.pickupId)) completed.delete(item.pickupId); else completed.add(item.pickupId);
        saveSessionState();
        $('kitchen-detail').hidden = true;
        render();
      });
    }

    function escapeHtml(value) {
      return text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    }

    async function login(event) {
      event.preventDefault();
      const password = $('kitchen-password').value.trim();
      const url = apiUrl();
      if (!url) { setGateError('Backend URL is not configured. Use offline access to continue.'); return; }
      const button = $('kitchen-login');
      button.disabled = true;
      try {
        const loginUrl = new URL(url);
        loginUrl.searchParams.set('action', 'adminLogin');
        loginUrl.searchParams.set('code', password);
        const response = await fetch(loginUrl.toString(), { mode: 'cors' });
        const data = await response.json();
        if (!data.success || !data.token) throw new Error(data.message || 'Access denied.');
        localStorage.setItem(TOKEN_KEY, data.token);
        show('board');
        render();
      } catch (error) {
        setGateError(error.message || 'Unable to verify access. Use offline access if the network is unavailable.');
      } finally {
        button.disabled = false;
      }
    }

    function handleUpload(event) {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (!/\.xlsx$/i.test(file.name)) { $('kitchen-error').textContent = 'Please choose an .xlsx export file.'; $('kitchen-error').hidden = false; return; }
      file.arrayBuffer().then((buffer) => {
        const next = parseWorkbook(XLSX.read(buffer, { type: 'array', cellDates: true }));
        if (current && current.sessionTitle !== next.sessionTitle &&
            !root.confirm(`This looks like a new session (${next.sessionTitle}). Start a fresh board?`)) return;
        current = next;
        loadSessionState(current.sessionTitle);
        saveSessionState();
        $('kitchen-error').hidden = true;
        render();
      }).catch((error) => { $('kitchen-error').textContent = error.message || 'Could not parse this workbook.'; $('kitchen-error').hidden = false; });
    }

    $('kitchen-login-form').addEventListener('submit', login);
    $('kitchen-offline').addEventListener('click', () => { localStorage.setItem(TOKEN_KEY, 'offline'); show('board'); render(); });
    $('kitchen-upload').addEventListener('change', handleUpload);
    $('kitchen-upload-empty').addEventListener('click', () => $('kitchen-upload').click());
    $('kitchen-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-pickup-id]');
      if (button && current) showDetail(current.items.find((item) => item.pickupId === decodeURIComponent(button.dataset.pickupId)));
    });
    $('kitchen-detail-close').addEventListener('click', () => { $('kitchen-detail').hidden = true; });
    document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
    document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { sort = button.dataset.sort; render(); }));
    $('kitchen-timer').addEventListener('click', () => {
      const value = root.prompt('Set today’s cutoff time (HH:MM):', meta.cutoff ? new Date(meta.cutoff).toTimeString().slice(0, 5) : '');
      if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return;
      const [hours, minutes] = value.split(':').map(Number);
      const cutoff = new Date();
      cutoff.setHours(hours, minutes, 0, 0);
      meta.cutoff = cutoff.toISOString();
      saveSessionState();
      updateTimer();
    });

    if (current) {
      loadSessionState(current.sessionTitle);
      if (localStorage.getItem(TOKEN_KEY)) {
        show('board');
        render();
      } else {
        show('gate');
      }
    } else show('gate');
    updateTimer();
    timerHandle = window.setInterval(updateTimer, 1000);
    window.addEventListener('beforeunload', () => window.clearInterval(timerHandle));
  }

  root.KitchenBoard = { parseWorkbook, paymentIcon, classInfo };
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
}());
