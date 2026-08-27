// ============================================================================
// ARTISAN OVEN — Order Management & Order Lookup API
// ============================================================================

// ====== SETTINGS — edit these lines if needed ======
var YOUR_EMAIL = 'louis@benne.co.uk';
var EMAIL_SUBJECT = 'Pizza Order Update';
var CONFIRMATION_SUBJECT = 'Your Pizza Order Confirmation & Payment Details';
var PAYPAL_ME_BASE = 'https://paypal.me/ArtisanOven';
var PAYPAL_NCP_LINK = 'https://www.paypal.com/ncp/payment/LXZKSSG3QEFJA';

// NEW: Live order capacity limits
// Change ORDERING_ENABLED to false to manually shut off ordering completely.
// Change MAX_PIZZAS to the total limit of pizzas you can handle.
var ORDERING_ENABLED = true;
var MAX_PIZZAS = 20;

// ===================================================

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
// WEB APP API ENTRYPOINT (doGet)
// ============================================================================

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action || 'getOrder';
    var query = safeTrim(params.query || params.email || params.orderId || '');

    if (action === 'getOrder') {
      if (!query) {
        return createJsonResponse({
          success: false,
          message: 'Please provide an email address or Order ID to search.'
        });
      }

      var result = lookupOrder(query, query);
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
          message: "We couldn't find an order associated with that email address. Please check the email and try again."
        });
      }
    }

    if (action === 'getStatus') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
      var data = raw.getDataRange().getValues();
      
      var totalPizzas = 0;
      for (var r = 1; r < data.length; r++) {
        var row = data[r];
        if (rowIsBlank(row)) continue;

        var qtyRaw = safeTrim(row[3]);
        var qtyDigit = extractDigit(qtyRaw) || '0';
        var blocks = BRANCHES[qtyDigit] || [];

        for (var b = 0; b < blocks.length; b++) {
          var cols = blocks[b];
          var sizeRaw = safeTrim(row[cols[0]]);
          var childName = safeTrim(row[cols[1]]);
          if (sizeRaw || childName) totalPizzas++;
        }
      }
      
      var remaining = Math.max(0, MAX_PIZZAS - totalPizzas);
      var isOpen = ORDERING_ENABLED && (remaining > 0);
      
      var message = "";
      if (!ORDERING_ENABLED) {
        message = "Ordering is currently closed.";
      } else if (remaining <= 0) {
        message = "We're fully booked for this session. Please check back next time.";
      } else {
        message = remaining + " pizzas remaining.";
      }

      return createJsonResponse({
        currentPizzas: totalPizzas,
        maxPizzas: MAX_PIZZAS,
        remainingPizzas: remaining,
        orderingOpen: isOpen,
        message: message
      });
    }

    return createJsonResponse({
      success: false,
      message: 'Invalid action requested.'
    });

  } catch (err) {
    Logger.log('doGet error: ' + err);
    return createJsonResponse({
      success: false,
      message: 'Unable to retrieve order at this time. Please try again shortly.'
    });
  }
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function lookupOrder(searchEmail, searchOrderId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var data = raw.getDataRange().getValues();
  if (data.length < 2) return null;

  var matchingOrders = [];
  var normalizedSearchEmail = searchEmail ? searchEmail.toLowerCase() : '';
  var normalizedOrderId = searchOrderId ? searchOrderId.toUpperCase().replace(/\s+/g, '') : '';

  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    if (rowIsBlank(row)) continue;

    var orderNum = r;
    var formattedId = String(orderNum);

    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);
    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'Valued Customer';
    var payerEmail = extractPayerEmail(row);

    var emailMatches = normalizedSearchEmail && payerEmail && (payerEmail.toLowerCase() === normalizedSearchEmail);
    var idMatches = normalizedOrderId && (normalizedOrderId === formattedId);

    if (emailMatches || idMatches) {
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
  // Waitlist/Overcapacity check could be added here
  rebuildCleanSheets();
  emailXlsxSnapshot();
  trySendOrderConfirmation(e);
}

// NEW: true if every cell in a row is empty/whitespace.
function rowIsBlank(row) {
  return !row.some(function(cell) { return safeTrim(cell) !== ''; });
}

function resetAllOrderData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var lastRow = raw.getLastRow();

  if (lastRow > 1) {
    raw.deleteRows(2, lastRow - 1); 
  }

  var sheet = ss.getSheetByName('Pizza Order Update');
  if (sheet) sheet.clear();

  Logger.log('All order data cleared. Numbering will restart from 1 on the next submission.');
}

