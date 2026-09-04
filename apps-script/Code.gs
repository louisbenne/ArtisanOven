// ============================================================================
// ARTISAN OVEN — Operational Backend, Public API & Admin System
// Version: 2.3.0 (Build 2026.08.31)
//
// SUMMARY OF UPDATES IN v2.3.0:
// 1. Separation of School Lunch Orders & Special Event Orders:
//    - adminGetOrders specifically reads school lunch orders from 'Form Responses 1'.
//    - adminGetEventOrders specifically reads special event orders from 'Event Customers'
//      with optional eventId filtering, returning complete customer & pizza item details.
// 2. Case-Insensitive Normalized Action Routing:
//    - Action matching is normalized across all endpoints (adminGetOrders, adminGetSettings,
//      adminGetEvents, adminGetEventOrders, adminUpdatePaidStatus, adminDeleteOrder,
//      adminResendConfirmation, adminSaveEvent, adminDeleteEvent, adminStartNewSession,
//      adminChangePassword, createEventOrder, getEvent, getEvents, etc.).
// 3. Unified Paid Status & Order Deletion Handling:
//    - adminUpdatePaidStatus & adminDeleteOrder seamlessly detect both school lunch orders
//      (numeric row IDs) and event orders (E-prefixed IDs or source='event').
// 4. Enhanced Event Orders Confirmation Resend:
//    - adminResendConfirmation routes event orders to sendEventConfirmation.
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
  'Account Number: 11427310\n' +
  'Payment Reference: Order Number, Name or Email\n\n' +
  'OR by using the order number on our website\n\n' +
  'https://www.artisanoven.shop\n\n' +
  'PAYPAL\n\n' +
  'paypal.me/ArtisanOven (Please include Order Number, Name or Email as reference)\n\n' +
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
    var params = {};
    if (e && e.parameter) {
      params = e.parameter;
    }
    
    // Support nested or stringified JSON payload if sent via parameters
    if (params.postData && typeof params.postData === 'string') {
      try {
        var parsedPost = JSON.parse(params.postData);
        for (var k in parsedPost) {
          if (params[k] === undefined) params[k] = parsedPost[k];
        }
      } catch (errPost) {}
    }

    var action = safeTrim(params.action || 'getOrder');
    var actionLower = action.toLowerCase();
    var query = safeTrim(params.query || params.email || params.orderId || '');

    // 1b. PUBLIC: GET EVENTS LIST
    if (actionLower === 'getevents' || action === 'getEvents') {
      setupEventSheets();
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Events');
      if (!sheet || sheet.getLastRow() < 2) return createJsonResponse({ success: true, events: [] });
      var data = sheet.getDataRange().getValues();
      var events = [];
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var active = row[11];
        var status = safeTrim(String(row[6]));
        var rawInstructions = safeTrim(String(row[8]));
        var regInterest = row[12] === true || row[12] === 'TRUE' || row[12] === 1 || row[12] === '1';
        if (!regInterest && (rawInstructions.indexOf('<!--AO_REG_INTEREST:1-->') >= 0 || rawInstructions.indexOf('[MODE:REGISTER_INTEREST]') >= 0)) {
          regInterest = true;
        } else if (rawInstructions.indexOf('<!--AO_REG_INTEREST:0-->') >= 0) {
          regInterest = false;
        }
        var cleanInstructions = rawInstructions
          .replace(/<!--AO_REG_INTEREST:[01]-->/g, '')
          .replace(/\[MODE:REGISTER_INTEREST\]/g, '')
          .trim();
        if (active === true || active === 'TRUE' || active === '1') {
          events.push({
            id: safeTrim(String(row[0])),
            name: safeTrim(String(row[1])),
            description: safeTrim(String(row[2])),
            date: safeTrim(String(row[3])),
            time: safeTrim(String(row[4])),
            location: safeTrim(String(row[5])),
            status: status || 'Open',
            registerInterest: regInterest,
            customerInstructions: cleanInstructions
          });
        }
      }
      return createJsonResponse({ success: true, events: events });
    }

    // 1c. PUBLIC: GET SINGLE EVENT DETAILS
    if (actionLower === 'getevent' || action === 'getEvent') {
      setupEventSheets();
      var eventId = safeTrim(params.eventId || params.event || params.id || '');
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Events');
      if (!sheet || sheet.getLastRow() < 2) return createJsonResponse({ success: false, message: 'Event not found' });
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (safeTrim(String(row[0])).toLowerCase() === eventId.toLowerCase()) {
          var rawInstructions = safeTrim(String(row[8]));
          var regInterest = row[12] === true || row[12] === 'TRUE' || row[12] === 1 || row[12] === '1';
          if (!regInterest && (rawInstructions.indexOf('<!--AO_REG_INTEREST:1-->') >= 0 || rawInstructions.indexOf('[MODE:REGISTER_INTEREST]') >= 0)) {
            regInterest = true;
          } else if (rawInstructions.indexOf('<!--AO_REG_INTEREST:0-->') >= 0) {
            regInterest = false;
          }
          var cleanInstructions = rawInstructions
            .replace(/<!--AO_REG_INTEREST:[01]-->/g, '')
            .replace(/\[MODE:REGISTER_INTEREST\]/g, '')
            .trim();
          return createJsonResponse({
            success: true,
            event: {
              id: safeTrim(String(row[0])),
              name: safeTrim(String(row[1])),
              description: safeTrim(String(row[2])),
              date: safeTrim(String(row[3])),
              time: safeTrim(String(row[4])),
              location: safeTrim(String(row[5])),
              status: safeTrim(String(row[6])) || 'Open',
              registerInterest: regInterest,
              customerInstructions: cleanInstructions
            }
          });
        }
      }
      return createJsonResponse({ success: false, message: 'Event not found' });
    }

    // 1d-register. PUBLIC: REGISTER INTEREST FOR EVENT
    if (actionLower === 'registerinterest' || action === 'registerInterest') {
      setupEventSheets();
      var body = params;
      var eventId = safeTrim(body.eventId || body.event || body.id || '');
      var eventName = sanitizeForSheet(body.eventName || 'Special Event');
      var eventDate = sanitizeForSheet(body.eventDate || '');
      var customerName = sanitizeForSheet(body.customerName || body.name || '');
      var customerEmail = sanitizeForSheet(body.customerEmail || body.email || '');
      var notes = sanitizeForSheet(body.notes || body.details || '');

      if (!customerName) {
        return createJsonResponse({ success: false, message: 'Please provide your name.' });
      }
      if (customerEmail && !isValidEmail(customerEmail)) {
        return createJsonResponse({ success: false, message: 'Please provide a valid email address.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var cleanName = (eventName + (eventDate ? (' - ' + eventDate) : '')).replace(/[:\/\?\*\[\]\\]/g, ' ').trim();
      var tabTitle = 'Register Interest - ' + cleanName;
      if (tabTitle.length > 31) {
        tabTitle = tabTitle.substring(0, 31).trim();
      }

      var sheet = ss.getSheetByName(tabTitle);
      if (!sheet) {
        sheet = ss.insertSheet(tabTitle);
        sheet.appendRow(['Timestamp', 'Customer Name', 'Customer Email', 'Notes / Details']);
        sheet.getRange(1, 1, 1, 4)
          .setFontWeight('bold')
          .setFontFamily('Arial')
          .setBackground('#1F3A2E')
          .setFontColor('#F7F5F0')
          .setHorizontalAlignment('center');
        sheet.setFrozenRows(1);
        sheet.autoResizeColumns(1, 4);
      }

      sheet.appendRow([new Date(), customerName, customerEmail || '-', notes]);
      SpreadsheetApp.flush();

      return createJsonResponse({ success: true, message: 'Interest registered successfully!' });
    }

    // 1d. PUBLIC: CREATE EVENT ORDER
    if (actionLower === 'createeventorder' || action === 'createEventOrder') {
      setupEventSheets();
      var body = params;
      var eventId = safeTrim(body.eventId || body.event || body.id || '');
      var customerName = sanitizeForSheet(body.customerName || body.name || '');
      var customerEmail = sanitizeForSheet(body.customerEmail || body.email || '');
      var paymentMethod = sanitizeForSheet(body.paymentMethod || 'Bank Transfer');
      var notes = sanitizeForSheet(body.notes || body.orderNotes || '');
      var submissionId = safeTrim(body.submissionId || '');
      var rawItems = body.items || [];
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems); } catch(e) { rawItems = []; }
      }

      if (!eventId || !customerName || !customerEmail || !isValidEmail(customerEmail)) {
        return createJsonResponse({ success: false, message: 'Please provide valid name, email and event ID.' });
      }

      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return createJsonResponse({ success: false, message: 'Please include at least one pizza item.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var evSheet = ss.getSheetByName('Events');
      var eventRow = null;
      if (evSheet && evSheet.getLastRow() >= 2) {
        var eventData = evSheet.getDataRange().getValues();
        for (var j = 1; j < eventData.length; j++) {
          if (safeTrim(String(eventData[j][0])).toLowerCase() === eventId.toLowerCase()) {
            eventRow = eventData[j];
            break;
          }
        }
      }

      var eventName = '';
      var eventDate = '';
      if (eventRow) {
        var eventStatus = safeTrim(String(eventRow[6]));
        if (eventStatus && eventStatus.toLowerCase() === 'closed') {
          return createJsonResponse({ success: false, message: 'This event is currently closed for ordering.' });
        }
        eventName = safeTrim(String(eventRow[1]));
        eventDate = safeTrim(String(eventRow[3]));
      } else {
        eventName = sanitizeForSheet(body.eventName || ('Event ' + eventId));
        eventDate = sanitizeForSheet(body.eventDate || 'Upcoming');
      }

      if (submissionId) {
        var cache = CacheService.getScriptCache();
        if (cache.get(submissionId)) {
          return createJsonResponse({ success: false, message: 'This order was already submitted successfully.' });
        }
        try { cache.put(submissionId, 'processed', 300); } catch (e) {}
      }

      var validatedItems = [];
      var calculatedTotal = 0;
      for (var k = 0; k < rawItems.length; k++) {
        var itm = rawItems[k];
        var sizeKey = safeTrim(itm.size);
        var qty = parseInt(itm.qty, 10);
        if (!PRICE_MAP[sizeKey]) {
          return createJsonResponse({ success: false, message: 'Invalid pizza size selected.' });
        }
        if (isNaN(qty) || qty < 1 || qty > 50) {
          return createJsonResponse({ success: false, message: 'Invalid quantity.' });
        }
        var unitPrice = PRICE_MAP[sizeKey];
        calculatedTotal += unitPrice * qty;
        validatedItems.push({
          size: sizeKey,
          qty: qty,
          unitPrice: unitPrice
        });
      }

      var orderId = getNextOrderNumber();
      var token = Utilities.getUuid();

      var custSheet = ss.getSheetByName('Event Customers');
      if (custSheet) {
        custSheet.appendRow([
          new Date(),
          orderId,
          eventId,
          eventName,
          eventDate,
          customerName,
          customerEmail,
          paymentMethod,
          JSON.stringify(validatedItems),
          calculatedTotal,
          '', // Payment Status
          'Confirmed', // Order Status
          'PENDING', // Confirmation Status
          notes,
          token,
          false, // Deleted
          submissionId
        ]);
      }

      // Also append to dedicated sheet tab for this event
      try {
        var dedicatedSheet = createOrGetEventOrdersSheet(ss, eventName, eventId);
        if (dedicatedSheet) {
          var itemsSummary = validatedItems.map(function(itm) {
            return formatSizeLabel(itm.size) + ' x ' + itm.qty;
          }).join(', ');

          dedicatedSheet.appendRow([
            new Date(),
            orderId,
            customerName,
            customerEmail,
            itemsSummary,
            calculatedTotal,
            paymentMethod,
            'Pending Payment',
            notes,
            'Confirmed'
          ]);
        }
      } catch (errTab) {
        Logger.log('Error appending to dedicated event tab: ' + errTab);
      }
      SpreadsheetApp.flush();

      try {
        sendEventConfirmation(orderId);
      } catch (err) {
        Logger.log('Error sending event confirmation email: ' + err);
      }

      return createJsonResponse({
        success: true,
        orderId: orderId,
        total: calculatedTotal,
        token: token,
        message: 'Order successfully placed.'
      });
    }

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
        if (isRowDeleted(row)) continue;

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
    if (action === 'adminLogin' || actionLower === 'adminlogin') {
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
    if (action === 'adminGetSettings' || actionLower === 'admingetsettings') {
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

    // 5. ADMIN: GET SCHOOL LUNCH ORDERS
    if (action === 'adminGetOrders' || actionLower === 'admingetorders') {
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

    // 5b. ADMIN: UPDATE SETTINGS
    if (action === 'adminUpdateSettings' || actionLower === 'adminupdatesettings') {
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
    if (action === 'adminStartNewSession' || actionLower === 'adminstartnewsession') {
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
    if (action === 'adminResendConfirmation' || actionLower === 'adminresendconfirmation') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var source = safeTrim(params.source || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      if (source === 'event' || /^E/i.test(orderId)) {
        try {
          sendEventConfirmation(orderId);
          logAdminAction('Resend Confirmation', 'Manually resent confirmation for Event Order #' + orderId);
          return createJsonResponse({ success: true, message: 'Confirmation resent successfully for Event Order #' + orderId });
        } catch (err) {
          return createJsonResponse({ success: false, message: 'Error resending event confirmation: ' + err.toString() });
        }
      }

      var parsedId = parseInt(orderId, 10);
      if (isNaN(parsedId) || parsedId < 1) {
        return createJsonResponse({ success: false, message: 'Invalid Order ID #' + orderId });
      }

      var rowNum = parsedId + 1;
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      ensureColumnsExist(raw, CONFIRMATION_SENT_COL);
      // Clear the "Sent" flag to force resend
      raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('');
      SpreadsheetApp.flush();
      
      try {
        sendOrderConfirmationForRow(rowNum);
        logAdminAction('Resend Confirmation', 'Manually resent confirmation for School Lunch Order #' + orderId);
        return createJsonResponse({ success: true, message: 'Confirmation resent successfully for Order #' + orderId });
      } catch (err) {
        return createJsonResponse({ success: false, message: 'Error resending confirmation: ' + err.toString() });
      }
    }

    // 8. ADMIN: UPDATE PAYMENT STATUS
    if (action === 'adminUpdatePaidStatus' || actionLower === 'adminupdatepaidstatus') {
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
      var source = safeTrim(params.source || 'lunch');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();

      if (source === 'event' || /^E/i.test(orderId)) {
        var sheet = ss.getSheetByName('Event Customers');
        var foundRow = -1;
        var evData = sheet ? sheet.getDataRange().getValues() : [];
        for (var i = 1; i < evData.length; i++) {
          if (safeTrim(String(evData[i][1])).toUpperCase() === orderId.toUpperCase()) {
            foundRow = i + 1;
            break;
          }
        }
        if (foundRow < 2) {
          return createJsonResponse({ success: false, message: 'Event order #' + orderId + ' not found.' });
        }
        sheet.getRange(foundRow, 11).setValue(status);
        SpreadsheetApp.flush();
        logAdminAction('Payment Updated', 'Event Order #' + orderId + ' set to ' + status);
        return createJsonResponse({ success: true, message: 'Event Order #' + orderId + ' status updated to ' + status });
      }

      var parsedId = parseInt(orderId, 10);
      if (isNaN(parsedId) || parsedId < 1) {
        return createJsonResponse({ success: false, message: 'Invalid Order ID #' + orderId });
      }

      var rowNum = parsedId + 1;
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      ensureColumnsExist(raw, PAYMENT_STATUS_COL + 1);
      raw.getRange(rowNum, PAYMENT_STATUS_COL + 1).setValue(status);
      SpreadsheetApp.flush();

      logAdminAction('Payment Updated', 'Order #' + orderId + ' set to ' + status);
      
      return createJsonResponse({ success: true, message: 'Order #' + orderId + ' status updated to ' + status });
    }

    // 9. ADMIN: DELETE ORDER
    if (action === 'adminDeleteOrder' || actionLower === 'admindeleteorder') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Session expired or unauthorized. Please log in again.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var source = safeTrim(params.source || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var eventSheet = ss.getSheetByName('Event Customers');
      var foundEventRow = -1;
      if (eventSheet && eventSheet.getLastRow() >= 2) {
        var evData = eventSheet.getDataRange().getValues();
        for (var i = 1; i < evData.length; i++) {
          if (safeTrim(String(evData[i][1])).toUpperCase() === orderId.toUpperCase()) {
            foundEventRow = i + 1;
            break;
          }
        }
      }

      if (source === 'event' || /^E/i.test(orderId) || foundEventRow >= 2) {
        if (foundEventRow < 2) {
          return createJsonResponse({ success: false, message: 'Event order #' + orderId + ' not found.' });
        }
        eventSheet.getRange(foundEventRow, 16).setValue('TRUE');
        SpreadsheetApp.flush();
        logAdminAction('Delete Event Order', 'Event Order #' + orderId + ' marked as deleted');
        return createJsonResponse({ success: true, message: 'Event Order #' + orderId + ' deleted successfully.' });
      }

      var parsedId = parseInt(orderId, 10);
      if (isNaN(parsedId) || parsedId < 1) {
        return createJsonResponse({ success: false, message: 'Invalid Order ID #' + orderId });
      }

      var rowNum = parsedId + 1;
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      
      if (rowNum < 2 || rowNum > raw.getLastRow()) {
        return createJsonResponse({ success: false, message: 'Order ID #' + orderId + ' not found.' });
      }

      // Ensure the sheet has enough columns for the deleted flag
      ensureColumnsExist(raw, IS_DELETED_COL + 1);

      // Mark only this specific row as deleted
      raw.getRange(rowNum, IS_DELETED_COL + 1).setValue('TRUE');
      SpreadsheetApp.flush();

      // Clear cache so real-time status updates immediately
      try { CacheService.getScriptCache().remove('SYSTEM_STATUS_CACHE'); } catch(err) {}

      logAdminAction('Delete Order', 'Order #' + orderId + ' (Row ' + rowNum + ') marked as deleted');
      
      // Update clean summary sheets and recalculate capacity stats
      try {
        rebuildCleanSheets();
      } catch (err) {
        Logger.log('Error rebuilding sheets after deletion: ' + err);
      }

      var settings = getSettings();
      var stats = calculateCurrentSessionStats(settings);

      return createJsonResponse({
        success: true,
        message: 'Order #' + orderId + ' deleted successfully.',
        orderId: orderId,
        stats: stats
      });
    }

    // 11. ADMIN: GET EVENTS FOR MANAGEMENT
    if (action === 'adminGetEvents' || actionLower === 'admingetevents') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Unauthorized.' });
      }
      setupEventSheets();
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Events');
      if (!sheet || sheet.getLastRow() < 2) return createJsonResponse({ success: true, events: [] });
      var data = sheet.getDataRange().getValues();
      var header = data[0];
      var colMap = {};
      for (var c = 0; c < header.length; c++) {
        colMap[String(header[c]).trim().toLowerCase()] = c;
      }

      var events = [];
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var activeVal = colMap['active'] !== undefined ? row[colMap['active']] : row[11];
        var regIntVal = colMap['register interest'] !== undefined ? row[colMap['register interest']] : row[12];
        var rawInstructions = safeTrim(String(row[colMap['customer instructions'] || 8]));
        var isRegInt = regIntVal === true || regIntVal === 'TRUE' || regIntVal === 1 || regIntVal === '1';
        if (!isRegInt && (rawInstructions.indexOf('<!--AO_REG_INTEREST:1-->') >= 0 || rawInstructions.indexOf('[MODE:REGISTER_INTEREST]') >= 0)) {
          isRegInt = true;
        } else if (rawInstructions.indexOf('<!--AO_REG_INTEREST:0-->') >= 0) {
          isRegInt = false;
        }
        var cleanInstructions = rawInstructions
          .replace(/<!--AO_REG_INTEREST:[01]-->/g, '')
          .replace(/\[MODE:REGISTER_INTEREST\]/g, '')
          .trim();
        events.push({
          id: safeTrim(String(row[colMap['event id'] || 0])),
          name: safeTrim(String(row[colMap['event name'] || 1])),
          description: safeTrim(String(row[colMap['description'] || 2])),
          date: safeTrim(String(row[colMap['event date'] || 3])),
          time: safeTrim(String(row[colMap['event time'] || 4])),
          location: safeTrim(String(row[colMap['location'] || 5])),
          status: safeTrim(String(row[colMap['status'] || 6])),
          deadline: safeTrim(String(row[colMap['ordering deadline'] || 7])),
          customerInstructions: cleanInstructions,
          emailSubject: safeTrim(String(row[colMap['email subject'] || 9])),
          emailMessage: safeTrim(String(row[colMap['email message'] || 10])),
          active: activeVal === true || activeVal === 'TRUE' || activeVal === '1',
          registerInterest: isRegInt
        });
      }
      return createJsonResponse({ success: true, events: events });
    }

    // 12. ADMIN: SAVE EVENT
    if (action === 'adminSaveEvent' || actionLower === 'adminsaveevent') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Unauthorized.' });
      }
      setupEventSheets();
      var eventId = safeTrim(params.eventId || '');
      var name = sanitizeForSheet(params.name || '');
      var desc = sanitizeForSheet(params.description || '');
      var date = sanitizeForSheet(params.date || '');
      var time = sanitizeForSheet(params.time || '');
      var location = sanitizeForSheet(params.location || '');
      var status = sanitizeForSheet(params.status || 'Open');
      var instructions = sanitizeForSheet(params.customerInstructions || '');
      var emailSub = sanitizeForSheet(params.emailSubject || '');
      var emailMsg = sanitizeForSheet(params.emailMessage || '');
      var active = params.active === true || params.active === 'true' || params.active === '1' || params.active === 1;
      var registerInterest = false;
      if (params.registerInterest === true || params.registerInterest === 'true' || params.registerInterest === '1' || params.registerInterest === 1) {
        registerInterest = true;
      } else if (params.registerInterest === false || params.registerInterest === 'false' || params.registerInterest === '0' || params.registerInterest === 0) {
        registerInterest = false;
      } else if (instructions.indexOf('<!--AO_REG_INTEREST:1-->') >= 0 || instructions.indexOf('[MODE:REGISTER_INTEREST]') >= 0) {
        registerInterest = true;
      } else if (instructions.indexOf('<!--AO_REG_INTEREST:0-->') >= 0) {
        registerInterest = false;
      }

      if (!name) {
        return createJsonResponse({ success: false, message: 'Event Name is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Events');
      var lastCol = sheet.getLastColumn();
      var headerRow = sheet.getRange(1, 1, 1, Math.max(lastCol, 13)).getValues()[0];
      var colMap = {};
      for (var c = 0; c < headerRow.length; c++) {
        colMap[String(headerRow[c]).trim().toLowerCase()] = c + 1;
      }
      if (!colMap['register interest']) {
        sheet.insertColumnAfter(12);
        sheet.getRange(1, 13).setValue('Register Interest').setFontWeight('bold').setBackground('#E8E8E8');
        headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        colMap = {};
        for (var c = 0; c < headerRow.length; c++) {
          colMap[String(headerRow[c]).trim().toLowerCase()] = c + 1;
        }
      }

      var data = sheet.getDataRange().getValues();
      var rowIndex = -1;

      if (!eventId) {
        eventId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4);
      }

      var rowIdColIndex = colMap['event id'] ? colMap['event id'] - 1 : 0;
      for (var i = 1; i < data.length; i++) {
        if (safeTrim(String(data[i][rowIdColIndex])) === eventId) {
          rowIndex = i + 1;
          break;
        }
      }

      var idCol = colMap['event id'] || 1;
      var nameCol = colMap['event name'] || 2;
      var descCol = colMap['description'] || 3;
      var dateCol = colMap['event date'] || 4;
      var timeCol = colMap['event time'] || 5;
      var locCol = colMap['location'] || 6;
      var statusCol = colMap['status'] || 7;
      var deadlineCol = colMap['ordering deadline'] || 8;
      var instCol = colMap['customer instructions'] || 9;
      var subCol = colMap['email subject'] || 10;
      var msgCol = colMap['email message'] || 11;
      var activeCol = colMap['active'] || 12;
      var regIntCol = colMap['register interest'] || 13;
      var createdCol = colMap['created at'] || 14;

      var maxCol = Math.max(idCol, nameCol, descCol, dateCol, timeCol, locCol, statusCol, deadlineCol, instCol, subCol, msgCol, activeCol, regIntCol, createdCol);

      if (rowIndex > 0) {
        sheet.getRange(rowIndex, nameCol).setValue(name);
        sheet.getRange(rowIndex, descCol).setValue(desc);
        sheet.getRange(rowIndex, dateCol).setValue(date);
        sheet.getRange(rowIndex, timeCol).setValue(time);
        sheet.getRange(rowIndex, locCol).setValue(location);
        sheet.getRange(rowIndex, statusCol).setValue(status);
        sheet.getRange(rowIndex, instCol).setValue(instructions);
        sheet.getRange(rowIndex, subCol).setValue(emailSub);
        sheet.getRange(rowIndex, msgCol).setValue(emailMsg);
        sheet.getRange(rowIndex, activeCol).setValue(active);
        sheet.getRange(rowIndex, regIntCol).setValue(registerInterest);
        logAdminAction('Update Event', 'Updated event: ' + name);
      } else {
        var newRow = [];
        for (var c = 1; c <= maxCol; c++) {
          newRow.push('');
        }
        newRow[idCol - 1] = eventId;
        newRow[nameCol - 1] = name;
        newRow[descCol - 1] = desc;
        newRow[dateCol - 1] = date;
        newRow[timeCol - 1] = time;
        newRow[locCol - 1] = location;
        newRow[statusCol - 1] = status;
        newRow[instCol - 1] = instructions;
        newRow[subCol - 1] = emailSub;
        newRow[msgCol - 1] = emailMsg;
        newRow[activeCol - 1] = active;
        newRow[regIntCol - 1] = registerInterest;
        newRow[createdCol - 1] = new Date();

        sheet.appendRow(newRow);
        logAdminAction('Create Event', 'Created event: ' + name);

        try {
          createOrGetEventOrdersSheet(ss, name, eventId);
        } catch (sheetErr) {
          Logger.log('Error creating dedicated tab for event: ' + sheetErr);
        }
      }
      SpreadsheetApp.flush();

      return createJsonResponse({ success: true, message: 'Event saved successfully.', eventId: eventId });
    }

    // 12.1. ADMIN: GET REGISTER INTEREST PEOPLE
    if (action === 'adminGetRegisterInterest' || actionLower === 'admingetregisterinterest') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Unauthorized.' });
      }
      setupEventSheets();
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheets = ss.getSheets();
      var interestedPeople = [];

      for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var sName = sheet.getName();
        if (sName.indexOf('Register Interest -') === 0) {
          var eventName = sName.replace('Register Interest -', '').trim();
          var lastRow = sheet.getLastRow();
          if (lastRow >= 2) {
            var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
            for (var r = 0; r < values.length; r++) {
              var row = values[r];
              if (row[1] || row[2]) {
                interestedPeople.push({
                  eventName: eventName,
                  timestamp: row[0] instanceof Date ? row[0].toISOString() : String(row[0]),
                  customerName: safeTrim(String(row[1])),
                  customerEmail: safeTrim(String(row[2])),
                  notes: safeTrim(String(row[3]))
                });
              }
            }
          }
        }
      }

      interestedPeople.sort(function(a, b) {
        return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
      });

      return createJsonResponse({ success: true, interestedPeople: interestedPeople });
    }

    // 12b. ADMIN: DELETE EVENT
    if (action === 'adminDeleteEvent' || actionLower === 'admindeleteevent') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Unauthorized.' });
      }
      setupEventSheets();
      var eventId = safeTrim(params.eventId || '');
      if (!eventId) {
        return createJsonResponse({ success: false, message: 'Event ID is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Events');
      if (sheet && sheet.getLastRow() >= 2) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (safeTrim(String(data[i][0])) === eventId) {
            sheet.deleteRow(i + 1);
            logAdminAction('Delete Event', 'Deleted event ID: ' + eventId);
            SpreadsheetApp.flush();
            return createJsonResponse({ success: true, message: 'Event deleted successfully.' });
          }
        }
      }
      return createJsonResponse({ success: true, message: 'Event not found or already deleted.' });
    }

    // 13. ADMIN: GET EVENT ORDERS (Dedicated to Special Events)
    if (action === 'adminGetEventOrders' || actionLower === 'admingeteventorders') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Unauthorized.' });
      }
      setupEventSheets();
      var eventId = safeTrim(params.eventId || params.event || '');
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Event Customers');
      if (!sheet || sheet.getLastRow() < 2) return createJsonResponse({ success: true, orders: [] });
      var data = sheet.getDataRange().getValues();
      var orders = [];

      for (var i = data.length - 1; i >= 1; i--) {
        var row = data[i];
        var rowEventId = safeTrim(String(row[2]));
        if (eventId && rowEventId.toLowerCase() !== eventId.toLowerCase()) continue;
        var isDel = String(row[15]).toUpperCase() === 'TRUE';
        if (isDel) continue;

        var orderId = safeTrim(String(row[1]));
        var timestamp = row[0] instanceof Date ? Utilities.formatDate(row[0], 'Europe/London', 'dd MMM yyyy HH:mm') : String(row[0]);
        var evName = safeTrim(String(row[3])) || 'Special Event';
        var evDate = safeTrim(String(row[4])) || '';
        var custName = safeTrim(String(row[5])) || 'Customer';
        var custEmail = safeTrim(String(row[6])) || '';
        var paymentMethod = mapPaymentMethod(row[7]);
        var contentsJson = safeTrim(String(row[8]) || '[]');
        var total = parseFloat(row[9]) || 0;
        var paymentStatus = safeTrim(String(row[10])) || (paymentMethod ? 'Paid' : 'Pending Payment');
        var notes = safeTrim(String(row[13]));

        var items = [];
        try { items = JSON.parse(contentsJson); } catch(e) {}

        var pizzas = items.map(function(item) {
          var up = parseFloat(item.unitPrice || PRICE_MAP[item.size] || 8);
          var q = parseInt(item.qty, 10) || 1;
          return {
            recipient: custName,
            class: '',
            size: formatSizeLabel(item.size),
            quantity: q,
            unitPrice: up,
            price: up * q
          };
        });

        orders.push({
          orderId: orderId,
          eventId: rowEventId,
          eventName: evName,
          eventDate: evDate,
          timestamp: timestamp,
          customer: { name: custName, email: custEmail },
          paymentMethod: paymentMethod,
          allergy: notes,
          pizzas: pizzas,
          total: total,
          paymentStatus: paymentStatus
        });
      }

      return createJsonResponse({ success: true, orders: orders });
    }

    // 10. ADMIN: CHANGE PASSWORD
    if (action === 'adminChangePassword' || actionLower === 'adminchangepassword') {
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
    if (action === 'adminLogout' || actionLower === 'adminlogout') {
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
  // Support POST bodies with JSON and form encoded parameters
  try {
    var body = {};
    if (e && e.parameter) {
      for (var p in e.parameter) {
        body[p] = e.parameter[p];
      }
    }
    if (e && e.postData && e.postData.contents) {
      try {
        var parsed = JSON.parse(e.postData.contents);
        for (var k in parsed) {
          body[k] = parsed[k];
        }
      } catch (ex) {
        // Content not JSON format, keep existing parameters
      }
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
      if (isRowDeleted(row)) continue;

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
  var searchIdClean = searchOrderId ? safeTrim(searchOrderId).toUpperCase() : '';
  if (searchIdClean && /^E/i.test(searchIdClean)) {
    var eventRes = lookupEventOrder(searchEmail, searchOrderId, searchToken);
    if (eventRes) return eventRes;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  if (data.length < 2) {
    if (searchEmail) {
      return lookupEventOrder(searchEmail, '', searchToken);
    }
    return null;
  }

  var matchingOrders = [];
  var normalizedSearchEmail = searchEmail ? searchEmail.toLowerCase() : '';
  var normalizedOrderId = searchOrderId ? searchOrderId.toUpperCase().replace(/\s+/g, '') : '';
  var sToken = searchToken ? safeTrim(searchToken) : '';

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (rowIsBlank(row)) continue;
    if (isRowDeleted(row)) continue;

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

  if (matchingOrders.length === 0) {
    if (searchEmail) {
      return lookupEventOrder(searchEmail, '', searchToken);
    }
    return null;
  }
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

function ensureColumnsExist(sheet, minColumns) {
  if (!sheet) return;
  var maxCols = sheet.getMaxColumns();
  if (maxCols < minColumns) {
    sheet.insertColumnsAfter(maxCols, minColumns - maxCols);
  }
}

function isRowDeleted(row) {
  if (!row || !Array.isArray(row)) return false;
  var val = row[IS_DELETED_COL];
  if (val === true || val === 1 || val === '1') return true;
  if (!val && val !== 0) return false;
  var str = safeTrim(val).toUpperCase();
  return (str === 'TRUE' || str === 'DELETED' || str === 'YES');
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
    if (isRowDeleted(row)) continue;

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
    if (isRowDeleted(row)) continue;

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
    var orderCapacity = 0;

    for (var b = 0; b < blocks.length; b++) {
      var cols = blocks[b];
      if (!cols) continue;
      
      var sizeRaw = safeTrim(row[cols[0]]);
      var childName = safeTrim(row[cols[1]]);
      var cls = safeTrim(row[cols[2]]);
      
      if (!sizeRaw && !childName) continue;
      
      var size = mapSize(sizeRaw);
      var price = PRICE_MAP[size] || 0;
      var cap = getPizzaCapacityValue(sizeRaw);
      orderTotal += price;
      orderCapacity += cap;
      
      pizzas.push({
        recipient: childName || 'Student',
        size: formatSizeLabel(size) || sizeRaw,
        sizeKey: size,
        capacity: cap,
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
        pizzaCount: normalizePizzaCapacity(orderCapacity),
        totalCapacity: normalizePizzaCapacity(orderCapacity),
        itemCount: pizzas.length,
        paymentStatus: manualPaymentStatus || (paymentMethod ? 'Paid' : 'Pending Payment')
      });
    }
  }

  Logger.log('getAllOrdersForAdmin: Successfully parsed ' + allOrders.length + ' orders.');
  return allOrders;
}

/**
 * ============================================================================
 * SPECIAL EVENTS & CATERING BACKEND HELPERS
 * ============================================================================
 */

function seedOrderCounter() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
    var lastRow = raw ? raw.getLastRow() : 1;
    var seed = Math.max(100, lastRow + 1);
    PropertiesService.getScriptProperties().setProperty('NEXT_ORDER_NUMBER', String(seed));
    return seed;
  } catch (e) {
    return 100;
  }
}

function getNextOrderNumber() {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var current = parseInt(props.getProperty('NEXT_ORDER_NUMBER'), 10);
    if (!current || isNaN(current)) {
      current = seedOrderCounter();
    }
    var next = current + 1;
    props.setProperty('NEXT_ORDER_NUMBER', String(next));
    return 'E' + current;
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function sanitizeForSheet(str) {
  if (!str) return '';
  var clean = String(str).trim();
  if (/^[=+\-@]/.test(clean)) {
    clean = "'" + clean;
  }
  return clean;
}

function setupEventSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  var eventsSheet = ss.getSheetByName('Events');
  if (!eventsSheet) {
    eventsSheet = ss.insertSheet('Events');
    eventsSheet.appendRow([
      'Event ID', 'Event Name', 'Description', 'Event Date', 'Event Time',
      'Location', 'Status', 'Ordering Deadline', 'Customer Instructions',
      'Email Subject', 'Email Message', 'Active', 'Register Interest', 'Created At'
    ]);
    eventsSheet.getRange(1, 1, 1, 14).setFontWeight('bold').setBackground('#E8E8E8');
    
    eventsSheet.appendRow([
      'summer-fair-2026',
      'Summer School Fair & BBQ',
      'Join us for our annual Summer Fair wood-fired pizza dinner.',
      'Friday 10th July 2026',
      '17:30 - 20:00',
      'School Courtyard',
      'Open',
      '',
      'Please collect your pizzas from the courtyard oven marquee.',
      'Artisan Oven — Summer Fair Order Confirmation',
      'Thank you for ordering for the Summer Fair!',
      true,
      false,
      new Date()
    ]);
  } else {
    // Check if Register Interest column exists in header
    var lastCol = eventsSheet.getLastColumn();
    if (lastCol >= 1) {
      var headerRow = eventsSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var hasReg = false;
      for (var h = 0; h < headerRow.length; h++) {
        if (String(headerRow[h]).toLowerCase().indexOf('register interest') >= 0) {
          hasReg = true;
          break;
        }
      }
      if (!hasReg) {
        eventsSheet.insertColumnAfter(12);
        eventsSheet.getRange(1, 13).setValue('Register Interest').setFontWeight('bold').setBackground('#E8E8E8');
      }
    }
  }

  var custSheet = ss.getSheetByName('Event Customers');
  if (!custSheet) {
    custSheet = ss.insertSheet('Event Customers');
    custSheet.appendRow([
      'Timestamp', 'Order ID', 'Event ID', 'Event Name', 'Event Date',
      'Customer Name', 'Customer Email', 'Payment Method', 'Order Contents JSON',
      'Total (£)', 'Payment Status', 'Order Status', 'Confirmation Status',
      'Customer Notes', 'Order Token', 'Deleted', 'Submission ID'
    ]);
    custSheet.getRange(1, 1, 1, 17).setFontWeight('bold').setBackground('#E8E8E8');
  }
}

/**
 * Creates or retrieves a dedicated tab/sheet for a specific event's orders.
 * Google Sheet tab names are limited to 31 characters.
 */
function createOrGetEventOrdersSheet(ss, eventName, eventId) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;

  // Clean and format tab name: "Event - Summer Fair 2026"
  var cleanName = (eventName || eventId || 'Special Event').replace(/[:\/\?\*\[\]\\]/g, ' ').trim();
  var tabTitle = 'Event - ' + cleanName;
  if (tabTitle.length > 31) {
    tabTitle = tabTitle.substring(0, 31).trim();
  }

  var sheet = ss.getSheetByName(tabTitle);
  if (!sheet) {
    // Check fallback by eventId if name truncation collided
    sheet = ss.insertSheet(tabTitle);
    sheet.appendRow([
      'Timestamp', 'Order ID', 'Customer Name', 'Customer Email',
      'Pizzas Ordered', 'Total (£)', 'Payment Method', 'Payment Status',
      'Notes & Dietary', 'Status'
    ]);
    
    // Style header row with Artisan Forest Theme
    sheet.getRange(1, 1, 1, 10)
      .setFontWeight('bold')
      .setFontFamily('Arial')
      .setBackground('#1F3A2E')
      .setFontColor('#F7F5F0')
      .setHorizontalAlignment('center');
      
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 10);
  }
  return sheet;
}

