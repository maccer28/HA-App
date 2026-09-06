# Energy Dashboard — Custom HA Panel

## What this is
A custom Home Assistant frontend panel built as a native web component.
No token required. Runs in HA's JS context with full access to `hass` object.

## System details
- **HA host**: https://ha.ma33er.xyz / 192.168.1.240
- **Config path**: /srv/dev-disk-by-uuid-9f09d20d-90ff-43e0-be85-970dea1fff5c/newinstall/appdata/homeassistant/config/
- **Panel file**: config/www/energy-dashboard/energy-dashboard.js — historical
  path from the pre-HACS approach; HACS now manages the panel file's location
  on the host directly, this is not something you manually copy to anymore
  (see `## Deploy` below)
- **Inverter**: Solis S6-EH1P (1-Phase LV Hybrid, Protocol 33, Modbus via waveshare bridge at 192.168.1.254:502)
- **Battery**: Lithtech TR8500WX — 51.2V nominal, 314Ah, **16.076kWh (confirmed)**, Max charge/discharge 200A.
  Communicates SOC to the inverter over RS485 (`select.battery_model` =
  "Lithium Battery LV(RS485)"), so the inverter uses the BMS's SOC and current
  limits directly. **`number.solis_s6_eh1p_battery_rated_capacity` reads 50 Ah
  and should be left alone** — that field only applies to batteries without BMS
  communication and is unused here. It is not a misconfiguration.
- **Solar**: AC-coupled, separate Modbus inverter on waveshare bridge slave 1
- **Tariff** (from the 29/07-28/08/2026 bill; rates rose 20/07/2026). The bill
  quotes ex-VAT and adds 9% at the end; the package stores **VAT-inclusive**
  rates, because that is what the money costs:

  | Band | Window | Billed ex-VAT | Used in package (inc 9%) |
  |---|---|---|---|
  | EV / Night Boost | 02:00-05:00 | 0.1030 | **0.1123** |
  | Night | 23:00-08:00 | 0.2549 | **0.2778** |
  | Day | 08:00-17:00 *and 19:00-23:00* | 0.3283 | **0.3578** |
  | Peak | 17:00-19:00 | 0.4234 | **0.4615** |

  Daily fixed charge **1.1120** = standing (0.9731 → 1.0607) + PSO levy
  (1.46/month → 0.0513/day). Together roughly **40% of the bill**.

  The supplier on the bill is Flogas, not Bord Gáis. The band *windows* above
  are inherited from the original notes and have not been confirmed against the
  supplier's tariff document — the rates have.

## Key sensors
### Live power
- sensor.solar_power — solar AC output watts
- sensor.solis_s6_eh1p_grid_power_net — grid W (positive=import, negative=export)
- sensor.solis_s6_eh1p_battery_charge_power — W, 0 unless charging  ← prefer this
- sensor.solis_s6_eh1p_battery_discharge_power — W, 0 unless discharging  ← prefer this
- sensor.solis_s6_eh1p_battery_power — battery W (positive = DISCHARGING, see Notes)
- sensor.solis_s6_eh1p_battery_power_net — battery W net (same convention)
- sensor.solis_s6_eh1p_battery_soh — battery health %
- sensor.solis_s6_eh1p_battery_voltage_bms / _current_bms — BMS-reported pair
- sensor.solis_s6_eh1p_household_load_power — house load W
- sensor.solis_s6_eh1p_battery_soc — battery % (0-100)
- sensor.solis_s6_eh1p_battery_voltage — battery V
- sensor.solis_s6_eh1p_battery_current — battery A
- sensor.solis_s6_eh1p_temperature — inverter °C
- sensor.solis_s6_eh1p_a_phase_voltage — grid voltage V
- sensor.solis_s6_eh1p_grid_frequency — grid Hz
- sensor.solis_s6_eh1p_status_string — inverter status text

