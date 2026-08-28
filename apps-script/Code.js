// ============================================================================
// ARTISAN OVEN — Operational Backend, Public API & Admin System
// ============================================================================

// ====== CORE DEFAULTS & CONFIGURATION ======
var YOUR_EMAIL = 'louis@benne.co.uk';
var EMAIL_SUBJECT = 'Pizza Order Update';
var CONFIRMATION_SUBJECT = 'Your Pizza Order Confirmation & Payment Details';
var PAYPAL_ME_BASE = 'https://paypal.me/ArtisanOven';
var PAYPAL_NCP_LINK = 'https://www.paypal.com/ncp/payment/LXZKSSG3QEFJA';

// Default Admin Password (can be customized via Admin Dashboard or Script Properties)
var DEFAULT_ADMIN_PASSWORD = 'ArtisanOvenAdmin2026!';

// Canonical payment mappings
var PAYMENT_MAP = {
  'Bank Transfer': 'BankTransfer',
  'BankTransfer': 'BankTransfer',
  'Paypal': 'Paypal',
  'PayPal': 'Paypal',
  'Cash Via child at luch-time pickup': 'Cash',
  'Cash': 'Cash'
};

// Legacy dropdown mapping (fallback)
var SIZE_MAP = {
  'Whole 12-inch pizza — £8': '12inch',
  'Half a 12-inch pizza — £5': 'Half12inch',
  'Quarter of a 12-inch pizza — £3': 'Quarter12inch'
};

// Price per pizza size
var PRICE_MAP = {
  '12inch': 8,
  'Half12inch': 5,
  'Quarter12inch': 3
};

// Column index (0-based) blocks for each "how many pizzas" branch: [sizeCol, nameCol, classCol]
var BRANCHES = {
  '1': [[4, 5, 6]],
  '2': [[43, 44, 45], [46, 47, 48]],
  '3': [[7, 8, 9], [10, 11, 12], [13, 14, 15]],
  '4': [[31, 32, 33], [34, 35, 36], [37, 38, 39], [40, 41, 42]],
  '5': [[16, 17, 18], [19, 20, 21], [22, 23, 24], [25, 26, 27], [28, 29, 30]]
};

// Hidden column in RAW sheet to record confirmation email status
var CONFIRMATION_SENT_COL = 60;
var ORDER_TOKEN_COL = 61;
var PAYMENT_STATUS_COL = 62;
var IS_DELETED_COL = 63;

// Standard payment info block
var PAYMENT_INFO_BLOCK =
  'PAYMENT INFORMATION\n\n' +
  'Please pay using one of the following three methods:\n\n' +
  'BANK TRANSFER\n\n' +
  'Account Name: Louis Benne\n' +
  'Sort Code: 07-09-76\n' +
  'Account Number: 11427310\n\n' +
  'OR by using the order number on our website\n\n' +
  'https://www.artisanoven.shop\n\n' +
  'PAYPAL\n\n' +
  'paypal.me/ArtisanOven\n\n' +
  'Alternatively, you can pay securely using the following payment link:\n\n' +
  'paypal.com/ncp/payment/LXZKSSG3QEFJA\n\n' +
  'OR\n\n' +
  'CASH\n\n' +
  'Cash payments may be sent with your child. \n' +
  'Please ensure that the exact amount is provided, as we are unable to give change.';

// ============================================================================
// SETTINGS STORAGE & RETRIEVAL (ScriptProperties + Admin_Settings Sheet)
// ============================================================================

function getDefaultSettings() {
  return {
    serviceDate: 'Tuesday 15th September 2026',
    serviceTitle: 'Tuesday 15th Sept Availability',
    serviceNoticeDate: 'Tuesday Lunchtime — starting 15th of August',
    maxPizzas: 20,
    orderingEnabled: true,
    autoCloseEnabled: true,
    autoCloseDay: 'Sunday',
    autoCloseTime: '21:00',
    capacityMessage: 'We have a limited number of orders while we gauge our capacity. Once we get into full swing, we’ll be able to open up to more orders.',
    deadlineMessage: 'Orders will close at 9:00 PM on Sunday evenings, giving us time to prepare for Tuesday.',
    fullyBookedMessage: "We're fully booked for this session. Please check back next time.",
    sessionStartRow: 2,
    sessionId: 'session_init',
    sessionStartDate: new Date().toISOString()
  };
}

function getSettings() {
  var props = PropertiesService.getScriptProperties();
  var rawJson = props.getProperty('ARTISAN_SETTINGS');
  var defaults = getDefaultSettings();
  
  if (!rawJson) {
    props.setProperty('ARTISAN_SETTINGS', JSON.stringify(defaults));
    return defaults;
  }
  
  try {
    var parsed = JSON.parse(rawJson);
    for (var key in defaults) {
      if (parsed[key] === undefined) {
        parsed[key] = defaults[key];
      }
    }
    return parsed;
  } catch (err) {
    Logger.log('Error parsing settings JSON: ' + err);
    return defaults;
  }
}

function saveSettings(newSettings) {
  var current = getSettings();
  for (var k in newSettings) {
    if (newSettings[k] !== undefined) {
      current[k] = newSettings[k];
    }
  }
  PropertiesService.getScriptProperties().setProperty('ARTISAN_SETTINGS', JSON.stringify(current));
  syncSettingsToSheet(current);
  return current;
}

function syncSettingsToSheet(settings) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Admin_Settings');
    if (!sheet) {
      sheet = ss.insertSheet('Admin_Settings');
    }
    sheet.clear();
    
    var rows = [
      ['SETTING KEY', 'VALUE', 'LAST UPDATED'],
      ['Service Date', settings.serviceDate, new Date()],
      ['Service Title', settings.serviceTitle, new Date()],
      ['Service Notice Date', settings.serviceNoticeDate, new Date()],
      ['Max Pizzas Limit', settings.maxPizzas, new Date()],
      ['Ordering Status (Manual)', settings.orderingEnabled ? 'OPEN' : 'CLOSED', new Date()],
      ['Auto-Close Enabled', settings.autoCloseEnabled ? 'YES' : 'NO', new Date()],
      ['Auto-Close Schedule', settings.autoCloseDay + ' at ' + settings.autoCloseTime, new Date()],
      ['Capacity Disclaimer', settings.capacityMessage, new Date()],
      ['Deadline Message', settings.deadlineMessage, new Date()],
      ['Fully Booked Message', settings.fullyBookedMessage, new Date()],
      ['Current Session ID', settings.sessionId, new Date()],
      ['Session Start Row', settings.sessionStartRow, new Date()],
      ['Session Start Timestamp', settings.sessionStartDate, new Date()]
    ];
    
    sheet.getRange(1, 1, rows.length, 3).setValues(rows);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#E8E8E8');
    sheet.autoResizeColumns(1, 3);
  } catch (e) {
    Logger.log('Error syncing settings to sheet: ' + e);
  }
}

