// ============================================================================
// ARTISAN OVEN — Operational Backend, Public API & Admin System
// Version: 2.5.2 (Build 2026.09.22)
//
// SUMMARY OF UPDATES IN v2.5.2:
// 1. Performance Optimization: 
//    - Optimized 'getStatus' to only read relevant rows from the sheet instead of the entire range.
//    - Faster processing of Internal Parent Orders.
// 2. Reliability: Fixed potential OOM or timeout issues on large spreadsheets.
// ============================================================================

// ====== SCRIPT VERSION INFO ======
var SCRIPT_VERSION = '2.5.2';
var SCRIPT_BUILD = '2026.09.22';

// ====== CORE DEFAULTS & CONFIGURATION ======
var YOUR_EMAIL = 'louis@benne.co.uk';
var EMAIL_SUBJECT = 'Pizza Order Update';
var CONFIRMATION_SUBJECT = 'Your Pizza Order Confirmation & Payment Details';
var PAYPAL_ME_BASE = 'https://paypal.me/ArtisanOven';
var PAYPAL_NCP_LINK = 'https://www.paypal.com/ncp/payment/LXZKSSG3QEFJA';

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

var INTERNAL_PARENT_DISCOUNT_CODE = 'MUTTI';
var PARENT_EMAILS = [
  'lornajbouwer@hotmail.com',
  'lisa@garrettgirl.com'
];
var PARENT_ACCESS_CODE_PROP = 'PARENT_ACCESS_CODE';
var ADMIN_ACCESS_CODE_PROP = 'ADMIN_ACCESS_CODE';
var DEFAULT_ADMIN_ACCESS_CODE = 'ArtisanOvenAdmin2026!';
var PARENT_SESSION_TTL_SECONDS = 12 * 60 * 60;
var ADMIN_SESSION_TTL_SECONDS = 0; // Direct password authentication; no expiration timer or session limit

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
    ordersTeamEmail: 'louis@benne.co.uk,marlowb11@icloud.com',
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
  try { CacheService.getScriptCache().remove('SYSTEM_STATUS_CACHE'); } catch(err) {}
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
      ['Orders Team Email', settings.ordersTeamEmail, new Date()],
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

function getAdminAccessCode() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty(ADMIN_ACCESS_CODE_PROP) || props.getProperty('ADMIN_PASSWORD') || DEFAULT_ADMIN_ACCESS_CODE;
  return safeTrim(code || '');
}

function getAdminPassword() {
  return getAdminAccessCode();
}

