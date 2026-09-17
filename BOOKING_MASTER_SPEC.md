# Fair Flow Booking — Master Spec

Approved product direction for Fair Flow Booking.

Canonical integration branch: `feature/booking`  
Checkpoint this spec was written against: `f587bd8a27c250173b2e31ed4ce281c853ba26fa`

Preserve everything already implemented unless a task explicitly requires changing it. The existing codebase is the source of truth for architecture, field names, and current behavior.

---

## Product goal

Fair Flow Booking is an intelligent scheduling system for high-volume salons, not just a calendar.

It must help a busy front desk book, move, and recover time quickly — and later recommend better slots, fill waitlist demand, and recover lost provider hours.

---

## Core design

- Clean, fast scheduling UX inspired by the best parts of systems such as Mangomint, Mindbody, Booksy, Fresha, Boulevard, and Vagaro.
- Do **not** copy another product's UI.
- Keep Fair Flow visually consistent with the current Booking interface.
- Optimize for high-volume front-desk operation and minimal clicks.

Staff Booking lives inside the existing Fair Flow SPA (`public/index.html`) as a second product area (Operations ↔ Booking). It is not a separate app.

---

## Current architecture (source of truth)

Booking is client-side JavaScript talking to Firestore. There are **no Booking Cloud Functions**.

**Entitlement:** `window.ffCanAccessBooking()` in `public/booking/access.js`. Staging/localhost only. Production stays off until a Booking package exists.

**Main entry:** `public/index.html` script tags → `public/booking/shell.js` → `ffGoToBooking` / `ffSetBookingSection`.

**Sidebar sections:** Calendar · Sales · Clients · Reports · Services · Settings.

**Services** is not a Booking-owned catalog. The Booking Services section opens the existing Operations Services screen (`goToServices()` / `#servicesScreen`).

**Reuse, do not duplicate:** Fair Flow staff, locations, location schedules, special business days, staff default schedules, approved Inbox schedule exceptions, tickets service catalog (`tickets-catalog-data.js`), Live Floor FAB offset.

**Firestore (salon-member only, not public):**

| Path | Owner module |
|------|-------------|
| `salons/{salonId}/appointments/{id}` | `public/booking/appointments/` |
| `salons/{salonId}/clients/{id}` | `public/booking/clients/` |
| `salons/{salonId}/sales/{id}` | `public/booking/sales/` |
| `salons/{salonId}/counters/sales` | sales numbering |
| `salons/{salonId}/settings/main.booking` | overlap policy |
| `salons/{salonId}/calendarBlocks/{id}` | one-off Time Blocks |
| `salons/{salonId}/calendarBlockSeries/{id}` | recurring Time Block definition |
| `salons/{salonId}/calendarBlockExceptions/{id}` | per-date skip/override |

**Appointment `serviceLines[]` fields in use:** `lineId`, `serviceId`, `serviceNameSnapshot`, `providerId`, `providerNameSnapshot`, `startAt`, `endAt`, `durationMinutes`, `priceSnapshot`, `guestKey`, `guestName`, `requested`. Combo component lines also snapshot `comboInstanceId`, `comboServiceId`, `comboNameSnapshot`, `comboSellingPriceSnapshot`, `comboComponentIndex`, `comboComponentCount`. Add-on foundation: `lineKind`, `addonTargetLineId`, `addonOfComboInstanceId`.

Prefer new isolated modules under `public/booking/<area>/`. Do not put substantial Booking business logic in `index.html`.

---

## Calendar

### Direction

- Day view
- Week view
- 15-minute grid
- Provider columns
- Provider **full name** and photo
- Persistent location awareness
- Open hours white
- Closed hours grey
- Provider-off periods visually distinct
- Current-time indicator
- Drag/drop
- Multi-service visit remains visually understandable as **one appointment**
- Requested-provider indicator
- Blocked time
- Filters
- Print day

### Currently implemented