// ============================================================================
// SECURITY & AUTHENTICATION
// ============================================================================

function getAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('ADMIN_PASSWORD') || DEFAULT_ADMIN_PASSWORD;
}

function setAdminPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', newPassword);
}

function generateAdminToken() {
  var token = 'ao_adm_' + Utilities.getUuid().replace(/-/g, '') + '_' + Date.now();
  var expiry = Date.now() + (8 * 60 * 60 * 1000); // 8 hours validity
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_TOKEN', token);
  props.setProperty('ADMIN_TOKEN_EXPIRY', String(expiry));
  return token;
}

function verifyAdminToken(token) {
  if (!token) return false;
  var props = PropertiesService.getScriptProperties();
  var storedToken = props.getProperty('ADMIN_TOKEN');
  var expiry = parseInt(props.getProperty('ADMIN_TOKEN_EXPIRY') || '0', 10);
  
  if (storedToken && storedToken === token && Date.now() < expiry) {
    return true;
  }
  return false;
}

function invalidateAdminToken() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('ADMIN_TOKEN');
  props.deleteProperty('ADMIN_TOKEN_EXPIRY');
}

// Audit logger
function logAdminAction(action, details) {
  // Speed up log: don't check for sheet existence every time in the login path if possible
  // but for safety we still check. We skip the formatting for speed.
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Admin Log');
    if (!sheet) {
      sheet = ss.insertSheet('Admin Log');
      sheet.appendRow(['Timestamp', 'Action', 'Details', 'Actor']);
    }
    sheet.appendRow([new Date(), action, details || '', 'Admin']);
  } catch (err) {
    Logger.log('Error logging admin action: ' + err);
  }
}

function getAdminLogs() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Admin Log');
    if (!sheet || sheet.getLastRow() < 2) return [];
    var data = sheet.getDataRange().getValues();
    var logs = [];
    for (var i = data.length - 1; i >= 1 && logs.length < 20; i--) {
      var row = data[i];
      logs.push({
        timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Europe/London', 'dd MMM yyyy HH:mm:ss') : String(row[0]),
        action: String(row[1] || ''),
        details: String(row[2] || ''),
        actor: String(row[3] || 'Admin')
      });
    }
    return logs;
  } catch (err) {
    Logger.log('Error reading logs: ' + err);
    return [];
  }
}

// ============================================================================
// AUTOMATIC CLOSING SCHEDULE LOGIC
// ============================================================================

function isPastAutoClosingDeadline(settings) {
  if (!settings.autoCloseEnabled) return false;
  
  try {
    var now = new Date();
    // Format current day of week and 24-hr time in London timezone
    // 'u' gives 1 (Mon) to 7 (Sun)
    var dayOfWeek = parseInt(Utilities.formatDate(now, 'Europe/London', 'u'), 10);
    var hour = parseInt(Utilities.formatDate(now, 'Europe/London', 'HH'), 10);
    var minute = parseInt(Utilities.formatDate(now, 'Europe/London', 'mm'), 10);
    var currentTimeVal = hour * 60 + minute;

    var closeTimeParts = (settings.autoCloseTime || '21:00').split(':');
    var closeHour = parseInt(closeTimeParts[0] || '21', 10);
    var closeMinute = parseInt(closeTimeParts[1] || '0', 10);
    var closeTimeVal = closeHour * 60 + closeMinute;

    // Default target: Sunday (7) after closing time, through Monday (1) all day, until Tuesday (2) 13:00
    // After Tuesday 13:00, ordering naturally opens for next session unless manually locked
    if (dayOfWeek === 7 && currentTimeVal >= closeTimeVal) {
      return true;
    }
    if (dayOfWeek === 1) { // Monday
      return true;
    }
    if (dayOfWeek === 2 && currentTimeVal < (13 * 60)) { // Tuesday morning before lunch
      return true;
    }
  } catch (e) {
    Logger.log('Auto-close calculation error: ' + e);
  }
  return false;
}

