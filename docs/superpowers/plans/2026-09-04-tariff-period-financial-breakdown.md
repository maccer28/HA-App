# Tariff-Period Financial Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track savings and arbitrage profit per tariff period (Night Boost/Night/Day/Peak), for today and lifetime, and show it in a new Financial-tab table in a minimal `energy-dashboard.js` HACS-distributed panel.

**Architecture:** Backend: four `utility_meter` tariff trackers (grid import, battery charge, battery discharge, solar) synced to the real clock by one automation, feeding template sensors for per-period saving/arbitrage (today via direct calculation, lifetime via `input_number` accumulators rolled up nightly). All backend config ships as a single HA `package` YAML file that the user copies to their HA host by hand (this repo has no network access to the HA host). Frontend: a new minimal `energy-dashboard.js` custom element (just enough scaffold to host one Financial view) distributed via a HACS custom repository, with its financial-table logic split into pure, unit-tested functions (`buildFinancialRows`, `renderRowsHTML`) separate from DOM plumbing.

**Tech Stack:** Home Assistant YAML (`utility_meter`, `template`, `input_number`, `automation`, `panel_custom`), vanilla JS Web Components (no build step), Node's built-in test runner (`node:test`), Python 3 + PyYAML + Jinja2 for backend config validation, HACS (frontend/plugin category) for panel distribution.

**Spec:** `docs/superpowers/specs/2026-09-04-tariff-period-financial-breakdown-design.md`

## Global Constraints

- Tariff rates (EUR/kWh): night_boost=0.0824, night=0.2438, day=0.3233, peak=0.4508. Standing charge=0.9164/day.
- Tariff hour boundaries (local time): night_boost 02:00–05:00, peak 17:00–19:00, night 23:00–02:00 & 05:00–08:00, day 08:00–17:00 & 19:00–23:00 (exactly matches the existing `sensor.electricity_rate` logic — do not change the boundaries).
- Install date for lifetime/day-count sensors: 2026-07-13 (already established elsewhere in the existing config; not touched by this plan).
- This git repo cannot reach the HA host (`ha.ma33er.xyz` / `192.168.1.240`) over the network or filesystem — every backend change is delivered as a file in this repo for the user to copy manually; no task may assume live HA access.
- No new JS runtime dependencies — use only what ships with Node 22 and the browser (no npm install, no bundler).
- All new HA entity/helper IDs use the `_night_boost` / `_night` / `_day` / `_peak` suffix convention, matching the spec.

---

## File Structure

- `hacs.json` (create) — HACS custom-repository manifest for the frontend plugin.
- `energy-dashboard.js` (create) — the web component: pure calc/render functions + the `EnergyDashboard` custom element, exported so they're importable from a Node test.
- `energy-dashboard.test.js` (create) — `node:test` unit tests for the pure functions.
- `package.json` (create) — minimal, `"type": "module"` only, no dependencies; exists so Node treats `.js` files as ES modules and so `npm test` has somewhere to live.
- `dev/harness.html` (create) — standalone HTML page that fakes a `hass` object and loads `energy-dashboard.js` directly, for manual visual verification without a real HA instance.
- `ha-config/packages/tariff_period_breakdown.yaml` (create) — the complete backend config package (utility_meter, input_number, template sensors, automations, panel_custom) for the user to copy onto the HA host.
- `scripts/validate_ha_yaml.py` (create) — reusable YAML + embedded-Jinja syntax checker for any file under `ha-config/`.
- `README.md` (modify) — HACS install instructions + manual backend deploy steps.
- `CLAUDE.md` (modify) — record the new sensors/entities and the HACS distribution method, replacing the old `cp`-based deploy section.

---

### Task 1: HACS manifest

**Files:**
- Create: `hacs.json`

**Interfaces:**
- Produces: a valid `hacs.json` HACS reads when this repo is added as a custom repository (category: Plugin).

- [ ] **Step 1: Write `hacs.json`**

```json
{
  "name": "Energy Dashboard",
  "filename": "energy-dashboard.js",
  "content_in_root": true,
  "render_readme": true
}
```

- [ ] **Step 2: Validate it's well-formed JSON**