Day view, 15-minute snap, provider columns with **first name** + photo, global active-location (no calendar-local picker), open/closed overlays, provider-off bands, now-line, drag/drop (including stacked multi-service: name = whole visit, segment = one line), requested-provider heart, stacked multi-service cards.

**Time Blocks.** One-off `calendarBlocks` stay backward compatible. Recurring definitions persist as `calendarBlockSeries` plus per-date `calendarBlockExceptions` (skip or override). Visible Calendar days generate occurrences in memory; Fair Flow does not write one document per future day. Flexibility `fixed` is hard unavailable time. Flexibility `flexible` may relocate an occurrence inside its allowed window, keeping the required duration, so an appointment can use the preferred slot when another valid placement exists. Moving or deleting **this occurrence** does not rewrite the series.

### Not implemented

Calendar-local location selector and resources (rooms/chairs).

---

## Appointments

### Direction

- Create / edit / cancel / reschedule
- Multi-service
- Multi-provider
- Requested provider
- Any available provider
- Notes
- Statuses including no-show
- Processing time
- Buffer / finishing time
- Configurable overlap
- Group / party support
- Recurring appointments later

### Currently implemented

Create, in-place edit, soft cancel, drag or edit to move time/provider/date (no dedicated reschedule API), independent `serviceLines`, per-line providers, per-line `requested`, appointment notes, overlap setting `booking.allowedOverlapMinutes` ∈ `{0, 15, 20, 30}`.

Statuses: `scheduled`, `confirmed`, `checked_in`, `in_service`, `completed`, `cancelled`, `no_show`. Visit-flow UI exists except **no-show has no UI action**. `completed` and `no_show` still occupy calendar time (`ACTIVE_STATUSES`).

Create currently hardcodes `source: "front_desk"` and `assignmentType: "specific_provider"`. Enums already include `online` and `any_provider`.

Party support exists as extra people via `guestKey` / `guestName`, not a separate group-appointment type.

### Not implemented

Dedicated reschedule UX, any-available-provider assignment UX, processing / buffer / finishing time, recurring / series, a distinct group-appointment product.

Combo Services can be created in the Services catalog. Phase 2 expands a selected Combo into per-component `serviceLines` inside one appointment, with per-component providers and times. Historical appointments without Combo metadata still load as before.

---

## Services

Booking consumes the Operations catalog. Duration and staff capability come from `durationMinutes` and `staffOverrides` (opt-out: capable unless `enabled === false`). Pricing snapshots onto lines.

The catalog now supports two service types:

- **Single** — one sellable, schedulable service. This is the current service. Existing documents without `serviceType` continue to work as Single. No migration is required.
- **Combo** — one sellable catalog item with one combo name and one combo selling price (`name` + `defaultPrice`), composed of two or more existing Single Services.

A Combo is sold to the client / front desk as **one item**. Internally it stores component `serviceId`s and per-component `allocatedPrice` so later Booking, checkout, commission, and reporting can attribute each component correctly. Allocated price is not required to match the standalone price of the underlying Single.

### Catalog fields

| Field | Meaning |
|------|---------|
| `serviceType` | `"single"` \| `"combo"`. Omitted on existing docs ⇒ Single. |
| `components[]` | Combo only. `{ serviceId, allocatedPrice, sortOrder }`. |
| `durationMinutes` | Single: editable duration. Combo: derived as the sum of component durations. |

Validation (Phase 1):

- minimum 2 components
- components must be existing Single Services (no nested combos)
- no duplicate component `serviceId`
- combo cannot reference itself
- allocated prices must sum (in cents) to the combo selling price

`sortOrder` on components is the default sequential order for later scheduling. Parallel vs sequential timing, per-component provider assignment, and add-ons attached to a component are **not** written in Phase 1; the component identity is enough for those later fields.

### Atomicity rule

- A **visit** may contain multiple components / services assigned to **different providers**.
- A Combo may split **between its component services**.
- A **single component / service itself cannot be split** between multiple providers. The provider who starts one component must finish that component.

