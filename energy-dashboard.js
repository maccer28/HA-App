const PERIODS = [
  { key: 'night_boost', label: 'Night Boost' },
  { key: 'night', label: 'Night' },
  { key: 'day', label: 'Day' },
  { key: 'peak', label: 'Peak' },
];

export const TABS = [
  { key: 'live', label: 'Live' },
  { key: 'financial', label: 'Financial' },
];

const DASH = '—';

const COLORS = {
  solar: '#f59e0b',
  battery: '#3b82f6',
  gridImport: '#f97316',
  gridExport: '#22c55e',
  home: '#8b5cf6',
  dim: '#6b7280',
};

function num(states, entityId) {
  const raw = states[entityId]?.state;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Display counterpart to num(): distinguishes "sensor is missing or
// unavailable" from "sensor genuinely reads zero", so the panel can show a
// dash instead of a plausible-looking but fictional 0.
function numOrNull(states, entityId) {
  const parsed = parseFloat(states[entityId]?.state);
  return Number.isFinite(parsed) ? parsed : null;
}

function strOrNull(states, entityId) {
  const raw = states[entityId]?.state;
  if (raw === undefined || raw === null || raw === '' || raw === 'unknown' || raw === 'unavailable') {
    return null;
  }
  return raw;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtPower(w) {
  if (w === null) return DASH;
  return Math.abs(w) < 1000 ? `${Math.trunc(w)} W` : `${(w / 1000).toFixed(2)} kW`;
}

export function fmtEnergy(kwh) {
  return kwh === null ? DASH : `${kwh.toFixed(2)} kWh`;
}

export function fmtEuro(v) {
  return v === null ? DASH : `€${v.toFixed(2)}`;
}

export function fmtNum(v, dp, unit) {
  if (v === null) return DASH;
  return unit ? `${v.toFixed(dp)} ${unit}` : v.toFixed(dp);
}

export function buildFinancialRows(states) {
  return PERIODS.map(({ key, label }) => ({
    key,
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
        `<tr class="period-${r.key}"><td>${r.period}</td><td>${euro(r.todaySaving)}</td><td>${euro(r.todayArbitrage)}</td><td>${euro(r.lifetimeSaving)}</td><td>${euro(r.lifetimeArbitrage)}</td></tr>`
    )
    .join('');
}

// ─── Live tab builders ────────────────────────────────────────────────
// Each returns plain, already-formatted data. All domain knowledge that could
// drift (tariff boundaries, the Wh/kWh conversion) lives in Home Assistant
// template sensors instead — see ha-config/packages/tariff_period_breakdown.yaml.

export function buildPowerFlow(states) {
  const solar = numOrNull(states, 'sensor.solar_power');
  const grid = numOrNull(states, 'sensor.solis_s6_eh1p_grid_power_net');
  const home = numOrNull(states, 'sensor.solis_s6_eh1p_household_load_power');

  const gridDirection = grid === null ? null : grid >= 0 ? 'Import' : 'Export';

  // The inverter exposes charge and discharge as two separate one-sided power
  // sensors, each 0 when the other is active. Reading those removes the sign
  // question on battery_power entirely — which matters, because that sign is
  // the opposite of the intuitive one: verified live on 2026-09-05,
  // battery_power read +127 W while discharge_power was 127, charge_power 0,
  // and SOC fell 60% -> 59%. Positive is DISCHARGE.
  const charge = numOrNull(states, 'sensor.solis_s6_eh1p_battery_charge_power');
  const discharge = numOrNull(states, 'sensor.solis_s6_eh1p_battery_discharge_power');

  let battery = null;
  let batteryDirection = null;
  if (charge !== null || discharge !== null) {
    const c = charge ?? 0;
    const dis = discharge ?? 0;
    if (c > 0) {
      battery = c;
      batteryDirection = 'Charging';
    } else if (dis > 0) {
      battery = dis;
      batteryDirection = 'Discharging';
    } else {
      battery = 0;
      batteryDirection = 'Idle';
    }
  }

  const directional = (value, direction) =>
    value === null ? DASH : `${fmtPower(Math.abs(value))} ${direction}`;

  return [
    {
      key: 'solar',
      label: 'Solar',
      color: solar === null ? COLORS.dim : COLORS.solar,
      value: solar,
      direction: null,
      text: fmtPower(solar),
    },
    {
      key: 'grid',
      label: 'Grid',
      color: grid === null ? COLORS.dim : grid >= 0 ? COLORS.gridImport : COLORS.gridExport,
      value: grid,
      direction: gridDirection,
      text: directional(grid, gridDirection),
    },
    {
      key: 'battery',
      label: 'Battery',
      color: battery === null ? COLORS.dim : COLORS.battery,
      value: battery,
      direction: batteryDirection,
      text: directional(battery, batteryDirection),
    },
    {
      key: 'home',
      label: 'Home',
      color: home === null ? COLORS.dim : COLORS.home,
      value: home,
      direction: null,
      text: fmtPower(home),
    },
  ];
}

const PERIOD_LABELS = Object.fromEntries(PERIODS.map(p => [p.key, p.label]));

export function buildRateNow(states) {
  const period = strOrNull(states, 'sensor.current_tariff_period');
  const isKnown = period !== null && Object.hasOwn(PERIOD_LABELS, period);
  const rate = numOrNull(states, 'sensor.electricity_rate');

  return {
    period: isKnown ? period : null,
    label: isKnown ? PERIOD_LABELS[period] : DASH,
    rateText: rate === null ? DASH : `€${rate.toFixed(4)}/kWh`,
    isKnown,
  };
}

const ENERGY_TODAY = [
  ['Solar', 'sensor.solar_today_kwh'],
  ['Battery Charged', 'sensor.solis_s6_eh1p_today_battery_charge_energy'],
  ['Battery Discharged', 'sensor.solis_s6_eh1p_today_battery_discharge_energy'],
  ['Grid Import', 'sensor.solis_s6_eh1p_today_energy_imported_from_grid'],
  ['Grid Export', 'sensor.solis_s6_eh1p_today_energy_fed_into_grid'],
  ['Home Load', 'sensor.solis_s6_eh1p_household_load_today_energy'],
];

export function buildEnergyToday(states) {
  return ENERGY_TODAY.map(([label, entityId]) => ({
    label,
    text: fmtEnergy(numOrNull(states, entityId)),
  }));
}

// [label, today, yesterday, lifetime] — lifetime is null where no such
// accumulator exists, and renders as a dash rather than a fabricated total.
const FINANCIAL_SUMMARY = [
  ['Cost', 'sensor.energy_cost_today', 'sensor.energy_cost_yesterday', null],
  [
    'Cost without battery',
    'sensor.energy_cost_without_battery_today',
    'sensor.energy_cost_without_battery_yesterday',
    null,
  ],
  ['Saving', 'sensor.energy_saving_today', 'sensor.energy_saving_yesterday', 'sensor.total_energy_saving'],
  [
    'Arbitrage',
    'sensor.arbitrage_profit_today',
    'sensor.arbitrage_profit_yesterday',
    'sensor.total_arbitrage_profit',
  ],
  ['Battery charge cost', 'sensor.battery_charge_cost_today', 'sensor.battery_charge_cost_yesterday', null],
  ['Solar value', 'sensor.solar_value_today', 'sensor.solar_value_yesterday', null],
];

export function buildFinancialSummary(states) {
  return FINANCIAL_SUMMARY.map(([label, today, yesterday, lifetime]) => ({
    label,
    today: fmtEuro(numOrNull(states, today)),
    yesterday: fmtEuro(numOrNull(states, yesterday)),
    total: lifetime === null ? DASH : fmtEuro(numOrNull(states, lifetime)),
  }));
}

const SYSTEM_STATS = [
  ['Battery SOC', 'sensor.solis_s6_eh1p_battery_soc', 1, '%'],
  ['Battery Voltage', 'sensor.solis_s6_eh1p_battery_voltage', 1, 'V'],
  ['Battery Current', 'sensor.solis_s6_eh1p_battery_current', 1, 'A'],
  ['Inverter Temp', 'sensor.solis_s6_eh1p_temperature', 1, '°C'],
  ['Grid Voltage', 'sensor.solis_s6_eh1p_a_phase_voltage', 1, 'V'],
  ['Grid Frequency', 'sensor.solis_s6_eh1p_grid_frequency', 2, 'Hz'],
];

export function buildSystemStats(states) {
  const rows = SYSTEM_STATS.map(([label, entityId, dp, unit]) => ({
    label,
    text: fmtNum(numOrNull(states, entityId), dp, unit),
  }));

  // The only free-text value on the tab, so the only one that needs escaping.
  const status = strOrNull(states, 'sensor.solis_s6_eh1p_status_string');
  rows.push({ label: 'Status', text: status === null ? DASH : esc(status) });
  return rows;
}

// ─── Live tab rendering ───────────────────────────────────────────────

export function renderTabsHTML(tabs, activeKey) {
  return tabs
    .map(
      t =>
        `<button type="button" data-tab="${t.key}" class="tab${t.key === activeKey ? ' active' : ''}">${t.label}</button>`
    )
    .join('');
}

function renderStatRowsHTML(rows) {
  return rows.map(r => `<div class="stat"><span>${r.label}</span><b>${r.text}</b></div>`).join('');
}

export function renderLiveHTML(states) {
  const flow = buildPowerFlow(states);
  const rate = buildRateNow(states);
  const energy = buildEnergyToday(states);
  const money = buildFinancialSummary(states);
  const stats = buildSystemStats(states);

  const nodes = flow
    .map(
      n =>
        `<div class="node"><span class="node-label">${n.label}</span><b class="node-value" style="color:${n.color}">${n.text}</b></div>`
    )
    .join('');

  const chips = PERIODS.map(
    p => `<span class="rate-period${rate.isKnown && rate.period === p.key ? ' active' : ''}">${p.label}</span>`
  ).join('');

  const moneyRows = money
    .map(
      r =>
        `<tr><td>${r.label}</td><td>${r.today}</td><td>${r.yesterday}</td><td>${r.total}</td></tr>`
    )
    .join('');

  return `
    <section class="card">
      <h3>Power Flow</h3>
      <div class="flow">${nodes}</div>
    </section>
    <section class="card">
      <h3>Rate Now</h3>
      <div class="rate-value">${rate.rateText}</div>
      <div class="rate-periods">${chips}</div>
    </section>
    <section class="card">
      <h3>Energy Today</h3>
      <div class="stats">${renderStatRowsHTML(energy)}</div>
    </section>
    <section class="card">
      <h3>Financial</h3>
      <table>
        <thead><tr><th>Metric</th><th>Today</th><th>Yesterday</th><th>Lifetime</th></tr></thead>
        <tbody>${moneyRows}</tbody>
      </table>
    </section>
    <section class="card">
      <h3>System</h3>
      <div class="stats">${renderStatRowsHTML(stats)}</div>
    </section>
  `;
}

if (typeof HTMLElement !== 'undefined') {
  class EnergyDashboard extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._initialized = false;
      this._activeTab = 'live';
      this._renderedTab = null;
    }

    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;
      this.style.cssText = 'display:block;height:100vh;background:#0d0f14;color:#e2e8f0;font-family:Inter,sans-serif;overflow:auto;';
      // Hardcoded hex throughout, never CSS variables — HA injects its own
      // theme variables into the page and would override them.
      this.innerHTML = `
        <style>
          #tabs { display: flex; gap: 4px; padding: 12px 16px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
          .tab { background: none; border: none; border-bottom: 2px solid transparent; color: #6b7280; font: 500 14px Inter, sans-serif; padding: 8px 14px; cursor: pointer; }
          .tab.active { color: #e2e8f0; border-bottom-color: #22c55e; }
          .panel { padding: 16px; }
          .panel[hidden] { display: none; }
          h2 { font-weight: 600; margin: 0 0 12px; }
          h3 { color: #6b7280; font: 500 12px Inter, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 12px; }
          .card { background: #13161d; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 16px; margin-bottom: 12px; max-width: 720px; }
          table { border-collapse: collapse; width: 100%; max-width: 640px; }
          th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-family: 'JetBrains Mono', monospace; font-size: 14px; }
          th { color: #6b7280; font-family: Inter, sans-serif; font-weight: 500; }
          .period-night_boost td:first-child, .period-night td:first-child { border-left: 3px solid #3b82f6; }
          .period-day td:first-child { border-left: 3px solid #f59e0b; }
          .period-peak td:first-child { border-left: 3px solid #ef4444; }
          .flow { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
          .node { display: flex; flex-direction: column; gap: 4px; }
          .node-label { color: #6b7280; font-size: 12px; }
          .node-value { font: 600 18px 'JetBrains Mono', monospace; }
          .rate-value { font: 600 28px 'JetBrains Mono', monospace; margin-bottom: 12px; }
          .rate-periods { display: flex; flex-wrap: wrap; gap: 6px; }
          .rate-period { border: 1px solid rgba(255,255,255,0.06); border-radius: 999px; color: #6b7280; font-size: 12px; padding: 4px 12px; }
          .rate-period.active { background: rgba(34,197,94,0.15); border-color: #22c55e; color: #22c55e; }
          .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 20px; }
          .stat { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px; }
          .stat span { color: #6b7280; font-size: 13px; }
          .stat b { font: 500 14px 'JetBrains Mono', monospace; }
        </style>
        <div id="tabs"></div>
        <div id="panel-live" class="panel"></div>
        <div id="panel-financial" class="panel">
          <h2>Financial &mdash; Savings by Tariff Period</h2>
          <table>
            <thead>
              <tr><th>Period</th><th>Today Saving</th><th>Today Arbitrage</th><th>Lifetime Saving</th><th>Lifetime Arbitrage</th></tr>
            </thead>
            <tbody id="financial-body"></tbody>
          </table>
        </div>
      `;
      // Delegated, so the listener survives the tab strip being re-rendered.
      this.querySelector('#tabs').addEventListener('click', e => {
        const key = e.target.closest('[data-tab]')?.dataset.tab;
        if (!key || key === this._activeTab) return;
        this._activeTab = key;
        this._render();
      });
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._initialized) this.connectedCallback();
      this._render();
    }

    _render() {
      const states = this._hass?.states || {};
      const live = this.querySelector('#panel-live');
      const financial = this.querySelector('#panel-financial');
      if (!live || !financial) return;

      // hass is set on every state change system-wide, so only touch the tab
      // strip when the selection actually moved.
      if (this._renderedTab !== this._activeTab) {
        this._renderedTab = this._activeTab;
        this.querySelector('#tabs').innerHTML = renderTabsHTML(TABS, this._activeTab);
        live.hidden = this._activeTab !== 'live';
        financial.hidden = this._activeTab !== 'financial';
      }

      if (this._activeTab === 'live') {
        live.innerHTML = renderLiveHTML(states);
      } else {
        this.querySelector('#financial-body').innerHTML = renderRowsHTML(buildFinancialRows(states));
      }
    }
  }

  customElements.define('energy-dashboard', EnergyDashboard);
}
