# Energy Dashboard — Custom HA Panel

## What this is
A custom Home Assistant frontend panel built as a native web component.
No token required. Runs in HA's JS context with full access to `hass` object.

## System details
- **HA host**: https://ha.ma33er.xyz / 192.168.1.240
- **Config path**: /srv/dev-disk-by-uuid-9f09d20d-90ff-43e0-be85-970dea1fff5c/newinstall/appdata/homeassistant/config/
- **Panel file**: config/www/energy-dashboard/energy-dashboard.js
- **Inverter**: Solis S6-EH1P (1-Phase LV Hybrid, Protocol 33, Modbus via waveshare bridge at 192.168.1.254:502)
- **Battery**: Lithtech TR8500WX — 51.2V nominal, 314Ah, 16.076kWh, Max charge/discharge 200A
- **Solar**: AC-coupled, separate Modbus inverter on waveshare bridge slave 1
- **Tariff**: Bord Gais EV Smart — Night Boost 02:00-05:00 €0.0824, Night 23:00-08:00 €0.2438, Day 08:00-17:00 €0.3233, Peak 17:00-19:00 €0.4508, Standing €0.9164/day

## Key sensors
### Live power
- sensor.solar_power — solar AC output watts
- sensor.solis_s6_eh1p_grid_power_net — grid W (positive=import, negative=export)
- sensor.solis_s6_eh1p_battery_power — battery W
- sensor.solis_s6_eh1p_battery_power_net — battery W net
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

### Energy yesterday
- sensor.solis_s6_eh1p_yesterday_energy_imported_from_grid
- sensor.solis_s6_eh1p_yesterday_battery_charge_energy
- sensor.solis_s6_eh1p_yesterday_battery_discharge_energy
- sensor.solis_s6_eh1p_yesterday_energy_consumption
- sensor.solar_today_previous_period — yesterday solar kWh

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
1. **Live** — power flow (solar/grid/battery/home nodes), rate now with period highlight, today/yesterday/totals financial grid, system stats (temp/voltage/current/grid V/Hz/status), energy today grid (no bars — just numbers)
2. **Solar & Battery** — 24h power flow area chart, 7d daily energy bar chart, 24h SOC area chart, 24h battery voltage line, 24h battery current area, 24h inverter temp area
3. **Financial** — total saving growth line chart (60d), daily breakdown bar chart (30d: cost/no-battery/saving/arbitrage/charge cost/solar value), daily saving trend (30d), avg daily saving line (30d)
4. **Totals** — 8 summary tiles (total saving, proj annual, avg/day, days running, total arbitrage, solar total, total charged, current rate), 30d cost breakdown bar chart

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
with `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml`, then
copy it to the HA host's `config/packages/` directory and restart HA (this
repo has no network access to the HA host, so this copy step is manual).

## Notes
- solar_today is in Wh not kWh — divide by 1000 when displaying
- battery_power_net sign: check carefully, may need inversion depending on charge/discharge direction
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
```bash
cp energy-dashboard.js /srv/dev-disk-by-uuid-9f09d20d-90ff-43e0-be85-970dea1fff5c/newinstall/appdata/homeassistant/config/www/energy-dashboard/energy-dashboard.js
# Then in HA: Developer Tools → YAML → Reload Location (or full restart for first install)
```