Run: `python3 -c "import json; json.load(open('hacs.json')); print('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add hacs.json
git commit -m "$(cat <<'EOF'
Add HACS manifest for the energy dashboard panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

---

### Task 2: Pure financial-table functions + tests

**Files:**
- Create: `package.json`
- Create: `energy-dashboard.js`
- Test: `energy-dashboard.test.js`

**Interfaces:**
- Produces: `export function buildFinancialRows(states)` — takes an object shaped like `hass.states` (keys are entity ids, values are `{ state: "1.23" }`-shaped objects) and returns an array of 4 row objects, one per period, each `{ period, todaySaving, todayArbitrage, lifetimeSaving, lifetimeArbitrage }` (all four value fields are `number`, `period` is the display label e.g. `"Night Boost"`).
- Produces: `export function renderRowsHTML(rows)` — takes the array `buildFinancialRows` returns and returns an HTML string of `<tr>` elements (one per row), amounts formatted as `€X.XX`.
- Consumed by: Task 3's `EnergyDashboard` class, in the same file.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ha-app-energy-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing tests**

```javascript
// energy-dashboard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialRows, renderRowsHTML } from './energy-dashboard.js';

test('buildFinancialRows extracts and orders all four periods', () => {
  const states = {
    'sensor.saving_today_night_boost': { state: '1.23' },
    'sensor.arbitrage_today_night_boost': { state: '-0.25' },
    'sensor.total_saving_night_boost': { state: '45.67' },
    'sensor.total_arbitrage_night_boost': { state: '-3.1' },

    'sensor.saving_today_night': { state: '0.5' },
    'sensor.arbitrage_today_night': { state: '0.1' },
    'sensor.total_saving_night': { state: '20' },
    'sensor.total_arbitrage_night': { state: '2' },

    'sensor.saving_today_day': { state: '2' },
    'sensor.arbitrage_today_day': { state: '0.75' },
    'sensor.total_saving_day': { state: '60' },
    'sensor.total_arbitrage_day': { state: '5' },

    'sensor.saving_today_peak': { state: '1' },
    'sensor.arbitrage_today_peak': { state: '0.4' },
    'sensor.total_saving_peak': { state: '15' },
    'sensor.total_arbitrage_peak': { state: '1.5' },
  };

  const rows = buildFinancialRows(states);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => r.period), ['Night Boost', 'Night', 'Day', 'Peak']);
  assert.deepEqual(rows[0], {
    period: 'Night Boost',
    todaySaving: 1.23,
    todayArbitrage: -0.25,
    lifetimeSaving: 45.67,
    lifetimeArbitrage: -3.1,
  });
  assert.deepEqual(rows[2], {
    period: 'Day',
    todaySaving: 2,
    todayArbitrage: 0.75,
    lifetimeSaving: 60,
    lifetimeArbitrage: 5,
  });
});

test('buildFinancialRows defaults missing or unavailable sensors to 0', () => {
  const rows = buildFinancialRows({});
  assert.deepEqual(rows[0], {
    period: 'Night Boost',
    todaySaving: 0,
    todayArbitrage: 0,
    lifetimeSaving: 0,
    lifetimeArbitrage: 0,
  });

  const withUnavailable = {
    'sensor.saving_today_peak': { state: 'unavailable' },
  };
  const rows2 = buildFinancialRows(withUnavailable);
  assert.equal(rows2[3].todaySaving, 0);
});

test('renderRowsHTML formats each row as a table row with euro amounts', () => {
  const html = renderRowsHTML([
    { period: 'Night Boost', todaySaving: 1.5, todayArbitrage: -0.2, lifetimeSaving: 10, lifetimeArbitrage: 2 },
  ]);
  assert.equal(
    html,
    '<tr><td>Night Boost</td><td>€1.50</td><td>€-0.20</td><td>€10.00</td><td>€2.00</td></tr>'
  );
});