function setAdminPassword(newPassword) {
  var code = safeTrim(newPassword || '');
  if (!code) {
    throw new Error('Admin access code is required.');
  }
  if (code.length < 4) {
    throw new Error('Admin access code must be at least 4 characters long.');
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(ADMIN_ACCESS_CODE_PROP, code);
  props.setProperty('ADMIN_PASSWORD', code);
  return code;
}

function setAdminAccessCode(newCode) {
  return setAdminPassword(newCode);
}

function generateAdminToken() {
  return getAdminAccessCode();
}

function verifyAdminToken(token) {
  var supplied = safeTrim(token || '');
  if (!supplied) return false;
  var expected = getAdminAccessCode();
  if (!expected) return false;
  // Black or white authentication: if supplied password matches expected admin code, access is granted. No hours, no token expiration.
  if (supplied === expected) return true;
  // Fallback check for any active cache items
  try {
    if (CacheService.getScriptCache().get(supplied) === 'valid') return true;
  } catch (e) {}
  return false;
}

function getParentAccessCode() {
  return safeTrim(PropertiesService.getScriptProperties().getProperty(PARENT_ACCESS_CODE_PROP) || '');
}

function setParentAccessCode(newCode) {
  var code = safeTrim(newCode || '');
  if (!code) {
    throw new Error('Parent access code is required.');
  }
  if (code.length < 4) {
    throw new Error('Parent access code must be at least 4 characters long.');
  }
  PropertiesService.getScriptProperties().setProperty(PARENT_ACCESS_CODE_PROP, code);
  return code;
}

function generateParentSessionToken() {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put(token, 'valid', PARENT_SESSION_TTL_SECONDS);
  return token;
}

function verifyParentSessionToken(token) {
  var supplied = safeTrim(token || '');
  if (!supplied) return false;
  var expected = getParentAccessCode();
  if (expected && supplied === expected) return true;
  try {
    if (CacheService.getScriptCache().get(supplied) === 'valid') return true;
  } catch (e) {}
  return false;
}

function invalidateAdminToken(token) {
  if (token) {
    try {
      CacheService.getScriptCache().remove(token);
    } catch (e) {}
  }
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

    // 1a. PUBLIC: SCRIPT VERSION CHECK
    if (actionLower === 'getversion' || action === 'getVersion' || actionLower === 'version') {
      return createJsonResponse({
        success: true,
        version: SCRIPT_VERSION,
        build: SCRIPT_BUILD,
        name: 'Artisan Oven Backend'
      });
    }

    // 1b. PUBLIC: PARENT ACCESS AUTH
    if (actionLower === 'parentauth' || action === 'parentAuth') {
      var suppliedCode = safeTrim(params.code || params.accessCode || '');
      var expectedCode = getParentAccessCode();
      if (!suppliedCode || !expectedCode || suppliedCode !== expectedCode) {
        return createJsonResponse({ success: false, message: 'Access denied.' });
      }
      var token = generateParentSessionToken();
      return createJsonResponse({
        success: true,
        token: token,
        expiresInSeconds: PARENT_SESSION_TTL_SECONDS,
        message: 'Access granted.'
      });
    }

    // 1c. PUBLIC: GET EVENTS LIST
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

    // 1d. PUBLIC: CREATE INTERNAL PARENT ORDER
    if (actionLower === 'createparentorder' || action === 'createParentOrder') {
      var parentToken = safeTrim(params.token || params.sessionToken || '');
      if (!verifyParentSessionToken(parentToken)) {
        return createJsonResponse({ success: false, message: 'Access denied.' });
      }

      var parentName = sanitizeForSheet(params.parentName || params.name || '');
      var parentEmail = sanitizeForSheet(params.parentEmail || params.email || '');
      var childName = sanitizeForSheet(params.childName || '');
      var childClass = sanitizeForSheet(params.class || params.childClass || '');
      var paymentMethod = sanitizeForSheet(params.paymentMethod || 'Bank Transfer');
      var notes = sanitizeForSheet(params.notes || params.orderNotes || '');
      var submissionId = safeTrim(params.submissionId || '');
      var rawItems = params.items || [];
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems); } catch (e) { rawItems = []; }
      }

      if (!parentName || !parentEmail || !isValidEmail(parentEmail)) {
        return createJsonResponse({ success: false, message: 'Please provide a valid parent name and email address.' });
      }
      if (!childName || !childClass) {
        return createJsonResponse({ success: false, message: 'Please provide the child name and class.' });
      }
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return createJsonResponse({ success: false, message: 'Please include at least one pizza item.' });
      }

      if (submissionId) {
        var orderCache = CacheService.getScriptCache();
        if (orderCache.get(submissionId)) {
          return createJsonResponse({ success: false, message: 'This order was already submitted successfully.' });
        }
        try { orderCache.put(submissionId, 'processed', 300); } catch (e) {}
      }

      var validatedItems = [];
      var originalTotal = 0;
      for (var pi = 0; pi < rawItems.length; pi++) {
        var item = rawItems[pi];
        var sizeKey = safeTrim(item.size || '');
        var qty = parseInt(item.qty, 10);
        if (!PRICE_MAP[sizeKey]) {
          return createJsonResponse({ success: false, message: 'Invalid pizza size selected.' });
        }
        if (isNaN(qty) || qty < 1 || qty > 50) {
          return createJsonResponse({ success: false, message: 'Invalid quantity.' });
        }
        var unitPrice = PRICE_MAP[sizeKey];
        originalTotal += unitPrice * qty;
        validatedItems.push({ size: sizeKey, qty: qty, unitPrice: unitPrice });
      }

      var discountInfo = getDiscount(INTERNAL_PARENT_DISCOUNT_CODE, originalTotal);
      if (!discountInfo || !discountInfo.valid) {
        return createJsonResponse({ success: false, message: 'Unable to apply the internal parent discount.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var parentSheet = ensureInternalParentOrdersSheet(ss);
      var orderId = getNextOrderNumber();
      var orderToken = Utilities.getUuid();
      var finalTotal = Number(discountInfo.newTotal) || 0;
      var discountAmount = Number(discountInfo.discountAmount) || 0;

      parentSheet.appendRow([
        new Date(),
        orderId,
        parentName,
        parentEmail,
        childName,
        childClass,
        JSON.stringify(validatedItems),
        originalTotal,
        discountAmount,
        finalTotal,
        paymentMethod,
        'Pending Payment',
        'Confirmed',
        'PENDING',
        notes,
        orderToken,
        false,
        'INTERNAL_PARENT'
      ]);
      SpreadsheetApp.flush();

      try { sendParentOrderConfirmation(orderId); } catch (err) {
        Logger.log('Error sending parent confirmation email: ' + err);
      }
      try { sendInternalParentOrderNotification(orderId); } catch (err) {
        Logger.log('Error sending parent organiser notification: ' + err);
      }
      // Keep the operational workbook and emailed snapshot in sync with
      // regular orders whenever a parent order is received.
      try {
        rebuildCleanSheets();
        emailXlsxSnapshot();
      } catch (err) {
        Logger.log('Error rebuilding/emailing parent order update: ' + err);
      }

      return createJsonResponse({
        success: true,
        orderId: orderId,
        originalTotal: originalTotal,
        discountAmount: discountAmount,
        finalTotal: finalTotal,
        token: orderToken,
        message: 'Parent order successfully placed.'
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
        var totalAfterDiscount = result.totalAfterDiscount !== undefined ? result.totalAfterDiscount : result.total;
        return createJsonResponse({
          success: true,
          orderId: result.formattedOrderId,
          customerName: result.payerName,
          email: result.payerEmail,
          paymentMethod: result.paymentMethod,
          paid: result.paid,
          total: totalAfterDiscount,
          totalAfterDiscount: totalAfterDiscount,
          totalFormatted: '£' + totalAfterDiscount.toFixed(2),
          discountCode: result.discountCode || '',
          discountAmount: result.discountAmount || 0,
          discountReason: result.discountReason || '',
          order: result.pizzas,
          paypalMeUrl: PAYPAL_ME_BASE + '/' + totalAfterDiscount.toFixed(2),
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
      var lastRow = raw.getLastRow();
      var startRowIndex = Math.max(1, (parseInt(settings.sessionStartRow, 10) || 2) - 1);
      
      var totalPizzas = 0;
      var totalOrders = 0;

      // OPTIMIZATION: Only read rows from the current session start row onwards
      if (lastRow > startRowIndex) {
        var data = raw.getRange(startRowIndex + 1, 1, lastRow - startRowIndex, raw.getLastColumn()).getValues();
        for (var r = 0; r < data.length; r++) {
          var row = data[r];
          if (!row || rowIsBlank(row)) continue;
          if (isRowDeleted(row)) continue;

          var stats = calculateRowPizzaStats(row);
          totalPizzas += stats.pizzaCapacity;
          if (stats.pizzaSelections > 0) totalOrders++;
        }
      }

      var parentSheet = ss.getSheetByName('Internal Parent Orders');
      if (parentSheet) {
        var pLastRow = parentSheet.getLastRow();
        if (pLastRow >= 2) {
          var parentData = parentSheet.getRange(2, 1, pLastRow - 1, parentSheet.getLastColumn()).getValues();
          for (var pr = 0; pr < parentData.length; pr++) {
            var parentRow = parentData[pr];
            if (!parentRow || rowIsBlank(parentRow)) continue;
            if (safeTrim(String(parentRow[16] || '')).toUpperCase() === 'TRUE') continue;
            var parentItemsJson = safeTrim(String(parentRow[6] || '[]'));
            try {
              var parentItems = JSON.parse(parentItemsJson);
              for (var pi = 0; pi < parentItems.length; pi++) {
                var parentItem = parentItems[pi] || {};
                totalPizzas += getPizzaCapacityValue(parentItem.size || '') * (parseInt(parentItem.qty, 10) || 0);
              }
            } catch (e) {
              Logger.log('Error parsing Internal Parent Orders items for status: ' + e);
            }
          }
        }
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

    // 3. ADMIN: LOGIN & AUTH
    if (actionLower === 'adminauth' || action === 'adminAuth' || action === 'adminLogin' || actionLower === 'adminlogin') {
      var suppliedCode = safeTrim(params.code || params.accessCode || params.password || '');
      var expectedCode = getAdminAccessCode();
      if (!suppliedCode || !expectedCode || suppliedCode !== expectedCode) {
        return createJsonResponse({
          success: false,
          message: 'Access denied. Incorrect password.'
        });
      }
      logAdminAction('Admin Login', 'Successful login from web interface');
      return createJsonResponse({
        success: true,
        token: suppliedCode,
        message: 'Access granted.'
      });
    }

    // 3b. KITCHEN BOARD: LOAD SAVED READ-ONLY STATE
    if (actionLower === 'kitchenload' || action === 'kitchenLoad') {
      var kitchenToken = safeTrim(params.token || '');
      if (!verifyAdminToken(kitchenToken)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
      }
      return createJsonResponse({ success: true, state: loadKitchenBoardState() });
    }

    // 3b.1. KITCHEN BOARD: FAST CHANGE CHECK FOR OPEN BOARDS
    if (actionLower === 'kitchenstatus' || action === 'kitchenStatus') {
      var statusToken = safeTrim(params.token || '');
      if (!verifyAdminToken(statusToken)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
      }
      return createJsonResponse({ success: true, updatedAt: getKitchenBoardUpdatedAt() });
    }

    // 3c. KITCHEN BOARD: SAVE CLIENT-SIDE BOARD STATE
    if (actionLower === 'kitchensave' || action === 'kitchenSave') {
      var saveToken = safeTrim(params.token || '');
      if (!verifyAdminToken(saveToken)) {
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
      }
      var kitchenPayload = params.payload || '';
      if (!kitchenPayload || kitchenPayload.length > 500000) {
        return createJsonResponse({ success: false, message: 'Kitchen board state is missing or too large.' });
      }
      try {
        var parsedKitchenState = JSON.parse(kitchenPayload);
        var savedAt = saveKitchenBoardState(parsedKitchenState);
        return createJsonResponse({ success: true, savedAt: savedAt });
      } catch (kitchenError) {
        return createJsonResponse({ success: false, message: 'Kitchen board state could not be saved.' });
      }
    }

    // 4. ADMIN: GET ALL SETTINGS
    if (action === 'adminGetSettings' || actionLower === 'admingetsettings') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var currentSettings = getSettings();
      var stats = calculateCurrentSessionStats(currentSettings);

      return createJsonResponse({
        success: true,
        version: SCRIPT_VERSION,
        build: SCRIPT_BUILD,
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
          message: 'Access denied. Incorrect password.'
        });
      }
      var combinedOrders = getAllOrdersForAdmin();
      var parentOrders = getAllParentOrdersForAdmin();
      parentOrders.forEach(function(parentOrder) {
        var childNames = safeTrim(parentOrder.childName || '').split(/\s*,\s*/).filter(Boolean);
        var childClasses = safeTrim(parentOrder.className || '').split(/\s*,\s*/).filter(Boolean);
        var pizzaItems = [];
        (parentOrder.items || []).forEach(function(item) {
          var quantity = parseInt(item.qty, 10) || 0;
          for (var pi = 0; pi < quantity; pi++) {
            pizzaItems.push({
              recipient: childNames[pizzaItems.length] || childNames[0] || 'Child',
              size: item.size || 'Pizza',
              sizeKey: item.sizeKey || '',
              capacity: getPizzaCapacityValue(item.sizeKey || ''),
              price: Number(item.unitPrice || 0),
              class: childClasses[pizzaItems.length] || childClasses[0] || ''
            });
          }
        });
        var capacity = pizzaItems.reduce(function(sum, item) {
          return sum + item.capacity;
        }, 0);
        combinedOrders.push({
          orderId: parentOrder.orderId,
          timestamp: parentOrder.timestamp,
          customer: { name: parentOrder.parentName, email: parentOrder.parentEmail },
          allergy: '',
          pizzas: pizzaItems,
          total: Number(parentOrder.finalTotal || 0),
          totalAfterDiscount: Number(parentOrder.finalTotal || 0),
          discountCode: INTERNAL_PARENT_DISCOUNT_CODE,
          discountAmount: Number(parentOrder.discountAmount || 0),
          discountReason: 'Internal parent discount',
          pizzaCount: normalizePizzaCapacity(capacity),
          totalCapacity: normalizePizzaCapacity(capacity),
          itemCount: pizzaItems.length,
          paymentStatus: parentOrder.paymentStatus || 'Pending Payment',
          paymentMethod: parentOrder.paymentMethod || 'Bank Transfer',
          source: 'parent'
        });
      });
      return createJsonResponse({
        success: true,
        orders: combinedOrders
      });
    }

    // 5b. ADMIN: GET PARENT ORDERS
    if (action === 'adminGetParentOrders' || actionLower === 'admingetparentorders') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }
      return createJsonResponse({
        success: true,
        orders: getAllParentOrdersForAdmin()
      });
    }

    // 5c. ADMIN: ROTATE PARENT ACCESS CODE
    if (action === 'adminSetParentAccessCode' || actionLower === 'adminsetparentaccesscode') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }
      var newCode = safeTrim(params.parentAccessCode || params.code || '');
      if (!newCode) {
        return createJsonResponse({ success: false, message: 'Parent access code is required.' });
      }
      try {
        setParentAccessCode(newCode);
        logAdminAction('Parent Access Code Updated', 'Rotated parent access code.');
        return createJsonResponse({ success: true, message: 'Parent access code updated.' });
      } catch (err) {
        return createJsonResponse({ success: false, message: err.toString() });
      }
    }

    // 5d. ADMIN: UPDATE SETTINGS
    if (action === 'adminUpdateSettings' || actionLower === 'adminupdatesettings') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
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
      if (payload.ordersTeamEmail !== undefined) updated.ordersTeamEmail = safeTrim(payload.ordersTeamEmail);

      var newSettings = saveSettings(updated);
      logAdminAction('Settings Updated', JSON.stringify(updated));

      return createJsonResponse({
        success: true,
        message: 'Settings saved successfully.',
        settings: newSettings,
        stats: calculateCurrentSessionStats(newSettings)
      });
    }

    // 5c. ADMIN: LIVE ORDERS CHECKLIST
    if (action === 'adminGetOrdersChecklist' || actionLower === 'admingetorderschecklist') {
      var checklistToken = safeTrim(params.token || '');
      if (!verifyAdminToken(checklistToken)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var checklist = getCurrentSessionOrderChecklist();
      return createJsonResponse({
        success: true,
        html: renderOrdersChecklistHtml(checklist, false),
        sessionLabel: checklist.sessionLabel,
        itemCount: checklist.items.length,
        totalCapacity: checklist.totalCapacity
      });
    }

    // 5d. ADMIN: EMAIL LIVE ORDERS CHECKLIST AS PDF
    if (action === 'emailOrdersPdf' || actionLower === 'emailorderspdf') {
      var ordersEmailToken = safeTrim(params.token || '');
      if (!verifyAdminToken(ordersEmailToken)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var ordersChecklist = getCurrentSessionOrderChecklist();
      var ordersSettings = getSettings();
      var recipients = safeTrim(ordersSettings.ordersTeamEmail || YOUR_EMAIL);
      if (!recipients) {
        return createJsonResponse({ success: false, message: 'No team email recipients are configured.' });
      }

      var pdfHtml = HtmlService.createTemplate(renderOrdersChecklistHtml(ordersChecklist, true))
        .evaluate()
        .getContent();
      var pdfBlob = Utilities.newBlob(pdfHtml, 'text/html', 'orders.html')
        .getAs('application/pdf')
        .setName('Orders - ' + ordersChecklist.sessionLabel + '.pdf');
      MailApp.sendEmail({
        to: recipients,
        subject: 'Orders - ' + ordersChecklist.sessionLabel,
        body: 'Attached is the live orders checklist for ' + ordersChecklist.sessionLabel + '.',
        attachments: [pdfBlob]
      });
      logAdminAction('Email Orders Checklist', 'Sent live PDF to ' + recipients + ' (' + ordersChecklist.items.length + ' items)');
      return createJsonResponse({
        success: true,
        message: 'Orders PDF emailed to ' + recipients + '.'
      });
    }

    // 6. ADMIN: START NEW WEEK / NEW SESSION
    if (action === 'adminStartNewSession' || actionLower === 'adminstartnewsession') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      var lastRow = raw.getLastRow();
      
      // Email previous week's complete data archive before clearing
      if (lastRow > 1) {
        try {
          var settingsBeforeReset = getSettings();
          var recipient = safeTrim(settingsBeforeReset.ordersTeamEmail || YOUR_EMAIL);
          if (recipient) {
            sendInternalSummaryEmail(recipient, 'ARCHIVE: Previous Week Data Snapshot prior to New Week Reset (' + (settingsBeforeReset.serviceDate || 'Previous Session') + ')');
            emailXlsxSnapshot(recipient);
          }
        } catch (archiveErr) {
          Logger.log('Failed to email previous week archive: ' + archiveErr);
        }
      }

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
          message: 'Access denied. Incorrect password.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var source = safeTrim(params.source || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      if (source === 'parent') {
        try {
          var parentSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Internal Parent Orders');
          if (parentSheet && parentSheet.getLastRow() >= 2) {
            var parentRows = parentSheet.getDataRange().getValues();
            for (var parentIndex = 1; parentIndex < parentRows.length; parentIndex++) {
              if (safeTrim(String(parentRows[parentIndex][1] || '')).toUpperCase() === orderId.toUpperCase()) {
                parentSheet.getRange(parentIndex + 1, 14).setValue('');
                break;
              }
            }
          }
          sendParentOrderConfirmation(orderId);
          logAdminAction('Resend Confirmation', 'Manually resent confirmation for Parent Order #' + orderId);
          return createJsonResponse({ success: true, message: 'Confirmation resent successfully for Parent Order #' + orderId });
        } catch (err) {
          return createJsonResponse({ success: false, message: 'Error resending parent confirmation: ' + err.toString() });
        }
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

    // 7b. ADMIN: SEND AUTOMATED EMAIL (Customer & Internal Team)
    if (action === 'adminSendAutomatedEmail' || actionLower === 'adminsendautomatedemail') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var category = safeTrim(params.category || params.emailCategory || 'customer');
      var emailType = safeTrim(params.type || params.emailType || 'confirmation');
      var recipient = safeTrim(params.recipient || '');
      var orderId = safeTrim(params.orderId || '');
      var source = safeTrim(params.source || '');
      var subject = safeTrim(params.subject || '');
      var message = safeTrim(params.message || params.notes || '');

      // Internal email dispatch
      if (category === 'internal' || emailType === 'spreadsheet' || emailType === 'summary') {
        var targetEmail = recipient || 'louis@benne.co.uk';
        if (!targetEmail) targetEmail = 'louis@benne.co.uk';

        if (emailType === 'summary') {
          try {
            var clientStats = null;
            if (params.lunchTotalOrders !== undefined || params.lunchOrders !== undefined) {
              clientStats = {
                lunchOrders: params.lunchTotalOrders || params.lunchOrders,
                lunchPizzas: params.lunchTotalPizzas || params.lunchPizzas,
                lunchItems: params.lunchTotalItems || params.lunchItems,
                lunchPending: params.lunchPending,
                lunchPaid: params.lunchPaid,
                parentOrders: params.parentTotalOrders || params.parentOrders,
                parentPizzas: params.parentTotalPizzas || params.parentPizzas,
                parentPending: params.parentPending,
                parentPaid: params.parentPaid,
                capacityMax: params.capacityMax,
                capacityRemaining: params.capacityRemaining
              };
            }
            sendInternalSummaryEmail(targetEmail, message, clientStats);
            logAdminAction('Send Automated Email', 'Dispatched operational summary to ' + targetEmail);
            return createJsonResponse({
              success: true,
              message: 'Operational summary report emailed successfully to ' + targetEmail
            });
          } catch (sumErr) {
            return createJsonResponse({
              success: false,
              message: 'Failed to send summary email: ' + sumErr.toString()
            });
          }
        } else {
          // Default internal: Live spreadsheet .xlsx export
          try {
            rebuildCleanSheets();
            emailXlsxSnapshot(targetEmail);
            logAdminAction('Send Automated Email', 'Dispatched live spreadsheet snapshot (.xlsx) to ' + targetEmail);
            return createJsonResponse({
              success: true,
              message: 'Live spreadsheet snapshot (.xlsx) emailed successfully to ' + targetEmail
            });
          } catch (sheetErr) {
            return createJsonResponse({
              success: false,
              message: 'Failed to send live spreadsheet: ' + sheetErr.toString()
            });
          }
        }
      }

      // Customer email dispatch
      if (category === 'customer') {
        if (!recipient && !orderId) {
          return createJsonResponse({ success: false, message: 'Please provide either a Customer Email or Order ID.' });
        }

        if (emailType === 'confirmation') {
          if (!orderId) {
            return createJsonResponse({ success: false, message: 'Order ID is required to send confirmation email.' });
          }

          if (source === 'parent' || /^P/i.test(orderId)) {
            try {
              sendParentOrderConfirmation(orderId);
              logAdminAction('Send Automated Email', 'Sent confirmation for Parent Order #' + orderId);
              return createJsonResponse({ success: true, message: 'Confirmation sent for Parent Order #' + orderId });
            } catch (errP) {
              return createJsonResponse({ success: false, message: 'Error sending parent confirmation: ' + errP.toString() });
            }
          } else if (source === 'event' || /^E/i.test(orderId)) {
            try {
              sendEventConfirmation(orderId);
              logAdminAction('Send Automated Email', 'Sent confirmation for Event Order #' + orderId);
              return createJsonResponse({ success: true, message: 'Confirmation sent for Event Order #' + orderId });
            } catch (errE) {
              return createJsonResponse({ success: false, message: 'Error sending event confirmation: ' + errE.toString() });
            }
          } else {
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
            raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('');
            SpreadsheetApp.flush();
            try {
              sendOrderConfirmationForRow(rowNum);
              logAdminAction('Send Automated Email', 'Sent confirmation for School Lunch Order #' + orderId);
              return createJsonResponse({ success: true, message: 'Confirmation sent successfully for Order #' + orderId });
            } catch (errL) {
              return createJsonResponse({ success: false, message: 'Error sending confirmation: ' + errL.toString() });
            }
          }
        } else if (emailType === 'ready') {
          if (!recipient) {
            return createJsonResponse({ success: false, message: 'Recipient email is required.' });
          }
          try {
            sendCustomerOrderReadyEmail(recipient, orderId, message);
            logAdminAction('Send Automated Email', 'Sent collection ready notice for Order #' + orderId + ' to ' + recipient);
            return createJsonResponse({ success: true, message: 'Collection ready email sent to ' + recipient });
          } catch (readyErr) {
            return createJsonResponse({ success: false, message: 'Error sending ready notice: ' + readyErr.toString() });
          }
        } else {
          // Custom / payment reminder
          if (!recipient) {
            return createJsonResponse({ success: false, message: 'Recipient email is required.' });
          }
          try {
            var finalSubject = subject || ('Artisan Oven — Update regarding your pizza order' + (orderId ? ' #' + orderId : ''));
            sendCustomerCustomEmail(recipient, finalSubject, message);
            logAdminAction('Send Automated Email', 'Sent customer update email to ' + recipient);
            return createJsonResponse({ success: true, message: 'Email sent successfully to ' + recipient });
          } catch (custErr) {
            return createJsonResponse({ success: false, message: 'Error sending customer email: ' + custErr.toString() });
          }
        }
      }

      return createJsonResponse({ success: false, message: 'Invalid email request parameters.' });
    }

    // 8. ADMIN: UPDATE PAYMENT STATUS
    if (action === 'adminUpdatePaidStatus' || actionLower === 'adminupdatepaidstatus') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var status = safeTrim(params.status || ''); // 'Paid' or 'Pending'
      var source = safeTrim(params.source || 'lunch');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();

      if (source === 'parent') {
        var parentSheet = ss.getSheetByName('Internal Parent Orders');
        var foundParentRow = -1;
        var parentData = parentSheet ? parentSheet.getDataRange().getValues() : [];
        for (var i = 1; i < parentData.length; i++) {
          if (safeTrim(String(parentData[i][1])).toUpperCase() === orderId.toUpperCase()) {
            foundParentRow = i + 1;
            break;
          }
        }
        if (foundParentRow < 2) {
          return createJsonResponse({ success: false, message: 'Parent order #' + orderId + ' not found.' });
        }
        parentSheet.getRange(foundParentRow, 12).setValue(status);
        SpreadsheetApp.flush();
        logAdminAction('Payment Updated', 'Parent Order #' + orderId + ' set to ' + status);
        return createJsonResponse({ success: true, message: 'Parent Order #' + orderId + ' status updated to ' + status });
      }

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

      if (status && status.toLowerCase() === 'paid') {
        var paymentRow = raw.getRange(rowNum, 1, 1, raw.getLastColumn()).getValues()[0];
        var paymentHeaders = raw.getRange(1, 1, 1, raw.getLastColumn()).getValues()[0];
        var paymentDiscount = getOrderDiscountInfo(paymentRow, paymentHeaders, calculateOrderSubtotalFromRow(paymentRow));
        if (paymentDiscount && paymentDiscount.code) {
          var paymentCodeRow = getDiscount(paymentDiscount.code, calculateOrderSubtotalFromRow(paymentRow));
          if (paymentCodeRow && paymentCodeRow.valid && paymentCodeRow.rowIndex) {
            incrementDiscountUsage(paymentCodeRow.rowIndex);
          }
        }
      }

      logAdminAction('Payment Updated', 'Order #' + orderId + ' set to ' + status);
      
      return createJsonResponse({ success: true, message: 'Order #' + orderId + ' status updated to ' + status });
    }

    // 8b. ADMIN: UPDATE PAYMENT METHOD (ROOTED IN PIZZA ORDER UPDATE SHEET)
    if (action === 'adminUpdatePaymentMethod' || actionLower === 'adminupdatepaymentmethod') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var method = safeTrim(params.paymentMethod || params.method || '');
      if (!orderId || !method) {
        return createJsonResponse({ success: false, message: 'Order ID and Payment Method are required.' });
      }

      var normalizedMethod = mapPaymentMethod(method);
      var ss = SpreadsheetApp.getActiveSpreadsheet();

      // 1. Update in Pizza Order Update sheet if present
      try {
        var updateSheet = ss.getSheetByName('Pizza Order Update');
        if (updateSheet) {
          var uData = updateSheet.getDataRange().getValues();
          var idIdx = -1;
          var methodIdx = -1;
          if (uData.length > 0) {
            var uHeaders = uData[0];
            for (var h = 0; h < uHeaders.length; h++) {
              var ut = String(uHeaders[h]).toLowerCase();
              if (ut === 'order id') idIdx = h;
              if (ut === 'payment method') methodIdx = h;
            }
          }
          if (idIdx !== -1 && methodIdx !== -1) {
            var found = false;
            for (var i = 1; i < uData.length; i++) {
              if (String(uData[i][idIdx]) === orderId) {
                updateSheet.getRange(i + 1, methodIdx + 1).setValue(normalizedMethod);
                found = true;
                break;
              }
            }
            if (!found) {
              // Append new override row
              var newRow = [];
              for (var c = 0; c < uHeaders.length; c++) {
                if (c === idIdx) newRow.push(orderId);
                else if (c === methodIdx) newRow.push(normalizedMethod);
                else newRow.push('');
              }
              updateSheet.appendRow(newRow);
            }
          }
        }
      } catch (e) {
        Logger.log('adminUpdatePaymentMethod update sheet sync error: ' + e);
      }

      logAdminAction('Payment Method Updated', 'Order #' + orderId + ' method set to ' + normalizedMethod);
      return createJsonResponse({ success: true, message: 'Order #' + orderId + ' payment method updated to ' + normalizedMethod });
    }

    // 9. ADMIN: DELETE ORDER
    if (action === 'adminDeleteOrder' || actionLower === 'admindeleteorder') {
      var token = safeTrim(params.token || '');
      if (!verifyAdminToken(token)) {
        return createJsonResponse({
          success: false,
          unauthorized: true,
          message: 'Access denied. Incorrect password.'
        });
      }

      var orderId = safeTrim(params.orderId || '');
      var source = safeTrim(params.source || '');
      if (!orderId) {
        return createJsonResponse({ success: false, message: 'Order ID is required.' });
      }

      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var parentSheet = ss.getSheetByName('Internal Parent Orders');
      var foundParentRow = -1;
      if (parentSheet && parentSheet.getLastRow() >= 2) {
        var parentData = parentSheet.getDataRange().getValues();
        for (var i = 1; i < parentData.length; i++) {
          if (safeTrim(String(parentData[i][1])).toUpperCase() === orderId.toUpperCase()) {
            foundParentRow = i + 1;
            break;
          }
        }
      }

      if (source === 'parent' || foundParentRow >= 2) {
        if (foundParentRow < 2) {
          return createJsonResponse({ success: false, message: 'Parent order #' + orderId + ' not found.' });
        }
        parentSheet.getRange(foundParentRow, 17).setValue('TRUE');
        SpreadsheetApp.flush();
        logAdminAction('Delete Parent Order', 'Parent Order #' + orderId + ' marked as deleted');
        return createJsonResponse({ success: true, message: 'Parent Order #' + orderId + ' deleted successfully.' });
      }

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
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
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
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
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
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
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
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
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
        return createJsonResponse({ success: false, unauthorized: true, message: 'Access denied. Incorrect password.' });
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
        var paymentStatus = safeTrim(String(row[10])) || 'Pending Payment';
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
          message: 'Access denied. Incorrect password.'
        });
      }

      var currentPass = safeTrim(params.currentPassword || params.currentCode || '');
      var newPass = safeTrim(params.newPassword || params.newCode || '');

      if (currentPass !== getAdminAccessCode()) {
        return createJsonResponse({
          success: false,
          message: 'Current access code is not correct.'
        });
      }

      if (!newPass || newPass.length < 4) {
        return createJsonResponse({
          success: false,
          message: 'New access code must be at least 4 characters.'
        });
      }

      setAdminPassword(newPass);
      logAdminAction('Access Code Changed', 'Shared access code updated');

      return createJsonResponse({
        success: true,
        message: 'Shared access code updated successfully.'
      });
    }

    // 8. ADMIN: LOGOUT
    if (action === 'adminLogout' || actionLower === 'adminlogout') {
      invalidateAdminToken(safeTrim(params.token || ''));
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

function ensureDiscountCodeSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;

  var sheet = ss.getSheetByName('Discount Codes');
  if (!sheet) {
    sheet = ss.insertSheet('Discount Codes');
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Code', 'Type', 'Value', 'MaxUses', 'TimesUsed', 'Active', 'ExpiresOn']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#E8E8E8');
  }

  var headers = sheet.getRange(1, 1, 1, Math.max(7, sheet.getLastColumn())).getValues()[0];
  var required = ['Code', 'Type', 'Value', 'MaxUses', 'TimesUsed', 'Active', 'ExpiresOn'];
  var missing = [];
  for (var i = 0; i < required.length; i++) {
    if (headers.indexOf(required[i]) === -1) {
      missing.push(required[i]);
    }
  }

  if (missing.length > 0) {
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(required);
    } else {
      var nextCol = sheet.getLastColumn() + 1;
      for (var j = 0; j < missing.length; j++) {
        sheet.getRange(1, nextCol + j).setValue(missing[j]);
      }
    }
  }

  var codeColumn = headers.indexOf('Code');
  if (codeColumn !== -1) {
    var codeValues = sheet.getRange(2, codeColumn + 1, Math.max(1, sheet.getLastRow() - 1), 1).getValues();
    var hasDefaultCode = codeValues.some(function(row) {
      return safeTrim(row[0]).toUpperCase() === 'STMSCS';
    });
    if (!hasDefaultCode) {
      sheet.appendRow(['STMSCS', 'percent', 15, '', 0, true, '']);
    }
    var hasMuttiCode = codeValues.some(function(row) {
      var c = safeTrim(row[0]).toUpperCase();
      return c === 'MUTTI' || c === 'INTERNAL_PARENT_50';
    });
    if (!hasMuttiCode) {
      sheet.appendRow(['MUTTI', 'percent', 50, '', 0, true, '']);
    }
  }

  return sheet;
}

