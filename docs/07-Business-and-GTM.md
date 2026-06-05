# 07 · Business & Go-To-Market

> Why TERANODE can be a product, who buys it, how it's positioned and priced, and how to take it from a pilot to a business. Nepal-first, then beyond.
> Related: [README](./README.md) · [Roadmap](./04-Roadmap-and-Phased-Plan.md) · [BOM](./05-BOM-and-Cost.md)

> Figures here are **planning estimates/assumptions** to be validated with real customer conversations and quotes, not researched market data.

---

## 1. Problem & opportunity
- **Water is wasted and crops are stressed** because irrigation is done by clock, habit, or guesswork — not by what the soil actually needs, and soil varies across a single field.
- **Fertilizer is over/under-applied**, costing money and harming soil/yield, with no feedback loop from real NPK/pH/EC.
- **Labor is scarce/expensive**; farmers can't manually check every patch daily.
- **Climate variability** (erratic rain, heat) makes manual scheduling worse.

TERANODE turns a farm into **zoned, data-driven, automated irrigation + fertigation** controllable from a phone — saving water, fertilizer, and labor while improving consistency and yield. The closest familiar reference (indoor *Intelligent Hydroponic Systems*) proves people want "monitor + automate + app"; TERANODE brings it **outdoors, to soil, at farm scale**.

## 2. Target users & segments
| Segment | Profile | Why they buy |
|---|---|---|
| **Commercial vegetable / horticulture farms** (primary pilot) | 0.5–10+ acre, cash crops, drip-capable | Yield consistency, water/fertilizer savings, labor reduction |
| **Polyhouse / greenhouse growers** | High-value crops, already semi-automated | Precision fertigation + remote control |
| **Orchards / plantations** | Trees in distinct blocks | Zoned scheduling across blocks |
| **Agri-cooperatives / contract farming** | Manage many smallholders | Central oversight via the **master dashboard** |
| **Agri-institutions / research / demo farms** | Universities, NGOs, govt schemes | Data, repeatability, showcase |

**Jobs-to-be-done:** "Keep each part of my farm correctly watered and fed without me walking the field," "Show me what's happening and warn me when something's wrong," "Cut my water/fertilizer/labor bill."

## 3. Positioning
> **TERANODE = zoned soil intelligence + automated fertigation + a multi-tenant SaaS** — for outdoor farms, not just indoor hydroponics.

| vs. | They are | TERANODE difference |
|---|---|---|
| Indoor hydroponic/"HyperPod"-style kits | Controlled indoor, water-based, single unit | Outdoor **soil**, **multi-zone**, farm-scale |
| Basic timer/controller irrigation | Schedule-only, no sensing | **Sensor-driven** + rain-skip + fertigation + remote app |
| High-end precision-ag platforms | Powerful but expensive/complex, foreign support | **Affordable, locally supported**, manual onboarding, simple app |
| DIY Arduino projects | One-off, no product/SaaS/support | **Productized**, multi-tenant, OTA, alerts, support |

**Differentiators:** per-zone soil data (most cheap systems ignore that fields vary), integrated **fertigation**, **edge-first** reliability (keeps watering offline), and a company **master dashboard** for fleet management + support.

## 4. Competitive landscape (categories to scan)
- Imported smart-irrigation controllers and precision-ag platforms (capable, costly, weak local support/onboarding).
- Local irrigation/drip suppliers (hardware, little software/automation).
- DIY/maker IoT irrigation (no product, no support, no SaaS).
- Indoor hydroponic kit makers (different environment; validates demand for the app/automation experience).
> Action: build a concrete competitor table during Phase 1 with real local quotes, feature checklists, and support terms.

## 5. Business model & pricing (hypotheses to validate)
**Hybrid: hardware + SaaS subscription.**
- **Hardware kit** (one-time): gateway + zone kits + actuators, installed. Cost basis in `05` (~$715 for a 3-zone mains farm); price with margin + install (validate willingness-to-pay locally).
- **SaaS subscription** (recurring): tiered by farm/zone count and features.

| Tier | For | Includes (illustrative) |
|---|---|---|
| **Basic** | Small farm | Up to N zones, live + history, manual control, basic alerts |
| **Pro** | Commercial farm | More zones, fertigation automation, schedules, push alerts, reports |
| **Enterprise / Co-op** | Many farms | Master/sub-account management, API, priority support, OTA fleet mgmt |

Other levers: install/commissioning fee, annual maintenance/calibration plan, spares, financing/lease-to-own for smallholders, co-op/group pricing.
> Manual onboarding (MVP) means sales + provisioning are high-touch — fine at pilot scale; automate (payments + self-serve) in Phase 3 (`04`).

## 6. Go-to-market
- **Phase 1 — pilot (1 lighthouse farm):** instrument a willing commercial farm at low/zero cost; capture **before/after** water, fertilizer, labor, and yield data; document a case study.
- **Phase 2 — early adopters (3–10 farms):** sell to similar farms via the pilot's proof; refine pricing, install playbook, and support; build the competitor/feature table.
- **Phase 3 — scale:** automate onboarding/payments, partner with **drip-irrigation dealers, agri-input retailers, co-ops, and government/NGO subsidy programs**; consider regional expansion.
- **Channels:** direct (commercial farms), partnerships (irrigation suppliers, co-ops), demo/research farms as showcases, agri expos, word-of-mouth in farming communities.

## 7. Nepal-first considerations
- **Subsidy/scheme alignment:** agriculture modernization and drip-irrigation subsidies can offset hardware cost — package TERANODE to qualify.
- **Connectivity:** WiFi rare on farms; **4G/LTE** is widely available — make the cellular path smooth; LoRa handles intra-farm.
- **Power:** grid is intermittent rurally — the **solar + edge-first offline** design is a strong local selling point.
- **Payments (later):** integrate **eSewa/Khalti** alongside cards for local self-serve.
- **Support & language:** local-language UI option + on-the-ground install/support is a real moat vs. imported platforms.
- **Affordability:** keep the entry kit cheap (start mains + few zones + 7-in-1 probe consolidation per `05`); expand zones later.

## 8. KPIs & metrics
**Product/impact (the pitch):** % water saved, % fertilizer saved, labor hours saved, yield/quality change, system uptime, % time in auto vs manual.
**Business:** farms onboarded, zones under management, hardware + MRR revenue, CAC vs LTV, churn, install time per farm, support tickets/farm, gross margin (hardware vs SaaS).
**Reliability (trust):** mean time between field failures, alert→resolution time, offline-survival incidents handled correctly.

## 9. Key risks & assumptions (business)
| Risk | Mitigation |
|---|---|
| Farmers won't pay recurring SaaS | Bundle value into clear savings; offer annual plans; co-op pricing; prove ROI in the pilot |
| Hardware cost too high for smallholders | Tiered kits, financing/subsidy alignment, sensor consolidation (`05`) |
| Long sales/education cycle | Lighthouse case study + demo farm + dealer partnerships |
| Support burden across remote farms | Remote diagnostics + OTA + spares kits (`06`); regional partners |
| Trust after a bad watering event | Edge-first safety/fail-closed + alerts; conservative defaults; transparent state |

## 10. Next steps (business track)
1. Identify and sign a **lighthouse pilot farm**.
2. Define the **savings baseline** to measure against (current water/fertilizer/labor).
3. Build the **competitor + pricing** table with real local quotes.
4. Draft the **kit + subscription** price sheet and a one-page value/ROI pitch.
5. Line up **channel/subsidy** conversations (irrigation dealers, co-ops, ag programs) for Phase 2.