test('renderRowsHTML joins multiple rows with no separator needed between <tr> tags', () => {
  const html = renderRowsHTML([
    { period: 'Day', todaySaving: 1, todayArbitrage: 1, lifetimeSaving: 1, lifetimeArbitrage: 1 },
    { period: 'Peak', todaySaving: 2, todayArbitrage: 2, lifetimeSaving: 2, lifetimeArbitrage: 2 },
  ]);
  assert.equal((html.match(/<tr>/g) || []).length, 2);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `energy-dashboard.js` does not exist yet / has no exports.

- [ ] **Step 4: Write the minimal implementation**

```javascript
// energy-dashboard.js
const PERIODS = [
  { key: 'night_boost', label: 'Night Boost' },
  { key: 'night', label: 'Night' },
  { key: 'day', label: 'Day' },
  { key: 'peak', label: 'Peak' },
];

function num(states, entityId) {
  const raw = states[entityId]?.state;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildFinancialRows(states) {
  return PERIODS.map(({ key, label }) => ({
    period: label,
    todaySaving: num(states, `sensor.saving_today_${key}`),
    todayArbitrage: num(states, `sensor.arbitrage_today_${key}`),
    lifetimeSaving: num(states, `sensor.total_saving_${key}`),
    lifetimeArbitrage: num(states, `sensor.total_arbitrage_${key}`),
  }));
}

function euro(value) {
  return `€${value.toFixed(2)}`;
}

export function renderRowsHTML(rows) {
  return rows
    .map(
      r =>
        `<tr><td>${r.period}</td><td>${euro(r.todaySaving)}</td><td>${euro(r.todayArbitrage)}</td><td>${euro(r.lifetimeSaving)}</td><td>${euro(r.lifetimeArbitrage)}</td></tr>`
    )
    .join('');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add package.json energy-dashboard.js energy-dashboard.test.js
git commit -m "$(cat <<'EOF'
Add pure financial-row calc/render functions with tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

---

### Task 3: `EnergyDashboard` custom element + manual harness

**Files:**
- Modify: `energy-dashboard.js` (append the custom element class, using Task 2's exports)
- Create: `dev/harness.html`

**Interfaces:**
- Consumes: `buildFinancialRows(states)`, `renderRowsHTML(rows)` from Task 2 (same file, no import needed).
- Produces: `customElements.define('energy-dashboard', EnergyDashboard)` — a `<energy-dashboard>` element whose `.hass` setter (matching HA's panel contract) triggers a re-render of the Financial table.

- [ ] **Step 1: Append the custom element to `energy-dashboard.js`**

```javascript
class EnergyDashboard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._initialized = false;
  }

  connectedCallback() {
    if (this._initialized) return;
    this._initialized = true;
    this.style.cssText = 'display:block;height:100vh;background:#0d0f14;color:#e2e8f0;font-family:Inter,sans-serif;overflow:auto;';
    this.innerHTML = `
      <style>
        #financial { padding: 16px; }
        h2 { font-weight: 600; margin: 0 0 12px; }
        table { border-collapse: collapse; width: 100%; max-width: 640px; }
        th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-family: 'JetBrains Mono', monospace; font-size: 14px; }
        th { color: #6b7280; font-family: Inter, sans-serif; font-weight: 500; }
      </style>
      <div id="financial">
        <h2>Financial &mdash; Savings by Tariff Period</h2>
        <table>
          <thead>
            <tr><th>Period</th><th>Today Saving</th><th>Today Arbitrage</th><th>Lifetime Saving</th><th>Lifetime Arbitrage</th></tr>
          </thead>
          <tbody id="financial-body"></tbody>
        </table>
      </div>
    `;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) this.connectedCallback();
    this._render();
  }

  _render() {
    const tbody = this.querySelector('#financial-body');
    if (!tbody) return;
    const rows = buildFinancialRows(this._hass?.states || {});
    tbody.innerHTML = renderRowsHTML(rows);
  }
}

customElements.define('energy-dashboard', EnergyDashboard);
```

- [ ] **Step 2: Create the manual verification harness**

```html
<!-- dev/harness.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Energy Dashboard Harness</title>
  </head>
  <body style="margin:0;">
    <energy-dashboard></energy-dashboard>
    <script type="module">
      import '../energy-dashboard.js';

      const fakeHass = {
        states: {
          'sensor.saving_today_night_boost': { state: '0.85' },
          'sensor.arbitrage_today_night_boost': { state: '-0.6' },
          'sensor.total_saving_night_boost': { state: '32.10' },
          'sensor.total_arbitrage_night_boost': { state: '-9.40' },

          'sensor.saving_today_night': { state: '0.20' },
          'sensor.arbitrage_today_night': { state: '0.05' },
          'sensor.total_saving_night': { state: '8.00' },
          'sensor.total_arbitrage_night': { state: '1.10' },

          'sensor.saving_today_day': { state: '1.40' },
          'sensor.arbitrage_today_day': { state: '0.30' },
          'sensor.total_saving_day': { state: '55.00' },
          'sensor.total_arbitrage_day': { state: '4.30' },

          'sensor.saving_today_peak': { state: '0.95' },
          'sensor.arbitrage_today_peak': { state: '0.50' },
          'sensor.total_saving_peak': { state: '18.60' },
          'sensor.total_arbitrage_peak': { state: '2.90' },
        },
      };

      document.querySelector('energy-dashboard').hass = fakeHass;
    </script>
  </body>
</html>
```

- [ ] **Step 3: Serve and visually verify**

Run: `python3 -m http.server 8642` (from the repo root), then open `http://localhost:8642/dev/harness.html` in a browser.
Expected: a dark-background page with a "Financial — Savings by Tariff Period" heading and a 4-row table (Night Boost/Night/Day/Peak) showing the euro amounts from the fake data above, formatted to 2 decimals. Stop the server (Ctrl+C) once confirmed.