### Energy today
- sensor.solar_today — solar kWh today (utility meter, resets midnight)
- sensor.solis_s6_eh1p_today_battery_charge_energy — kWh
- sensor.solis_s6_eh1p_today_battery_discharge_energy — kWh
- sensor.solis_s6_eh1p_today_energy_imported_from_grid — kWh
- sensor.solis_s6_eh1p_today_energy_fed_into_grid — kWh
- sensor.solis_s6_eh1p_household_load_today_energy — kWh

### Energy yesterday (inverter-reported — totals only, NO tariff split)
- sensor.solis_s6_eh1p_yesterday_energy_imported_from_grid
- sensor.solis_s6_eh1p_yesterday_energy_fed_into_grid
- sensor.solis_s6_eh1p_yesterday_battery_charge_energy
- sensor.solis_s6_eh1p_yesterday_battery_discharge_energy
- sensor.solis_s6_eh1p_yesterday_energy_consumption

These are authoritative for daily totals but are single numbers with no tariff
breakdown, so they **cannot** price yesterday against the four-rate tariff —
that limitation is what forced the old `min(imported, 3.0)` heuristics. Use the
meters' `last_period` for anything priced; see "Derived helpers" below. There is
no inverter-side solar sensor (solar is a separate AC-coupled inverter on
Modbus slave 1).

Verified live against the HA API on 2026-09-05:

- `sensor.solar_today` **is in Wh** (`unit_of_measurement: Wh`) — the long-held
  assumption is correct. It is a utility_meter helper; its own `last_period`
  attribute holds yesterday's solar.
- **`sensor.solar_today_previous_period` does not exist.** The host templates
  referencing it resolve to `unknown` → `float(0)`, so yesterday's solar has
  been silently counted as **zero** — understating, not overstating. Nothing in
  this repo references it any more; use sensor.solar_yesterday_kwh.
- `sensor.solar_today`'s source reads 142.40 kWh lifetime while
  `sensor.solar_total_yield` reads 366.48 kWh — two different solar
  measurements. Daily deltas look consistent, but if solar figures ever look
  off, this discrepancy is the first thing to check.

## Battery protection (no temperature is reported, by design)
`sensor.solis_s6_eh1p_battery_temperature_bms` reads a constant **0.0 °C** and
always has. This is not a fault: the Lithtech pack has no temperature gauge on
its own screen either, and does not publish one over RS485.

Protection still works, expressed as a current limit rather than a temperature.
Measured over 45 days, `battery_charge_current_limitation_bms` ranged
**40–157 A** while the discharge limit sat flat at 195 A — the pack actively
throttling the inverter, which obeys it.

**If a night charge ever fails, look at that sensor first.** A limit of 0 means
the BMS blocked charging (cold being the usual cause). The symptom downstream is
an empty battery in the morning and a day bought at the day rate instead of the
EV rate — roughly €2–3 — which otherwise presents as "the figures look wrong".

`sensor.solis_s6_eh1p_lead_acid_battery_temperature` reads −200.1 °C and is a
different register for a battery type not fitted here. Ignore it.

## HA API access
The host **is** reachable from this repo at `https://ha.ma33er.xyz` (the LAN IP
192.168.1.240 is not). A long-lived token lives in `.ha_token` (gitignored):

```bash
TOKEN=$(tr -d '\r\n' < .ha_token)
curl -s -H "Authorization: Bearer $TOKEN" https://ha.ma33er.xyz/api/states
```

Use read-only `GET` unless the user has asked for a change — the same API can
call services and set states.

## Meter source granularity (accuracy caveat)
The `sensor.solis_s6_eh1p_total_*` counters the utility meters use are
**integers stepping in whole kWh** (1500, 521, 486). Two consequences:

1. A meter reads `unknown` until its source ticks, so after a restart the
   tariff buckets stay blank for a while — `sensor.energy_cost_today` collapses
   to roughly the standing charge alone until then. `sensor.solar_daily_*`
   avoids this because `solar_total_yield` has 2 dp and changes constantly.