Phase 2 expands a Combo into component `serviceLines` on create/edit. Reports and checkout still use each line's `priceSnapshot` (the allocated Combo price). Smart Scheduling is not rewritten; component lines are structured so a later phase can score sequential vs parallel placement.

Processing, buffer, and finishing times are **not** in the catalog or appointment model yet. Add them only with an explicit task that owns the shared catalog / appointment schema.

---

## Availability and conflicts

Canonical schedule engine: `public/booking/availability.js`.

It answers: can this provider work at this location on this date/time? **Schedule only** — not appointment conflicts, Queue, or Tickets.

Sources: location `businessHours` / `specialBusinessDays` / `dayShiftSegments`, staff `defaultSchedule` / location schedule, approved Inbox exceptions (`vacation`, `day_off`/`time_off`, `late_start`, `early_leave`, `schedule_change`).

Appointment conflicts are separate: `appointments/data.js` `checkProviderConflict` using the overlap setting.

Empty-slot click currently checks schedule availability only. Conflicts are enforced on create/update.

---

## Smart scheduling

Fair Flow should not only determine whether a time is **available**. It should evaluate how **good** a slot is.

Consider:

- Gap before
- Gap after
- Whether those gaps can fit another service
- Provider utilization
- Requested-provider preference
- Provider schedule
- Multi-provider impact
- Shift boundaries
- Buffers
- Processing time
- Business rules

Possible slot quality:

- **BEST FIT**
- **GOOD FIT**
- **AVAILABLE**
- **LOW FIT**

Valid appointments should not necessarily be hidden just because they create a gap. Fair Flow should rank / recommend better times.

**Status:** not implemented. Do not pretend ranking exists in the current create/edit flow.

---

## Fair Flow Scheduling Agent

A future agent should continuously detect:

- Gaps
- Cancellations
- Waitlist opportunities
- Underutilized staff
- Appointments that could move slightly earlier or later
- Better provider / time combinations

Example:

```
12:00–1:00 Client A
1:00–1:30 gap
1:30–2:30 Client B
```

Fair Flow can identify that Client B could move to 1:00 and offer:  
“30-minute gap detected. Ask Client B to come at 1:00?”

Future automation modes:

- Suggest
- Ask client and execute after acceptance
- Auto within manager-defined rules

**Never silently move an appointment without the required permission.**

This agent is future work. It is not present in the current codebase.

---

## Waitlist

Future waitlist should support:

- Service
- Preferred provider
- Any provider
- Date / time window
- Flexible timing
- Ranking based on calendar fit
- Automatic outreach when availability appears

**Status:** no Booking waitlist module. Operations Live Floor / `queueState` is a separate walk-in queue and is not wired to Booking. Do not casually merge the two without an explicit task.

---

## Clients

Salon-level clients already exist: search (name / email / phone including `phoneKeys` / `phoneKeyPrefixes`), create, profile, bounded appointment and sales history, notes, `allowSms` / `allowEmail`, photo.

Memberships and Payments tabs are empty stubs. Do not invent memberships, wallets, or cards until those products exist.

---

## Client messaging

Future system should support:

- Confirmations
- Reminders
- Waitlist offers
- Earlier / later time offers
- Cancellation openings
- Appointment change requests
- Rebooking
- Review requests

Respect `allowSms` / `allowEmail` and future communication policies.

**Status:** prefs are stored; there is no client SMS/email sender. Staff Inbox is operations (schedule requests, supplies, etc.), not client outreach. “Confirm Appointment” is a calendar status change, not a message.

---

## Sales / checkout

Staff can check out from an appointment or as a walk-in sale. Tax is currently 0; `method` / `processor` default to `"none"`. Product retail checkout is not real yet. Do not build POS/card processing unless the task owns it.

**Required later — Combo checkout grouping:** a Combo is ONE sold product with ONE selling price. Component `serviceLines` exist for scheduling, provider attribution, commissions, and reporting. Checkout must not treat those components as independent full-price products. Phase 2 writes allocated `priceSnapshot` values that reconcile to the Combo selling price. Grouping those lines into **one customer-facing checkout item** at that Combo selling price is required future behavior, not optional.

