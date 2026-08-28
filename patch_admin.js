        <!-- Top Overview Header & Quick Refresh -->
        <div class="dashboard-topbar">
          <div>
            <h1 class="dashboard-heading">Operational Control Center</h1>
            <p class="dashboard-subheading" id="dashboard-last-updated">Connecting to backend...</p>
          </div>
          <div class="dashboard-actions">
            <button type="button" id="btn-refresh-data" class="admin-secondary-btn" title="Refresh latest data">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div class="admin-tabs">
          <button type="button" class="admin-tab active" data-tab="tab-dashboard">Dashboard & Settings</button>
          <button type="button" class="admin-tab" data-tab="tab-orders" id="btn-tab-orders">Orders</button>
        </div>

        <div id="tab-dashboard" class="tab-content active">
