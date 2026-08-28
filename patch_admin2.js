        </div> <!-- End tab-dashboard -->

        <div id="tab-orders" class="tab-content">
          <div class="orders-summary-bar" id="orders-summary-bar">
            <div class="order-summary-stat">
              <span class="stat-label">Total Orders</span>
              <span class="stat-value" id="stat-total-orders">-</span>
            </div>
            <div class="order-summary-stat">
              <span class="stat-label">Total Pizzas</span>
              <span class="stat-value" id="stat-total-pizzas">-</span>
            </div>
            <div class="order-summary-stat">
              <span class="stat-label">Pending Payment</span>
              <span class="stat-value" id="stat-pending-payment">-</span>
            </div>
            <div class="order-summary-stat">
              <span class="stat-label">Paid</span>
              <span class="stat-value" id="stat-paid-payment">-</span>
            </div>
          </div>
          
          <div class="orders-search-bar">
            <input type="text" id="orders-search-input" placeholder="Search orders by customer name, email, or recipient..." />
          </div>

          <div id="orders-list-container">
            <p style="color: var(--text-secondary); text-align: center; padding: 40px 0;">Loading orders...</p>
          </div>
        </div>

        <!-- Logout Footer Box -->