- [ ] **Step 4: Re-run the unit tests to confirm Task 2's tests still pass**

Run: `npm test`
Expected: all 4 tests still PASS (the custom element addition doesn't touch the exported functions' behavior)

- [ ] **Step 5: Commit**

```bash
git add energy-dashboard.js dev/harness.html
git commit -m "$(cat <<'EOF'
Add EnergyDashboard custom element with Financial table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

---

### Task 4: Backend config package

**Files:**
- Create: `ha-config/packages/tariff_period_breakdown.yaml`

**Interfaces:**
- Produces (HA entity ids, for Task 5's validator and the panel's expectations): `utility_meter.grid_import_daily`/`battery_charge_daily`/`battery_discharge_daily`/`solar_daily` (each generating `_night_boost`/`_night`/`_day`/`_peak` sub-sensors), `input_number.total_saving_{period}` / `total_arbitrage_{period}`, `sensor.saving_today_{period}` / `arbitrage_today_{period}` / `total_saving_{period}` / `total_arbitrage_{period}`, rewritten `sensor.energy_cost_today` / `energy_cost_without_battery_today`, automations `tariff_period_sync` and `tariff_period_savings_midnight_rollup`, and a `panel_custom` entry for `energy-dashboard`.

- [ ] **Step 1: Write the package file**

```yaml
# ha-config/packages/tariff_period_breakdown.yaml
#
# Tariff-period financial breakdown. See:
# docs/superpowers/specs/2026-09-04-tariff-period-financial-breakdown-design.md
# in the HA-App repo for the full design.
#
# One-time setup on the HA host, if not already done:
#   Add `packages: !include_dir_named packages` under the `homeassistant:`
#   key in configuration.yaml, then place this file in `config/packages/`.

utility_meter:
  grid_import_daily:
    source: sensor.solis_s6_eh1p_total_energy_imported_from_grid
    cycle: daily
    tariffs:
      - night_boost
      - night
      - day
      - peak

  battery_charge_daily:
    source: sensor.solis_s6_eh1p_total_battery_charge_energy
    cycle: daily
    tariffs:
      - night_boost
      - night
      - day
      - peak

  battery_discharge_daily:
    source: sensor.solis_s6_eh1p_total_battery_discharge_energy
    cycle: daily
    tariffs:
      - night_boost
      - night
      - day
      - peak

  solar_daily:
    source: sensor.solar_total_yield
    cycle: daily
    tariffs:
      - night_boost
      - night
      - day
      - peak

input_number:
  total_saving_night_boost:
    name: "Total Saving - Night Boost"
    min: 0
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_saving_night:
    name: "Total Saving - Night"
    min: 0
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_saving_day:
    name: "Total Saving - Day"
    min: 0
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_saving_peak:
    name: "Total Saving - Peak"
    min: 0
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_arbitrage_night_boost:
    name: "Total Arbitrage - Night Boost"
    min: -100000
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_arbitrage_night:
    name: "Total Arbitrage - Night"
    min: -100000
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_arbitrage_day:
    name: "Total Arbitrage - Day"
    min: -100000
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"
  total_arbitrage_peak:
    name: "Total Arbitrage - Peak"
    min: -100000
    max: 100000
    step: 0.01
    unit_of_measurement: "EUR"

