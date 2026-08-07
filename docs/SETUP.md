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