2. Each 1 kWh tick is attributed entirely to whichever tariff was active when
   the counter crossed, so the per-period split is coarse — worst at the
   Night Boost/Night boundary, where the rates differ 3x.

`sensor.solis_s6_eh1p_today_*` are 0.1 kWh (10x finer) but reset daily; the
power sensors update every ~20s and would suit a Riemann-sum integration.

### Financial (template sensors in configuration.yaml)
- sensor.electricity_rate — current EUR/kWh
- sensor.energy_cost_today — actual cost today €
- sensor.energy_cost_yesterday
- sensor.energy_cost_without_battery_today — what cost would be without battery €
- sensor.energy_cost_without_battery_yesterday
- sensor.energy_saving_today — saving today €
- sensor.energy_saving_yesterday
- sensor.arbitrage_profit_today — pure buy cheap/sell dear profit €
- sensor.arbitrage_profit_yesterday
- sensor.battery_charge_cost_today — cost to charge battery €
- sensor.battery_charge_cost_yesterday
- sensor.solar_value_today — value of solar produced €
- sensor.solar_value_yesterday
- sensor.total_energy_saving — lifetime accumulated saving € (backed by input_number)
- sensor.total_arbitrage_profit — lifetime arbitrage €
- sensor.average_daily_saving — rolling average €/day
- sensor.projected_annual_saving — projected annual saving €
- sensor.days_since_install — days since 2026-07-13
- sensor.saving_today_{night_boost,night,day,peak} — today's saving €, split by tariff period
- sensor.arbitrage_today_{night_boost,night,day,peak} — today's arbitrage profit €, split by tariff period
- sensor.total_saving_{night_boost,night,day,peak} — lifetime saving €, split by tariff period
- sensor.total_arbitrage_{night_boost,night,day,peak} — lifetime arbitrage profit €, split by tariff period

### Derived helpers (defined in the package — use these, not raw sensors)
- sensor.current_tariff_period — `night_boost|night|day|peak`, read straight
  off `select.grid_import_daily`. **The** source of truth for "which period
  is it now". Never recompute the hour boundaries anywhere else — that logic
  belongs only to the `Tariff Period Sync` automation.
- sensor.solar_today_kwh — today's solar in kWh, summed from the four
  `sensor.solar_daily_*` tariff buckets (source: the confirmed-kWh
  `sensor.solar_total_yield`). Use this instead of `sensor.solar_today`;
  it exists precisely so no consumer has to remember a `/1000`.
- sensor.solar_yesterday_kwh — same, from those buckets' `last_period`.
- sensor.tariff_meter_drift_yesterday — summed grid-import `last_period` minus
  the inverter's own yesterday import. Should be ~0; persistent non-zero means
  the meters lost energy and yesterday under-counts by that many kWh.

**Yesterday comes from `last_period`, not from history.** Every utility_meter
tariff sensor exposes a `last_period` attribute (a stringified Decimal — always
`| float(0)` it) holding its previous completed cycle. These meters are
`cycle: daily`, so `last_period` is yesterday, per tariff, with no history
query and no recorder dependency, restored across restarts. All the
`*_yesterday` financial sensors in the package are built on it. Note it reads 0
until the first midnight after install.

### Totals (cumulative, ever-increasing)
- sensor.solar_total_yield — lifetime solar kWh
- sensor.solis_s6_eh1p_total_battery_charge_energy — lifetime charged kWh
- sensor.solis_s6_eh1p_total_battery_discharge_energy — lifetime discharged kWh
- sensor.solis_s6_eh1p_total_energy_imported_from_grid
- sensor.solis_s6_eh1p_total_energy_fed_into_grid

### Other
- weather.forecast_home — weather state string
- sensor.sun_next_rising / sensor.sun_next_setting — ISO datetime strings
- sensor.burrin_rainfall_forecast_24h — mm rainfall forecast