function ensureDiscountColumns(sheet) {
  if (!sheet) return;

  var lastCol = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var required = ['Discount Code', 'Discount Amount (£)', 'Total After Discount (£)', 'Discount Reason'];
  var missing = [];

  for (var i = 0; i < required.length; i++) {
    if (headers.indexOf(required[i]) === -1) {
      missing.push(required[i]);
    }
  }

  if (missing.length > 0) {
    var insertAt = lastCol + 1;
    for (var j = 0; j < missing.length; j++) {
      sheet.getRange(1, insertAt + j).setValue(missing[j]);
    }
  }
}

function normalizeHeaderName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function findHeaderIndex(headers, possibleNames) {
  if (!headers || !headers.length) return -1;

  var normalizedHeaders = [];
  for (var i = 0; i < headers.length; i++) {
    normalizedHeaders.push(normalizeHeaderName(headers[i]));
  }

  for (var j = 0; j < possibleNames.length; j++) {
    var name = normalizeHeaderName(possibleNames[j]);
    var idx = normalizedHeaders.indexOf(name);
    if (idx !== -1) return idx;
  }

  for (var k = 0; k < normalizedHeaders.length; k++) {
    var current = normalizedHeaders[k];
    for (var l = 0; l < possibleNames.length; l++) {
      var candidate = normalizeHeaderName(possibleNames[l]);
      if (!candidate) continue;
      if (current === candidate || current.indexOf(candidate) !== -1 || candidate.indexOf(current) !== -1) {
        return k;
      }
    }

    if (current.indexOf('discount code') !== -1 || current.indexOf('staff sibling discount') !== -1) {
      return k;
    }
  }

  return -1;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function calculateOrderSubtotalFromRow(row) {
  if (!row || !row.length) return 0;

  var qtyRaw = safeTrim(row[3]);
  var qtyDigit = extractDigit(qtyRaw) || '0';
  var blocks = BRANCHES[qtyDigit] || [];
  var subtotal = 0;

  for (var b = 0; b < blocks.length; b++) {
    var cols = blocks[b];
    if (!cols) continue;
    var sizeRaw = safeTrim(row[cols[0]]);
    var childName = safeTrim(row[cols[1]]);
    if (!sizeRaw && !childName) continue;
    var size = mapSize(sizeRaw);
    subtotal += PRICE_MAP[size] || 0;
  }

  return roundCurrency(subtotal);
}

function getOrderDiscountInfo(row, headers, subtotal) {
  if (!row || !headers) return null;
  var codeCol = findHeaderIndex(headers, ['Discount Code', 'Discount code']);
  var rawCode = codeCol === -1 ? '' : safeTrim(row[codeCol]);
  if (!rawCode) {
    for (var i = 0; i < row.length; i++) {
      var val = safeTrim(row[i]).toUpperCase();
      if (val === 'STMSCS' || val === 'INTERNAL_PARENT_50' || val === 'INTERNAL_PARENT') {
        rawCode = val === 'INTERNAL_PARENT' ? INTERNAL_PARENT_DISCOUNT_CODE : val;
        break;
      }
    }
  }
  if (!rawCode) {
    var email = extractPayerEmail(row).toLowerCase();
    if (email && PARENT_EMAILS.indexOf(email) !== -1) {
      rawCode = INTERNAL_PARENT_DISCOUNT_CODE;
    }
  }
  if (!rawCode) return null;

  var activeSubtotal = typeof subtotal === 'number' ? subtotal : calculateOrderSubtotalFromRow(row);
  var discount = getDiscount(rawCode, activeSubtotal);
  if (!discount || !discount.valid) {
    return null;
  }

  return {
    code: discount.code,
    type: discount.type,
    value: discount.value,
    discountAmount: roundCurrency(discount.discountAmount),
    totalAfterDiscount: roundCurrency(discount.newTotal),
    discountReason: discount.code === INTERNAL_PARENT_DISCOUNT_CODE ? '50% internal parent discount' : ''
  };
}

function applyDiscountToResponseRow(rawSheet, rowNum) {
  if (!rawSheet || !rowNum) return null;
  ensureDiscountCodeSheet();
  ensureDiscountColumns(rawSheet);

  var headers = rawSheet.getRange(1, 1, 1, rawSheet.getLastColumn()).getValues()[0];
  var row = rawSheet.getRange(rowNum, 1, 1, rawSheet.getLastColumn()).getValues()[0];
  var codeCol = findHeaderIndex(headers, ['Discount Code', 'Discount code']);
  var amountCol = findHeaderIndex(headers, ['Discount Amount (£)', 'Discount Amount']);
  var totalCol = findHeaderIndex(headers, ['Total After Discount (£)', 'Total After Discount']);
  var reasonCol = findHeaderIndex(headers, ['Discount Reason']);

  if (codeCol === -1) {
    return null;
  }

  var rawCode = safeTrim(row[codeCol]);
  var subtotal = calculateOrderSubtotalFromRow(row);
  var discount = rawCode ? getDiscount(rawCode, subtotal) : null;

  if (amountCol !== -1) {
    rawSheet.getRange(rowNum, amountCol + 1).setValue(discount && discount.valid ? discount.discountAmount : 0);
  }
  if (totalCol !== -1) {
    rawSheet.getRange(rowNum, totalCol + 1).setValue(discount && discount.valid ? discount.newTotal : subtotal);
  }
  if (reasonCol !== -1) {
    rawSheet.getRange(rowNum, reasonCol + 1).setValue(discount && discount.valid ? '' : (discount ? discount.reason : ''));
  }
  if (codeCol !== -1) {
    rawSheet.getRange(rowNum, codeCol + 1).setValue(rawCode.toUpperCase());
  }

  return discount && discount.valid ? {
    code: discount.code,
    discountAmount: roundCurrency(discount.discountAmount),
    totalAfterDiscount: roundCurrency(discount.newTotal)
  } : null;
}

function getDiscount(rawCode, subtotal) {
  if (!rawCode) return null;

  var code = safeTrim(rawCode).toUpperCase();
  if (!code) return null;

  if (code === 'STMSCS') {
    var defaultDiscountAmount = roundCurrency((Number(subtotal) || 0) * 0.15);
    return {
      valid: true,
      code: code,
      type: 'percent',
      value: 15,
      discountAmount: defaultDiscountAmount,
      newTotal: Math.max(0, roundCurrency((Number(subtotal) || 0) - defaultDiscountAmount))
    };
  }

  if (code === 'MUTTI' || code === 'INTERNAL_PARENT_50' || code === 'INTERNAL_PARENT') {
    var muttiDiscountAmount = roundCurrency((Number(subtotal) || 0) * 0.50);
    return {
      valid: true,
      code: 'MUTTI',
      type: 'percent',
      value: 50,
      discountAmount: muttiDiscountAmount,
      newTotal: Math.max(0, roundCurrency((Number(subtotal) || 0) - muttiDiscountAmount))
    };
  }

  var sheet = ensureDiscountCodeSheet();
  if (!sheet) return null;

  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return null;

  var headers = rows[0];
  var col = {};
  for (var i = 0; i < headers.length; i++) {
    col[normalizeHeaderName(headers[i])] = i;
  }

  var codeCol = findHeaderIndex(headers, ['Code', 'Discount Code']);
  var typeCol = findHeaderIndex(headers, ['Type', 'Discount Type']);
  var valueCol = findHeaderIndex(headers, ['Value', 'Discount Value', 'Amount']);
  var maxUsesCol = findHeaderIndex(headers, ['MaxUses', 'Max Uses', 'Maximum Uses']);
  var timesUsedCol = findHeaderIndex(headers, ['TimesUsed', 'Times Used', 'Uses']);
  var activeCol = findHeaderIndex(headers, ['Active', 'Enabled', 'Is Active']);
  var expiresCol = findHeaderIndex(headers, ['ExpiresOn', 'Expires On', 'Expiry', 'Expiry Date']);

  if (codeCol === -1 || typeCol === -1 || valueCol === -1 || activeCol === -1) {
    return { valid: false, reason: 'Discount sheet headers are incomplete.' };
  }

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row || row.length === 0) continue;
    if (safeTrim(String(row[codeCol] || '')).toUpperCase() !== code) continue;

    var activeValue = safeTrim(row[activeCol]).toLowerCase();
    var active = row[activeCol] === true || activeValue === 'true' || activeValue === 'yes' || activeValue === '1' || activeValue === 'active' || row[activeCol] === 1;
    var maxUses = maxUsesCol === -1 ? NaN : parseFloat(row[maxUsesCol]);
    var timesUsed = timesUsedCol === -1 ? 0 : parseFloat(row[timesUsedCol] || 0);
    var expiresOn = expiresCol === -1 ? '' : row[expiresCol];

    if (!active) {
      return { valid: false, reason: 'This code is no longer active.' };
    }
    if (!isNaN(maxUses) && maxUses >= 0 && timesUsed >= maxUses) {
      return { valid: false, reason: 'This code has reached its usage limit.' };
    }
    if (expiresOn && new Date() > new Date(expiresOn)) {
      return { valid: false, reason: 'This code has expired.' };
    }

    var type = safeTrim(String(row[typeCol] || '')).toLowerCase();
    var value = parseFloat(row[valueCol]);
    if (isNaN(value)) {
      return { valid: false, reason: 'This code is configured incorrectly.' };
    }

    var discountAmount = (type === 'percent' || type === 'percentage' || type === '%')
      ? Math.round((Number(subtotal) || 0) * (value / 100) * 100) / 100
      : Math.min(value, Number(subtotal) || 0);

    return {
      valid: true,
      code: code,
      type: type,
      value: value,
      discountAmount: roundCurrency(discountAmount),
      newTotal: Math.max(0, roundCurrency((Number(subtotal) || 0) - discountAmount)),
      rowIndex: i + 1
    };
  }

  return { valid: false, reason: 'Code not recognized.' };
}