function lookupEventOrder(searchEmail, searchOrderId, searchToken) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Event Customers');
  if (!sheet || sheet.getLastRow() < 2) return null;
  var data = sheet.getDataRange().getValues();

  var normEmail = searchEmail ? searchEmail.toLowerCase() : '';
  var normId = searchOrderId ? searchOrderId.toUpperCase().replace(/\s+/g, '') : '';
  var sToken = searchToken ? safeTrim(searchToken) : '';

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var isDel = String(row[15]).toUpperCase() === 'TRUE';
    if (isDel) continue;

    var orderId = safeTrim(String(row[1] || '')).toUpperCase();
    var customerName = safeTrim(String(row[5] || ''));
    var customerEmail = safeTrim(String(row[6] || ''));
    var paymentMethod = mapPaymentMethod(row[7]);
    var contentsJson = safeTrim(String(row[8] || '[]'));
    var total = parseFloat(row[9]) || 0;
    var paymentStatus = safeTrim(String(row[10] || ''));
    var token = safeTrim(String(row[14] || ''));

    var idMatches = normId && (normId === orderId);
    var emailMatches = normEmail && customerEmail && (customerEmail.toLowerCase() === normEmail);
    var tokenMatches = sToken && idMatches && (token === sToken);

    if (tokenMatches || emailMatches || (idMatches && !sToken)) {
      var items = [];
      try {
        items = JSON.parse(contentsJson);
      } catch (e) {
        items = [];
      }

      var pizzas = items.map(function(item, idx) {
        var unitPrice = parseFloat(item.unitPrice || PRICE_MAP[item.size] || 8);
        var qty = parseInt(item.qty, 10) || 1;
        return {
          item: formatSizeLabel(item.size),
          sizeKey: item.size,
          quantity: qty,
          childName: customerName,
          class: '',
          price: unitPrice * qty,
          priceFormatted: '£' + (unitPrice * qty).toFixed(2),
          pickupId: orderId + '-' + (idx + 1)
        };
      });

      return {
        orderIndex: orderId,
        formattedOrderId: orderId,
        payerName: customerName,
        payerEmail: customerEmail,
        paymentMethod: paymentMethod,
        paid: (paymentStatus === 'Paid' || paymentMethod) ? 'Yes' : 'No',
        total: total,
        pizzas: pizzas
      };
    }
  }
  return null;
}