## How to build the panel (web component pattern)

```javascript
class EnergyDashboard extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<style>/* your CSS */</style><div id="root"><!-- your HTML --></div>`;
  }

  set hass(hass) {
    this._hass = hass;
    // Called automatically on every state change
    // Access states: hass.states['sensor.solar_power'].state
    // Access history via hass.connection.sendMessagePromise()
    this._update();
  }

  _update() {
    if (!this._hass) return;
    const s = id => parseFloat(this._hass.states[id]?.state) || 0;
    const ss = id => this._hass.states[id]?.state || '—';
    // Update DOM elements with current values
  }
}
customElements.define('energy-dashboard', EnergyDashboard);
```

## History queries via hass.connection
```javascript
// Get history for last 24h
const result = await this._hass.connection.sendMessagePromise({
  type: 'history/history_during_period',
  start_time: new Date(Date.now() - 24*3600*1000).toISOString(),
  entity_ids: ['sensor.solar_power', 'sensor.solis_s6_eh1p_battery_soc'],
  minimal_response: true,
  no_attributes: true,
  significant_changes_only: false
});
// result is { 'sensor.solar_power': [{state, last_changed}, ...], ... }
```

## configuration.yaml panel registration

**Superseded** — this exact block should be removed from the host's
`configuration.yaml`; the current `panel_custom` registration lives in
`ha-config/packages/tariff_period_breakdown.yaml` with a HACS-served
`module_url`. Kept here as a reference for what to delete (see `## Deploy`).

```yaml
panel_custom:
  - name: energy-dashboard
    sidebar_title: Energy
    sidebar_icon: mdi:lightning-bolt
    url_path: energy-dashboard
    module_url: /local/energy-dashboard/energy-dashboard.js
```

## Design system
- Background: #0d0f14
- Surface (cards): #13161d
- Border: rgba(255,255,255,0.06)
- Dim text: #6b7280
- Body text: #e2e8f0
- Solar: #f59e0b
- Battery: #3b82f6
- Grid import: #f97316
- Grid export / saving / accent: #22c55e
- Home load: #8b5cf6
- Cost / warning: #ef4444
- Fonts: Inter (UI), JetBrains Mono (numbers/data)

## Dashboard tabs
Three tabs, in this order. The guiding split: **Live answers "what is happening
now", History answers "what happened", Financial answers "what did it save me".**

1. **Live** — deliberately simple. Power flow (solar/grid/battery/home), battery
   state of charge, the rate in force now with the active tariff period
   highlighted, and inverter health. **No running totals** — the current rate is
   live data and belongs here, but cost/saving/arbitrage figures do not. A test
   enforces this.
2. **History** — energy today, then charts over 30 days: grid import stacked by
   tariff period, and net saving per day. Sourced from **long-term statistics**,
   not raw history (see below).
3. **Financial** — leads with the saving as an arithmetic chain
   (avoided cost − battery charge cost = net saving), then today/yesterday/
   lifetime detail, then the per-tariff-period table.

### Why History uses statistics, not history
`recorder` runs at its default `purge_keep_days: 10` — verified live, 15 days
back returns zero rows. So `history/history_during_period` cannot serve the
30-day views. `recorder/statistics_during_period` can: HA keeps hourly and daily
rollups indefinitely. `dailyDeltas()` converts a utility meter's rising `sum`
into per-day energy; `dailyMaxima()` takes the end-of-day value of a
`measurement` sensor.

### The financial model
Saving is **net**: what the battery/solar energy would have cost at the rate in
force when it was used, minus what was paid to charge. The earlier model omitted
the charge cost and overstated the daily figure by ~51%. Since this system
charges cheap at night and discharges by day (and solar is minor), the charge
term is the dominant correction — Night Boost saving is legitimately negative,
Day/Peak positive, and they net out across the day.