function incrementDiscountUsage(rowIndex) {
  if (!rowIndex) return;
  var sheet = ensureDiscountCodeSheet();
  if (!sheet) return;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var usedCol = headers.indexOf('TimesUsed');
  if (usedCol === -1) return;

  var current = Number(sheet.getRange(rowIndex, usedCol + 1).getValue() || 0);
  sheet.getRange(rowIndex, usedCol + 1).setValue(current + 1);
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
    
    var currentCashIncome = 0;
    var currentCashOrders = 0;
    var currentCashPaidIncome = 0;
    var currentCashPaidOrders = 0;

    var currentBankIncome = 0;
    var currentBankOrders = 0;
    var currentBankPaidIncome = 0;
    var currentBankPaidOrders = 0;

    var currentTotalIncome = 0;
    var headers = data.length > 0 ? data[0] : [];

    // Optional: Load overrides from Pizza Order Update sheet
    var methodOverrides = {};
    try {
      var updateSheet = ss.getSheetByName('Pizza Order Update');
      if (updateSheet) {
        var uData = updateSheet.getDataRange().getValues();
        if (uData.length > 1) {
          var uHeaders = uData[0];
          var idCol = -1, methodCol = -1;
          for (var h = 0; h < uHeaders.length; h++) {
            var ut = String(uHeaders[h] || '').toLowerCase().trim();
            if (ut === 'order id' || ut === 'id') idCol = h;
            if (ut === 'payment method' || ut === 'method') methodCol = h;
          }
          if (idCol !== -1 && methodCol !== -1) {
            for (var i = 1; i < uData.length; i++) {
              var rawId = uData[i][idCol];
              var mth = String(uData[i][methodCol] || '').trim();
              if (rawId !== '' && mth !== '') {
                var oid = String(rawId).trim();
                methodOverrides[oid] = mth;
                // Add integer version to handle numeric cell formatting (e.g. 123.0)
                var pId = parseInt(oid, 10);
                if (!isNaN(pId)) methodOverrides[String(pId)] = mth;
              }
            }
          }
        }
      }
    } catch (e) {
      Logger.log('Stats override note: ' + e);
    }

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
        if (stats.pizzaSelections > 0) {
          totalOrders++;
          
          var paymentMethod = methodOverrides[String(r)] || detectPaymentMethodFromRow(row, headers);
          var manualPaymentStatus = safeTrim(row[PAYMENT_STATUS_COL]);
          var isPaid = resolvePaymentStatus(row, headers, manualPaymentStatus) === 'Paid';
          
          var qtyDigit = extractDigit(safeTrim(row[3])) || '0';
          var blocks = BRANCHES[qtyDigit] || [];
          var orderTotal = 0;
          for (var b = 0; b < blocks.length; b++) {
            var cols = blocks[b];
            var sizeRaw = safeTrim(row[cols[0]]);
            var childName = safeTrim(row[cols[1]]);
            if (sizeRaw || childName) {
              var size = mapSize(sizeRaw);
              var price = PRICE_MAP[size] || 0;
              orderTotal += price;
            }
          }
          
          var discountInfo = getOrderDiscountInfo(row, headers, orderTotal);
          var totalAfterDiscount = discountInfo && discountInfo.totalAfterDiscount !== undefined ? discountInfo.totalAfterDiscount : orderTotal;
          
          currentTotalIncome += totalAfterDiscount;
          if (String(paymentMethod).toLowerCase().indexOf('cash') !== -1) {
            currentCashIncome += totalAfterDiscount;
            currentCashOrders++;
            if (isPaid) {
              currentCashPaidIncome += totalAfterDiscount;
              currentCashPaidOrders++;
            }
          } else {
            currentBankIncome += totalAfterDiscount;
            currentBankOrders++;
            if (isPaid) {
              currentBankPaidIncome += totalAfterDiscount;
              currentBankPaidOrders++;
            }
          }
        }
      }
    }

    // Also include active Parent Orders in the session stats if the sheet exists
    try {
      var parentSheet = ss.getSheetByName('Internal Parent Orders');
      if (parentSheet && parentSheet.getLastRow() >= 2) {
        var parentRows = parentSheet.getDataRange().getValues();
        for (var p = 1; p < parentRows.length; p++) {
          var pRow = parentRows[p];
          if (!pRow || rowIsBlank(pRow)) continue;
          if (safeTrim(String(pRow[16] || '')).toUpperCase() === 'TRUE') continue; // deleted
          
          var pTotal = parseFloat(pRow[9]) || 0;
          var pMethod = mapPaymentMethod(pRow[10]);
          var pStatus = safeTrim(String(pRow[11] || '')).toLowerCase();
          if (/^(failed|declined|rejected|cancelled|canceled|refunded|void)$/.test(pStatus)) continue;
          var pIsPaid = (pStatus === 'paid');
          
          currentTotalIncome += pTotal;
          totalOrders++;
          if (String(pMethod).toLowerCase().indexOf('cash') !== -1) {
            currentCashIncome += pTotal;
            currentCashOrders++;
            if (pIsPaid) {
              currentCashPaidIncome += pTotal;
              currentCashPaidOrders++;
            }
          } else {
            currentBankIncome += pTotal;
            currentBankOrders++;
            if (pIsPaid) {
              currentBankPaidIncome += pTotal;
              currentBankPaidOrders++;
            }
          }
        }
      }
    } catch (parentErr) {
      Logger.log('Parent orders stats note: ' + parentErr);
    }

    totalPizzas = normalizePizzaCapacity(totalPizzas);
    totalHistoricalPizzas = normalizePizzaCapacity(totalHistoricalPizzas);

    var maxLimit = parseFloat(settings.maxPizzas || 20);
    var remaining = Math.max(0, maxLimit - totalPizzas);
    var isPastDeadline = isPastAutoClosingDeadline(settings);
    var isOpen = (settings.orderingEnabled === true) && !isPastDeadline && (remaining > 0);

    var currentActualIncome = currentBankPaidIncome + currentCashIncome;
    var currentActualOrders = currentBankPaidOrders + currentCashOrders;

    return {
      success: true,
      currentPizzas: totalPizzas,
      maxPizzas: maxLimit,
      remainingPizzas: remaining,
      currentOrders: totalOrders,
      currentCashIncome: Math.round(currentCashIncome * 100) / 100,
      currentCashOrders: currentCashOrders,
      currentCashPaidIncome: Math.round(currentCashPaidIncome * 100) / 100,
      currentCashPaidOrders: currentCashPaidOrders,
      currentBankIncome: Math.round(currentBankIncome * 100) / 100,
      currentBankOrders: currentBankOrders,
      currentBankPaidIncome: Math.round(currentBankPaidIncome * 100) / 100,
      currentBankPaidOrders: currentBankPaidOrders,
      currentTotalIncome: Math.round(currentTotalIncome * 100) / 100,
      currentTotalOrders: totalOrders,
      currentActualIncome: Math.round(currentActualIncome * 100) / 100,
      currentActualOrders: currentActualOrders,
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
      currentCashIncome: 0,
      currentCashOrders: 0,
      currentBankIncome: 0,
      currentBankOrders: 0,
      currentTotalIncome: 0,
      orderingOpen: true
    };
  }
}

function getKitchenBoardSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Kitchen_Board_State');
  if (!sheet) {
    sheet = ss.insertSheet('Kitchen_Board_State');
    sheet.getRange(1, 1, 1, 5).setValues([['SESSION TITLE', 'BOARD DATA JSON', 'COMPLETED JSON', 'META JSON', 'UPDATED AT']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function loadKitchenBoardState() {
  var sheet = getKitchenBoardSheet();
  if (sheet.getLastRow() < 2) return null;
  var row = sheet.getRange(2, 1, 1, 5).getValues()[0];
  if (!row[0]) return null;
  return {
    sessionTitle: String(row[0]),
    data: row[1] ? JSON.parse(String(row[1])) : null,
    completed: row[2] ? JSON.parse(String(row[2])) : [],
    meta: row[3] ? JSON.parse(String(row[3])) : {},
    updatedAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || '')
  };
}

function getKitchenBoardUpdatedAt() {
  var sheet = getKitchenBoardSheet();
  if (sheet.getLastRow() < 2) return '';
  var value = sheet.getRange(2, 5).getValue();
  return value instanceof Date ? value.toISOString() : String(value || '');
}

function saveKitchenBoardState(state) {
  if (!state || !state.sessionTitle || !state.data || !Array.isArray(state.completed)) {
    throw new Error('Invalid kitchen board state.');
  }
  var sheet = getKitchenBoardSheet();
  var row = [
    String(state.sessionTitle).slice(0, 200),
    JSON.stringify(state.data),
    JSON.stringify(state.completed),
    JSON.stringify(state.meta || {}),
    new Date()
  ];
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.getRange(2, 1, 1, 5).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return row[4] instanceof Date ? row[4].toISOString() : String(row[4]);
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
    var parentRes = lookupInternalParentOrder(searchEmail, searchOrderId, searchToken);
    if (parentRes) return parentRes;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  if (data.length < 2) {
    if (searchEmail) {
      return lookupEventOrder(searchEmail, '', searchToken) || lookupInternalParentOrder(searchEmail, '', searchToken);
    }
    return null;
  }

  var matchingOrders = [];
  var headers = data.length > 0 ? data[0] : [];
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

      var discountInfo = getOrderDiscountInfo(row, headers, orderTotal);
      var totalAfterDiscount = discountInfo && discountInfo.totalAfterDiscount !== undefined ? discountInfo.totalAfterDiscount : orderTotal;

      if (pizzas.length > 0) {
        matchingOrders.push({
          orderIndex: orderNum,
          formattedOrderId: formattedId,
          payerName: payerName,
          payerEmail: payerEmail,
          paymentMethod: paymentMethod,
          paid: resolvePaymentStatus(row, headers, row[PAYMENT_STATUS_COL]) === 'Paid' ? 'Yes' : 'No',
          total: totalAfterDiscount,
          totalAfterDiscount: totalAfterDiscount,
          discountCode: discountInfo ? discountInfo.code : '',
          discountAmount: discountInfo ? discountInfo.discountAmount : 0,
          discountReason: discountInfo ? discountInfo.discountReason : '',
          pizzas: pizzas
        });
      }
    }
  }

  if (matchingOrders.length === 0) {
    if (searchEmail) {
      return lookupEventOrder(searchEmail, '', searchToken) || lookupInternalParentOrder(searchEmail, '', searchToken);
    }
    return lookupInternalParentOrder(searchEmail, searchOrderId, searchToken);
  }
  return matchingOrders[matchingOrders.length - 1];
}

