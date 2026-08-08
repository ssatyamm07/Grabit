# Grabit — Developer Setup

Step-by-step for a new developer. Same style as Slade Blade / Saras SETUP.

---

## What you are running

```
┌────────────────┐     ┌─────────────────────┐
│ Expo mobile    │────▶│ Backend API :3001   │
│ Metro :8082    │     └──────────┬──────────┘
└────────────────┘                │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              Postgres:5434    Redis:6379    (MSG91 later)
              + PostGIS
```

| Component | Folder | URL |
|-----------|--------|-----|
| Backend API | `backend/` | http://localhost:3001/api |
| Mobile | `expo-app/` | Expo start → :8082 |
| Health | — | http://localhost:3001/api/health |

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ (24 LTS preferred for Expo 57) |
| npm | 9+ |
| Docker Desktop | recent |
| Expo Go or dev build | for device |

> Note: Node 23 may warn on Expo/RN engine ranges; prefer Node 20 or 22 LTS if Metro misbehaves.

---

## Step 1 — Start infrastructure

```bash
cd /path/to/Grabit
docker compose up -d
docker compose ps
```

**Expected:** `grabit-postgres` healthy on **5434**, `grabit-redis` healthy on **6379**.

Port **5433** is often taken by other local stacks — Grabit uses **5434**.

---

## Step 2 — Backend

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

**Expected:**

```
Grabit API listening on http://localhost:3001
```

Smoke:

```bash
curl http://localhost:3001/api/health
curl 'http://localhost:3001/api/catalog/master/search?q=Amul'
```

Demo accounts (after seed):

| Role | Phone |
|------|-------|
| Vendor (Ravi Kirana) | `9000000001` |
| Vendor (Lakshmi Dairy & Pooja) | `9000000002` |
| Customer (sample lists) | `9111111111` |
| Super admin | `9000000099` |
| Regional admin | `9000000077` |
| Delivery partner | `9000000088` |

OTP flow:

```bash
curl -X POST http://localhost:3001/api/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9999999999"}'
# → { "ok": true, "dev_otp": "......" }

curl -X POST http://localhost:3001/api/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9999999999","otp":"......"}'
```

### Shopping lists + split checkout

Household shopping lists (grocery / pooja / dairy / vegetables / custom). Items must be master-catalog products. Checkout auto-splits across nearby vendors.

```bash
TOKEN=<access_token from verify-otp>

# Create list
curl -X POST http://localhost:3001/api/lists \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: list-create-1' \
  -d '{"name":"Weekly grocery","list_type":"grocery"}'

# Add item (upsert: same master_product_id increases qty)
curl -X POST http://localhost:3001/api/lists/$LIST_ID/items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"master_product_id":1,"qty":2}'

# Add household member by phone
curl -X POST http://localhost:3001/api/lists/$LIST_ID/members \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9222222222","role":"editor"}'

# Preview multi-vendor split (requires geo)
curl -X POST http://localhost:3001/api/lists/$LIST_ID/checkout/preview \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"lat":19.076,"lng":72.8777}'
# → vendor_buckets[], unfulfillable[], pricing, preview_token

# Confirm (Idempotency-Key required; atomic multi-order)
curl -X POST http://localhost:3001/api/lists/$LIST_ID/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: checkout-1' \
  -d '{"preview_token":"..."}'
```

**Tests**

```bash
cd backend
npm run test:unit
npm run test:integration   # needs Docker PostGIS up
npm test
npm run outbox:relay       # drain unpublished outbox events once
```

### Addresses, auth refresh, vendor apply, delivery, admin

```bash
# Profile + refresh
curl -X PATCH http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Satyam"}'
curl -X POST http://localhost:3001/api/auth/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"..."}'

# Addresses
curl -X POST http://localhost:3001/api/addresses \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"Home","lat":19.076,"lng":72.8777,"pincode":"400001","is_default":true}'

# Vendor apply (pending until admin approves)
curl -X POST http://localhost:3001/api/vendors/me/apply \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"business_name":"My Store","lat":19.076,"lng":72.8777}'

# Admin approve
curl -X POST http://localhost:3001/api/admin/vendors/$VENDOR_ID/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Place order with fulfillment_mode=self|partner
curl -X POST http://localhost:3001/api/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: o1' \
  -H 'Content-Type: application/json' \
  -d '{"vendor_id":1,"fulfillment_mode":"partner","items":[{"listing_id":1,"qty":1}]}'

# Vendor marks ready → returns delivery_otp (dev)
curl -X POST http://localhost:3001/api/orders/$ORDER_ID/transition \
  -H "Authorization: Bearer $VENDOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"to_status":"ready"}'

# Delivery partner
curl http://localhost:3001/api/delivery/jobs -H "Authorization: Bearer $DELIVERY_TOKEN"
curl -X POST http://localhost:3001/api/delivery/jobs/$JOB_ID/accept -H "Authorization: Bearer $DELIVERY_TOKEN"
curl -X POST http://localhost:3001/api/delivery/jobs/$JOB_ID/pickup -H "Authorization: Bearer $DELIVERY_TOKEN"
curl -X POST http://localhost:3001/api/delivery/jobs/$JOB_ID/complete \
  -H "Authorization: Bearer $DELIVERY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"delivery_otp":"123456"}'
```