## Chart library
Use Chart.js 4.4.1 from cdnjs:
`<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>`

Chart defaults: dark theme, transparent background, no toolbar, borderColor rgba(255,255,255,0.04) grid, smooth curves, fill with solid opacity 0.15 for area charts.

## Deploy

Panel: distributed via HACS (custom repository, category Plugin) — see
`README.md`. After editing `energy-dashboard.js`, push the change and
either bump the version tag or use HACS's "redownload" for a dev install;
HACS handles placing the file under `/hacsfiles/HA-App/`.

Backend sensors/automations: edit
`ha-config/packages/tariff_period_breakdown.yaml` in this repo, validate
with `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml`, then,
**before** copying it to the host, edit the host's `configuration.yaml`
and delete:
- the existing template sensor blocks with `unique_id: energy_cost_today`
  and `unique_id: energy_cost_without_battery_today` — the package defines
  accurate replacements with the same `unique_id`s, and HA packages
  *merge* with the main config rather than overriding it, so leaving the
  old blocks in place means the new accurate sensors get skipped (or
  create duplicate `_2` entities) and the old inaccurate heuristic keeps
  being used everywhere downstream.
- the existing `panel_custom` block for `url_path: energy-dashboard` /
  `module_url: /local/energy-dashboard/energy-dashboard.js` (shown below
  under "configuration.yaml panel registration") — the package registers
  its own `panel_custom` entry at the same `url_path`, HA raises an error
  on a duplicate `frontend_url_path`, and there's a real risk the broken
  `/local/` entry (see "Lessons learned" below on `NS_ERROR_CORRUPTED_CONTENT`)
  wins the conflict.

- the template sensor blocks `Electricity Rate`
  (`unique_id: electricity_rate_yaml`), `Solar Value Today`
  (`unique_id: solar_value_today`) and `Grid Import Rate Breakdown` — the
  first two have accurate replacements in the package (same `unique_id`s,
  so the same merge trap applies); the third is an exact duplicate of the
  package's `sensor.current_tariff_period` and nothing references it.

Then copy the package to the HA host's `config/packages/` directory and
restart HA. The copy is manual: the REST API (see "HA API access" above) can
read state and call services but cannot write config files, so it can verify a
deploy but not perform one. Afterwards, check the HA log for `Duplicate unique_id` —
any hit means one of the blocks above is still present, and the old
inaccurate sensor is the one being used.

`sensor.solar_total_yield` is **confirmed genuinely kWh** — the unit is
declared directly on its Modbus input register (slave 1, address 72), so
`sensor.solar_daily_*`, `sensor.solar_today_kwh`, `sensor.saving_today_*`,
`sensor.energy_cost_without_battery_today` and the lifetime accumulators
fed by the nightly rollup all carry no unit ambiguity. The separate
`sensor.solar_today` UI helper is still unverified — see README.md's
"Outstanding: the `sensor.solar_today` unit", which now affects only the
yesterday figures.

## Bill validation (2026-09-05)
Four Flogas bills for meter 33080844 were reconciled against the model. This is
the only ground truth the financial figures have; prefer it over the dashboard's
own history whenever the two disagree.

| period | Day | Night | Peak | EV | bill | €/day | EV share |
|---|---|---|---|---|---|---|---|
| 01/05-28/05 | 232.3 | 56.5 | 36.3 | 25.6 | 136.02 | 4.86 | 7.3% |
| 29/05-27/06 | 178.4 | 58.6 | 20.0 | 28.3 | 115.43 | 3.85 | 9.9% |
| 28/06-28/07 | 131.9 | 36.9 | 13.2 | 193.1 | 110.46 | 3.56 | 51.5% |
| 29/07-28/08 | 25.3 | 6.8 | 2.0 | 346.3 | 85.24 | 2.75 | 91.0% |

Battery commissioned ~13/07/2026. Day-rate units collapsed 232 → 25 kWh/month.