// ============================================================================
// TRIGGER ENTRYPOINT & SPREADSHEET REBUILD
// ============================================================================

function ensureFormSubmitTrigger() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var triggers = ScriptApp.getProjectTriggers();
    var hasSubmitTrigger = false;
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'onFormSubmitTrigger') {
        hasSubmitTrigger = true;
        break;
      }
    }
    if (!hasSubmitTrigger) {
      ScriptApp.newTrigger('onFormSubmitTrigger')
        .forSpreadsheet(ss)
        .onFormSubmit()
        .create();
      Logger.log('Successfully installed missing onFormSubmitTrigger.');
    }
  } catch (err) {
    Logger.log('ensureFormSubmitTrigger note: ' + err);
  }
}

function onFormSubmitTrigger(e) {
  // Invalidate cache immediately so public tracker updates
  try { CacheService.getScriptCache().remove('SYSTEM_STATUS_CACHE'); } catch(err) {}

  ensureDiscountCodeSheet();
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
    var rowNum = e && e.range ? e.range.getRow() : raw.getLastRow();
    if (rowNum && raw) {
      applyDiscountToResponseRow(raw, rowNum);
    }
  } catch (err) {
    Logger.log('Discount processing on form submit failed: ' + err);
  }

  // CRITICAL: Send customer confirmation FIRST before heavy admin spreadsheet rebuild/export tasks
  trySendOrderConfirmation(e);

  rebuildCleanSheets();
  try {
    emailXlsxSnapshot();
  } catch (snapErr) {
    Logger.log('emailXlsxSnapshot warning: ' + snapErr);
  }
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

  ensureDiscountCodeSheet();
  ensureDiscountColumns(raw);
  var lastRawRow = raw.getLastRow();
  for (var rIdx = 2; rIdx <= lastRawRow; rIdx++) {
    try {
      applyDiscountToResponseRow(raw, rIdx);
    } catch (e) {}
  }

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
  var headers = data.length > 0 ? data[0] : [];

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

    var startRowIndex = Math.max(1, (parseInt(settings.sessionStartRow, 10) || 2) - 1);
    var isCurrentSession = (r >= startRowIndex);

    var stats = calculateRowPizzaStats(row);
    if (isCurrentSession) {
      sessionPizzaCapacity += stats.pizzaCapacity;
    }

    var allergyYN = safeTrim(row[1]);
    var allergyText = stripHtml(safeTrim(row[2]));
    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var payerRaw = firstNonEmpty(row[50], row[52]);

    var paymentMethod = detectPaymentMethodFromRow(row, headers);
    var payerName = safeTrim(payerRaw) || 'Unknown';
    var payerEmail = extractPayerEmail(row);

    if (!isCurrentSession) {
      payerName = "[PAST SESSION] " + payerName;
    }

    if (isCurrentSession) {
      sessionOrders++;
      if (String(allergyYN).toLowerCase() === 'yes') allergyOrders++;
      var paid = resolvePaymentStatus(row, headers, row[PAYMENT_STATUS_COL]) === 'Paid' ? 'Yes' : 'No';
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

    var discountInfo = getOrderDiscountInfo(row, headers, orderTotal);
    var discountCodeStr = '';
    var orderTotalAfterDiscount = orderTotal;
    if (discountInfo && discountInfo.valid) {
      discountCodeStr = discountInfo.code + (discountInfo.value ? ' (' + discountInfo.value + (discountInfo.type === 'percent' ? '%' : '') + ')' : '');
      orderTotalAfterDiscount = discountInfo.totalAfterDiscount;
    }

    orderSummaryRows.push([
      formattedOrderId,
      payerName,
      discountCodeStr,
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
        formattedOrderId, payerName, discountCodeStr, paymentMethod, paymentMethod ? 'Yes' : 'No', allergyYN, allergyText,
        pizza.pizzaNum, pickupId, pizza.childName, pizza.class, size
      ]);
    }

    var confirmSent = raw.getRange(r + 1, CONFIRMATION_SENT_COL).getValue() === 'SENT' ? 'Yes' : 'No';
    orderTotalsRows.push([formattedOrderId, payerName, discountCodeStr, payerEmail || '(no valid email)', orderTotalAfterDiscount, confirmSent]);
  }

  var currentRow = 1;
  writeSectionTitle(sheet, currentRow, 'CURRENT ACTIVE SESSION: ' + settings.serviceDate, 9);
  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'ORDER SUMMARY', 9);
  currentRow++;

  var orderSummaryHeader = [
    'Order ID', 'Payer Name', 'Discount Code', 'Payment Method', 'Paid', 'Allergy Flag',
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
    sheet.getRange(currentRow, 9, orderSummaryRows.length, 1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    for (var i = 0; i < orderSummaryRows.length; i++) {
      var detailsText = orderSummaryRows[i][8];
      var numLines = (detailsText.match(/\n/g) || []).length + 1;
      var rowHeight = Math.max(21, numLines * 15);
      sheet.setRowHeight(currentRow + i, rowHeight);
    }
    currentRow += orderSummaryRows.length;
  }

  currentRow += 2;

  writeSectionTitle(sheet, currentRow, 'PIZZA ORDERS', 12);
  currentRow++;

  var pizzaOrdersHeader = [
    'Order ID', 'Payer Name', 'Discount Code', 'Payment Method', 'Paid', 'Allergy Flag',
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

  writeSectionTitle(sheet, currentRow, 'ORDER TOTALS & PAYMENT STATUS', 6);
  currentRow++;

  var orderTotalsHeader = ['Order ID', 'Payer Name', 'Discount Code', 'Email', 'Amount Owed (£)', 'Confirmation Emailed'];
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

  sheet.autoResizeColumns(1, 12);
  appendParentOrdersToUpdateSheet(sheet);
  SpreadsheetApp.flush();
}

function appendParentOrdersToUpdateSheet(sheet) {
  var parentSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Internal Parent Orders');
  if (!parentSheet || parentSheet.getLastRow() < 2) return;

  var rows = parentSheet.getDataRange().getValues();
  var summaryRows = [];
  var pizzaRows = [];
  var totalRows = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row || rowIsBlank(row) || safeTrim(String(row[16] || '')).toUpperCase() === 'TRUE') continue;
    var orderId = safeTrim(String(row[1] || ''));
    var parentName = safeTrim(String(row[2] || ''));
    var parentEmail = safeTrim(String(row[3] || ''));
    var childNames = safeTrim(String(row[4] || '')).split(/\s*,\s*/).filter(Boolean);
    var childClasses = safeTrim(String(row[5] || '')).split(/\s*,\s*/).filter(Boolean);
    var items = [];
    try { items = JSON.parse(String(row[6] || '[]')); } catch (e) {}
    var discountCodeStr = 'MUTTI (50%)';
    var details = [];
    var pizzaNumber = 0;
    items.forEach(function(item) {
      var qty = parseInt(item.qty, 10) || 0;
      for (var q = 0; q < qty; q++) {
        pizzaNumber++;
        var childName = childNames[pizzaNumber - 1] || childNames[0] || 'Child';
        var childClass = childClasses[pizzaNumber - 1] || childClasses[0] || '';
        var size = formatSizeLabel(item.size || '');
        details.push(orderId + '-' + pizzaNumber + ': ' + childName + ' (' + childClass + ') - ' + size);
        pizzaRows.push([orderId, parentName, discountCodeStr, mapPaymentMethod(row[10]), row[11] === 'Paid' ? 'Yes' : 'No', '', '', pizzaNumber, orderId + '-' + pizzaNumber, childName, childClass, size]);
      }
    });
    summaryRows.push([orderId, parentName, discountCodeStr, mapPaymentMethod(row[10]), row[11] === 'Paid' ? 'Yes' : 'No', '', '', pizzaNumber, details.join('\n')]);
    totalRows.push([orderId, parentName, discountCodeStr, parentEmail, Number(row[9]) || 0, row[13] === 'SENT' ? 'Yes' : 'No']);
  }

  if (!summaryRows.length) return;
  var start = sheet.getLastRow() + 2;
  writeSectionTitle(sheet, start, 'INTERNAL PARENT ORDERS', 12);
  start += 2;
  sheet.getRange(start, 1, 1, 9).setValues([['Order ID', 'Payer Name', 'Discount Code', 'Payment Method', 'Paid', 'Allergy Flag', 'Allergy Details', 'No. of Pizzas', 'Pizza Details']]).setFontWeight('bold').setBackground('#E8E8E8');
  start++;
  sheet.getRange(start, 1, summaryRows.length, 9).setValues(summaryRows);
  start += summaryRows.length + 2;
  sheet.getRange(start, 1, 1, 12).setValues([['Order ID', 'Payer Name', 'Discount Code', 'Payment Method', 'Paid', 'Allergy Flag', 'Allergy Details', 'Pizza Item ID', 'Pickup ID', 'Child Name', 'Class', 'Size']]).setFontWeight('bold').setBackground('#E8E8E8');
  start++;
  sheet.getRange(start, 1, pizzaRows.length, 12).setValues(pizzaRows);
  start += pizzaRows.length + 2;
  sheet.getRange(start, 1, 1, 6).setValues([['Order ID', 'Payer Name', 'Discount Code', 'Email', 'Amount Owed (£)', 'Confirmation Emailed']]).setFontWeight('bold').setBackground('#E8E8E8');
  start++;
  sheet.getRange(start, 1, totalRows.length, 6).setValues(totalRows);
  sheet.autoResizeColumns(1, 12);
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

function emailXlsxSnapshot(targetEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Ensure the live combined 'Pizza Order Update' tab is freshly rebuilt from the current session
  rebuildCleanSheets();
  SpreadsheetApp.flush();

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

  var recipient = targetEmail || YOUR_EMAIL;
  MailApp.sendEmail({
    to: recipient,
    subject: (EMAIL_SUBJECT || 'Pizza Order Update') + ' - Live Spreadsheet',
    body: 'Please find attached the latest updated live spreadsheet for Artisan Oven pizza orders.\n\nSent from Artisan Oven Admin Dashboard.',
    attachments: [blob]
  });

  DriveApp.getFileById(tempSs.getId()).setTrashed(true);
}

