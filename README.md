# Grabit

India’s local commerce OS — asset-light marketplace connecting customers, neighbourhood vendors, and delivery partners.

**Brand palette:** blue `#1B6CA8` · yellow `#F5C518` · green `#2E8B57`

Architecture source of truth: [`plan.txt`](./plan.txt)

---

## Stack (Slade Blade–style)

| Piece | Folder | Default |
|-------|--------|---------|
| API | `backend/` | http://localhost:3001/api |
| Mobile | `expo-app/` | Expo Metro :8082 |
| Postgres + PostGIS | Docker | localhost:5434 |
| Redis | Docker | localhost:6379 |

---

## Quick start

```bash
# 1) Infra
docker compose up -d

# 2) API
cd backend && npm install && cp .env.example .env
npm run migrate && npm run seed
npm run dev

# 3) App (new terminal)
cd expo-app && npm install
npm start
```

OTP in development is returned in the API response (`SHOW_OTP_IN_RESPONSE=true`).

Full steps: [`docs/SETUP.md`](./docs/SETUP.md)

---

## What’s working

- Domains: `auth`, `catalog`, `geo`, `vendors`, `orders`, `ledger`, `inventory`
- Core loop: vendor listings → place order (`Idempotency-Key`) → reserve/commit/release stock → state machine + `order_events` → ledger (paise) → outbox
- Seed: **Ravi Kirana** vendor phone `9000000001` with stocked listings
- Expo: customer shop/cart/COD order · vendor accept/reject + add listing

---

## Next build slice

Notifications + auto-expire unaccepted orders · delivery partner OTP complete · online payments webhook.