- Feeding a bill's own registers through the package reproduces it to the cent
  (€85.23 vs €85.24 billed).
- Pricing that month against what the house would have imported without a
  battery gives **€2.46/day**; the package's model gives €2.48/day. The model
  is sound.
- `input_number.total_energy_savings` was seeded at **138.53** on 2026-09-05
  from the bills. Two earlier values (257.94, then 183.42) were derived from the
  dashboard's own statistics and were both too high — the first because saving
  was computed gross, the second because rescaling assumed all discharge was
  valued at the day rate.
- Rates rose on 20/07/2026 (visible as split lines on the 28/06-28/07 bill).
  Statistics recorded before then used the older rates and are not directly
  comparable.

## Notes
- **Home Assistant owns the data; the panel only renders it.** No tariff-period
  boundary math, no unit conversion, no rate tables in JS — anything that could
  drift gets a template sensor in the package instead. The panel's JS is
  restricted to number→string formatting.
- solar_today is in Wh (verified live) — don't use it; use
  sensor.solar_today_kwh / sensor.solar_yesterday_kwh.
- **battery_power / battery_power_net: positive = DISCHARGING**, the opposite of
  the intuitive reading. Verified live 2026-09-05: battery_power was +127 W
  while battery_discharge_power was 127, battery_charge_power 0, and SOC fell
  60% → 59%. `sensor.solis_s6_eh1p_battery_current_direction` was 1.
  **Prefer the two one-sided sensors** — `sensor.solis_s6_eh1p_battery_charge_power`
  and `sensor.solis_s6_eh1p_battery_discharge_power`, each 0 when the other is
  active — so no sign convention has to be remembered at all. The panel does this.
- grid_power_net: positive = importing, negative = exporting
- Total saving sensors backed by input_number helpers that accumulate via midnight automation
- Install date: 2026-07-13
- The hass object set() is called on EVERY state change across ALL entities — be efficient, only update DOM elements that changed

## Lessons learned from HTML panel approach (DO NOT repeat)

### Why the HTML panel approach failed
- HA's ServiceWorker intercepts `/local/` requests and corrupts them (`NS_ERROR_CORRUPTED_CONTENT`)
- `panel_custom` with `module_url` expects a JS module, not an HTML file
- `panel_iframe` was removed in HA 2024.4
- Webpage dashboard type still has ServiceWorker issues
- Browser caching + ServiceWorker = very hard to debug/update
- Every device needs a manual Long-Lived Access Token

### The correct approach: native web component
Build as `energy-dashboard.js` — a proper custom element registered with `customElements.define()`.
- Loaded by HA as a proper JS module via `module_url`
- No CORS, no token needed — runs inside HA's own JS context
- `hass` object injected automatically with full auth and state access
- History via `this._hass.connection.sendMessagePromise()`
- Updates automatically on every state change via `set hass(hass){}`
- No ServiceWorker issues — HA handles caching of its own modules correctly

### File structure
```
/config/www/energy-dashboard/
  energy-dashboard.js    ← single file, the custom element
```

### configuration.yaml
```yaml
panel_custom:
  - name: energy-dashboard
    sidebar_title: Energy
    sidebar_icon: mdi:lightning-bolt
    url_path: energy-dashboard
    module_url: /local/energy-dashboard/energy-dashboard.js
```