function sendInternalSummaryEmail(targetEmail, customNotes, clientStats) {
  SpreadsheetApp.flush();
  var settings = getSettings();
  
  // 1. Calculate school lunch orders directly from Form Responses 1 using the admin parser
  var lunchOrders = getAllOrdersForAdmin();
  var totalLunchOrders = lunchOrders.length;
  var totalLunchPizzas = 0;
  var totalLunchItems = 0;
  var lunchPending = 0;
  var lunchPaid = 0;
  
  lunchOrders.forEach(function(o) {
    var cap = (typeof o.totalCapacity === 'number') ? o.totalCapacity : (o.pizzaCount || 0);
    var items = (typeof o.itemCount === 'number') ? o.itemCount : (o.pizzas && o.pizzas.length ? o.pizzas.length : cap);
    totalLunchPizzas += cap;
    totalLunchItems += items;
    if (o.paymentStatus === 'Paid') {
      lunchPaid++;
    } else {
      lunchPending++;
    }
  });
  totalLunchPizzas = Math.round(totalLunchPizzas * 100) / 100;

  // Sync / reconcile with clientStats if explicitly provided from loaded UI
  if (clientStats) {
    if (clientStats.lunchOrders !== undefined && !isNaN(parseInt(clientStats.lunchOrders, 10))) {
      totalLunchOrders = parseInt(clientStats.lunchOrders, 10);
    }
    if (clientStats.lunchPizzas !== undefined && !isNaN(parseFloat(clientStats.lunchPizzas))) {
      totalLunchPizzas = parseFloat(clientStats.lunchPizzas);
    }
    if (clientStats.lunchItems !== undefined && !isNaN(parseInt(clientStats.lunchItems, 10))) {
      totalLunchItems = parseInt(clientStats.lunchItems, 10);
    }
    if (clientStats.lunchPending !== undefined && !isNaN(parseInt(clientStats.lunchPending, 10))) {
      lunchPending = parseInt(clientStats.lunchPending, 10);
    }
    if (clientStats.lunchPaid !== undefined && !isNaN(parseInt(clientStats.lunchPaid, 10))) {
      lunchPaid = parseInt(clientStats.lunchPaid, 10);
    }
  }

  // 2. Calculate Internal Parent Orders
  var parentOrdersList = getAllParentOrdersForAdmin();
  var totalParentOrders = parentOrdersList.length;
  var totalParentPizzas = 0;
  var totalParentItems = 0;
  var parentPending = 0;
  var parentPaid = 0;

  parentOrdersList.forEach(function(p) {
    var pItems = p.items || [];
    pItems.forEach(function(it) {
      var q = parseInt(it.qty, 10) || 1;
      totalParentPizzas += q;
      totalParentItems += q;
    });
    if (p.paymentStatus === 'Paid') {
      parentPaid++;
    } else {
      parentPending++;
    }
  });

  if (clientStats) {
    if (clientStats.parentOrders !== undefined && !isNaN(parseInt(clientStats.parentOrders, 10))) {
      totalParentOrders = parseInt(clientStats.parentOrders, 10);
    }
    if (clientStats.parentPizzas !== undefined && !isNaN(parseFloat(clientStats.parentPizzas))) {
      totalParentPizzas = parseFloat(clientStats.parentPizzas);
    }
    if (clientStats.parentPending !== undefined && !isNaN(parseInt(clientStats.parentPending, 10))) {
      parentPending = parseInt(clientStats.parentPending, 10);
    }
    if (clientStats.parentPaid !== undefined && !isNaN(parseInt(clientStats.parentPaid, 10))) {
      parentPaid = parseInt(clientStats.parentPaid, 10);
    }
  }

  // 3. Capacity
  var maxLimit = parseFloat(settings.maxPizzas || 20);
  if (clientStats && clientStats.capacityMax !== undefined && !isNaN(parseFloat(clientStats.capacityMax))) {
    maxLimit = parseFloat(clientStats.capacityMax);
  }
  var remaining = Math.max(0, maxLimit - totalLunchPizzas);
  if (clientStats && clientStats.capacityRemaining !== undefined && !isNaN(parseFloat(clientStats.capacityRemaining))) {
    remaining = parseFloat(clientStats.capacityRemaining);
  }
  var isPastDeadline = isPastAutoClosingDeadline(settings);
  var orderingStatus = (settings.orderingEnabled && !isPastDeadline && remaining > 0) ? 'OPEN' : (settings.orderingEnabled ? 'OPEN (Fully Booked)' : 'CLOSED');

  var combinedOrdersCount = totalLunchOrders + totalParentOrders;
  var combinedPizzasCount = totalLunchPizzas + totalParentPizzas;

  var sessionDateFormatted = settings.serviceDate || 'Tuesday 15th September 2026';

  var body = 'ARTISAN OVEN — OPERATIONAL SUMMARY\n' +
    'Session Date: ' + sessionDateFormatted + '\n' +
    'Status: ' + orderingStatus + '\n\n' +
    'via Google Forms (Form Responses 1):\n' +
    'Total Orders: ' + totalLunchOrders + '\n' +
    'Total Pizzas: ' + totalLunchPizzas + ' (' + totalLunchItems + ' items)\n' +
    'Pending Payment: ' + lunchPending + '\n' +
    'Paid: ' + lunchPaid + '\n\n' +
    'Capacity Remaining: ' + remaining + ' of ' + maxLimit + ' pizzas\n\n' +
    'Internal Parent Orders:\n' +
    'Total Orders: ' + totalParentOrders + '\n' +
    'Total Pizzas: ' + totalParentPizzas + ' pizzas\n' +
    'Pending Payment: ' + parentPending + '\n' +
    'Paid: ' + parentPaid + '\n\n' +
    'Overall Combined Totals:\n' +
    'Total Orders: ' + combinedOrdersCount + '\n' +
    'Total Pizzas: ' + combinedPizzasCount + ' pizzas\n\n' +
    (customNotes ? 'Admin Notes:\n' + customNotes + '\n\n' : '') +
    'Generated on-demand from Artisan Oven Admin Dashboard at ' + Utilities.formatDate(new Date(), 'Europe/London', 'dd MMM yyyy HH:mm');

  var htmlBody = '<div style="font-family: Arial, sans-serif; color: #1F3A2E; max-width: 600px; margin: 0 auto; line-height: 1.5;">' +
    '<div style="background: #4F6359; color: #fff; padding: 18px 24px; border-radius: 8px 8px 0 0; text-align: center;">' +
    '<h2 style="margin: 0; font-size: 1.4rem; letter-spacing: 0.04em;">ARTISAN OVEN</h2>' +
    '<p style="margin: 4px 0 0 0; font-size: 0.95rem; opacity: 0.9;">Operational Summary · ' + sessionDateFormatted + '</p>' +
    '</div>' +
    '<div style="background: #FAF8F5; border: 1px solid #DCE3DB; border-top: none; padding: 22px; border-radius: 0 0 8px 8px;">' +
    '<div style="margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #E2E8DF;">' +
    '<p style="margin: 3px 0; font-size: 0.95rem;"><strong>Session Date:</strong> ' + sessionDateFormatted + '</p>' +
    '<p style="margin: 3px 0; font-size: 0.95rem;"><strong>Ordering Status:</strong> <span style="font-weight: bold; color: ' + (orderingStatus.indexOf('OPEN') >= 0 ? '#2E6930' : '#A83220') + ';">' + orderingStatus + '</span></p>' +
    '<p style="margin: 3px 0; font-size: 0.95rem;"><strong>Capacity Remaining:</strong> <span style="font-weight: bold; color: #C65D3B;">' + remaining + ' of ' + maxLimit + ' pizzas</span></p>' +
    '</div>' +

    // School Lunch Orders Box
    '<div style="background: #FFFFFF; border: 1px solid #DCE3DB; border-radius: 8px; padding: 16px; margin-bottom: 16px;">' +
    '<h3 style="margin: 0 0 12px 0; color: #1F3A2E; font-size: 1.05rem; border-bottom: 1px solid #F0F4EE; padding-bottom: 6px;">School Lunch Orders <span style="font-size: 0.8rem; font-weight: normal; color: #738A7C;">(Form Responses 1)</span></h3>' +
    '<table style="width: 100%; border-collapse: collapse; font-size: 0.92rem;">' +
    '<tr><td style="padding: 5px 0; color: #555;">Total Orders:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + totalLunchOrders + '</td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Total Pizzas:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + totalLunchPizzas + ' <span style="font-weight: normal; color: #777;">(' + totalLunchItems + ' items)</span></td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Pending Payment:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #C65D3B;">' + lunchPending + '</td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Paid:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #2E6930;">' + lunchPaid + '</td></tr>' +
    '</table>' +
    '</div>' +

    // Internal Parent Orders Box
    '<div style="background: #FFFFFF; border: 1px solid #DCE3DB; border-radius: 8px; padding: 16px; margin-bottom: 16px;">' +
    '<h3 style="margin: 0 0 12px 0; color: #1F3A2E; font-size: 1.05rem; border-bottom: 1px solid #F0F4EE; padding-bottom: 6px;">Internal Parent Orders</h3>' +
    '<table style="width: 100%; border-collapse: collapse; font-size: 0.92rem;">' +
    '<tr><td style="padding: 5px 0; color: #555;">Total Orders:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + totalParentOrders + '</td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Total Pizzas:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + totalParentPizzas + ' pizzas</td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Pending Payment:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #C65D3B;">' + parentPending + '</td></tr>' +
    '<tr><td style="padding: 5px 0; color: #555;">Paid:</td><td style="padding: 5px 0; font-weight: bold; text-align: right; color: #2E6930;">' + parentPaid + '</td></tr>' +
    '</table>' +
    '</div>' +

    // Combined Totals Box
    '<div style="background: #EEF3ED; border: 1px solid #D0DDD0; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">' +
    '<table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">' +
    '<tr><td style="padding: 4px 0; color: #2E5A44; font-weight: bold;">Combined Orders:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + combinedOrdersCount + ' orders</td></tr>' +
    '<tr><td style="padding: 4px 0; color: #2E5A44; font-weight: bold;">Combined Pizzas:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #1F3A2E;">' + combinedPizzasCount + ' pizzas</td></tr>' +
    '</table>' +
    '</div>' +

    (customNotes ? '<div style="background: #FFF8E7; border-left: 4px solid #C65D3B; padding: 12px; margin-bottom: 16px; border-radius: 0 4px 4px 0;"><p style="margin: 0; font-size: 0.9rem;"><strong>Admin Notes:</strong><br>' + customNotes.replace(/\n/g, '<br>') + '</p></div>' : '') +
    '<p style="font-size: 0.8rem; color: #738A7C; margin: 16px 0 0 0; text-align: center;">Dispatched on-demand from Artisan Oven Admin Dashboard.</p>' +
    '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: targetEmail,
    subject: 'Artisan Oven — Operational Summary (' + sessionDateFormatted + ')',
    body: body,
    htmlBody: htmlBody
  });
}

function sendCustomerOrderReadyEmail(recipientEmail, orderId, customMessage) {
  var subject = 'Artisan Oven — Your Pizza Order #' + orderId + ' is Ready for Collection!';
  var body = 'Hello,\n\n' +
    'Great news! Your pizza order #' + orderId + ' has been freshly baked and is ready for collection at the courtyard.\n\n' +
    (customMessage ? customMessage + '\n\n' : '') +
    'Please collect your order promptly.\n\n' +
    'Thank you for ordering with Artisan Oven!\n' +
    'Marlow, Louis, and Quinton';

  var htmlBody = '<div style="font-family: Arial, sans-serif; color: #1F3A2E; max-width: 600px;">' +
    '<div style="background: #4F6359; color: #fff; padding: 16px; border-radius: 8px 8px 0 0; text-align: center;">' +
    '<h2 style="margin: 0; font-size: 1.5rem; letter-spacing: 0.05em;">ARTISAN OVEN</h2>' +
    '<p style="margin: 4px 0 0 0; font-size: 0.9rem; opacity: 0.9;">Order Ready for Collection</p>' +
    '</div>' +
    '<div style="border: 1px solid rgba(31,58,46,0.15); border-top: none; padding: 20px; border-radius: 0 0 8px 8px; background: #fff;">' +
    '<p>Hello,</p>' +
    '<p>Great news! Your pizza order <strong>#' + orderId + '</strong> is freshly prepared and ready for collection at the courtyard.</p>' +
    (customMessage ? '<div style="background: #F4F6F0; border-left: 4px solid #C65D3B; padding: 12px; margin: 16px 0;"><p style="margin:0;">' + customMessage.replace(/\n/g, '<br>') + '</p></div>' : '') +
    '<p>Please collect your order promptly so you can enjoy it while it is hot and crisp.</p>' +
    '<p>Thank you for supporting Artisan Oven!</p>' +
    '<p>Kind regards,<br><strong>Marlow, Louis, and Quinton</strong></p>' +
    '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: recipientEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody
  });
}

function sendCustomerCustomEmail(recipientEmail, subject, messageBody) {
  var cleanSubject = subject || 'Artisan Oven — Pizza Order Update';
  var body = (messageBody || 'Thank you for your order with Artisan Oven.') + '\n\nKind regards,\nMarlow, Louis, and Quinton\nArtisan Oven';

  var htmlBody = '<div style="font-family: Arial, sans-serif; color: #1F3A2E; max-width: 600px;">' +
    '<div style="background: #4F6359; color: #fff; padding: 16px; border-radius: 8px 8px 0 0; text-align: center;">' +
    '<h2 style="margin: 0; font-size: 1.5rem; letter-spacing: 0.05em;">ARTISAN OVEN</h2>' +
    '</div>' +
    '<div style="border: 1px solid rgba(31,58,46,0.15); border-top: none; padding: 20px; border-radius: 0 0 8px 8px; background: #fff;">' +
    '<div style="font-size: 1rem; line-height: 1.6; color: #1F3A2E;">' +
    (messageBody ? messageBody.replace(/\n/g, '<br>') : 'Thank you for choosing Artisan Oven.') +
    '</div>' +
    '<hr style="border: none; border-top: 1px solid rgba(31,58,46,0.1); margin: 24px 0 16px 0;" />' +
    '<p style="font-size: 0.9rem; color: #738A7C; margin: 0;">Kind regards,<br><strong style="color:#1F3A2E;">Marlow, Louis, and Quinton</strong><br>Artisan Oven</p>' +
    '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: recipientEmail,
    subject: cleanSubject,
    body: body,
    htmlBody: htmlBody
  });
}

function trySendOrderConfirmation(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
    if (!raw) return;
    ensureColumnsExist(raw, CONFIRMATION_SENT_COL);
    ensureColumnsExist(raw, ORDER_TOKEN_COL);

    var rowNum = (e && e.range) ? e.range.getRow() : raw.getLastRow();
    if (rowNum >= 2 && rowNum <= raw.getLastRow()) {
      sendOrderConfirmationForRow(rowNum);
    }
  } catch (err) {
    Logger.log('trySendOrderConfirmation error: ' + err);
  }
}

function sendOrderConfirmationForRow(rowNum) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    Logger.log('Could not obtain lock for row ' + rowNum + ': ' + lockErr);
  }

  try {
    var settings = getSettings();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
    if (!raw) return;

    ensureColumnsExist(raw, CONFIRMATION_SENT_COL);
    ensureColumnsExist(raw, ORDER_TOKEN_COL);

    var alreadySent = raw.getRange(rowNum, CONFIRMATION_SENT_COL).getValue();
    if (alreadySent === 'SENT') return;

    var lastCol = Math.max(raw.getLastColumn(), CONFIRMATION_SENT_COL, ORDER_TOKEN_COL);
    var row = raw.getRange(rowNum, 1, 1, lastCol).getValues()[0];

    // Safeguard: Check order timestamp to prevent bulk email dispatch on historical/existing rows during deployment or code updates (extended to 24 hours)
    var timestamp = row[0];
    if (timestamp instanceof Date) {
      var ageMs = new Date().getTime() - timestamp.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        Logger.log('Skipping confirmation for historical row ' + rowNum + ' (submitted > 24 hours ago)');
        raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('SENT');
        return;
      }
    }

    var orderIndex = rowNum - 1;
    var formattedOrderId = String(orderIndex);

    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);
    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'there';
    
    // Get order headers to find email more accurately
    var orderHeaders = raw.getRange(1, 1, 1, raw.getLastColumn()).getValues()[0];
    var payerEmail = extractPayerEmailWithHeaders(row, orderHeaders);

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

    var orderHeaders = raw.getRange(1, 1, 1, raw.getLastColumn()).getValues()[0];
    var discountInfo = getOrderDiscountInfo(row, orderHeaders, orderTotal);
    var totalAfterDiscount = discountInfo && discountInfo.totalAfterDiscount !== undefined ? discountInfo.totalAfterDiscount : orderTotal;

    if (pizzas.length === 0) {
      Logger.log('No pizza items parsed for row ' + rowNum + ' — confirmation not sent.');
      return;
    }

    var lines = pizzas.map(function(p) {
      return p.childName + (p.class ? ' (' + p.class + ')' : '') + '\n' + formatSizeLabel(p.size) + ' — £' + p.price.toFixed(2);
    });
    if (discountInfo && discountInfo.code) {
      lines.push('DISCOUNT: ' + discountInfo.code + ' (-£' + discountInfo.discountAmount.toFixed(2) + ')');
    }

    var orderLink = 'https://www.artisanoven.shop/Payment.html?order=' + formattedOrderId + '&token=' + token + '&t=' + new Date().getTime();

    var body =
      'Hi ' + payerName + ',\n\n' +
      'Thank you for placing your pizza order for ' + settings.serviceDate + '. Please find your order details below:\n\n' +
      'ORDER NUMBER: #' + formattedOrderId + '\n\n' +
      'Click your order number or the link below to view your order:\n' + orderLink + '\n\n' +
      'ORDER SUMMARY\n\n' +
      lines.join('\n\n') + '\n\n' +
      'TOTAL AMOUNT DUE: £' + totalAfterDiscount.toFixed(2) + '\n\n' +
      PAYMENT_INFO_BLOCK + '\n\n' +
      'COLLECTION\n\n' +
      'Please ask your child to collect their pizza from the back of the courtyard at lunchtime.\n\n' +
      'STAY UPDATED\n' +
      'Join our WhatsApp group: https://chat.whatsapp.com/H6UKHyWuVHnCJWNu7f83ZO\n\n' +
      'Thank you.\n\n' +
      'Kind regards,\n\nMarlow, Louis, and Quinton';

    var htmlBody =
      '<p>Hi ' + payerName + ',</p>' +
      '<p>Thank you for placing your pizza order for ' + settings.serviceDate + '. Please find your order details below:</p>' +
      '<p><strong>ORDER NUMBER: <a href="' + orderLink + '" target="_blank">#' + formattedOrderId + '</a></strong></p>' +
      '<p><a href="' + orderLink + '" target="_blank" style="display:inline-block;padding:10px 20px;background-color:#4F6359;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">VIEW MY ORDER</a></p>' +
      '<p>You will be taken directly to your order on the Artisan Oven website.</p>' +
      '<p><strong>ORDER SUMMARY</strong></p>' +
      '<p>' + lines.join('<br><br>') + '</p>' +
      '<p><strong>TOTAL AMOUNT DUE: £' + totalAfterDiscount.toFixed(2) + '</strong></p>' +
      '<p>' + PAYMENT_INFO_BLOCK.replace(/\n/g, '<br>') + '</p>' +
      '<p><strong>COLLECTION</strong></p>' +
      '<p>Please ask your child to collect their pizza from the back of the courtyard at lunchtime.</p>' +
      '<p><strong>STAY UPDATED</strong></p>' +
      '<p>Join our WhatsApp group for updates: <a href="https://chat.whatsapp.com/H6UKHyWuVHnCJWNu7f83ZO">Click here to join</a></p>' +
      '<p>Thank you.</p>' +
      '<p>Kind regards,<br><br>Marlow, Louis, and Quinton</p>';

    MailApp.sendEmail({
      to: payerEmail,
      subject: CONFIRMATION_SUBJECT + ' (' + formattedOrderId + ')',
      body: body,
      htmlBody: htmlBody
    });
    // Mark as SENT only after successful MailApp dispatch
    raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('SENT');
  } catch (e) {
    Logger.log('MailApp error for row ' + rowNum + ': ' + e);
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      if (raw) {
        raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('FAILED: ' + e.toString().substring(0, 50));
      }
    } catch (innerErr) {}
  } finally {
    try {
      lock.releaseLock();
    } catch (lockErr) {}
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
  if (!raw) return 'Bank Transfer';
  var key = String(raw).trim().replace(/\s+/g, ' ');
  var lower = key.toLowerCase();
  if (lower.indexOf('cash') !== -1) return 'Cash';
  if (lower.indexOf('card') !== -1) return 'Card';
  if (lower.indexOf('paypal') !== -1) return 'PayPal';
  if (lower.indexOf('bank') !== -1 || lower.indexOf('transfer') !== -1) return 'Bank Transfer';
  return PAYMENT_MAP[key] || (key === '' ? 'Bank Transfer' : key);
}

