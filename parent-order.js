(function () {
  const PARENT_TOKEN_KEY = 'AO_PARENT_SESSION_TOKEN';
  const SIZE_PRICES = {
    '12inch': 8,
    'Half12inch': 5,
    'Quarter12inch': 3
  };
  const PARENT_PROFILES = {
    'lisa-g': {
      name: 'Lisa G',
      email: 'lisa@garrettgirl.com',
      children: [{ name: 'Dylan', className: 'Class 10' }]
    },
    'lorna-b': {
      name: 'Lorna B',
      email: 'lornajbouwer@hotmail.com',
      children: [
        { name: 'Orlando', className: 'Class 5' },
        { name: 'Leon', className: 'Class 10' }
      ]
    }
  };

  function getScriptApiUrl() {
    if (typeof window.ORDER_API_URL !== 'undefined' && window.ORDER_API_URL) return window.ORDER_API_URL;
    if (typeof ORDER_API_URL !== 'undefined' && ORDER_API_URL) return ORDER_API_URL;
    return '';
  }

  function showScreen(id) {
    document.getElementById('parent-access-screen').style.display = id === 'access' ? 'block' : 'none';
    document.getElementById('parent-order-screen').style.display = id === 'order' ? 'block' : 'none';
    document.getElementById('parent-success-screen').style.display = id === 'success' ? 'block' : 'none';
  }

  function setError(message) {
    const errorEl = document.getElementById('parent-access-error');
    if (!errorEl) return;
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  function pizzaOptions() {
    return `
      <option value="12inch">Whole Margherita (12")</option>
      <option value="Half12inch">Half Margherita</option>
      <option value="Quarter12inch">Quarter Margherita</option>
    `;
  }

  function addChildRow(child = {}) {
    const container = document.getElementById('parent-pizza-rows');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'pizza-item-row';
    row.innerHTML = `
      <div>
        <label>Child name *</label>
        <input class="child-name-input admin-input" type="text" required placeholder="e.g. Orlando" value="${child.name || ''}" />
      </div>
      <div>
        <label>Class *</label>
        <input class="child-class-input admin-input" type="text" required placeholder="e.g. Class 5" value="${child.className || ''}" />
      </div>
      <div>
        <label>Pizza size *</label>
        <select class="pizza-size-select admin-input">${pizzaOptions()}</select>
      </div>
      <div>
        <label>Subtotal</label>
        <div class="pizza-row-subtotal">£8.00</div>
      </div>
      <div>
        <button type="button" class="remove-pizza-btn" aria-label="Remove pizza">×</button>
      </div>
    `;

    const removeBtn = row.querySelector('.remove-pizza-btn');
    removeBtn.addEventListener('click', () => {
      if (container.querySelectorAll('.pizza-item-row').length > 1) {
        row.remove();
        updateTotals();
      }
    });

    row.querySelector('.pizza-size-select').addEventListener('change', updateTotals);
    row.querySelector('.child-name-input').addEventListener('input', updateTotals);
    row.querySelector('.child-class-input').addEventListener('input', updateTotals);
    container.appendChild(row);
    updateTotals();
  }

  function updateTotals() {
    const rows = document.querySelectorAll('.pizza-item-row');
    let total = 0;

    rows.forEach((row) => {
      const size = row.querySelector('.pizza-size-select')?.value || '12inch';
      const unitPrice = SIZE_PRICES[size] || 0;
      const subtotal = unitPrice;
      total += subtotal;
      row.querySelector('.pizza-row-subtotal').textContent = '£' + subtotal.toFixed(2);
    });

    const discount = total * 0.5;
    const finalTotal = total - discount;
    const originalTotalEl = document.getElementById('parent-order-original-total');
    const discountEl = document.getElementById('parent-order-discount');
    const totalEl = document.getElementById('parent-order-total');
    if (originalTotalEl) originalTotalEl.textContent = '£' + total.toFixed(2);
    if (discountEl) discountEl.textContent = '-£' + discount.toFixed(2);
    if (totalEl) totalEl.textContent = '£' + finalTotal.toFixed(2);
  }

  function updateParentProfile() {
    const profileSelect = document.getElementById('parent-profile');
    const profile = PARENT_PROFILES[profileSelect?.value];
    const nameInput = document.getElementById('parent-name');
    const emailInput = document.getElementById('parent-email');
    if (!nameInput || !emailInput) return;
    nameInput.value = profile ? profile.name : '';
    emailInput.value = profile ? profile.email : '';
    const container = document.getElementById('parent-pizza-rows');
    if (container) {
      container.innerHTML = '';
      (profile?.children || [{}]).forEach((child) => addChildRow(child));
    }
  }

  function initOrderForm() {
    const profileSelect = document.getElementById('parent-profile');
    if (profileSelect) profileSelect.addEventListener('change', updateParentProfile);

    const addButton = document.getElementById('parent-add-child-btn');
    if (addButton) {
      addButton.addEventListener('click', () => addChildRow());
    }

    const initialRow = document.querySelector('.pizza-item-row');
    if (initialRow) {
      initialRow.querySelector('.pizza-size-select').addEventListener('change', updateTotals);
      initialRow.querySelector('.child-name-input').addEventListener('input', updateTotals);
      initialRow.querySelector('.child-class-input').addEventListener('input', updateTotals);
      initialRow.querySelector('.remove-pizza-btn').addEventListener('click', () => {
        const rows = document.querySelectorAll('.pizza-item-row');
        if (rows.length > 1) {
          initialRow.remove();
          updateTotals();
        }
      });
    }

    updateTotals();
  }

  function showOrderForm() {
    showScreen('order');
    const accessCodeInput = document.getElementById('parent-access-code');
    if (accessCodeInput) accessCodeInput.value = '';
    setError('');
  }

  function showSuccess(data) {
    const successEl = document.getElementById('parent-success-content');
    if (successEl && data) {
      successEl.innerHTML = `
        <div class="success-icon">✓</div>
        <h2>Order placed successfully</h2>
        <p>Your parent order has been received.</p>
        <div class="success-summary">
          <div><span>Order #</span><strong>${data.orderId || '—'}</strong></div>
          <div><span>Original total</span><strong>£${Number(data.originalTotal || 0).toFixed(2)}</strong></div>
          <div><span>Internal discount</span><strong>-£${Number(data.discountAmount || 0).toFixed(2)}</strong></div>
          <div><span>Final total</span><strong>£${Number(data.finalTotal || 0).toFixed(2)}</strong></div>
        </div>
      `;
    }
    showScreen('success');
  }

  async function handleParentAccess(event) {
    event.preventDefault();
    const codeInput = document.getElementById('parent-access-code');
    const code = (codeInput && codeInput.value || '').trim();
    const apiUrl = getScriptApiUrl();

    if (!apiUrl) {
      setError('Google Apps Script URL is not configured for this page.');
      return;
    }

    const submitBtn = document.getElementById('parent-access-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Checking...';
    }

    try {
      const url = new URL(apiUrl);
      url.searchParams.set('action', 'parentAuth');
      url.searchParams.set('code', code);

      const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
      const data = await response.json();

      if (!data || !data.success || !data.token) {
        setError(data && data.message ? data.message : 'Access denied. Please check your code and try again.');
        return;
      }

      sessionStorage.setItem(PARENT_TOKEN_KEY, data.token);
      showOrderForm();
    } catch (error) {
      setError('Unable to verify the access code. Please try again.');
      console.error('Parent access error:', error);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue';
      }
    }
  }

  async function handleParentOrderSubmit(event) {
    event.preventDefault();
    const apiUrl = getScriptApiUrl();
    const token = sessionStorage.getItem(PARENT_TOKEN_KEY);
    if (!apiUrl || !token) {
      showScreen('access');
      setError('Your access session has expired. Please enter the parent access code again.');
      return;
    }

    const itemsBySize = {};
    const childNames = [];
    const childClasses = [];
    let incompleteChild = false;
    document.querySelectorAll('.pizza-item-row').forEach((row) => {
      const size = row.querySelector('.pizza-size-select')?.value;
      const childName = row.querySelector('.child-name-input')?.value.trim();
      const childClass = row.querySelector('.child-class-input')?.value.trim();
      if (size && childName && childClass) {
        itemsBySize[size] = (itemsBySize[size] || 0) + 1;
        childNames.push(childName);
        childClasses.push(childClass);
      } else {
        incompleteChild = true;
      }
    });
    const items = Object.entries(itemsBySize).map(([size, qty]) => ({ size, qty }));

    if (incompleteChild || !items.length) {
      alert('Please complete each child name, class and pizza selection before submitting.');
      return;
    }

    const payload = {
      token,
      parentName: document.getElementById('parent-name').value.trim(),
      parentEmail: document.getElementById('parent-email').value.trim(),
      childName: childNames.join(', '),
      childClass: childClasses.join(', '),
      paymentMethod: document.getElementById('parent-payment-method').value,
      notes: document.getElementById('parent-notes').value.trim(),
      items: JSON.stringify(items)
    };

    if (!payload.parentName || !payload.parentEmail || !payload.childName || !payload.childClass) {
      alert('Please fill in all required parent and child details before submitting your order.');
      return;
    }

    const submitBtn = document.getElementById('parent-submit-order');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    try {
      const url = new URL(apiUrl);
      url.searchParams.set('action', 'createParentOrder');
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, value);
      });

      const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
      const data = await response.json();

      if (!data || !data.success) {
        alert(data && data.message ? data.message : 'Your parent order could not be submitted.');
        return;
      }

      showSuccess(data);
    } catch (error) {
      console.error('Parent order submit error:', error);
      alert('There was a problem submitting your order. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place parent order';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const accessForm = document.getElementById('parent-access-form');
    const orderForm = document.getElementById('parent-order-form');

    if (accessForm) accessForm.addEventListener('submit', handleParentAccess);
    if (orderForm) orderForm.addEventListener('submit', handleParentOrderSubmit);

    const hasToken = !!sessionStorage.getItem(PARENT_TOKEN_KEY);
    if (hasToken) {
      showOrderForm();
    } else {
      showScreen('access');
    }

    initOrderForm();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./parent-sw.js').catch(() => {});
    }
  });
})();
