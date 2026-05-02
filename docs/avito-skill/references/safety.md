# Safety

Use this file before any paid, write, destructive, or reputation-affecting operation.

## Default Posture

- Read before write.
- Prefer preview/report mode by default.
- Treat `401`, `403`, `429`, validation errors, and SDK mapping errors as business-blocking diagnostics.
- Do not scrape Avito public pages if official SDK/API data is enough.
- Do not print tokens, client secrets, refresh tokens, authorization headers, cookies, or complete raw credential-bearing error payloads.

## Confirmation Gates

Require explicit user confirmation before:

- spending money;
- changing listing price;
- applying, stopping, deleting, or modifying paid promotion;
- sending messages or images;
- deleting messages;
- marking chats read;
- blacklisting users;
- updating stock;
- changing order status;
- creating, changing, downloading operational labels when it affects fulfillment;
- answering reviews;
- deleting review answers;
- creating, updating, deleting, prolonging, or auto-renewing vacancies;
- updating realty prices, booking info, availability, or base params;
- linking items to employees or changing account hierarchy state.

## Promotion Execution Checklist

Before applying paid promotion, show:

- item IDs;
- service, package, campaign, bid, or strategy type;
- expected cost, budget, commission, bid, or price;
- forecast, suggests, bid data, or current-order status where available;
- business reason;
- risks and assumptions;
- reversal, stop, delete, or rollback option if available.

Then wait for explicit confirmation.

## Error Handling

- For `401` or auth failures: report that credentials or token scope need attention without revealing secrets.
- For `403`: report likely permission, tariff, account, or employee-scope constraints.
- For `429`: report rate limiting and recommend retry timing or narrower scope.
- For validation errors: show the user-facing field or payload issue, not secret-bearing internals.
- For SDK mapping errors: state that the SDK response did not match the expected model and preserve the operation as read-only.