function sendEventConfirmation(orderId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Event Customers');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getDataRange().getValues();

  var rowNum = -1;
  var row = null;
  for (var i = 1; i < data.length; i++) {
    if (safeTrim(String(data[i][1])).toUpperCase() === orderId.toUpperCase()) {
      rowNum = i + 1;
      row = data[i];
      break;
    }
  }

  if (!row) return;

  var alreadySent = safeTrim(String(row[12]));
  if (alreadySent === 'SENT') return;

  sheet.getRange(rowNum, 13).setValue('SENT');
  SpreadsheetApp.flush();

  var eventId = safeTrim(String(row[2]));
  var eventName = safeTrim(String(row[3])) || 'Special Event';
  var eventDate = safeTrim(String(row[4])) || '';
  var payerName = safeTrim(String(row[5])) || 'there';
  var payerEmail = safeTrim(String(row[6])) || '';
  var contentsJson = safeTrim(String(row[8])) || '[]';
  var total = parseFloat(row[9]) || 0;
  var token = safeTrim(String(row[14]));

  if (!token) {
    token = Utilities.getUuid();
    sheet.getRange(rowNum, 15).setValue(token);
  }

  if (!payerEmail) return;

  var evSheet = ss.getSheetByName('Events');
  var emailSub = 'Artisan Oven — Event Order Confirmation (' + orderId + ')';
  var customMsg = '';
  if (evSheet && evSheet.getLastRow() >= 2) {
    var evData = evSheet.getDataRange().getValues();
    for (var j = 1; j < evData.length; j++) {
      if (safeTrim(String(evData[j][0])) === eventId) {
        if (evData[j][9]) emailSub = String(evData[j][9]) + ' (' + orderId + ')';
        if (evData[j][10]) customMsg = String(evData[j][10]);
        break;
      }
    }
  }

  var items = [];
  try { items = JSON.parse(contentsJson); } catch(e) {}

  var lines = items.map(function(item) {
    var up = parseFloat(item.unitPrice || PRICE_MAP[item.size] || 8);
    var q = parseInt(item.qty, 10) || 1;
    return formatSizeLabel(item.size) + ' x ' + q + ' — £' + (up * q).toFixed(2);
  });

  var orderLink = 'https://artisanoven.shop/Payment.html?order=' + orderId + '&token=' + token + '&t=' + new Date().getTime();

  var body =
    'Hi ' + payerName + ',\n\n' +
    'Thank you for placing your pizza order for ' + eventName + (eventDate ? ' (' + eventDate + ')' : '') + '.\n\n' +
    'ORDER NUMBER: #' + orderId + '\n\n' +
    'View your order and payment details here:\n' + orderLink + '\n\n' +
    'ORDER SUMMARY\n\n' +
    lines.join('\n') + '\n\n' +
    'TOTAL AMOUNT DUE: £' + total.toFixed(2) + '\n\n' +
    (customMsg ? customMsg + '\n\n' : '') +
    PAYMENT_INFO_BLOCK + '\n\n' +
    'Thank you for supporting Artisan Oven!\n\n' +
    'Kind regards,\n\nMarlow, Louis, and Quinton';

  var htmlBody =
    '<p>Hi ' + payerName + ',</p>' +
    '<p>Thank you for placing your pizza order for <strong>' + eventName + '</strong>' + (eventDate ? ' (' + eventDate + ')' : '') + '.</p>' +
    '<p><strong>ORDER NUMBER: <a href="' + orderLink + '" target="_blank">#' + orderId + '</a></strong></p>' +
    '<p><a href="' + orderLink + '" target="_blank" style="display:inline-block;padding:10px 20px;background-color:#4F6359;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">VIEW MY ORDER</a></p>' +
    '<p><strong>ORDER SUMMARY</strong></p>' +
    '<p>' + lines.join('<br>') + '</p>' +
    '<p><strong>TOTAL AMOUNT DUE: £' + total.toFixed(2) + '</strong></p>' +
    (customMsg ? '<p><em>' + customMsg + '</em></p>' : '') +
    '<p>' + PAYMENT_INFO_BLOCK.replace(/\n/g, '<br>') + '</p>' +
    '<p>Thank you for supporting Artisan Oven!</p>' +
    '<p>Kind regards,<br><br>Marlow, Louis, and Quinton</p>';

  try {
    MailApp.sendEmail({
      to: payerEmail,
      subject: emailSub,
      body: body,
      htmlBody: htmlBody
    });
    sheet.getRange(rowNum, 13).setValue('SENT');
  } catch (e) {
    sheet.getRange(rowNum, 13).setValue('FAILED: ' + e.toString().substring(0, 50));
  }
}