Razorpay payment APIs are intentionally not included yet (COD only).

### Google Maps / geocode

Set `GOOGLE_MAPS_API_KEY` in `backend/.env` for Google Geocoding, Places Autocomplete, and Distance Matrix. Without it, geocode/places fall back to Nominatim.

```bash
# Place search (geocode)
curl 'http://localhost:3001/api/addresses/geocode/search?q=Andheri%20East' \
  -H "Authorization: Bearer $TOKEN"

# Places Autocomplete (Maps SDK companion)
curl 'http://localhost:3001/api/addresses/places/autocomplete?q=Bandra' \
  -H "Authorization: Bearer $TOKEN"

# Reverse geocode pin → address
curl 'http://localhost:3001/api/addresses/geocode/reverse?lat=19.076&lon=72.8777' \
  -H "Authorization: Bearer $TOKEN"

# Delivery quote (distance + fee)
curl 'http://localhost:3001/api/orders/delivery-quote?vendor_id=1&lat=19.076&lng=72.8777' \
  -H "Authorization: Bearer $TOKEN"

# Live tracking / ETA
curl http://localhost:3001/api/orders/$ORDER_ID/tracking -H "Authorization: Bearer $TOKEN"

# Payments (COD now; Razorpay when keys set)
curl -X POST http://localhost:3001/api/payment/create \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"order_id":1,"provider":"cod"}'

# Order aliases
curl -X POST http://localhost:3001/api/orders/$ORDER_ID/accept -H "Authorization: Bearer $VENDOR_TOKEN"
curl http://localhost:3001/api/orders/$ORDER_ID/events -H "Authorization: Bearer $TOKEN"
```

Full route coverage: `backend/tests/integration/api.coverage.test.js` (`npm test`).

### Product images (MinIO local / S3 prod)

Local MinIO is in Docker Compose (API **`:9010`**, console **`:9011`** — avoids clash with other MinIO on 9000).

```bash
docker compose up -d minio
# console: http://localhost:9011  (minioadmin / minioadmin)
```

`backend/.env`:

```
STORAGE_DRIVER=minio
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9010
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_PUBLIC_URL=http://127.0.0.1:9010
MINIO_BUCKET_PRODUCTS=products
```

Production AWS S3:

```
STORAGE_DRIVER=s3
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=grabit-products
S3_PUBLIC_URL=https://grabit-products.s3.ap-south-1.amazonaws.com
```

```bash
# Upload (JSON base64) — or multipart field "images"
curl -X POST http://localhost:3001/api/admin/catalog/master/$PRODUCT_ID/images \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"images":["data:image/jpeg;base64,/9j/..."]}'

# Delete
curl -X DELETE http://localhost:3001/api/admin/catalog/master/$PRODUCT_ID/images \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:9000/products/..."}'
```

---

## Step 3 — Expo app

```bash
cd expo-app
cp .env.example .env   # if present; else ensure EXPO_PUBLIC_API_BASE_URL
npm install
npm start
```

- iOS simulator: press `i`
- Android emulator: press `a`
- Physical device: same LAN IP — set `EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3001/api`

**Brand:** blue primary, yellow CTA, green success — see `src/theme/colors.ts`.

---

## Brand colours

| Token | Hex | Use |
|-------|-----|-----|
| Blue | `#1B6CA8` | Primary / trust |
| Yellow | `#F5C518` | CTAs / energy |
| Green | `#2E8B57` | Success / local freshness |

---

## Common issues

| Symptom | Fix |
|---------|-----|
| `ECONNREFUSED` Postgres | `docker compose up -d` and wait until healthy |
| Port 5433 in use | Already mapped to 5434 — check `.env` `DATABASE_URL` |
| OTP works in curl, app fails | Device can’t reach `localhost` — use LAN IP |
| Migration PostGIS error | Confirm image is `postgis/postgis` and extension created |

---

## What’s next after setup

1. Mobile UI for shopping lists + split checkout preview  
2. Outbox relay worker hardening  
3. Delivery partner shell  

See root [`plan.txt`](../plan.txt) §17 Build Order.
