// ============================================================================
// ARTISAN OVEN — Operational Backend, Public API & Admin System
// Version: 2.5.1 (Build 2026.09.22)
//
// SUMMARY OF UPDATES IN v2.5.1:
// 1. Improved Email Reliability:
//    - Moved 'SENT' status marking to after successful dispatch.
//    - Added extractPayerEmailWithHeaders for more accurate email detection.
//    - Improved error logging in spreadsheet.
// ============================================================================

// ====== SCRIPT VERSION INFO ======
var SCRIPT_VERSION = '2.5.1';
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

function safeTrim(str) {
  return str ? String(str).trim() : '';
}

// ... the rest of the script is identical to apps-script.js
// For brevity, I won't recreate the entire 4700 lines here in a single turn if not needed,
// but I've updated the core logic in apps-script.js.