// ============================================================================
// WEB APP API ENTRYPOINT (doGet & doPost)
// ============================================================================

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action || 'getOrder';
    var query = safeTrim(params.query || params.email || params.orderId || '');

    // 1. PUBLIC: ORDER LOOKUP
    if (action === 'getOrder') {
      if (!query) {
        return createJsonResponse({
          success: false,
          message: 'Please provide an email address or Order ID to search.'
        });
      }

      var searchToken = safeTrim(params.token || '');
      var result = lookupOrder(query, query, searchToken);
      if (result) {
        return createJsonResponse({
          success: true,
          orderId: result.formattedOrderId,
          customerName: result.payerName,
          email: result.payerEmail,
          paymentMethod: result.paymentMethod,
          paid: result.paid,
          total: result.total,
          totalFormatted: '£' + result.total.toFixed(2),
          order: result.pizzas,
          paypalMeUrl: PAYPAL_ME_BASE + '/' + result.total.toFixed(2),
          paypalNcpUrl: PAYPAL_NCP_LINK
        });
      } else {
        return createJsonResponse({
          success: false,
          message: "We couldn't find your order. Please use the link in your order confirmation email."
        });
      }
    }

    // 2. PUBLIC: LIVE SYSTEM STATUS & CAPACITY
    if (action === 'getStatus') {
      var cache = CacheService.getScriptCache();
      var cached = cache.get('SYSTEM_STATUS_CACHE');
      if (cached && !params._t) { // Skip cache if cache-busting _t is present
        return createJsonResponse(JSON.parse(cached));
      }

      var settings = getSettings();
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) {
        return createJsonResponse({
          success: false,
          message: 'Backend Configuration Error: Spreadsheet not found.'
        });
      }
      
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      var data = raw.getDataRange().getValues();
      
      var startRow = Math.max(1, (parseInt(settings.sessionStartRow, 10) || 2) - 1);
      var totalPizzas = 0;
      var totalOrders = 0;

      for (var r = startRow; r < data.length; r++) {
        var row = data[r];
        if (!row || rowIsBlank(row)) continue;
        if (safeTrim(row[IS_DELETED_COL]) === 'TRUE') continue;

        var stats = calculateRowPizzaStats(row);
        
        totalPizzas += stats.pizzaCapacity;
        if (stats.pizzaSelections > 0) totalOrders++;
      }
      
      totalPizzas = normalizePizzaCapacity(totalPizzas);

      var maxLimit = parseFloat(settings.maxPizzas || 20);
      var remaining = Math.max(0, maxLimit - totalPizzas);
      var isPastDeadline = isPastAutoClosingDeadline(settings);
      var isOpen = (settings.orderingEnabled === true) && !isPastDeadline && (remaining > 0);
      
      var message = "";
      if (settings.orderingEnabled === false) {
        message = "Ordering is currently closed by the administrator.";
      } else if (isPastDeadline) {
        message = "Ordering for this week has closed (" + (settings.autoCloseDay || 'Sunday') + " " + (settings.autoCloseTime || '9:00 PM') + ").";
      } else if (remaining <= 0) {
        message = settings.fullyBookedMessage || "We're fully booked for this session. Please check back next time.";
      } else {
        message = remaining + " pizzas remaining.";
      }

      var responseData = {
        success: true,
        orderingOpen: isOpen,
        orderingEnabled: settings.orderingEnabled,
        isPastDeadline: isPastDeadline,
        currentPizzas: totalPizzas,
        maxPizzas: maxLimit,
        remainingPizzas: remaining,
        currentOrders: totalOrders,
        serviceDate: settings.serviceDate,
        serviceTitle: settings.serviceTitle,
        serviceNoticeDate: settings.serviceNoticeDate,
        capacityMessage: settings.capacityMessage,
        deadlineMessage: settings.deadlineMessage,
        closedMessage: message,
        sessionId: settings.sessionTimestamp || settings.sessionId,
        closingSchedule: (settings.autoCloseDay || 'Sunday') + ' at ' + (settings.autoCloseTime || '9:00 PM')
      };

      // Cache for 2 minutes (120 seconds) to speed up public lookup
      try { cache.put('SYSTEM_STATUS_CACHE', JSON.stringify(responseData), 120); } catch(e) {}

      return createJsonResponse(responseData);
    }

    // 3. ADMIN: LOGIN
    if (action === 'adminLogin') {
      var password = safeTrim(params.password || '');
      if (password && password === getAdminPassword()) {
        var token = generateAdminToken();
        logAdminAction('Admin Login', 'Successful login from web interface');
        return createJsonResponse({
          success: true,
          token: token,
          message: 'Logged in successfully.'
        });
      } else {
        return createJsonResponse({
          success: false,
          message: 'Incorrect password.'
        });
      }
    }

    // 4. ADMIN: GET ALL SETTINGS
    if (action === 'adminGetSettings') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var currentSettings = getSettings();
      var stats = calculateCurrentSessionStats(currentSettings);

      return createJsonResponse({
        success: true,
        settings: currentSettings,
        stats: stats,
        logs: getAdminLogs()
      });
    }

    // 5. ADMIN: UPDATE SETTINGS
    if (action === 'adminGetOrders') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }
      return createJsonResponse({
        success: true,
        orders: getAllOrdersForAdmin()
      });
    }
    if (action === 'adminUpdateSettings') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var payload = {};
      if (params.settingsJson) {
        try {
          payload = JSON.parse(params.settingsJson);
        } catch (e) {
          payload = params;
        }
      } else {
        payload = params;
      }

      var updated = {};
      if (payload.serviceDate !== undefined) updated.serviceDate = safeTrim(payload.serviceDate);
      if (payload.serviceTitle !== undefined) updated.serviceTitle = safeTrim(payload.serviceTitle);
      if (payload.serviceNoticeDate !== undefined) updated.serviceNoticeDate = safeTrim(payload.serviceNoticeDate);
      if (payload.maxPizzas !== undefined) updated.maxPizzas = parseInt(payload.maxPizzas, 10);
      if (payload.orderingEnabled !== undefined) updated.orderingEnabled = (String(payload.orderingEnabled) === 'true' || payload.orderingEnabled === true);
      if (payload.autoCloseEnabled !== undefined) updated.autoCloseEnabled = (String(payload.autoCloseEnabled) === 'true' || payload.autoCloseEnabled === true);
      if (payload.autoCloseDay !== undefined) updated.autoCloseDay = safeTrim(payload.autoCloseDay);
      if (payload.autoCloseTime !== undefined) updated.autoCloseTime = safeTrim(payload.autoCloseTime);
      if (payload.capacityMessage !== undefined) updated.capacityMessage = safeTrim(payload.capacityMessage);
      if (payload.deadlineMessage !== undefined) updated.deadlineMessage = safeTrim(payload.deadlineMessage);
      if (payload.fullyBookedMessage !== undefined) updated.fullyBookedMessage = safeTrim(payload.fullyBookedMessage);

      var newSettings = saveSettings(updated);
      logAdminAction('Settings Updated', JSON.stringify(updated));

      return createJsonResponse({
        success: true,
        message: 'Settings saved successfully.',
        settings: newSettings,
        stats: calculateCurrentSessionStats(newSettings)
      });
    }

    // 6. ADMIN: START NEW WEEK / NEW SESSION
    if (action === 'adminStartNewSession') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      var lastRow = raw.getLastRow();
      
      // 1. DELETE OLD RESPONSES (so next form submission is on row 2 = Order 1)
      if (lastRow > 1) {
        raw.deleteRows(2, lastRow - 1);
      }
      
      // 2. CLEAR PIZZA ORDER UPDATE SHEET
      var updateSheet = ss.getSheetByName('Pizza Order Update');
      if (updateSheet) {
        updateSheet.clear();
      }

      var newDate = safeTrim(params.newServiceDate || '');
      var newMax = params.newMaxPizzas ? parseInt(params.newMaxPizzas, 10) : undefined;
      var newSessionId = 'session_' + Utilities.formatDate(new Date(), 'Europe/London', 'yyyyMMdd_HHmmss');

      var updatePayload = {
        sessionStartRow: 2, // Reset back to row 2
        sessionId: newSessionId,
        sessionStartDate: new Date().toISOString(),
        orderingEnabled: true
      };

      if (newDate) {
        updatePayload.serviceDate = newDate;
        updatePayload.serviceTitle = newDate + ' Availability';
      }
      if (newMax) {
        updatePayload.maxPizzas = newMax;
      }

      var saved = saveSettings(updatePayload);
      logAdminAction('New Week Started', 'Spreadsheet cleared. Session: ' + newSessionId + ', Date: ' + (newDate || saved.serviceDate));

      // Rebuild the empty headers immediately
      rebuildCleanSheets();

      return createJsonResponse({
        success: true,
        message: 'New ordering session created successfully. Old orders have been cleared.',
        settings: saved,
        stats: calculateCurrentSessionStats(saved)
      });
    }

    // 7. ADMIN: RESEND CONFIRMATION
    if (action === 'adminResendConfirmation') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var rowNum = parseInt(orderId, 10) + 1;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      // Clear the "Sent" flag to force resend
      raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('');
      
      try {
        sendOrderConfirmationForRow(rowNum);
        logAdminAction('Resend Confirmation', 'Manually resent confirmation for Order #' + orderId);
        return createJsonResponse({ success: true, message: 'Confirmation resent successfully for Order #' + orderId });
      } catch (err) {
        return createJsonResponse({ success: false, message: 'Error resending confirmation: ' + err.toString() });
      }
    }

    // 8. ADMIN: CHANGE PASSWORD
    if (action === 'adminUpdatePaidStatus') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var status = safeTrim(params.status || ''); // 'Paid' or 'Pending'
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var rowNum = parseInt(orderId, 10) + 1;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      raw.getRange(rowNum, PAYMENT_STATUS_COL + 1).setValue(status);
      logAdminAction('Payment Updated', 'Order #' + orderId + ' set to ' + status);
      
      return createJsonResponse({ success: true, message: 'Order #' + orderId + ' status updated to ' + status });
    }

    // 9. ADMIN: DELETE ORDER
    if (action === 'adminDeleteOrder') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var rowNum = parseInt(orderId, 10) + 1;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      raw.getRange(rowNum, IS_DELETED_COL + 1).setValue('TRUE');
      logAdminAction('Delete Order', 'Order #' + orderId + ' marked as deleted');
      
      return createJsonResponse({ success: true, message: 'Order #' + orderId + ' deleted successfully.' });
    }

    // 10. ADMIN: CHANGE PASSWORD
    if (action === 'adminChangePassword') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized.'
        });
      }

      var currentPass = safeTrim(params.currentPassword || '');
      var newPass = safeTrim(params.newPassword || '');

      if (currentPass !== getAdminPassword()) {
        return createJsonResponse({
          success: false,
          message: 'Current password is not correct.'
        });
      }

      if (!newPass || newPass.length < 6) {
        return createJsonResponse({
          success: false,
          message: 'New password must be at least 6 characters.'
        });
      }

      setAdminPassword(newPass);
      logAdminAction('Password Changed', 'Administrator password updated');

      return createJsonResponse({
        success: true,
        message: 'Admin password updated successfully.'
      });
    }

    // 8. ADMIN: LOGOUT
    if (action === 'adminLogout') {
      invalidateAdminToken();
      return createJsonResponse({
        success: true,
        message: 'Logged out successfully.'
      });
    }

    return createJsonResponse({
      success: false,
      message: 'Invalid action requested: ' + action
    });

  } catch (err) {
    Logger.log('doGet error: ' + err);
    return createJsonResponse({
      success: false,
      message: 'Server error: ' + err.toString()
    });
  }
}

