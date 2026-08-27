# Add a Live / Maximum Order Limit System to Artisan Oven

## Project context

I have an existing website hosted using GitHub Pages.

Repository:

`louisbenne/ArtisanOven`

The website is a simple static HTML/CSS/JavaScript site with no build step.

Current important files include:

```text
index.html
Payment.html
order.html
style.css
script.js
server.js
```

The website currently has a Google Form embedded for customers to place pizza orders.

The Google Form submits responses into a Google Spreadsheet. I also already have a Google Apps Script connected to the spreadsheet which processes orders and sends emails.

## Goal

I want to add a temporary live order capacity feature.

Because we are starting slowly, I want to limit the maximum number of orders that can be accepted during a specific ordering period.

For example:

```text
Maximum orders: 20
Current orders: 7
Orders remaining: 13
```

This information should appear live on the Artisan Oven website.

When the maximum number of orders has been reached, customers should clearly see that ordering is closed and should not be able to access or submit a new order.

## Important architecture requirements

GitHub Pages is a static website, so do NOT attempt to store the order count inside JavaScript, localStorage, or a static JSON file in the GitHub repository.

The Google Spreadsheet should be the source of truth.

Use the existing Google Apps Script connected to the order spreadsheet to create a small API endpoint.

The architecture should be:

```text
Google Form
      ↓
Google Spreadsheet
      ↓
Google Apps Script
      ↓
JSON API endpoint
      ↓
GitHub Pages website
```

## Google Sheet setup

Create or use a configuration area/sheet containing at least:

```text
MAX_ORDERS
ORDERING_ENABLED
```

For example:

```text
MAX_ORDERS = 20
ORDERING_ENABLED = TRUE
```

The Apps Script should count the number of valid order responses in the Google Form response sheet.

It should then calculate:

```text
currentOrders
maxOrders
remainingOrders
orderingOpen
```

Example JSON response:

```json
{
  "currentOrders": 7,
  "maxOrders": 20,
  "remainingOrders": 13,
  "orderingOpen": true,
  "message": "13 orders remaining"
}
```

## Apps Script API

Add a `doGet()` function to the existing Apps Script.

The function should:

1. Read the maximum order limit from the configuration.
2. Count the current valid orders.
3. Calculate the remaining capacity.
4. Check whether ordering has been manually disabled.
5. Return JSON using `ContentService`.
6. Never expose private customer information, emails, names, spreadsheet data, or order details.

The API should only expose the order capacity information.

The endpoint should return something similar to:

```json
{
  "currentOrders": 7,
  "maxOrders": 20,
  "remainingOrders": 13,
  "orderingOpen": true
}
```

If the maximum has been reached:

```json
{
  "currentOrders": 20,
  "maxOrders": 20,
  "remainingOrders": 0,
  "orderingOpen": false
}
```

Make the Apps Script easy to configure and clearly comment the section where I can change the maximum order amount.

## Website changes

Update the website so the homepage and/or order page displays a live order status component on the idex html aswell as the ordeing page.

Suggested design:

```text
TONIGHT'S AVAILABILITY

████████░░░░░░░░░░

7 of 20 orders taken

13 orders remaining
```

The design should match the existing Artisan Oven branding and styling.

Do not redesign the entire website.

Add the minimum amount of new HTML and CSS necessary.

## Live updating

Use JavaScript `fetch()` to request the Google Apps Script API.

The website should:

1. Load the current order status when the page opens.
2. Display a loading state while checking availability.
3. Display the number of orders remaining.
4. Update the progress bar.
5. Refresh the data automatically every 30–60 seconds while the page is open.
6. Gracefully handle API errors.

Example logic:

```text
IF orderingOpen is true
AND remainingOrders > 0
    Show "Order Now"
    Enable ordering button
ELSE
    Show "Fully Booked"
    Disable ordering button
END
```

## When sold out

When the maximum number of orders has been reached:

* Disable the main "Order" button.
* Do not allow navigation to the Google Form through the normal website buttons.
* Replace the button text with:

```text
FULLY BOOKED
```

* Display a friendly message such as:

```text
We're fully booked for this session.

Please check back next time.
```

The `order.html` page itself must also check the API.

This is important because a user could manually type the URL to `order.html`.

If ordering is closed, the Google Form iframe should not be shown.

Instead show the fully booked message.

## Manual override

I want an easy manual override.

In the Google Sheet or Apps Script configuration I should be able to manually set:

```text
ORDERING_ENABLED = FALSE
```

This should immediately close ordering even if the maximum number of orders has not been reached.

The website should then display:

```text
Ordering is currently closed.
```

## Race condition / overselling protection

Think carefully about the fact that multiple people could open the website at the same time.

The live counter on the website is primarily for displaying availability.

However, the system should try to avoid exceeding the maximum order amount.

Please explain the limitations of using Google Forms for strict order limits.

If possible, add protection in the Apps Script order processing workflow so that once the maximum number of accepted orders has been reached, additional responses are marked as:

```text
WAITLIST
```

or:

```text
OVER CAPACITY
```

rather than being treated as confirmed orders.

Do not delete customer responses.

This provides a safety net if multiple customers submit an order simultaneously.

## Resetting for a new session

Make the system easy to reset.

I should be able to start a new ordering session by changing configuration values rather than modifying website code.

For example:

```text
MAX_ORDERS = 20
ORDERING_ENABLED = TRUE
```

Potentially include a session/date identifier if useful.

The order count should be easy to reset for a new pizza night without deleting previous orders.

## Code quality

Please:

* Inspect the existing repository before making changes.
* Preserve the current website functionality.
* Reuse the existing styling and structure.
* Keep the solution simple.
* Do not introduce React, a database, Node hosting, or another paid hosting platform.
* The website must continue working on GitHub Pages.
* Do not expose any API keys or private spreadsheet information.
* Add clear comments explaining where I need to paste the deployed Google Apps Script Web App URL.

At the end, provide:

1. The modified website files.
2. The complete Google Apps Script code additions.
3. Instructions for deploying the Apps Script as a Web App.
4. Instructions for adding the Web App URL to the GitHub Pages website.
5. A short testing checklist.

The final system should work entirely with:

```text
GitHub Pages
+
Google Forms
+
Google Sheets
+
Google Apps Script
```