---

## Reports

Reports should be **actionable**, not only descriptive. Number → explanation → operational context → action, when the data can support it.

Visible navigation today:

- Intelligence → Booking Intelligence · Forward Outlook
- Sales → Sales Summary · Sales Comparison · Service Sales · Sales by Time Period
- Clients → Cancellations · Client Retention · Client Spend

### Built

**Booking Intelligence** (default landing). Appointment-based owner view from live booking data:

- owner overview
- provider capacity
- working / booked / idle / calendar gap / open-edge idle time
- utilization (working minutes are client-bookable: scheduled windows minus Time Blocks)
- capacity patterns (day / weekday / hour)
- service demand and booked service value (`priceSnapshot`, not checkout sales)
- client behavior (in-period first-visit vs returning, repeat-in-period, requested provider)
- deterministic insights

Appointment `source` is still computed internally, but Booking Source is **not** shown to owners while create writes `front_desk`. No-show is counted when marked, but is not a headline KPI because that workflow is incomplete.

**Forward Outlook.** Future booked capacity from now through a selected future range (Next 7 / 14 / 30 days, or custom). Uses the range-complete appointment loader. Cancelled appointments do not occupy future capacity. Current-day working and booked intervals clip at location-local now. Time Blocks (one-off, recurring, moved, skipped) are removed from remaining working capacity and are not booked appointment time. Booked-ahead utilization is booked ahead minutes ÷ future bookable working minutes. Upcoming gaps are unused bookable time between future booked appointments; leading/trailing open time is not a gap. Booked service value ahead is `priceSnapshot`, not collected sales or a forecast.

**Financial reports** use closed checkout sales only (`salons/{salonId}/sales`), not appointment booked value:

- Sales Summary
- Sales Comparison (current civil range vs the immediately preceding equal-length civil range)
- Service Sales (service-item amounts; tips and ticket-level refunds are not allocated to services)
- Sales by Time Period
- Client Spend (closed tickets grouped by identified `clientId`; in-period spend, not lifetime value)

**Cancellations.** Appointments scheduled in the selected appointment-date range that have `status === "cancelled"`. Rate denominator is all appointments scheduled in that range. Cancelled provider time unions overlapping service-line windows per provider. Advance notice uses `startAt − cancelledAt` only when that value is ≥ 0. Within 24h is `0 <= noticeMinutes < 1440`. Same-day uses the appointment location timezone and does not imply advance notice. A later appointment indicator only looks inside the already loaded range and is not a rebook proof.

**Client Retention.** Cohort-based return after qualifying visits, with 30 / 60 / 90 / 180-day closed observation windows. The selected range is the cohort period, not the return period. A qualifying visit is `status === "completed"` (checked out after Check In → Start Service → Check Out). Booked, confirmed, checked-in, in-service, cancelled, and no-show appointments are not visits. One identified `clientId` per cohort; the anchor is that client's first completed visit in the cohort. A return is another completed visit for the same `clientId` on a later salon-local civil date, already occurred as of now, inside the selected locations. Same-day multi-service appointments, future scheduled bookings, and cancelled / no-show rows are not returns. A client enters an N-day rate denominator only when `anchor date + N days` has elapsed as of now; open windows are still in observation, never counted as unretained. Rate is returned eligible clients ÷ eligible cohort clients; no closed window shows — rather than 0%. Client Behavior (in-period repeat) is not retention. New vs existing, provider ranking, and service-specific retention are not in v1.

**Client Spend.** Closed checkout sales grouped by identified `clientId` in the selected location and civil date range. Spend is shared `breakdown.grossTotal` (item amounts + fees + tax + tip), so identified-client sales plus unidentified tickets equal Sales Summary / Sales by Time Period gross for the same complete dataset. Tickets without `clientId` are excluded from the ranked table and reported separately. Display names come from the latest ticket `clientSnapshot` in range; no name/phone identity matching and no client document reads. Open and void tickets are excluded. This is in-period spend, not estimated LTV.

