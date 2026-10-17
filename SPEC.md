# Product & Technical Specification: Garsfontein Grid (`SPEC.md`)

**Target Area:** Ward 45, Garsfontein, Pretoria, South Africa  
**Canonical Domain:** `garsfontein.timothybrits.co.za`  
**License:** GNU General Public License v3.0 (`GPL-3.0-only`)

---

## 1. Executive Summary & Core Objectives

Garsfontein Grid is an open-source civic power tracking application for Ward 45, Garsfontein. It provides real-time electrical grid monitoring, outage logging, rate-limited community confirmations ("My power is off too"), and machine-readable endpoints.

### Key Targets
* **Performance:** Mandatory **100/100 PageSpeed Insights** (Mobile/Desktop), zero Cumulative Layout Shift ($\text{CLS} = 0$).
* **Design:** Mobile-first, single-column view with a warm, tactile South African Earth-toned aesthetic.
* **SEO:** Dynamic OpenGraph social cards, dynamic XML sitemaps, automated `robots.txt`, and structured JSON-LD schema.
* **Theme Engine:** Zero-flash, system-aware light/dark theme toggle persisting preference in `localStorage`.
* **Stack:** SolidJS + Cloudflare Workers + Cloudflare D1 + Drizzle ORM + Vanilla Extract CSS.
* **Quality & CI/CD:** TDD with Vitest (`@cloudflare/vitest-pool-workers`), Storybook UI isolation, Playwright E2E testing, and GitHub Actions automation.

---

## 2. Technical Stack & Tooling

* **Runtime & Hosting:** Cloudflare Workers (API endpoints, dynamic SEO routes, Worker Assets SPA).
* **Database & ORM:** Cloudflare D1 + Drizzle ORM + `drizzle-kit`.
* **Frontend:** SolidJS + Vite + Vanilla Extract CSS (`clsx`).
* **Validation & Security:** TypeScript (strict mode), Zod, Cloudflare Turnstile, Cloudflare Worker Rate Limiting, HTTP-only session cookies.
* **Testing & Quality:** Vitest, Storybook, Playwright, Biome (linting/formatting), Lefthook (pre-commit hooks).

---

## 3. Design System & Theme Tokens

### A. Typography & Palette
* **Display Font:** *Fraunces* or *Playfair Display*
* **Body/Numbers:** *Plus Jakarta Sans* (`font-variant-numeric: tabular-nums`)
* **Light Palette:** Sand (`#F6F4EF`), Cream Card (`#FFFFFF`), Charcoal Text (`#1F2120`), Olive ON (`#2D5A27`), Ochre OFF (`#B33A2B`).
* **Dark Palette:** Basalt (`#121312`), Slate Card (`#1C1E1C`), White Text (`#F0EFEA`), Vibrant Olive ON (`#4CAF50`), Vibrant Terracotta OFF (`#E57373`).

### B. Zero-Flash Theme Bootscript (`index.html`)
```html
<script>
  (function() {
    try {
      var s = localStorage.getItem('theme');
      var d = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.add((s === 'dark' || (!s && d)) ? 'dark' : 'light');
    } catch (e) {}
  })();
</script>
```

---

## 4. SEO & Machine Manifests

* **`GET /sitemap.xml`**: Dynamically served XML covering `/` and `/privacy.html`.
* **`GET /robots.txt`**: Disallows `/api/admin/` and references `sitemap.xml`.
* **JSON-LD Schema**: Included on index page typed as `GovernmentService` for Ward 45 power tracking.

---

## 5. Database Schema (`worker/db/schema.ts`)

```typescript
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const heartbeats = sqliteTable('heartbeats', {
  id: integer('id').primaryKey(),
  lastSeen: text('last_seen').notNull(),
});

export const outages = sqliteTable('outages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  source: text('source', { enum: ['sensor', 'manual'] }).notNull(),
  isFalsePositive: integer('is_false_positive').notNull().default(0),
});

export const outageConfirmations = sqliteTable(
  'outage_confirmations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    outageId: integer('outage_id').notNull().references(() => outages.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    clientHash: text('client_hash').notNull(),
  },
  (table) => ({
    uniqueIpPerOutage: uniqueIndex('unique_ip_per_outage_idx').on(table.outageId, table.clientHash),
  })
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // Hashed session token
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
});
```

---

## 6. API Specification

* `GET /api/status` (Public)
  * **Rate Limit:** 60 req/min/IP.
  * **Logic:** Returns status `ON`/`OFF` based on heartbeat threshold (>180s = OFF) or unclosed outage records.
* `POST /api/confirm` (Public)
  * **Rate Limit:** 5 req/min/IP.
  * **Security:** Verifies Turnstile token and enforces 1 confirmation per IP hash (`SHA-256` + salt) per outage.
* `POST /api/admin/login` & `POST /api/admin/logout` (Admin Auth)
  * Validates password against `ADMIN_PASSWORD_HASH` using `@oslojs/crypto` / Web Crypto.
  * Sets an `HttpOnly; Secure; SameSite=Strict` session cookie (`admin_session`) linked to D1 `sessions`.
* `POST /api/admin/timer` & `/api/admin/outages` (Protected Admin Actions)
  * Requires valid `admin_session` cookie.
  * Controls punch clock actions and manual outage logging/updates.
* `POST /api/heartbeat` (IoT Sensor Ingestion)
  * Updates heartbeat (`id = 1`) and auto-closes open outages upon power restoration.

---

## 7. Project Structure

```text
garsfontein-grid/
├── .github/workflows/ci.yml
├── .storybook/
├── public/
│   ├── fonts/
│   ├── llms.txt
│   ├── privacy.html
│   └── robots.txt
├── src/
│   ├── components/
│   │   ├── StatusBadge.tsx
│   │   ├── PunchClock.tsx
│   │   └── ThemeToggle.tsx
│   ├── styles/
│   ├── App.tsx
│   └── index.tsx
├── worker/
│   ├── db/schema.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── seo.ts
│   │   └── status.ts
│   └── index.ts
├── drizzle.config.ts
├── LICENSE (GPL-3.0)
├── SPEC.md
└── wrangler.toml
```

---

## 8. Testing & CI Pipeline

* **Unit/Integration (Vitest):** Tests route logic, rate limiters, session verification, and D1 queries using `@cloudflare/vitest-pool-workers`.
* **UI Isolation (Storybook):** Component testing across light/dark modes and mobile viewports.
* **E2E (Playwright):** Full browser testing covering theme boot, admin session login, punch clock actions, and community confirmation rate limiting.
* **CI GitHub Actions (`ci.yml`):** Runs Biome linting, typechecking, Storybook build, Vitest suite, and Playwright E2E suite on all PRs.