function doPost(e) {
  // Support POST bodies with JSON
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (ex) {
        body = e.parameter || {};
      }
    } else {
      body = e.parameter || {};
    }

    var fakeEvent = { parameter: body };
    return doGet(fakeEvent);
  } catch (err) {
    return createJsonResponse({
      success: false,
      message: 'doPost error: ' + err.toString()
    });
  }
}

function calculateCurrentSessionStats(settings) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
    var data = raw.getDataRange().getValues();
    var startRow = Math.max(1, (settings.sessionStartRow || 2) - 1);
    
    var totalPizzas = 0;
    var totalOrders = 0;
    var totalHistoricalOrders = 0;
    var totalHistoricalPizzas = 0;
    var totalHistoricalPizzaSelections = 0;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (rowIsBlank(row)) continue;
      if (safeTrim(row[IS_DELETED_COL]) === 'TRUE') continue;

      var stats = calculateRowPizzaStats(row);

      totalHistoricalPizzas += stats.pizzaCapacity;
      totalHistoricalPizzaSelections += stats.pizzaSelections;

      if (stats.pizzaSelections > 0) totalHistoricalOrders++;

      if (r >= startRow) {
        totalPizzas += stats.pizzaCapacity;
        if (stats.pizzaSelections > 0) totalOrders++;
      }
    }

    totalPizzas = normalizePizzaCapacity(totalPizzas);
    totalHistoricalPizzas = normalizePizzaCapacity(totalHistoricalPizzas);

    var maxLimit = parseFloat(settings.maxPizzas || 20);
    var remaining = Math.max(0, maxLimit - totalPizzas);
    var isPastDeadline = isPastAutoClosingDeadline(settings);
    var isOpen = (settings.orderingEnabled === true) && !isPastDeadline && (remaining > 0);

    return {
      success: true,
      currentPizzas: totalPizzas,
      maxPizzas: maxLimit,
      remainingPizzas: remaining,
      currentOrders: totalOrders,
      orderingOpen: isOpen,
      orderingEnabled: (settings.orderingEnabled === true),
      isPastDeadline: isPastDeadline,
      totalHistoricalOrders: totalHistoricalOrders,
      totalHistoricalPizzas: totalHistoricalPizzas,
      totalHistoricalPizzaSelections: totalHistoricalPizzaSelections,
      sessionStartRow: settings.sessionStartRow
    };
  } catch (err) {
    Logger.log('calculateCurrentSessionStats error: ' + err);
    return {
      currentPizzas: 0,
      maxPizzas: 20,
      remainingPizzas: 20,
      currentOrders: 0,
      orderingOpen: true
    };
  }
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function lookupOrder(searchEmail, searchOrderId, searchToken) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  if (data.length < 2) return null;

  var matchingOrders = [];
  var normalizedSearchEmail = searchEmail ? searchEmail.toLowerCase() : '';
  var normalizedOrderId = searchOrderId ? searchOrderId.toUpperCase().replace(/\s+/g, '') : '';
  var sToken = searchToken ? safeTrim(searchToken) : '';

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (rowIsBlank(row)) continue;
    if (safeTrim(row[IS_DELETED_COL]) === 'TRUE') continue;

    var orderNum = r;
    var formattedId = String(orderNum);
    
    var token = safeTrim(String(row[ORDER_TOKEN_COL - 1] || ''));

    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);
    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'Valued Customer';
    var payerEmail = extractPayerEmail(row);

    var emailMatches = normalizedSearchEmail && payerEmail && (payerEmail.toLowerCase() === normalizedSearchEmail);
    var idMatches = normalizedOrderId && (normalizedOrderId === formattedId);
    
    var tokenMatches = false;
    if (sToken && normalizedOrderId) {
      if (idMatches && token === sToken) {
        tokenMatches = true;
      }
    }

    if (tokenMatches || emailMatches || (idMatches && !sToken)) {
      var blocks = BRANCHES[qtyDigit] || [];
      var pizzas = [];
      var orderTotal = 0;

      for (var b = 0; b < blocks.length; b++) {
        var cols = blocks[b];
        var sizeRaw = safeTrim(row[cols[0]]);
        var childName = safeTrim(row[cols[1]]);
        var cls = safeTrim(row[cols[2]]);

        if (!sizeRaw && !childName) continue;

        var size = mapSize(sizeRaw);
        var price = PRICE_MAP[size] || 0;
        orderTotal += price;

        pizzas.push({
          item: formatSizeLabel(size),
          sizeKey: size,
          quantity: 1,
          childName: childName || 'Student',
          class: cls || '',
          price: price,
          priceFormatted: '£' + price.toFixed(2),
          pickupId: orderNum + '-' + (pizzas.length + 1)
        });
      }

      if (pizzas.length > 0) {
        matchingOrders.push({
          orderIndex: orderNum,
          formattedOrderId: formattedId,
          payerName: payerName,
          payerEmail: payerEmail,
          paymentMethod: paymentMethod,
          paid: paymentMethod ? 'Yes' : 'No',
          total: orderTotal,
          pizzas: pizzas
        });
      }
    }
  }

  if (matchingOrders.length === 0) return null;
  return matchingOrders[matchingOrders.length - 1];
}