function rebuildCleanSheets() {
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
  if (data.length < 2) return;

  var sizeCounts = {};
  var totalPizzas = 0;
  var totalOrders = 0;
  var allergyOrders = 0;
  var paidOrders = 0;
  var unpaidOrders = 0;

  var orderSummaryRows = [];
  var pizzaOrdersRows = [];
  var orderTotalsRows = [];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    if (rowIsBlank(row)) continue;
    
    var pizzasBeforeThisOrder = totalPizzas;

    var allergyYN = safeTrim(row[1]);
    var allergyText = stripHtml(safeTrim(row[2]));
    var qtyRaw = safeTrim(row[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var paymentRaw = firstNonEmpty(row[49], row[51]);
    var payerRaw = firstNonEmpty(row[50], row[52]);

    var paymentMethod = mapPaymentMethod(paymentRaw);
    var payerName = safeTrim(payerRaw) || 'Unknown';
    var payerEmail = extractPayerEmail(row);

    var isWaitlist = (pizzasBeforeThisOrder >= MAX_PIZZAS);
    if (isWaitlist) {
      payerName = "[WAITLIST] " + payerName;
    }

    totalOrders++;
    if (String(allergyYN).toLowerCase() === 'yes') allergyOrders++;

    var paid = paymentMethod ? 'Yes' : 'No';
    if (paid === 'Yes') paidOrders++; else unpaidOrders++;

    var orderId = totalOrders;
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
      if (size) sizeCounts[size] = (sizeCounts[size] || 0) + 1;
      totalPizzas++;
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
      paid,
      allergyYN,
      allergyText,
      numPizzas,
      pizzaDetailsParts.join('\n')
    ]);

    for (var p = 0; p < pizzas.length; p++) {
      var pizza = pizzas[p];
      var pickupId = orderId + '-' + pizza.pizzaNum;
      pizzaOrdersRows.push([
        formattedOrderId, payerName, paymentMethod, paid, allergyYN, allergyText,
        pizza.pizzaNum, pickupId, pizza.childName, pizza.class, pizza.size
      ]);
    }

    var confirmSent = raw.getRange(r + 1, CONFIRMATION_SENT_COL).getValue() === 'SENT' ? 'Yes' : 'No';
    orderTotalsRows.push([formattedOrderId, payerName, payerEmail || '(no valid email)', orderTotal, confirmSent]);
  }

  var currentRow = 1;
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

  writeSectionTitle(sheet, currentRow, 'SUMMARY', 2);
  currentRow++;

  var summaryRows = [
    ['Pizza Order Summary', ''],
    ['', ''],
    ['Size', 'Count']
  ];
  for (var s in sizeCounts) {
    summaryRows.push([s, sizeCounts[s]]);
  }
  summaryRows.push(['Total Pizzas', totalPizzas]);
  summaryRows.push(['', '']);
  summaryRows.push(['Total Orders (payers)', totalOrders]);
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];

  var alreadySent = raw.getRange(rowNum, CONFIRMATION_SENT_COL).getValue();
  if (alreadySent === 'SENT') return;

  // Determine if this order was a waitlist order
  var data = raw.getDataRange().getValues();
  var pizzasBefore = 0;
  for (var r = 1; r < rowNum - 1; r++) {
    var pRow = data[r];
    if (rowIsBlank(pRow)) continue;

    var qtyRaw = safeTrim(pRow[3]);
    var qtyDigit = extractDigit(qtyRaw) || '0';
    var blocks = BRANCHES[qtyDigit] || [];
    for (var b = 0; b < blocks.length; b++) {
      var sizeRaw = safeTrim(pRow[blocks[b][0]]);
      var childName = safeTrim(pRow[blocks[b][1]]);
      if (sizeRaw || childName) pizzasBefore++;
    }
  }
  var isWaitlist = (pizzasBefore >= MAX_PIZZAS);

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
  
  if (isWaitlist) {
    body = 
      'Hi ' + payerName + ',\n\n' +
      'Thank you for your pizza order request. Unfortunately, we have already reached our maximum capacity for this session.\n\n' +
      'Your order has been placed on the WAITLIST. We will contact you if a spot opens up.\n\n' +
      'Please DO NOT send payment at this time.\n\n' +
      'Kind regards,\n\nMarlow, Louis, and Quinton';
  } else {
    body =
      'Hi ' + payerName + ',\n\n' +
      'Thank you for placing your pizza order. Please find your order details below:\n\n' +
      'ORDER NUMBER: ' + formattedOrderId + '\n\n' +
      'ORDER SUMMARY\n\n' +
      lines.join('\n\n') + '\n\n' +
      'TOTAL AMOUNT DUE: £' + orderTotal.toFixed(2) + '\n\n' +
      PAYMENT_INFO_BLOCK + '\n\n' +
      'COLLECTION\n\n' +
      'Please ask your child to collect their pizza from the back of the courtyard at lunchtime.\n\n' +
      'Thank you.\n\n' +
      'Kind regards,\n\nMarlow, Louis, and Quinton';
  }

  MailApp.sendEmail({
    to: payerEmail,
    subject: CONFIRMATION_SUBJECT + ' (' + formattedOrderId + ')',
    body: body
  });

  raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('SENT');
}

function testSendConfirmationForRow(rowNumber) {
  sendOrderConfirmationForRow(rowNumber);
}

function runTestSend() {
  testSendConfirmationForRow(2);
}

function clearSentMarker(rowNum) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  raw.getRange(rowNum, CONFIRMATION_SENT_COL).setValue('');
  Logger.log('Cleared SENT marker for row ' + rowNum);
}

function debugRow(rowNum) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var raw = ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
  var row = raw.getRange(rowNum, 1, 1, raw.getLastColumn()).getValues()[0];
  for (var i = 0; i < row.length; i++) {
    if (row[i]) Logger.log('col ' + i + ': ' + row[i]);
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