template:
  - sensor:
      # ─── PER-PERIOD SAVING (TODAY) ──────────────────────────────
      - name: "Saving Today - Night Boost"
        unique_id: saving_today_night_boost
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:piggy-bank
        state: >
          {% set rate = 0.0824 %}
          {% set imported = states('sensor.grid_import_daily_night_boost') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_night_boost') | float(0) %}
          {% set solar = states('sensor.solar_daily_night_boost') | float(0) %}
          {% set cost_with = imported * rate %}
          {% set cost_without = (imported + discharged + solar) * rate %}
          {{ (cost_without - cost_with) | round(2) }}

      - name: "Saving Today - Night"
        unique_id: saving_today_night
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:piggy-bank
        state: >
          {% set rate = 0.2438 %}
          {% set imported = states('sensor.grid_import_daily_night') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_night') | float(0) %}
          {% set solar = states('sensor.solar_daily_night') | float(0) %}
          {% set cost_with = imported * rate %}
          {% set cost_without = (imported + discharged + solar) * rate %}
          {{ (cost_without - cost_with) | round(2) }}

      - name: "Saving Today - Day"
        unique_id: saving_today_day
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:piggy-bank
        state: >
          {% set rate = 0.3233 %}
          {% set imported = states('sensor.grid_import_daily_day') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_day') | float(0) %}
          {% set solar = states('sensor.solar_daily_day') | float(0) %}
          {% set cost_with = imported * rate %}
          {% set cost_without = (imported + discharged + solar) * rate %}
          {{ (cost_without - cost_with) | round(2) }}

      - name: "Saving Today - Peak"
        unique_id: saving_today_peak
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:piggy-bank
        state: >
          {% set rate = 0.4508 %}
          {% set imported = states('sensor.grid_import_daily_peak') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_peak') | float(0) %}
          {% set solar = states('sensor.solar_daily_peak') | float(0) %}
          {% set cost_with = imported * rate %}
          {% set cost_without = (imported + discharged + solar) * rate %}
          {{ (cost_without - cost_with) | round(2) }}

      # ─── PER-PERIOD ARBITRAGE (TODAY) ───────────────────────────
      - name: "Arbitrage Today - Night Boost"
        unique_id: arbitrage_today_night_boost
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {% set rate = 0.0824 %}
          {% set charged = states('sensor.battery_charge_daily_night_boost') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_night_boost') | float(0) %}
          {{ ((discharged * rate) - (charged * rate)) | round(2) }}

      - name: "Arbitrage Today - Night"
        unique_id: arbitrage_today_night
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {% set rate = 0.2438 %}
          {% set charged = states('sensor.battery_charge_daily_night') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_night') | float(0) %}
          {{ ((discharged * rate) - (charged * rate)) | round(2) }}

      - name: "Arbitrage Today - Day"
        unique_id: arbitrage_today_day
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {% set rate = 0.3233 %}
          {% set charged = states('sensor.battery_charge_daily_day') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_day') | float(0) %}
          {{ ((discharged * rate) - (charged * rate)) | round(2) }}

      - name: "Arbitrage Today - Peak"
        unique_id: arbitrage_today_peak
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {% set rate = 0.4508 %}
          {% set charged = states('sensor.battery_charge_daily_peak') | float(0) %}
          {% set discharged = states('sensor.battery_discharge_daily_peak') | float(0) %}
          {{ ((discharged * rate) - (charged * rate)) | round(2) }}

      # ─── PER-PERIOD LIFETIME TOTALS ─────────────────────────────
      - name: "Total Saving - Night Boost"
        unique_id: total_saving_night_boost
        unit_of_measurement: "EUR"
        state_class: total_increasing
        icon: mdi:piggy-bank
        state: >
          {{ (states('input_number.total_saving_night_boost') | float(0) + states('sensor.saving_today_night_boost') | float(0)) | round(2) }}

      - name: "Total Saving - Night"
        unique_id: total_saving_night
        unit_of_measurement: "EUR"
        state_class: total_increasing
        icon: mdi:piggy-bank
        state: >
          {{ (states('input_number.total_saving_night') | float(0) + states('sensor.saving_today_night') | float(0)) | round(2) }}

      - name: "Total Saving - Day"
        unique_id: total_saving_day
        unit_of_measurement: "EUR"
        state_class: total_increasing
        icon: mdi:piggy-bank
        state: >
          {{ (states('input_number.total_saving_day') | float(0) + states('sensor.saving_today_day') | float(0)) | round(2) }}

      - name: "Total Saving - Peak"
        unique_id: total_saving_peak
        unit_of_measurement: "EUR"
        state_class: total_increasing
        icon: mdi:piggy-bank
        state: >
          {{ (states('input_number.total_saving_peak') | float(0) + states('sensor.saving_today_peak') | float(0)) | round(2) }}

      - name: "Total Arbitrage - Night Boost"
        unique_id: total_arbitrage_night_boost
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {{ (states('input_number.total_arbitrage_night_boost') | float(0) + states('sensor.arbitrage_today_night_boost') | float(0)) | round(2) }}

      - name: "Total Arbitrage - Night"
        unique_id: total_arbitrage_night
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {{ (states('input_number.total_arbitrage_night') | float(0) + states('sensor.arbitrage_today_night') | float(0)) | round(2) }}

      - name: "Total Arbitrage - Day"
        unique_id: total_arbitrage_day
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {{ (states('input_number.total_arbitrage_day') | float(0) + states('sensor.arbitrage_today_day') | float(0)) | round(2) }}

      - name: "Total Arbitrage - Peak"
        unique_id: total_arbitrage_peak
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:trending-up
        state: >
          {{ (states('input_number.total_arbitrage_peak') | float(0) + states('sensor.arbitrage_today_peak') | float(0)) | round(2) }}

      # ─── REWRITTEN DAILY COST SENSORS (accurate per-period sums,
      #     replacing the old flat 3kWh/10%-heuristic split) ───────
      - name: "Energy Cost Today"
        unique_id: energy_cost_today
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:currency-eur
        state: >
          {% set standing = 0.9164 %}
          {% set nb = states('sensor.grid_import_daily_night_boost') | float(0) * 0.0824 %}
          {% set n  = states('sensor.grid_import_daily_night') | float(0) * 0.2438 %}
          {% set d  = states('sensor.grid_import_daily_day') | float(0) * 0.3233 %}
          {% set p  = states('sensor.grid_import_daily_peak') | float(0) * 0.4508 %}
          {{ (nb + n + d + p + standing) | round(2) }}

      - name: "Energy Cost Without Battery Today"
        unique_id: energy_cost_without_battery_today
        unit_of_measurement: "EUR"
        state_class: measurement
        icon: mdi:currency-eur
        state: >
          {% set standing = 0.9164 %}
          {% set nb = (states('sensor.grid_import_daily_night_boost') | float(0) + states('sensor.battery_discharge_daily_night_boost') | float(0) + states('sensor.solar_daily_night_boost') | float(0)) * 0.0824 %}
          {% set n  = (states('sensor.grid_import_daily_night') | float(0) + states('sensor.battery_discharge_daily_night') | float(0) + states('sensor.solar_daily_night') | float(0)) * 0.2438 %}
          {% set d  = (states('sensor.grid_import_daily_day') | float(0) + states('sensor.battery_discharge_daily_day') | float(0) + states('sensor.solar_daily_day') | float(0)) * 0.3233 %}
          {% set p  = (states('sensor.grid_import_daily_peak') | float(0) + states('sensor.battery_discharge_daily_peak') | float(0) + states('sensor.solar_daily_peak') | float(0)) * 0.4508 %}
          {{ (nb + n + d + p + standing) | round(2) }}

automation:
  - alias: "Tariff Period Sync"
    id: tariff_period_sync
    trigger:
      - platform: time
        at: "02:00:00"
      - platform: time
        at: "05:00:00"
      - platform: time
        at: "08:00:00"
      - platform: time
        at: "17:00:00"
      - platform: time
        at: "19:00:00"
      - platform: time
        at: "23:00:00"
      - platform: homeassistant
        event: start
    action:
      - variables:
          period: >
            {% set hour = now().hour %}
            {% if hour >= 2 and hour < 5 %}
              night_boost
            {% elif hour >= 17 and hour < 19 %}
              peak
            {% elif hour >= 23 or hour < 8 %}
              night
            {% else %}
              day
            {% endif %}
      - service: select.select_option
        target:
          entity_id:
            - select.grid_import_daily
            - select.battery_charge_daily
            - select.battery_discharge_daily
            - select.solar_daily
        data:
          option: "{{ period }}"

  - alias: "Tariff Period Savings Midnight Rollup"
    id: tariff_period_savings_midnight_rollup
    trigger:
      - platform: time
        at: "23:59:00"
    action:
      - service: input_number.set_value
        target:
          entity_id: input_number.total_saving_night_boost
        data:
          value: "{{ (states('input_number.total_saving_night_boost') | float(0) + states('sensor.saving_today_night_boost') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_saving_night
        data:
          value: "{{ (states('input_number.total_saving_night') | float(0) + states('sensor.saving_today_night') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_saving_day
        data:
          value: "{{ (states('input_number.total_saving_day') | float(0) + states('sensor.saving_today_day') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_saving_peak
        data:
          value: "{{ (states('input_number.total_saving_peak') | float(0) + states('sensor.saving_today_peak') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_arbitrage_night_boost
        data:
          value: "{{ (states('input_number.total_arbitrage_night_boost') | float(0) + states('sensor.arbitrage_today_night_boost') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_arbitrage_night
        data:
          value: "{{ (states('input_number.total_arbitrage_night') | float(0) + states('sensor.arbitrage_today_night') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_arbitrage_day
        data:
          value: "{{ (states('input_number.total_arbitrage_day') | float(0) + states('sensor.arbitrage_today_day') | float(0)) | round(2) }}"
      - service: input_number.set_value
        target:
          entity_id: input_number.total_arbitrage_peak
        data:
          value: "{{ (states('input_number.total_arbitrage_peak') | float(0) + states('sensor.arbitrage_today_peak') | float(0)) | round(2) }}"

panel_custom:
  - name: energy-dashboard
    sidebar_title: Energy
    sidebar_icon: mdi:lightning-bolt
    url_path: energy-dashboard
    module_url: /hacsfiles/HA-App/energy-dashboard.js
```

- [ ] **Step 2: Commit**

```bash
git add ha-config/packages/tariff_period_breakdown.yaml
git commit -m "$(cat <<'EOF'
Add HA backend package for tariff-period financial breakdown

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

(Note: `module_url` assumes HACS serves this repo's root file at `/hacsfiles/HA-App/energy-dashboard.js`. Task 6's deployment checklist includes verifying this path after installing via HACS and correcting it here if HACS assigns a different one.)

---

### Task 5: Automated YAML/Jinja validation

**Files:**
- Create: `scripts/validate_ha_yaml.py`

**Interfaces:**
- Produces: a CLI script `python3 scripts/validate_ha_yaml.py <file>...` exiting non-zero with an error message on the first invalid file (bad YAML, or a Jinja template string that fails to parse), and printing `OK: <file>` for each valid one.

- [ ] **Step 1: Write a deliberately-broken test fixture to prove the checker catches errors**

```bash
mkdir -p /tmp/ha_yaml_validate_test
cat > /tmp/ha_yaml_validate_test/bad.yaml <<'EOF'
template:
  - sensor:
      - name: "Broken"
        state: >
          {% set x = 1 %
          {{ x }}
EOF
cat > /tmp/ha_yaml_validate_test/good.yaml <<'EOF'
template:
  - sensor:
      - name: "Fine"
        state: >
          {% set x = 1 %}
          {{ x }}
EOF
```

- [ ] **Step 2: Write the validator**

```python
#!/usr/bin/env python3
"""Validate YAML syntax and embedded Jinja template syntax in HA config files."""
import sys
import yaml
from jinja2 import Environment


def find_jinja_strings(node):
    if isinstance(node, str):
        if '{{' in node or '{%' in node:
            yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from find_jinja_strings(value)
    elif isinstance(node, list):
        for item in node:
            yield from find_jinja_strings(item)


def validate_file(path):
    with open(path) as f:
        try:
            data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            return f"{path}: YAML syntax error: {e}"

    env = Environment()
    for template_str in find_jinja_strings(data):
        try:
            env.parse(template_str)
        except Exception as e:
            return f"{path}: Jinja syntax error in template ({template_str[:40]!r}...): {e}"

    return None


def main(argv):
    if not argv:
        print("usage: validate_ha_yaml.py <file>...", file=sys.stderr)
        return 2

    had_error = False
    for path in argv:
        error = validate_file(path)
        if error:
            print(error, file=sys.stderr)
            had_error = True
        else:
            print(f"OK: {path}")

    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 3: Run against the test fixtures to verify it catches the broken one and passes the good one**

Run: `python3 scripts/validate_ha_yaml.py /tmp/ha_yaml_validate_test/bad.yaml /tmp/ha_yaml_validate_test/good.yaml`
Expected: prints a Jinja syntax error for `bad.yaml` to stderr, exits non-zero (note: since `bad.yaml` fails, `good.yaml` is still checked and would print `OK:` for it — confirm both lines appear, one error one OK).

Run: `echo $?`
Expected: non-zero

Then clean up: `rm -rf /tmp/ha_yaml_validate_test`

- [ ] **Step 4: Run it against the real package file**

Run: `python3 scripts/validate_ha_yaml.py ha-config/packages/tariff_period_breakdown.yaml`
Expected: `OK: ha-config/packages/tariff_period_breakdown.yaml`

If it fails: fix the reported template in `ha-config/packages/tariff_period_breakdown.yaml` and re-run until it passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate_ha_yaml.py
git commit -m "$(cat <<'EOF'
Add YAML/Jinja syntax validator for HA config packages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

---

### Task 6: Docs — README HACS install + CLAUDE.md update

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Write `README.md`**

```markdown
# HA-App — Energy Dashboard

A custom Home Assistant panel showing live solar/battery/grid power flow
and financial savings (including a per-tariff-period breakdown), built as
a native web component. See `CLAUDE.md` for full technical details.

## Install (HACS)

1. In HA, go to **HACS → ⋮ → Custom repositories**.
2. Add this repository's URL, category **Plugin**.
3. Find "Energy Dashboard" in HACS and install it.
4. Copy `ha-config/packages/tariff_period_breakdown.yaml` from this repo
   into your HA config's `packages/` directory (create it if it doesn't
   exist, and add `packages: !include_dir_named packages` under the
   `homeassistant:` key in `configuration.yaml` if you haven't already).
5. Restart Home Assistant.
6. In HACS's file list for this repo, confirm the served path for
   `energy-dashboard.js` (usually `/hacsfiles/HA-App/energy-dashboard.js`)
   matches the `module_url` in `tariff_period_breakdown.yaml`'s
   `panel_custom` entry — edit and re-copy the package file if it differs.
7. An "Energy" item should appear in the HA sidebar.

## Development

- `npm test` — runs the unit tests for the panel's pure calculation/render
  functions (`energy-dashboard.test.js`).
- `python3 -m http.server` then open `dev/harness.html` — visually verify
  the panel's Financial table against fake sensor data, without needing a
  real HA instance.
- `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml` — checks
  YAML and embedded Jinja template syntax before deploying config changes.
```

- [ ] **Step 2: Update `CLAUDE.md`'s "Financial" sensor list and "Deploy" section**

Add these new sensors to the "Financial (template sensors in configuration.yaml)" list in `CLAUDE.md`:

```markdown
- sensor.saving_today_{night_boost,night,day,peak} — today's saving €, split by tariff period
- sensor.arbitrage_today_{night_boost,night,day,peak} — today's arbitrage profit €, split by tariff period
- sensor.total_saving_{night_boost,night,day,peak} — lifetime saving €, split by tariff period
- sensor.total_arbitrage_{night_boost,night,day,peak} — lifetime arbitrage profit €, split by tariff period
```

Replace the existing `## Deploy` section (the one with the `cp energy-dashboard.js ...` command) with:

```markdown
## Deploy

Panel: distributed via HACS (custom repository, category Plugin) — see
`README.md`. After editing `energy-dashboard.js`, push the change and
either bump the version tag or use HACS's "redownload" for a dev install;
HACS handles placing the file under `/hacsfiles/HA-App/`.

Backend sensors/automations: edit
`ha-config/packages/tariff_period_breakdown.yaml` in this repo, validate
with `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml`, then
copy it to the HA host's `config/packages/` directory and restart HA (this
repo has no network access to the HA host, so this copy step is manual).
```

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Document HACS install and manual backend deploy steps

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EHW8cLnq1QccQQCPhsZonE
EOF
)"
```

---

### Task 7: Deployment checklist (manual, on the HA host)

This task has no code changes in this repo — it's the handoff to actually get the feature live, since this repo cannot reach the HA host. Follow `README.md`'s "Install (HACS)" section:

- [ ] **Step 1:** Push this repo to GitHub (if not already) and tag a release, e.g. `git tag v0.1.0 && git push origin v0.1.0` — HACS needs at least one release/tag to offer an install.
- [ ] **Step 2:** In HA, add this repo as a HACS custom repository (category Plugin) and install it.
- [ ] **Step 3:** Check HACS's file browser for this repo to confirm the actual served URL for `energy-dashboard.js`. If it's not `/hacsfiles/HA-App/energy-dashboard.js`, edit the `module_url` in `ha-config/packages/tariff_period_breakdown.yaml` to match, and re-run Task 5's validator before re-copying.
- [ ] **Step 4:** Copy `ha-config/packages/tariff_period_breakdown.yaml` to the HA host's `config/packages/` directory (creating the directory and adding `packages: !include_dir_named packages` under `homeassistant:` in `configuration.yaml` if this is the first package).
- [ ] **Step 5:** Before restarting HA, edit the host's `configuration.yaml` and delete the existing template sensor blocks with `unique_id: energy_cost_today` and `unique_id: energy_cost_without_battery_today`, and the existing `panel_custom` block for `url_path: energy-dashboard` / `module_url: /local/energy-dashboard/energy-dashboard.js`. HA packages merge rather than override, so leaving these in place means the new package's accurate replacements get skipped (or create duplicate `_2` entities) and HA may raise a duplicate `frontend_url_path` error — or worse, the broken `/local/` panel entry could win the conflict (see CLAUDE.md's "Lessons learned" section on `NS_ERROR_CORRUPTED_CONTENT`).
- [ ] **Step 6:** Verify `sensor.solar_total_yield` is genuinely in kWh (e.g. compare its value against a known recent daily solar total, or cross-check with `sensor.solar_today`) before trusting `sensor.saving_today_*` and `sensor.energy_cost_without_battery_today` — if it's actually in Wh, those sensors will overstate savings by roughly 1000x, and the nightly rollup automation would make that error permanent in `input_number.total_saving_*` until manually corrected.
- [ ] **Step 7:** Restart Home Assistant.
- [ ] **Step 8:** In Developer Tools → States, confirm `select.grid_import_daily` (and the other 3 selects) show a value matching the current hour's tariff period, and that `sensor.saving_today_night_boost` etc. exist and read `0` or a small number (not `unavailable`).
- [ ] **Step 9:** Confirm the "Energy" sidebar item appears and shows the Financial table with today's/lifetime figures.
- [ ] **Step 10:** After a full day, spot-check that `saving_today_night_boost + saving_today_night + saving_today_day + saving_today_peak` is close to the existing `sensor.energy_saving_today` (per the spec's verification note).