function detectPaymentMethodFromRow(row, headers) {
  if (!row || !row.length) return 'Bank Transfer';

  // 1. Look for known payment method headers in spreadsheet
  if (headers && headers.length) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').trim().toLowerCase();
      if (!h) continue;
      if (h.indexOf('payment method') !== -1 ||
          h.indexOf('preferred payment') !== -1 ||
          h.indexOf('method of payment') !== -1 ||
          h.indexOf('cash or card') !== -1 ||
          h.indexOf('how will you pay') !== -1 ||
          h.indexOf('how do you plan to pay') !== -1 ||
          h.indexOf('payment type') !== -1 ||
          h.indexOf('payment option') !== -1) {
        var val = safeTrim(row[i]);
        if (val) return mapPaymentMethod(val);
      }
    }
  }

  // 2. Scan row values for obvious payment method strings if no header found
  for (var j = 0; j < row.length; j++) {
    var cellVal = String(row[j] || '').toLowerCase().trim();
    if (cellVal === 'cash' || cellVal.indexOf('cash via child') !== -1 || cellVal === 'paypal' || cellVal === 'bank transfer') {
      return mapPaymentMethod(row[j]);
    }
  }

  // 3. Check standard Google Form columns 49 and 51
  var paymentRaw = firstNonEmpty(row[49], row[51]);
  if (paymentRaw) return mapPaymentMethod(paymentRaw);

  // 3. Fallback: inspect each cell for explicit keywords
  for (var c = 0; c < row.length; c++) {
    var cell = String(row[c] || '').trim().toLowerCase();
    if (cell === 'cash' || cell.indexOf('cash via') !== -1 || cell.indexOf('cash on') !== -1) {
      return 'Cash';
    }
    if (cell === 'card' || cell.indexOf('debit card') !== -1 || cell.indexOf('credit card') !== -1) {
      return 'Card';
    }
    if (cell === 'paypal') {
      return 'PayPal';
    }
    if (cell === 'bank transfer' || cell === 'banktransfer') {
      return 'Bank Transfer';
    }
  }

  return 'Bank Transfer';
}

function customerReportedPaid(row, headers) {
  if (!row || !headers) return false;

  for (var i = 0; i < headers.length; i++) {
    var header = safeTrim(headers[i]).toLowerCase();
    if (!header || !/paid|payment/.test(header)) continue;
    if (/payment\s*method|preferred\s+payment|method\s+of\s+payment/.test(header)) continue;
    if (!/have\s+you\s+paid|already\s+paid|paid\s+for|payment\s+(made|sent|completed)|paid\??/.test(header)) continue;

    var answer = safeTrim(row[i]).toLowerCase();
    return answer === 'yes' || answer === 'y' || answer === 'true' || answer === '1' || answer === 'paid';
  }

  return false;
}

function resolvePaymentStatus(row, headers, manualStatus) {
  var explicitStatus = safeTrim(manualStatus);
  if (explicitStatus) return explicitStatus;
  return customerReportedPaid(row, headers) ? 'Paid' : 'Pending Payment';
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

function extractPayerEmailWithHeaders(row, headers) {
  if (!row || !row.length) return '';
  
  // 1. Try to find a column with "email" in the header name (ignoring timestamp column)
  if (headers && headers.length) {
    for (var h = 1; h < headers.length; h++) {
      var head = String(headers[h] || '').toLowerCase();
      if (head.indexOf('email') >= 0 || head.indexOf('e-mail') >= 0) {
        var val = safeTrim(String(row[h] || ''));
        if (isValidEmail(val)) return val;
      }
    }
  }

  // 2. Fallback to searching all columns except the first one (timestamp)
  for (var i = 1; i < row.length; i++) {
    var candidate = safeTrim(row[i]);
    if (isValidEmail(candidate)) return candidate;
  }
  return '';
}

function extractPayerEmail(row) {
  return extractPayerEmailWithHeaders(row, []);
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
function getCurrentSessionOrderChecklist() {
  var settings = getSettings();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var lastRow = raw.getLastRow();
  var data = raw.getRange(1, 1, Math.min(lastRow, 1), raw.getLastColumn()).getValues();
  var headers = data.length > 0 ? data[0] : [];
  var startRowIndex = Math.max(1, (parseInt(settings.sessionStartRow, 10) || 2) - 1);
  var items = [];

  if (lastRow > startRowIndex) {
    var sessionData = raw.getRange(startRowIndex + 1, 1, lastRow - startRowIndex, raw.getLastColumn()).getValues();
    for (var r = 0; r < sessionData.length; r++) {
      var row = sessionData[r];
      if (rowIsBlank(row) || isRowDeleted(row)) continue;

      var paymentStatus = resolvePaymentStatus(row, headers, row[PAYMENT_STATUS_COL]);
      var normalizedPaymentStatus = safeTrim(paymentStatus).toLowerCase();
      if (/^(failed|declined|rejected|cancelled|canceled|refunded|void)$/.test(normalizedPaymentStatus)) continue;

      var orderNum = startRowIndex + 1 + r;
      var qtyDigit = extractDigit(safeTrim(row[3])) || '0';
      var allergyFlag = safeTrim(row[1]).toLowerCase() === 'yes';
      var allergyDetails = stripHtml(safeTrim(row[2]));
      var blocks = BRANCHES[qtyDigit] || [];

      for (var b = 0; b < blocks.length; b++) {
        var cols = blocks[b];
        var sizeRaw = safeTrim(row[cols[0]]);
        var childName = safeTrim(row[cols[1]]);
        var className = safeTrim(row[cols[2]]);
        if (!sizeRaw && !childName) continue;

      var size = mapSize(sizeRaw);
      var classMatch = className.match(/class\s*(\d+)/i);
      var classNumber = classMatch ? parseInt(classMatch[1], 10) : 999;
        items.push({
          pickupId: String(orderNum) + '-' + (items.filter(function(item) {
            return item.orderId === String(orderNum);
          }).length + 1),
          orderId: String(orderNum),
          childName: childName || 'Student',
          className: className || 'Unassigned',
          classNumber: classNumber,
          size: formatSizeLabel(size) || sizeRaw,
          capacity: getPizzaCapacityValue(sizeRaw),
          allergy: allergyFlag ? (allergyDetails || 'Flagged - confirm with parent') : ''
        });
      } // closes the blocks loop
    } // closes the session-data loop
  } // REQUIRED: closes `if (lastRow > startRowIndex)`

  items.sort(function(a, b) {
    return a.classNumber - b.classNumber ||
      a.className.localeCompare(b.className) ||
      a.childName.localeCompare(b.childName);
  });

  var totalCapacity = items.reduce(function(total, item) {
    return total + item.capacity;
  }, 0);
  var classCount = items.reduce(function(classes, item) {
    classes[item.className] = true;
    return classes;
  }, {});

  return {
    sessionLabel: safeTrim(settings.serviceDate) || 'Current session',
    items: items,
    totalCapacity: normalizePizzaCapacity(totalCapacity),
    classCount: Object.keys(classCount).length
  };
}

function escapeOrdersHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOrdersChecklistHtml(checklist, forPdf) {
  var grouped = {};
  checklist.items.forEach(function(item) {
    if (!grouped[item.className]) grouped[item.className] = [];
    grouped[item.className].push(item);
  });

  var groups = Object.keys(grouped).sort(function(a, b) {
    var aNumber = grouped[a][0].classNumber;
    var bNumber = grouped[b][0].classNumber;
    return aNumber - bNumber || a.localeCompare(b);
  });
  var classMarkup = groups.map(function(className) {
    var rows = grouped[className].map(function(item) {
      return '<div class="order-row">' +
        '<div class="check"></div>' +
        '<div class="who"><div class="name">' + escapeOrdersHtml(item.childName) + '</div>' +
        '<div class="sub">' + escapeOrdersHtml(item.size) + '</div>' +
        (item.allergy ? '<div class="allergy">Allergy - ' + escapeOrdersHtml(item.allergy) + '</div>' : '') +
        '</div><div class="ref">' + escapeOrdersHtml(item.pickupId) + '</div></div>';
    }).join('');
    return '<div class="class-row"><span>' + escapeOrdersHtml(className.toUpperCase()) +
      '</span><span class="count">' + grouped[className].length + ' ' +
      (grouped[className].length === 1 ? 'order' : 'orders') + '</span></div>' + rows;
  }).join('');

  var meta = checklist.items.length
    ? normalizePizzaCapacity(checklist.totalCapacity) + ' pizzas across ' + checklist.classCount +
      ' classes - tick each one off as it is handed out.'
    : 'No orders for this session yet.';
  var titleFont = forPdf ? 'Georgia, serif' : "'Fraunces', Georgia, serif";
  var emptyMarkup = checklist.items.length ? classMarkup : '<p class="empty">No orders for this session yet.</p>';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Orders</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">' +
    '<style>' +
    ':root{--ink:#1D1D1F;--subtle:#86868B;--hairline:#E5E5EA;--accent:#D9480F;--ring:#C7C7CC}' +
    '*{box-sizing:border-box}body{font-family:"Work Sans",Arial,sans-serif;color:var(--ink);margin:0;padding:40px 48px;max-width:760px}' +
    '.kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}' +
    'h1.title{font-family:' + titleFont + ';font-weight:600;font-size:42px;margin:4px 0 0}' +
    '.meta{color:var(--subtle);font-size:15px;margin:8px 0 32px}.class-row{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0 8px;border-bottom:1px solid var(--hairline);font-weight:600;font-size:13px;letter-spacing:.02em}' +
    '.count{color:var(--subtle);font-weight:400}.order-row{display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid var(--hairline);break-inside:avoid}' +
    '.check{width:15px;height:15px;min-width:15px;border-radius:50%;border:1.3px solid var(--ring)}.who{flex:1}.name{font-weight:600;font-size:15px}.sub{color:var(--subtle);font-size:12.5px;margin-top:2px}.allergy{color:var(--accent);font-weight:600;font-size:11.5px;margin-top:3px}.ref{color:var(--subtle);font-size:12.5px}.footer{margin-top:36px;color:var(--subtle);font-size:11px}.empty{color:var(--subtle);padding:12px 0}.class-row{break-after:avoid}' +
    '@media print{body{padding:0;max-width:none}.order-row{break-inside:avoid}}' +
    '</style></head><body><div class="kicker">' + escapeOrdersHtml(checklist.sessionLabel.toUpperCase()) +
    '</div><h1 class="title">Orders</h1><div class="meta">' + escapeOrdersHtml(meta) + '</div>' +
    emptyMarkup + '<div class="footer">Generated ' + escapeOrdersHtml(
      Utilities.formatDate(new Date(), 'Europe/London', 'dd MMM yyyy HH:mm')) +
    ' from the live order sheet.</div></body></html>';
}

function getAllOrdersForAdmin() {
  ensureFormSubmitTrigger();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  var headers = data.length > 0 ? data[0] : [];
  
  Logger.log('getAllOrdersForAdmin: Found ' + data.length + ' rows in sheet: ' + raw.getName());
  
  if (data.length < 2) {
    Logger.log('getAllOrdersForAdmin: No data rows found.');
    return [];
  }

  var allOrders = [];

  // Optional: Load overrides from Pizza Order Update sheet
  var methodOverrides = {};
  try {
    var updateSheet = ss.getSheetByName('Pizza Order Update');
    if (updateSheet) {
      var uData = updateSheet.getDataRange().getValues();
      if (uData.length > 1) {
        var uHeaders = uData[0];
        var idCol = -1, methodCol = -1;
        for (var h = 0; h < uHeaders.length; h++) {
          var ut = String(uHeaders[h] || '').toLowerCase().trim();
          if (ut === 'order id' || ut === 'id') idCol = h;
          if (ut === 'payment method' || ut === 'method') methodCol = h;
        }
        if (idCol !== -1 && methodCol !== -1) {
          for (var i = 1; i < uData.length; i++) {
            var rawId = uData[i][idCol];
            var mth = String(uData[i][methodCol] || '').trim();
            if (rawId !== '' && mth !== '') {
              var oid = String(rawId).trim();
              methodOverrides[oid] = mth;
              // Add integer version to handle numeric cell formatting (e.g. 123.0)
              var pId = parseInt(oid, 10);
              if (!isNaN(pId)) methodOverrides[String(pId)] = mth;
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log('Order list override note: ' + e);
  }

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
    var paymentMethod = methodOverrides[formattedId] || detectPaymentMethodFromRow(row, headers);
    var payerRaw = firstNonEmpty(row[50], row[52]);
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
      var discountInfo = getOrderDiscountInfo(row, headers, orderTotal);
      var totalAfterDiscount = discountInfo && discountInfo.totalAfterDiscount !== undefined ? discountInfo.totalAfterDiscount : orderTotal;
      allOrders.push({
        orderId: formattedId,
        timestamp: timestampStr,
        customer: {
          name: payerName,
          email: payerEmail
        },
        allergy: (String(allergyYN).toLowerCase() === 'yes' ? allergyText : ''),
        pizzas: pizzas,
        total: totalAfterDiscount,
        totalAfterDiscount: totalAfterDiscount,
        discountCode: discountInfo ? discountInfo.code : '',
        discountAmount: discountInfo ? discountInfo.discountAmount : 0,
        discountReason: discountInfo ? discountInfo.discountReason : '',
        pizzaCount: normalizePizzaCapacity(orderCapacity),
        totalCapacity: normalizePizzaCapacity(orderCapacity),
        itemCount: pizzas.length,
        paymentStatus: resolvePaymentStatus(row, headers, manualPaymentStatus),
        paymentMethod: paymentMethod
      });
    }
  }

  Logger.log('getAllOrdersForAdmin: Successfully parsed ' + allOrders.length + ' orders.');
  return allOrders;
}

function getAllParentOrdersForAdmin() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Internal Parent Orders');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var rows = sheet.getDataRange().getValues();
  var orders = [];
  for (var i = rows.length - 1; i >= 1; i--) {
    var row = rows[i];
    if (!row || rowIsBlank(row)) continue;
    if (safeTrim(String(row[16] || '')).toUpperCase() === 'TRUE') continue;

    var itemsJson = safeTrim(String(row[6] || '[]'));
    var items = [];
    try { items = JSON.parse(itemsJson); } catch (e) {}

    orders.push({
      orderId: safeTrim(String(row[1] || '')),
      parentName: safeTrim(String(row[2] || '')),
      parentEmail: safeTrim(String(row[3] || '')),
      childName: safeTrim(String(row[4] || '')),
      className: safeTrim(String(row[5] || '')),
      items: items.map(function(item) {
        return {
          sizeKey: item.size || '',
          size: formatSizeLabel(item.size || ''),
          qty: parseInt(item.qty, 10) || 0,
          unitPrice: parseFloat(item.unitPrice || PRICE_MAP[item.size] || 0)
        };
      }),
      originalTotal: parseFloat(row[7]) || 0,
      discountAmount: parseFloat(row[8]) || 0,
      finalTotal: parseFloat(row[9]) || 0,
      paymentMethod: mapPaymentMethod(row[10]),
      paymentStatus: safeTrim(String(row[11] || '')),
      orderType: safeTrim(String(row[17] || '')) || 'INTERNAL_PARENT',
      timestamp: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Europe/London', 'dd MMM yyyy HH:mm') : String(row[0] || '')
    });
  }
  return orders;
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

function ensureInternalParentOrdersSheet(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;

  var sheet = ss.getSheetByName('Internal Parent Orders');
  if (!sheet) {
    sheet = ss.insertSheet('Internal Parent Orders');
    sheet.appendRow([
      'Timestamp', 'OrderId', 'ParentName', 'ParentEmail', 'ChildName', 'Class', 'ItemsJson',
      'OriginalTotal', 'DiscountAmount', 'FinalTotal', 'PaymentMethod', 'PaymentStatus',
      'OrderStatus', 'ConfirmationStatus', 'Notes', 'Token', 'Deleted', 'OrderType'
    ]);
    sheet.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#E8E8E8');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 18);
  }
  return sheet;
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
        paid: paymentStatus === 'Paid' ? 'Yes' : 'No',
        total: total,
        pizzas: pizzas
      };
    }
  }
  return null;
}

function lookupInternalParentOrder(searchEmail, searchOrderId, searchToken) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Internal Parent Orders');
  if (!sheet || sheet.getLastRow() < 2) return null;
  var data = sheet.getDataRange().getValues();

  var normEmail = searchEmail ? searchEmail.toLowerCase() : '';
  var normId = searchOrderId ? searchOrderId.toUpperCase().replace(/\s+/g, '') : '';
  var sToken = searchToken ? safeTrim(searchToken) : '';

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    if (!row || rowIsBlank(row)) continue;
    if (safeTrim(String(row[16] || '')).toUpperCase() === 'TRUE') continue;

    var orderId = safeTrim(String(row[1] || '')).toUpperCase();
    var parentName = safeTrim(String(row[2] || ''));
    var parentEmail = safeTrim(String(row[3] || ''));
    var childName = safeTrim(String(row[4] || ''));
    var childClass = safeTrim(String(row[5] || ''));
    var itemsJson = safeTrim(String(row[6] || '[]'));
    var originalTotal = parseFloat(row[7]) || 0;
    var discountAmount = parseFloat(row[8]) || 0;
    var finalTotal = parseFloat(row[9]) || originalTotal;
    var paymentMethod = mapPaymentMethod(row[10]);
    var paymentStatus = safeTrim(String(row[11] || ''));
    var token = safeTrim(String(row[15] || ''));

    var idMatches = normId && (normId === orderId);
    var emailMatches = normEmail && parentEmail && (parentEmail.toLowerCase() === normEmail);
    var tokenMatches = sToken && idMatches && (token === sToken);

    if (tokenMatches || emailMatches || (idMatches && !sToken)) {
      var items = [];
      try { items = JSON.parse(itemsJson); } catch (e) { items = []; }
      var pizzas = items.map(function(item, idx) {
        var sizeKey = safeTrim(item.size || '');
        var unitPrice = parseFloat(item.unitPrice || PRICE_MAP[sizeKey] || 0);
        var qty = parseInt(item.qty, 10) || 1;
        return {
          item: formatSizeLabel(sizeKey),
          sizeKey: sizeKey,
          quantity: qty,
          childName: childName || 'Child',
          class: childClass || '',
          price: unitPrice * qty,
          priceFormatted: '£' + (unitPrice * qty).toFixed(2),
          pickupId: orderId + '-' + (idx + 1)
        };
      });

      return {
        orderIndex: orderId,
        formattedOrderId: orderId,
        payerName: parentName || 'Parent',
        payerEmail: parentEmail,
        paymentMethod: paymentMethod,
        paid: paymentStatus === 'Paid' ? 'Yes' : 'No',
        total: finalTotal,
        totalAfterDiscount: finalTotal,
        discountCode: INTERNAL_PARENT_DISCOUNT_CODE,
        discountAmount: discountAmount,
        discountReason: '50% internal parent discount',
        pizzas: pizzas
      };
    }
  }
  return null;
}

