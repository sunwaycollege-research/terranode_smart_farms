# TERANODE — Mobile App (React Native · Expo SDK 55 · Dev Client)

The customer/retailer/company app for Project TERANODE. Themed from
`apps/simulator/teranode-twin-themed.html` (parchment + soil-ink, light mode).
Runs **fully offline against a mock backend** (a tiny in-app "virtual gateway"),
so you can build the whole UI before the Express server exists.

## Stack
- **Expo SDK 55** (React Native 0.83, React 19), **Expo Router v6** (file-based, typed routes)
- **expo-dev-client** (custom dev build, as requested — not Expo Go)
- TypeScript, `react-native-svg` (gauges/charts), `expo-secure-store` (token), `expo-font` (Google Fonts)

## Run it
```bash
cd teranode-app
npx expo install --fix      # pins every package to the exact SDK-55-compatible version
npx expo-doctor             # sanity check
npx expo prebuild           # generates native ios/android (dev client needs native code)
npx expo run:ios            # or: npx expo run:android
# then for daily dev:
npm start                   # = expo start --dev-client
```
> If you only want a quick look without a native build, `npm run web` runs it in the browser,
> or temporarily install Expo Go and run `npx expo start` (Secure Store falls back to memory on web).

## Demo logins (mock)
The login screen has one-tap buttons:
- 🏢 **Company admin** — create/▸manage retailers, fleet health (`admin@teranode.io`)
- 🏪 **Retailer** — create farmer accounts + pick device modules (`sales@himalayan.np`)
- 🌱 **Farmer** — live field dashboard, zone control, alerts (`farmer@greenvalley.np`)

## Where things live
```
app/                      # Expo Router routes (role-gated groups)
  (auth)/login            # sign in + demo accounts
  (farmer)/               # tabs: Field · History · Alerts · Account
    dashboard             #   entitlement-gated modules (weather/pump/dosing/reservoir)
    zones/[zoneId]        #   gauge + NPK/pH/EC bars + auto/manual valve (desired-vs-reported)
  (retailer)/             # tabs: Customers · New · Account
    new-customer          #   ★ modular device toggles, LOCKED at creation
  (company)/              # tabs: Retailers · New · Fleet · Account
src/
  theme/                  # design tokens ported from the twin (oklch → hex)
  entitlements/           # device catalog (dynamic) + create-time-lock rules
  api/                    # client.ts (mock|real switch) + mock.ts (virtual gateway)
  auth/                   # AuthContext, role → route-group mapping
  components/             # ui, GaugeRing, BarMeter, FieldTiles
```

## Switching to the real backend
In `app.json → expo.extra`, set `"useMockApi": false` and `"apiBaseUrl"` to your
Express server. `src/api/client.ts` already maps every call to the REST routes in
[`docs/DEVELOPMENT-PLAN.md`](../../docs/DEVELOPMENT-PLAN.md) §5. No screen changes needed.