// ============================================================================
// TRIGGER ENTRYPOINT & SPREADSHEET REBUILD
// ============================================================================

function onFormSubmitTrigger(e) {
  // Invalidate cache immediately so public tracker updates
  try { CacheService.getScriptCache().remove('SYSTEM_STATUS_CACHE'); } catch(err) {}
  
  rebuildCleanSheets();
  emailXlsxSnapshot();
  trySendOrderConfirmation(e);
}

function rowIsBlank(row) {
  return !row.some(function(cell) { return safeTrim(cell) !== ''; });
}

function rebuildCleanSheets() {
  var settings = getSettings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];

  var sheet = ss.getSheetByName('Pizza Order Update');
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet('Pizza Order Update');
  }

  raw.hideSheet();

  var oldNames = ['Order Summary', 'Pizza Orders', 'Summary'];
  oldNames.forEach(function(name) {
    var s = ss.getSheetByName(name);
    if (s) ss.deleteSheet(s);
  });

  var data = raw.getDataRange().getValues();

  var sizeCounts = {};
  var sessionPizzas = 0;
  var sessionOrders = 0;
  var allergyOrders = 0;
  var paidOrders = 0;
  var unpaidOrders = 0;

  var orderSummaryRows = [];
  var pizzaOrdersRows = [];
  var orderTotalsRows = [];
  
  var maxLimit = parseFloat(settings.maxPizzas || 20);

  var sessionPizzaCapacity = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (rowIsBlank(row)) continue;
    if (safeTrim(row[IS_DELETED_COL]) === 'TRUE') continue;

    var isCurrentSession = (r >= settings.sessionStartRow);
    var pizzasBeforeThisOrder = sessionPizzas;
    var capacityBeforeThisOrder = sessionPizzaCapacity;

    var stats = calculateRowPizzaStats(row);
    if (isCurrentSession) {
      sessionPizzaCapacity += stats.pizzaCapacity;
    }

    var allergyYN = safeTrim(row[1]);
    var allergyText = stripHtml(safeTrim(row[2]));
    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);

    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'Unknown';
    var payerEmail = extractPayerEmail(row);

    var isWaitlist = isCurrentSession && (normalizePizzaCapacity(capacityBeforeThisOrder) >= maxLimit);
    if (isWaitlist) {
      payerName = "[WAITLIST] " + payerName;
    }
    if (!isCurrentSession) {
      payerName = "[PAST SESSION] " + payerName;
    }

    if (isCurrentSession) {
      sessionOrders++;
      if (String(allergyYN).toLowerCase() === 'yes') allergyOrders++;
      var paid = paymentMethod ? 'Yes' : 'No';
      if (paid === 'Yes') paidOrders++; else unpaidOrders++;
    }

    var orderId = r;
    var formattedOrderId = String(orderId);
    var blocks = BRANCHES[qtyDigit] || [];
    var pizzas = [];
    var orderTotal = 0;

    for (var b = 0; b < blocks.length; b++) {
      var cols = blocks[b];
      var sizeRaw = safeTrim(row[cols[0]]);
      var childName = safeTrim(row[cols[1]]);
      var cls = safeTrim(row[cols[2]]);

      if (!sizeRaw && !childName) continue;

      var size = mapSize(sizeRaw);
      if (isCurrentSession && size) {
        sizeCounts[size] = (sizeCounts[size] || 0) + 1;
        sessionPizzas++;
      }
      orderTotal += PRICE_MAP[size] || 0;

      pizzas.push({
        size: size || 'Unknown',
        childName: childName || 'Unknown',
        class: cls || '',
        pizzaNum: pizzas.length + 1
      });
    }

    var numPizzas = pizzas.length;
    var pizzaDetailsParts = [];
    for (var p = 0; p < pizzas.length; p++) {
      var pizza = pizzas[p];
      var pickupId = orderId + '-' + pizza.pizzaNum;
      pizzaDetailsParts.push(pickupId + ': ' + pizza.childName + ' (' + pizza.class + ') - ' + pizza.size);
    }

    orderSummaryRows.push([
      formattedOrderId,
      payerName,
      paymentMethod,
      paymentMethod ? 'Yes' : 'No',
      allergyYN,
      allergyText,
      numPizzas,
      pizzaDetailsParts.join('\n')
    ]);

    for (var p = 0; p < pizzas.length; p++) {
      var pizza = pizzas[p];
      var pickupId = orderId + '-' + pizza.pizzaNum;
      pizzaOrdersRows.push([
        formattedOrderId, payerName, paymentMethod, paymentMethod ? 'Yes' : 'No', allergyYN, allergyText,
        pizza.pizzaNum, pickupId, pizza.childName, pizza.class, pizza.size
      ]);
    }

    var confirmSent = raw.getRange(r + 1, CONFIRMATION_SENT_COL).getValue() === 'SENT' ? 'Yes' : 'No';
    orderTotalsRows.push([formattedOrderId, payerName, payerEmail || '(no valid email)', orderTotal, confirmSent]);
  }

  var currentRow = 1;
  writeSectionTitle(sheet, currentRow, 'CURRENT ACTIVE SESSION: ' + settings.serviceDate, 8);
  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'ORDER SUMMARY', 8);
  currentRow++;

  var orderSummaryHeader = [
    'Order ID', 'Payer Name', 'Payment Method', 'Paid', 'Allergy Flag',
    'Allergy Details', 'No. of Pizzas', 'Pizza Details (Pickup ID - Child - Class - Size)'
  ];

  sheet.getRange(currentRow, 1, 1, orderSummaryHeader.length)
    .setValues([orderSummaryHeader])
    .setFontWeight('bold')
    .setBackground('#E8E8E8');
  currentRow++;

  if (orderSummaryRows.length > 0) {
    sheet.getRange(currentRow, 1, orderSummaryRows.length, orderSummaryHeader.length)
      .setValues(orderSummaryRows);
    sheet.getRange(currentRow, 8, orderSummaryRows.length, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    for (var i = 0; i < orderSummaryRows.length; i++) {
      var detailsText = orderSummaryRows[i][7];
      var numLines = (detailsText.match(/\n/g) || []).length + 1;
      var rowHeight = Math.max(21, numLines * 15);
      sheet.setRowHeight(currentRow + i, rowHeight);
    }
    currentRow += orderSummaryRows.length;
  }

  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'PIZZA ORDERS', 11);
  currentRow++;

  var pizzaOrdersHeader = [
    'Order ID', 'Payer Name', 'Payment Method', 'Paid', 'Allergy Flag',
    'Allergy Details', 'Pizza Item ID', 'Pickup ID', 'Child Name', 'Class', 'Size'
  ];

  sheet.getRange(currentRow, 1, 1, pizzaOrdersHeader.length)
    .setValues([pizzaOrdersHeader])
    .setFontWeight('bold')
    .setBackground('#E8E8E8');
  currentRow++;

  if (pizzaOrdersRows.length > 0) {
    sheet.getRange(currentRow, 1, pizzaOrdersRows.length, pizzaOrdersHeader.length)
      .setValues(pizzaOrdersRows);
    currentRow += pizzaOrdersRows.length;
  }

  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'SESSION SUMMARY (' + settings.serviceDate + ')', 2);
  currentRow++;

  var summaryRows = [
    ['Pizza Order Summary', ''],
    ['', ''],
    ['Size', 'Count']
  ];
  for (var s in sizeCounts) {
    summaryRows.push([s, sizeCounts[s]]);
  }
  summaryRows.push(['Total Active Pizzas', sessionPizzas]);
  summaryRows.push(['Max Capacity Limit', maxLimit]);
  summaryRows.push(['', '']);
  summaryRows.push(['Active Orders (Current Session)', sessionOrders]);
  summaryRows.push(['Orders with allergies', allergyOrders]);
  summaryRows.push(['Orders paid', paidOrders]);
  summaryRows.push(['Orders NOT yet paid', unpaidOrders]);

  sheet.getRange(currentRow, 1, summaryRows.length, 2).setValues(summaryRows);
  sheet.getRange(currentRow, 1, 1, 2).setFontWeight('bold');
  sheet.getRange(currentRow + 2, 1, 1, 2).setFontWeight('bold');

  currentRow += summaryRows.length;
  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'ORDER TOTALS & PAYMENT STATUS', 5);
  currentRow++;

  var orderTotalsHeader = ['Order ID', 'Payer Name', 'Email', 'Amount Owed (£)', 'Confirmation Emailed'];
  sheet.getRange(currentRow, 1, 1, orderTotalsHeader.length)
    .setValues([orderTotalsHeader])
    .setFontWeight('bold')
    .setBackground('#E8E8E8');
  currentRow++;

  if (orderTotalsRows.length > 0) {
    sheet.getRange(currentRow, 1, orderTotalsRows.length, orderTotalsHeader.length)
      .setValues(orderTotalsRows);
    currentRow += orderTotalsRows.length;
  }

  sheet.autoResizeColumns(1, 11);
}