function sendParentOrderConfirmation(orderId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Internal Parent Orders');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getDataRange().getValues();

  var rowNum = -1;
  var row = null;
  for (var i = 1; i < data.length; i++) {
    if (safeTrim(String(data[i][1])).toUpperCase() === String(orderId).toUpperCase()) {
      rowNum = i + 1;
      row = data[i];
      break;
    }
  }
  if (!row) return;

  var alreadySent = safeTrim(String(row[13] || ''));
  if (alreadySent === 'SENT') return;

  var parentName = safeTrim(String(row[2] || 'there'));
  var parentEmail = safeTrim(String(row[3] || ''));
  var childName = safeTrim(String(row[4] || ''));
  var childClass = safeTrim(String(row[5] || ''));
  var itemsJson = safeTrim(String(row[6] || '[]'));
  var discountAmount = parseFloat(row[8]) || 0;
  var finalTotal = parseFloat(row[9]) || 0;
  var token = safeTrim(String(row[15] || ''));
  var paymentMethod = mapPaymentMethod(row[10]);

  var items = [];
  try { items = JSON.parse(itemsJson); } catch (e) {}
  var lines = items.map(function(item) {
    var q = parseInt(item.qty, 10) || 1;
    var up = parseFloat(item.unitPrice || PRICE_MAP[item.size] || 0);
    return formatSizeLabel(item.size) + ' x ' + q + ' — £' + (up * q).toFixed(2);
  });

  var orderLink = 'https://www.artisanoven.shop/Payment.html?order=' + orderId + '&token=' + token + '&t=' + new Date().getTime();
  var body =
    'Hi ' + parentName + ',\n\n' +
    'Thank you for placing your internal parent order for ' + childName + ' (' + childClass + ').\n\n' +
    'ORDER NUMBER: #' + orderId + '\n\n' +
    'View your order here:\n' + orderLink + '\n\n' +
    'ORDER SUMMARY\n\n' +
    lines.join('\n') + '\n\n' +
    'ORIGINAL TOTAL: £' + (parseFloat(row[7]) || 0).toFixed(2) + '\n' +
    'DISCOUNT: -£' + discountAmount.toFixed(2) + '\n' +
    'FINAL TOTAL: £' + finalTotal.toFixed(2) + '\n\n' +
    'PAYMENT METHOD: ' + paymentMethod + '\n\n' +
    PAYMENT_INFO_BLOCK + '\n\n' +
    'Thank you for supporting Artisan Oven.\n\n' +
    'Kind regards,\n\nMarlow, Louis, and Quinton';

  var htmlBody =
    '<p>Hi ' + parentName + ',</p>' +
    '<p>Thank you for placing your internal parent order for <strong>' + childName + '</strong> (' + childClass + ').</p>' +
    '<p><strong>ORDER NUMBER: <a href="' + orderLink + '" target="_blank">#' + orderId + '</a></strong></p>' +
    '<p><a href="' + orderLink + '" target="_blank" style="display:inline-block;padding:10px 20px;background-color:#4F6359;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold;">VIEW MY ORDER</a></p>' +
    '<p><strong>ORDER SUMMARY</strong></p>' +
    '<p>' + lines.join('<br>') + '</p>' +
    '<p><strong>ORIGINAL TOTAL:</strong> £' + (parseFloat(row[7]) || 0).toFixed(2) + '<br>' +
    '<strong>DISCOUNT:</strong> -£' + discountAmount.toFixed(2) + '<br>' +
    '<strong>FINAL TOTAL:</strong> £' + finalTotal.toFixed(2) + '</p>' +
    '<p><strong>PAYMENT METHOD:</strong> ' + paymentMethod + '</p>' +
    '<p>' + PAYMENT_INFO_BLOCK.replace(/\n/g, '<br>') + '</p>' +
    '<p>Thank you for supporting Artisan Oven!</p>' +
    '<p>Kind regards,<br><br>Marlow, Louis, and Quinton</p>';

  try {
    MailApp.sendEmail({
      to: parentEmail,
      subject: 'Artisan Oven — Parent Order Confirmation (' + orderId + ')',
      body: body,
      htmlBody: htmlBody
    });
    sheet.getRange(rowNum, 14).setValue('SENT');
  } catch (e) {
    sheet.getRange(rowNum, 14).setValue('FAILED: ' + e.toString().substring(0, 50));
  }
}

function sendInternalParentOrderNotification(orderId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Internal Parent Orders');
  if (!sheet || sheet.getLastRow() < 2) return;
  var data = sheet.getDataRange().getValues();

  var row = null;
  for (var i = 1; i < data.length; i++) {
    if (safeTrim(String(data[i][1])).toUpperCase() === String(orderId).toUpperCase()) {
      row = data[i];
      break;
    }
  }
  if (!row) return;

  var parentName = safeTrim(String(row[2] || ''));
  var parentEmail = safeTrim(String(row[3] || ''));
  var childName = safeTrim(String(row[4] || ''));
  var childClass = safeTrim(String(row[5] || ''));
  var itemsJson = safeTrim(String(row[6] || '[]'));
  var originalTotal = parseFloat(row[7]) || 0;
  var discountAmount = parseFloat(row[8]) || 0;
  var finalTotal = parseFloat(row[9]) || 0;
  var paymentMethod = mapPaymentMethod(row[10]);
  var notes = safeTrim(String(row[14] || ''));

  var items = [];
  try { items = JSON.parse(itemsJson); } catch (e) {}
  var lineItems = items.map(function(item) {
    var qty = parseInt(item.qty, 10) || 1;
    var up = parseFloat(item.unitPrice || PRICE_MAP[item.size] || 0);
    return formatSizeLabel(item.size) + ' x ' + qty + ' — £' + (up * qty).toFixed(2);
  });

  var body =
    'NEW INTERNAL PARENT ORDER — Order #' + orderId + '\n\n' +
    'Parent: ' + parentName + ' (' + parentEmail + ')\n' +
    'Child: ' + childName + '\n' +
    'Class: ' + childClass + '\n' +
    'Payment Method: ' + paymentMethod + '\n' +
    'Items:\n' + lineItems.join('\n') + '\n\n' +
    'Original Total: £' + originalTotal.toFixed(2) + '\n' +
    'Discount: -£' + discountAmount.toFixed(2) + '\n' +
    'Final Total: £' + finalTotal.toFixed(2) + '\n\n' +
    (notes ? 'Notes: ' + notes + '\n\n' : '') +
    'Order Type: INTERNAL_PARENT';

  MailApp.sendEmail({
    to: YOUR_EMAIL,
    subject: 'NEW INTERNAL PARENT ORDER — Order #' + orderId,
    body: body
  });
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

  var orderLink = 'https://www.artisanoven.shop/Payment.html?order=' + orderId + '&token=' + token + '&t=' + new Date().getTime();

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
