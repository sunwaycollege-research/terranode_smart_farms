# Mobile Farmer App

The farmer‑facing app — an **Expo + React Native** (expo‑router) app built for smallholder farmers:
dead‑simple, icon + colour coded, bilingual (English / Nepali), with a large‑touch "field mode".

Source: `apps/mobile/`. API client: `apps/mobile/src/api/client.ts`.

## 1. Structure

```
apps/mobile/
├── app/                       expo-router (file-based routes)
│   ├── _layout.tsx            root: fonts, providers (Auth, i18n, FieldMode)
│   ├── index.tsx              splash → redirect by role (customer → dashboard)
│   ├── (auth)/login.tsx       sign-in (+ dev demo login)
│   └── (customer)/            authenticated tabs + pushed screens
│       ├── _layout.tsx        bottom tab bar (lucide-style Ionicons)
│       ├── dashboard.tsx      live field overview (per-account cached)
│       ├── zones/[zoneId].tsx zone detail: gauges, nutrients, fertilizer, valve, coach
│       ├── zones/new.tsx      create/assign-zone wizard (crop picker + node)
│       ├── devices/add.tsx    device onboarding (WiFi / SoftAP)
│       ├── analytics.tsx · alerts.tsx · history.tsx · account.tsx
├── src/api/                   client.ts (live) + mock.ts (offline)
├── src/auth/                  AuthContext (secure-store session, refresh, logout)
├── src/components/            FieldTiles, GaugeRing, HealthRing, BarMeter, Charts,
│                              CropPicker, NutrientCard, FertilizerCard, WaterStatus, ui.tsx
├── src/i18n/                  en.ts / ne.ts + useT()
├── src/theme/                 tokens (parchment/soil palette), scale (field mode)
└── src/entitlements/          deviceCatalog + entitlement gates
```

## 2. Screens

```{list-table}
:header-rows: 1
:widths: 20 80

* - Screen
  - What the farmer sees
* - **Dashboard (Field)**
  - The home: gateway status + serial, systems strip (pump/dosing), **water/leak** card (live flow), **savings** tile, and a tile per zone (crop, health, moisture, valve). Polls + caches per‑account; clear loading / offline / "no farm yet" states.
* - **Zone detail**
  - Gauges + per‑channel status pills; a **Nutrients** card (N/P/K/pH/EC with LOW/OK/HIGH + the "approximate" caveat); a **stage‑aware Fertilizer plan** card (dose + organic option); a **coach** card (top recommendation); **valve control** (desired‑vs‑reported) + auto/manual mode. A crop‑less zone shows a "pick a crop" prompt instead of an error.
* - **Add / assign zone**
  - A wizard: pick a crop from the admin library → planting date → confirm the ESP32 node + sensor channels. **Create mode** makes a new zone (capped by the `zoneNodes` entitlement); **assign mode** sets a crop on an existing zone.
* - **Device onboarding**
  - Stepped flow: power on → join the device's SoftAP + enter WiFi → poll until the device links.
* - **Analytics / Alerts / History / Account**
  - Usage & savings, alerts + acknowledge, telemetry history charts, and profile + language/field‑mode toggles + sign‑out.
```

## 3. Live data + the API client

`src/api/client.ts` mirrors the REST surface (`@teranode/types`) with a mock seam (`useMockApi`
in `app.json`) for offline demos. Notable behaviors:

- **Auto host detection** — a `localhost` `apiBaseUrl` is rewritten at runtime to the Expo/Metro
  host IP, so the app reaches the dev machine from a real phone without hardcoding a LAN IP.
- **Secure sessions** — tokens in expo‑secure‑store; silent refresh on 401; an unrecoverable 401
  clears the session (and any stale mock session) and routes to login.
- **Per‑account caching** — the dashboard caches the overview under an account‑scoped key so one
  farmer can never see another's cached field.
- New endpoints it uses: `api.gateway(farmId)`, `api.readings(farmId)`, `api.createZone(...)`,
  `api.setValve(zoneId, open)`.

## 4. Farmer‑first UX

```{list-table}
:header-rows: 1
:widths: 30 70

* - Principle
  - Implementation
* - Bilingual
  - Every string in `en.ts` + `ne.ts` (typed `TranslationKey`); `useT()`/`tx=`.
* - Icon + colour status
  - Green = good · amber = watch · red = act, with icons (not colour alone).
* - Field mode
  - `useScale()` scales fonts/spacing/line‑height + enforces ≥44px touch targets for sunlight + imprecise taps.
* - Plain language
  - One short sentence of guidance per card (no agronomy jargon); guidance text sourced from the agronomy engine.
* - Entitlement gating
  - Tiles/features hidden unless the account's entitlement is on (defence‑in‑depth with the server).
```

## 5. Reusing the agronomy package

Like the web, the mobile app imports `@teranode/agronomy` directly — e.g. the Fertilizer card calls
`fertilizerPlan(cropId, stage)` so on‑device guidance matches the cloud. See {doc}`packages`.

## 6. Run

```bash
npm run -w @teranode/mobile start    # Expo
# On a device: set app.json → extra.apiBaseUrl to your machine's LAN IP (or rely on auto-detect).
```