function writeSectionTitle(sheet, row, titleText, mergeAcross) {
  var range = sheet.getRange(row, 1, 1, mergeAcross);
  range.merge();
  range.setValue(titleText);
  range.setFontWeight('bold');
  range.setFontSize(14);
  range.setHorizontalAlignment('center');
  range.setVerticalAlignment('middle');
  range.setBackground('#D9E1F2');
  sheet.setRowHeight(row, 30);
}

function emailXlsxSnapshot() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var combinedSheet = ss.getSheetByName('Pizza Order Update');
  if (!combinedSheet) return;

  var tempSs = SpreadsheetApp.create('Pizza Order Update Export');
  var tempSheet = combinedSheet.copyTo(tempSs);
  tempSheet.setName('Pizza Order Update');

  var defaultSheet = tempSs.getSheetByName('Sheet1');
  if (defaultSheet) tempSs.deleteSheet(defaultSheet);

  var url = 'https://docs.google.com/spreadsheets/d/' + tempSs.getId() + '/export?format=xlsx';
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  });
  var blob = response.getBlob().setName('Pizza_Orders_Live.xlsx');

  MailApp.sendEmail({
    to: YOUR_EMAIL,
    subject: EMAIL_SUBJECT,
    body: '',
    attachments: [blob]
  });

  DriveApp.getFileById(tempSs.getId()).setTrashed(true);
}

