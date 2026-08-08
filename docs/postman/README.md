# Grabit Postman Collection

Importable Postman Collection v2.1 for **every** Grabit HTTP API route, plus end-to-end flows and negative tests.

## Files

| File | Use |
|------|-----|
| [Grabit.postman_collection.json](./Grabit.postman_collection.json) | Full collection (~196 requests) |
| [Grabit.local.postman_environment.json](./Grabit.local.postman_environment.json) | Local env vars + seed phones |

Regenerate after adding routes:

```bash
cd backend && node scripts/generate-postman.js
```

## Import

1. Open Postman → **Import** → select both JSON files above.
2. Top-right environment dropdown → **Grabit Local**.
3. Start API with OTP visible for local testing:

```bash
cd backend
# in .env: SHOW_OTP_IN_RESPONSE=true  OTP_DRY_RUN=true
npm run migrate && npm run seed && npm run dev
```

4. Confirm health: run **00 Auth and Health → GET Health**.

## Seed phones

| Role | Phone | Env var |
|------|-------|---------|
| Customer | `9111111111` | `customerPhone` |
| Vendor (Ravi) | `9000000001` | `vendorPhone` |
| Vendor 2 | `9000000002` | `vendor2Phone` |
| Delivery | `9000000088` | `deliveryPhone` |
| Super admin | `9000000099` | `adminPhone` |
| Regional admin | `9000000077` | `regionalPhone` |
| Field agent | `9000000066` | `fieldPhone` |

## Auth (do this first)

In **00 Auth and Health**, for each role you need:

1. `POST Auth send-otp (*)` — Test script saves `*Otp` when `dev_otp` is returned.
2. `POST Auth verify-otp (*)` — Test script saves `*Token` (`customerToken`, `vendorToken`, …).

If OTP is not in the response, copy it from server logs / SMS dry-run and set the env OTP var manually, then re-run verify.

Collection default auth uses `{{customerToken}}`. Role folders override Bearer tokens.

## Idempotency-Key

**Required** header on:

- `POST /orders`
- `POST /lists/:id/checkout`
- `POST /services/bookings`

Optional on `POST /payment/create`. Flow requests auto-generate `{{idempotencyKey}}` in Pre-request scripts.

## Folder map

| Folder | Contents |
|--------|----------|
| **00 Auth and Health** | OTP per role, refresh, logout, me, health |
| **01 Public…** | Catalog, geo, search, vendors list/storefront, reviews GET, services, settings |
| **02 Customer** | Addresses/Maps, orders, payments, lists, disputes, reviews, devices, bookings |
| **03 Vendor** | Open/closed, listings, inventory, orders transitions, services |
| **04 Delivery** | Jobs accept → pickup → complete + location |
| **05 Admin Ops** | Catalog admin, approve vendors, analytics, verification, refunds, webhook |
| **06 Flows E2E** | Ordered happy paths (A–E) |
| **07 Negatives** | Expected 4xx — auth, orders, delivery, RBAC, payments, bookings |

## Flows (run after tokens + `vendorId` / `listingId`)

1. **Flow A — COD self delivery**  
   Customer place (`fulfillment_mode=self`) → vendor accept → preparing → ready (captures `deliveryOtp`) → picked → delivered with OTP.

2. **Flow B — Partner rider**  
   Place with `fulfillment_mode=partner` → vendor to ready → delivery accept/pickup/location/complete with door OTP → customer tracking.

3. **Flow C — Service booking**  
   List vendor services → book (Idempotency-Key) → vendor accept.

4. **Flow D — List checkout**  
   Create list → add catalog item → preview → checkout.

5. **Flow E — Razorpay create**  
   Place + `payment/create` with `provider=razorpay`. Needs live keys for 201; otherwise assert 4xx hint. Full Checkout SDK verify is done in the Expo app.

**Tip:** Before Flow A/B, run **01 → GET Vendors open** and **GET Vendor storefront** so `vendorId` and `listingId` are set. Ensure vendor is open (`03 → PATCH Vendor me (open)`).

## Negatives

Open **07 Negatives and Edges**. Each request description states the expected status; the Tests tab asserts it. Useful cases:

- Missing Bearer → 401  
- Wrong OTP / bad refresh  
- Place order without Idempotency-Key → 400  
- Oversell qty → 409  
- Delivery using `/orders/:id/transition` → 403  
- Customer hitting `/delivery/jobs` → 403  
- Booking without Idempotency-Key → 400  
- Webhook / verify with bad signature  

OTP rate limit (429): send-otp many times quickly; do not auto-run in CI.

## Not in this collection

- **Socket.IO** live events (free on the API process). REST equivalent: `GET /orders/:id/tracking`.
- Multipart image upload UX (admin images endpoint accepts JSON body; multipart also supported by API).

## After Postman

Use passing flows as the contract for Expo UX screens (customer checkout with Maps + Razorpay verify, vendor desk, rider desk).