### Web component skeleton
```javascript
// Import Chart.js if needed - use dynamic import
// All state access via this._hass.states['sensor.xxx'].state
// All history via this._hass.connection.sendMessagePromise({type:'history/history_during_period',...})

class EnergyDashboard extends HTMLElement {
  constructor() {
    super();
    this._hass = null;
    this._initialized = false;
    this._charts = {};
    this._historyLoaded = false;
  }

  connectedCallback() {
    if (!this._initialized) {
      this._initialized = true;
      this.style.cssText = 'display:block;height:100vh;background:#0d0f14;overflow:hidden;';
      this.innerHTML = `
        <style>
          /* All CSS here — no external stylesheets needed */
          /* Use hardcoded hex values, NOT CSS variables — HA injects its own vars */
        </style>
        <div id="dashboard">
          <!-- Full dashboard HTML -->
        </div>
      `;
      this._setupTabs();
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._updateLive();
    if (!this._historyLoaded) {
      this._historyLoaded = true;
      this._loadHistory();
    }
  }

  _s(id) { return parseFloat(this._hass?.states[id]?.state) || 0; }
  _ss(id) { return this._hass?.states[id]?.state || '—'; }

  async _loadHistory() {
    const now = new Date();
    const t24 = new Date(now - 24*3600*1000).toISOString();
    const t30 = new Date(now - 30*24*3600*1000).toISOString();
    const tInstall = '2026-07-13T00:00:00+00:00';

    try {
      const [hist24, hist30, histRate] = await Promise.all([
        this._hass.connection.sendMessagePromise({
          type: 'history/history_during_period',
          start_time: t24,
          entity_ids: ['sensor.solar_power','sensor.solis_s6_eh1p_grid_power_net','sensor.solis_s6_eh1p_battery_power','sensor.solis_s6_eh1p_household_load_power','sensor.solis_s6_eh1p_battery_soc','sensor.solis_s6_eh1p_battery_voltage'],
          minimal_response: true, no_attributes: true
        }),
        this._hass.connection.sendMessagePromise({
          type: 'history/history_during_period',
          start_time: t30,
          entity_ids: ['sensor.energy_saving_today','sensor.arbitrage_profit_today','sensor.solar_value_today','sensor.energy_cost_today','sensor.energy_cost_without_battery_today','sensor.total_energy_saving'],
          minimal_response: true, no_attributes: true
        }),
        this._hass.connection.sendMessagePromise({
          type: 'history/history_during_period',
          start_time: tInstall,
          entity_ids: ['sensor.solis_s6_eh1p_grid_power_net'],
          minimal_response: true, no_attributes: true
        }),
      ]);
      this._buildCharts(hist24, hist30);
      this._buildRateBreakdown(histRate['sensor.solis_s6_eh1p_grid_power_net'] || []);
    } catch(e) {
      console.error('Energy dashboard history failed:', e);
    }
  }

  _updateLive() {
    // Update all live DOM elements using this._s() and this._ss()
  }

  _buildCharts(hist24, hist30) {
    // Build Chart.js charts
  }

  _buildRateBreakdown(gridData) {
    // Rate period analysis
    // Ireland BST = UTC+1, so local_hour = (utc_hour + 1) % 24
    // Night Boost: 02-05 local
    // Night: 23-02 & 05-08 local  
    // Day: 08-17 local
    // Peak: 17-19 local
  }

  _setupTabs() {
    // Tab switching logic
  }
}

customElements.define('energy-dashboard', EnergyDashboard);
```

### Chart.js in web component
Load Chart.js dynamically to avoid module issues:
```javascript
async _loadChartJS() {
  if (window.Chart) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
```

### CSS important note
HA injects its own CSS variables into the page. Always use hardcoded hex values in the web component, never `var(--bg)` etc, or HA's theme will override your colours. The component's own `<style>` tag inside `innerHTML` is scoped to that component and works fine.

### Deploy after changes

**Superseded** by the HACS-based deploy in `## Deploy` above; this manual
`cp` approach is no longer the active procedure, kept here as historical
context for why the web-component approach (below) was chosen over the
earlier HTML-panel approach.

```bash
cp energy-dashboard.js /srv/dev-disk-by-uuid-9f09d20d-90ff-43e0-be85-970dea1fff5c/newinstall/appdata/homeassistant/config/www/energy-dashboard/energy-dashboard.js
# Then in HA: Developer Tools → YAML → Reload Location (or full restart for first install)
```