function trySendOrderConfirmation(e) {
  try {
    if (!e || !e.range) return;
    sendOrderConfirmationForRow(e.range.getRow());
  } catch (err) {
    Logger.log('trySendOrderConfirmation error: ' + err);
  }
}

function sendOrderConfirmationForRow(rowNum) {
  var settings = getSettings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];

  var alreadySent = raw.getRange(rowNum, CONFIRMATION_SENT_COL).getValue();
  if (alreadySent === 'SENT') return;

  // Mark as SENT immediately to prevent double processing in case of trigger hiccups
  raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('SENT');
  SpreadsheetApp.flush();

  var data = raw.getDataRange().getValues();
  var sessionStartRow = Math.max(1, (settings.sessionStartRow || 2) - 1);
  var maxLimit = parseFloat(settings.maxPizzas || 20);
  var sessionPizzasBefore = 0;
  for (var r = sessionStartRow; r < rowNum - 1; r++) {
    var pRow = data[r];
    if (rowIsBlank(pRow)) continue;
    var stats = calculateRowPizzaStats(pRow);
    sessionPizzasBefore += stats.pizzaCapacity;
  }
  sessionPizzasBefore = normalizePizzaCapacity(sessionPizzasBefore);
  var isWaitlist = (sessionPizzasBefore >= maxLimit);
  var lastCol = Math.max(raw.getLastColumn(), CONFIRMATION_SENT_COL);
  var row = raw.getRange(rowNum, 1, 1, lastCol).getValues()[0];

  var orderIndex = rowNum - 1;
  var formattedOrderId = String(orderIndex);

  var qtyRaw = safeTrim(row[3]);
  var qtyDigit = extractDigit(qtyRaw) || '0';
  var paymentRaw = firstNonEmpty(row[49], row[51]);
  var payerRaw = firstNonEmpty(row[50], row[52]);
  var paymentMethod = mapPaymentMethod(paymentRaw);
  var payerName = safeTrim(payerRaw) || 'there';
  var payerEmail = extractPayerEmail(row);

  if (!payerEmail) {
    Logger.log('No valid email found for row ' + rowNum + ' — confirmation not sent.');
    return;
  }

  // Generate or retrieve the secure token for this order
  var token = raw.getRange(rowNum, ORDER_TOKEN_COL).getValue();
  if (!token) {
    token = Utilities.getUuid();
    raw.getRange(rowNum, ORDER_TOKEN_COL).setValue(token);
  }

  var blocks = BRANCHES[qtyDigit] || [];
  var pizzas = [];
  var orderTotal = 0;

  for (var b = 0; b < blocks.length; b++) {
    var cols = blocks[b];
    var sizeRaw = safeTrim(row[cols[0]]);
    var childName = safeTrim(row[cols[1]]);
    var cls = safeTrim(row[cols[2]]);
    if (!sizeRaw && !childName) continue;

    var size = mapSize(sizeRaw);
    var price = PRICE_MAP[size] || 0;
    orderTotal += price;

    pizzas.push({
      size: size || 'Unknown',
      childName: childName || 'Unknown',
      class: cls || '',
      price: price
    });
  }

  if (pizzas.length === 0) {
    Logger.log('No pizza items parsed for row ' + rowNum + ' — confirmation not sent.');
    return;
  }

  var lines = pizzas.map(function(p) {
    return p.childName + (p.class ? ' (' + p.class + ')' : '') + '\n' + formatSizeLabel(p.size) + ' — £' + p.price.toFixed(2);
  });

  var body = '';
  var htmlBody = '';
  
  if (isWaitlist) {
    body = 
      'Hi ' + payerName + ',\n\n' +
      'Thank you for your pizza order request. Unfortunately, we have already reached our maximum capacity for this session (' + settings.serviceDate + ').\n\n' +
      'Your order has been placed on the WAITLIST. We will contact you if a spot opens up.\n\n' +
      'Please DO NOT send payment at this time.\n\n' +
      'Kind regards,\n\nMarlow, Louis, and Quinton';
    
    htmlBody = '<p>Hi ' + payerName + ',</p>' +
      '<p>Thank you for your pizza order request. Unfortunately, we have already reached our maximum capacity for this session (' + settings.serviceDate + ').</p>' +
      '<p>Your order has been placed on the WAITLIST. We will contact you if a spot opens up.</p>' +
      '<p>Please DO NOT send payment at this time.</p>' +
      '<p>Kind regards,<br><br>Marlow, Louis, and Quinton</p>';
  } else {
    var orderLink = 'https://artisanoven.shop/Payment.html?order=' + formattedOrderId + '&token=' + token + '&t=' + new Date().getTime();

    body =
      'Hi ' + payerName + ',\n\n' +
      'Thank you for placing your pizza order for ' + settings.serviceDate + '. Please find your order details below:\n\n' +
      'ORDER NUMBER: #' + formattedOrderId + '\n\n' +
      'Click your order number or the link below to view your order:\n' + orderLink + '\n\n' +
      'ORDER SUMMARY\n\n' +
      lines.join('\n\n') + '\n\n' +
      'TOTAL AMOUNT DUE: £' + orderTotal.toFixed(2) + '\n\n' +
      PAYMENT_INFO_BLOCK + '\n\n' +
      'COLLECTION\n\n' +
      'Please ask your child to collect their pizza from the back of the courtyard at lunchtime.\n\n' +
      'STAY UPDATED\n' +
      'Join our WhatsApp group: https://chat.whatsapp.com/H6UKHyWuVHnCJWNu7f83ZO\n\n' +
      'Thank you.\n\n' +
      'Kind regards,\n\nMarlow, Louis, and Quinton';

    htmlBody =
      '<p>Hi ' + payerName + ',</p>' +
      '<p>Thank you for placing your pizza order for ' + settings.serviceDate + '. Please find your order details below:</p>' +
      '<p><strong>ORDER NUMBER: <a href="' + orderLink + '" target="_blank">#' + formattedOrderId + '</a></strong></p>' +
      '<p><a href="' + orderLink + '" target="_blank" style="display:inline-block;padding:10px 20px;background-color:#4F6359;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">VIEW MY ORDER</a></p>' +
      '<p>You will be taken directly to your order on the Artisan Oven website.</p>' +
      '<p><strong>ORDER SUMMARY</strong></p>' +
      '<p>' + lines.join('<br><br>') + '</p>' +
      '<p><strong>TOTAL AMOUNT DUE: £' + orderTotal.toFixed(2) + '</strong></p>' +
      '<p>' + PAYMENT_INFO_BLOCK.replace(/\n/g, '<br>') + '</p>' +
      '<p><strong>COLLECTION</strong></p>' +
      '<p>Please ask your child to collect their pizza from the back of the courtyard at lunchtime.</p>' +
      '<p><strong>STAY UPDATED</strong></p>' +
      '<p>Join our WhatsApp group for updates: <a href="https://chat.whatsapp.com/H6UKHyWuVHnCJWNu7f83ZO">Click here to join</a></p>' +
      '<p>Thank you.</p>' +
      '<p>Kind regards,<br><br>Marlow, Louis, and Quinton</p>';
  }

  try {
    MailApp.sendEmail({
      to: payerEmail,
      subject: CONFIRMATION_SUBJECT + ' (' + formattedOrderId + ')',
      body: body,
      htmlBody: htmlBody
    });
    raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('SENT');
  } catch (e) {
    Logger.log('MailApp error for row ' + rowNum + ': ' + e);
    raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('FAILED: ' + e.toString().substring(0, 50));
  }
}

