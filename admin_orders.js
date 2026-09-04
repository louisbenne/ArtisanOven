      let cachedOrders = [];
      let searchDebounceTimer = null;
      
      const tabButtons = document.querySelectorAll('.admin-tab');
      const tabContents = document.querySelectorAll('.tab-content');
      const btnTabOrders = document.getElementById('btn-tab-orders');
      
      tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          tabButtons.forEach(b => b.classList.remove('active'));
          tabContents.forEach(c => c.classList.remove('active'));
          
          btn.classList.add('active');
          document.getElementById(btn.dataset.tab).classList.add('active');
        });
      });

      btnTabOrders.addEventListener('click', () => {
        loadOrdersData();
      });

      const searchInput = document.getElementById('orders-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => {
            renderOrders(cachedOrders);
          }, 120);
        });
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

      async function loadOrdersData(silent = false) {
        if (!currentAdminToken) return;
        
        try {
          if (!silent) {
            document.getElementById('orders-list-container').innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px 0;">Loading orders...</p>';
          }

          const apiUrl = (typeof ORDER_API_URL !== 'undefined') ? ORDER_API_URL : (window.ORDER_API_URL || "");
          const response = await fetch(apiUrl + "?action=adminGetOrders&token=" + encodeURIComponent(currentAdminToken));
          const data = await response.json();
          
          if (data.unauthorized) {
            sessionStorage.removeItem(STORAGE_KEY_TOKEN);
            currentAdminToken = "";
            showLoginView();
            showLoginError(data.message || "Session expired.");
            return;
          }

          if (data.success && data.orders) {
            cachedOrders = data.orders;
            renderOrders(cachedOrders);
          } else {
            document.getElementById('orders-list-container').innerHTML = `<p style="color: var(--terracotta); text-align: center; padding: 40px 0;">${escapeAdminHtml(data.message) || "Failed to load orders."}</p>`;
          }
        } catch (err) {
          console.warn("Orders load note:", err.message || err);
          document.getElementById('orders-list-container').innerHTML = '<p style="color: var(--terracotta); text-align: center; padding: 40px 0;">Connection error fetching orders.</p>';
        }
      }

      function renderOrders(orders) {
        const container = document.getElementById('orders-list-container');
        const searchTerm = (document.getElementById('orders-search-input').value || "").toLowerCase();
        
        let totalOrders = 0;
        let totalPizzas = 0;
        let pendingCount = 0;
        let paidCount = 0;

        let filtered = orders.filter(o => {
          const matchString = `${o.orderId} ${o.customer?.name || ''} ${o.customer?.email || ''} ${(o.pizzas || []).map(p => p.recipient).join(' ')}`.toLowerCase();
          return matchString.includes(searchTerm);
        });

        // Compute stats from all orders
        orders.forEach(o => {
          totalOrders++;
          totalPizzas += (o.pizzas ? o.pizzas.length : 0);
          if (o.paymentStatus === 'Paid') paidCount++;
          else pendingCount++;
        });

        document.getElementById('stat-total-orders').textContent = totalOrders;
        document.getElementById('stat-total-pizzas').textContent = totalPizzas;
        document.getElementById('stat-pending-payment').textContent = pendingCount;
        document.getElementById('stat-paid-payment').textContent = paidCount;

        if (filtered.length === 0) {
          container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px 0;">No orders found.</p>';
          return;
        }

        let html = '';
        filtered.forEach(order => {
          const statusClass = order.paymentStatus === 'Paid' ? 'paid' : 'pending';
          
          let pizzasHtml = '';
          (order.pizzas || []).forEach(p => {
            pizzasHtml += `
              <div class="order-pizza-item">
                <div class="order-pizza-recipient">${escapeAdminHtml(p.recipient)} ${p.class ? `(${escapeAdminHtml(p.class)})` : ''}</div>
                <div class="order-pizza-meta">
                  <span>${escapeAdminHtml(p.size)}</span>
                  <span>£${(Number(p.price) || 0).toFixed(2)}</span>
                </div>
              </div>
            `;
          });

          const orderIdDisplay = escapeAdminHtml(String(order.orderId || ''));
          const customerNameDisplay = escapeAdminHtml(order.customer?.name || '');
          const customerEmailDisplay = escapeAdminHtml(order.customer?.email || '');
          const totalFormatted = (Number(order.total) || 0).toFixed(2);
          const pizzaCount = order.pizzas ? order.pizzas.length : 0;

          html += `
            <div class="order-card" onclick="this.classList.toggle('expanded')">
              <div class="order-card-header">
                <div>
                  <div class="order-card-title">Order #${orderIdDisplay}</div>
                  <div class="order-card-customer">${customerNameDisplay}</div>
                  <div class="order-card-email">${customerEmailDisplay}</div>
                </div>
                <div class="order-card-status ${statusClass}">${escapeAdminHtml(order.paymentStatus)}</div>
              </div>
              <div class="order-card-summary">
                <span>${pizzaCount} pizza${pizzaCount === 1 ? '' : 's'}</span>
                <span style="font-weight: 700;">Total: £${totalFormatted}</span>
              </div>
              
              <div class="order-card-details">
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">Ordered: ${escapeAdminHtml(order.timestamp || '')}</div>
                ${order.allergy ? `<div style="background: #fff3cd; color: #856404; padding: 8px; border-radius: 4px; font-size: 0.85rem; margin-bottom: 12px; font-weight: 600;">Allergy Info: ${escapeAdminHtml(order.allergy)}</div>` : ''}
                ${pizzasHtml}
                <div class="order-card-total">
                  <span>Total</span>
                  <span>£${totalFormatted}</span>
                </div>
              </div>
            </div>
          `;
        });

        container.innerHTML = html;
      }