**Sales Comparison.** Closed checkout sales for the selected location-local civil range compared with the immediately preceding range of the same number of inclusive days (Sep 1–7 vs Aug 25–31; Sep 1–30 vs Aug 2–31). Totals reuse Sales Summary math: gross = items + fees + tax + tip; adjusted = gross − ticket-level refunds. KPIs are gross, adjusted, closed tickets, average closed ticket, and tips, each with current, previous, absolute change, and percent. Previous = 0 never becomes Infinity: both zero is 0%, current > 0 is shown as New. If either fetch is incomplete or errors, the comparison is not shown as trustworthy. Multi-location current totals must equal Sales Summary for the same current period. No per-location table in v1. This is not booked appointment value.

**Financial infrastructure:**

- date-range-complete Sales retrieval (`ffBookingReportsSalesRange.fetchForReport`)
- pagination (not the 80-row list APIs)
- multi-location timezone-aware civil ranges via sale `closedAt`
- incomplete / error protection (no authoritative totals when incomplete)
- shared ticket / refund / item math and cross-report reconciliation

**Appointment infrastructure:**

- Time Block capacity subtraction for Intelligence and Forward Outlook (`ffBookingReportsTimeBlockRange.fetchForReport` + `listForLocationsRange`). One-off, recurring, moved, and skipped occurrences use actual block times. Overlapping blocks union once. Blocks are removed from working capacity and are not booked appointment minutes.
- date-range-complete appointment retrieval (`ffBookingReportsAppointmentRange.fetchForReport`)
- repository methods `listAppointmentsForLocationRange` / `listAppointmentsForLocationsRange` (additive; Calendar still uses `getAppointmentsForDate` and the 500-row overlap `getAppointmentsForRange`)
- pagination with document-snapshot cursors on `locationId + startAt`
- per-location timezone civil bounds on appointment `startAt`
- safety max 10,000 appointments per location per requested range
- incomplete / error protection (no authoritative Intelligence, Cancellations, or Client Retention totals when incomplete)
- future civil ranges are valid; Forward Outlook uses this path; Client Retention looks forward from the cohort through `min(cohortEnd + 180 days, as-of)`

### Not yet built / blocked

- Product Sales (product checkout items are not written yet; hidden from nav)
- Team Sales (walk-in checkout items do not reliably include `providerId`)
- payment-method / tender reports (`method` / `processor` still `"none"`)
- full refund reporting (ticket-level history only; refund UI is not live)
- New vs Existing retention (appointment `firstVisit` is frozen at create and is not full salon history)
- provider or service retention ranking (multi-line attribution is ambiguous)
- gift cards, memberships, packages
- booking-source mix as owner truth
- exports as a Reports product

Example insight:

> 11.5 provider hours were lost to calendar gaps this week.  
> 7.25 hours could potentially have been recovered by moving appointments 30 minutes or less.

Reports should eventually provide **actions** from insights.

---

## Online / self-booking

Not implemented. Schema foreshadowing only (`source: "online"`). Firestore clients/appointments/sales are salon-member only. A public booking surface needs its own security design and must not loosen staff rules casually.

---

## Staging and production

| | |
|--|--|
| Staging | `fair-flow-staging` (`fair-flow-staging.web.app`) |
| Production | `fairflowapp-db841` — **forbidden** unless Shiri explicitly authorizes production work |
| Default Firebase alias | production — always pass `--project` |

Deploy only when a task explicitly authorizes it. Staging hosting is static files under `public/` plus `?v=` cache-bust in `index.html`.

---

## Implementation rules for later work

1. Read this spec before starting a Booking task.
2. Inspect the current modules before adding files or fields.
3. Preserve implemented calendar, appointment, client, sales, availability, and overlap behavior unless the task says otherwise.
4. Schema changes to appointments, clients, sales, or shared catalog require an explicit task that owns those files.
5. New features should land as isolated modules when practical. Integration into `index.html` happens after review, not from multiple parallel branches at once.