function formatSizeLabel(size) {
  if (size === '12inch') return '12" Pizza';
  if (size === 'Half12inch') return 'Half a 12" Pizza';
  if (size === 'Quarter12inch') return 'Quarter of a 12" Pizza';
  return size;
}

function safeTrim(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]+>/g, '').trim();
}

function firstNonEmpty() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return '';
}

function extractDigit(text) {
  if (!text) return null;
  var m = String(text).match(/(\d+)/);
  return m ? m[1] : null;
}

function mapPaymentMethod(raw) {
  if (!raw) return '';
  var key = String(raw).trim().replace(/\s+/g, ' ');
  return PAYMENT_MAP[key] || (key === '' ? '' : key);
}

function mapSize(raw) {
  if (!raw) return '';
  var text = String(raw).toLowerCase();
  if (text.indexOf('quarter') !== -1) return 'Quarter12inch';
  if (text.indexOf('half') !== -1) return 'Half12inch';
  if (text.indexOf('12') !== -1 || text.indexOf('whole') !== -1) return '12inch';
  var key = String(raw).trim().replace(/\s+/g, ' ');
  return SIZE_MAP[key] || key;
}

function extractPayerEmail(row) {
  for (var i = 0; i < row.length; i++) {
    var candidate = safeTrim(row[i]);
    if (isValidEmail(candidate)) return candidate;
  }
  return '';
}

function isValidEmail(text) {
  if (!text) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function normalizePizzaCapacity(value) {
  return Math.round(value * 4) / 4;
}

function getPizzaCapacityValue(sizeRaw) {
  var size = mapSize(sizeRaw);
  if (size === '12inch') return 1;
  if (size === 'Half12inch') return 0.5;
  if (size === 'Quarter12inch') return 0.25;
  return 1;
}

function calculateRowPizzaStats(row) {
  var qtyRaw = safeTrim(row[3]);
  var qtyDigit = extractDigit(qtyRaw) || '0';
  var blocks = BRANCHES[qtyDigit] || [];

  var pizzaSelections = 0;
  var pizzaCapacity = 0;

  for (var b = 0; b < blocks.length; b++) {
    var cols = blocks[b];
    var sizeRaw = safeTrim(row[cols[0]]);
    var childName = safeTrim(row[cols[1]]);

    if (sizeRaw || childName) {
      pizzaSelections++;
      var capacityValue = getPizzaCapacityValue(sizeRaw);
      pizzaCapacity += capacityValue;
    }
  }

  return {
    pizzaSelections: pizzaSelections,
    pizzaCapacity: pizzaCapacity
  };
}

// ============================================================================
// ADMIN ORDERS
// ============================================================================
function getAllOrdersForAdmin() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  
  Logger.log('getAllOrdersForAdmin: Found ' + data.length + ' rows in sheet: ' + raw.getName());
  
  if (data.length < 2) {
    Logger.log('getAllOrdersForAdmin: No data rows found.');
    return [];
  }

  var allOrders = [];

  // Read from the bottom to get newest orders first. Limit to 250 orders for performance.
  var start = data.length - 1;
  var end = Math.max(1, data.length - 250);

  for (var r = start; r >= end; r--) {
    var row = data[r];
    if (rowIsBlank(row)) continue;
    if (safeTrim(row[IS_DELETED_COL]) === 'TRUE') continue;

    var orderNum = r;
    var formattedId = String(orderNum);
    
    var timestampStr = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Europe/London', 'dd MMM yyyy HH:mm') : String(row[0]);
    
    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);
    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'Valued Customer';
    var payerEmail = extractPayerEmail(row);
    var allergyYN = safeTrim(row[1]);
    var allergyText = stripHtml(safeTrim(row[2]));
    var manualPaymentStatus = safeTrim(row[PAYMENT_STATUS_COL]);

    var blocks = BRANCHES[qtyDigit] || [];
    var pizzas = [];
    var orderTotal = 0;

    for (var b = 0; b < blocks.length; b++) {
      var cols = blocks[b];
      if (!cols) continue;
      
      var sizeRaw = safeTrim(row[cols[0]]);
      var childName = safeTrim(row[cols[1]]);
      var cls = safeTrim(row[cols[2]]);
      
      if (!sizeRaw && !childName) continue;
      
      var size = mapSize(sizeRaw);
      var price = PRICE_MAP[size] || 0;
      orderTotal += price;
      
      pizzas.push({
        recipient: childName || 'Student',
        size: formatSizeLabel(size) || sizeRaw,
        price: price,
        class: cls || ''
      });
    }

    if (pizzas.length > 0) {
      allOrders.push({
        orderId: formattedId,
        timestamp: timestampStr,
        customer: {
          name: payerName,
          email: payerEmail
        },
        allergy: (String(allergyYN).toLowerCase() === 'yes' ? allergyText : ''),
        pizzas: pizzas,
        total: orderTotal,
        paymentStatus: manualPaymentStatus || (paymentMethod ? 'Paid' : 'Pending Payment')
      });
    }
  }

  Logger.log('getAllOrdersForAdmin: Successfully parsed ' + allOrders.length + ' orders.');
  return allOrders;
}

// GitHub Actions deployment test - 28/08/2026