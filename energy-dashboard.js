const PERIODS = [
  { key: 'night_boost', label: 'Night Boost' },
  { key: 'night', label: 'Night' },
  { key: 'day', label: 'Day' },
  { key: 'peak', label: 'Peak' },
];

export const TABS = [
  { key: 'live', label: 'Live' },
  { key: 'history', label: 'History' },
  { key: 'financial', label: 'Financial' },
];

const DASH = '—';

// The saving model changed here; statistics before this date use the old,
// inflated calculation and are not comparable with what follows.
const MODEL_CHANGE_DATE = '2026-09-05';

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


export function buildBatteryStatus(states) {
  return {
    soc: numOrNull(states, 'sensor.solis_s6_eh1p_battery_soc'),
    socText: fmtNum(numOrNull(states, 'sensor.solis_s6_eh1p_battery_soc'), 0, '%'),
    sohText: fmtNum(numOrNull(states, 'sensor.solis_s6_eh1p_battery_soh'), 0, '%'),
    voltText: fmtNum(numOrNull(states, 'sensor.solis_s6_eh1p_battery_voltage'), 1, 'V'),
    currText: fmtNum(numOrNull(states, 'sensor.solis_s6_eh1p_battery_current'), 1, 'A'),
  };
}

// The money story as an arithmetic chain rather than one opaque total: what
// the battery/solar energy would have cost, minus what was paid to store it.
const MONEY_CHAIN = [
  ['Avoided cost', 'sensor.energy_avoided_cost_today', 'sensor.energy_avoided_cost_yesterday', '+'],
  ['Battery charge cost', 'sensor.battery_charge_cost_today', 'sensor.battery_charge_cost_yesterday', '\u2212'],
  ['Net saving', 'sensor.energy_saving_today', 'sensor.energy_saving_yesterday', '='],
];

export function buildMoneyChain(states) {
  return MONEY_CHAIN.map(([label, today, yesterday, op]) => ({
    label,
    op,
    today: fmtEuro(numOrNull(states, today)),
    yesterday: fmtEuro(numOrNull(states, yesterday)),
  }));
}

// ─── History (long-term statistics) ───────────────────────────────────
// Raw recorder history is purged after ~10 days on this system, so anything
// longer has to come from HA's long-term statistics, which are kept forever.

export const HISTORY_ENERGY_IDS = [
  'sensor.grid_import_daily_night_boost',
  'sensor.grid_import_daily_night',
  'sensor.grid_import_daily_day',
  'sensor.grid_import_daily_peak',
];

export const HISTORY_MONEY_IDS = [
  'sensor.energy_saving_today',
  'sensor.energy_avoided_cost_today',
  'sensor.battery_charge_cost_today',
];

export function statisticsRequest(statisticIds, days, types, now = new Date()) {
  const start = new Date(now.getTime() - days * 86400000);
  return {
    type: 'recorder/statistics_during_period',
    start_time: start.toISOString(),
    end_time: now.toISOString(),
    statistic_ids: statisticIds,
    period: 'day',
    types,
  };
}

// HA returns `start` as epoch milliseconds, not an ISO string. Slicing it as
// text produced raw epoch numbers on the chart axis. Days are bucketed in local
// time by the recorder, so format in local time to match.
function dayKey(row) {
  const raw = row?.start;
  const d = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : day;
}

// Days before the model change recorded saving GROSS -- without subtracting
// what was paid to charge the battery. battery_charge_cost_today has statistics
// covering the same period, so the whole series can be put on a net basis
// rather than left with an artificial cliff on the changeover date.
// The changeover day itself is dropped. Its statistic is the maximum the
// sensor reached that day, which spans both models AND the meter reset that
// came with the restart — measured on 2026-09-05, the stored max was 3.19
// while the sensor's actual corrected value for the day was 0.48. That day
// cannot be reconstructed from either model, so plotting it at all would show
// a figure that is simply wrong, permanently, every time the chart is drawn.
export function correctedNetSaving(savingRows, chargeRows, cutoffDay = MODEL_CHANGE_DATE) {
  const charge = new Map(dailyMaxima(chargeRows).map(p => [p.day, p.value]));
  return dailyMaxima(savingRows)
    .filter(({ day }) => day !== cutoffDay)
    .map(({ day, value }) => ({
      day,
      value: day < cutoffDay ? Number((value - (charge.get(day) ?? 0)).toFixed(2)) : value,
      corrected: day < cutoffDay,
    }));
}

// utility_meter statistics carry a monotonically rising `sum` that continues
// across the daily reset, so a day's energy is the rise in that sum. The first
// row has no predecessor and is dropped rather than reported as its own total.
export function dailyDeltas(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  let prev = null;
  for (const row of rows) {
    const sum = Number(row?.sum);
    if (!Number.isFinite(sum)) continue;
    if (prev !== null) out.push({ day: dayKey(row), value: Math.max(0, sum - prev) });
    prev = sum;
  }
  return out;
}

// Financial sensors are state_class measurement, so statistics store max per
// period. These climb from 0 each day, making the daily max the end-of-day value.
export function dailyMaxima(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => Number.isFinite(Number(r?.max)))
    .map(r => ({ day: dayKey(r), value: Number(r.max) }));
}

// Union of every day present across the series, so a sensor that was missing
// for a day leaves a gap rather than silently shifting later days left.
export function alignSeries(seriesByKey) {
  const days = [...new Set(Object.values(seriesByKey).flat().map(p => p.day))].sort();
  const datasets = {};
  for (const [key, points] of Object.entries(seriesByKey)) {
    const byDay = new Map(points.map(p => [p.day, p.value]));
    datasets[key] = days.map(d => (byDay.has(d) ? byDay.get(d) : null));
  }
  return { days, datasets };
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
  const batt = buildBatteryStatus(states);
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

  const pct = batt.soc === null ? 0 : Math.max(0, Math.min(100, batt.soc));

  return `
    <section class="card">
      <h3>Power Flow</h3>
      <div class="flow">${nodes}</div>
    </section>
    <section class="card">
      <h3>Battery</h3>
      <div class="soc-row">
        <div class="soc-bar"><div class="soc-fill" style="width:${pct}%"></div></div>
        <b class="soc-value">${batt.socText}</b>
      </div>
      <div class="stats">
        <div class="stat"><span>Voltage</span><b>${batt.voltText}</b></div>
        <div class="stat"><span>Current</span><b>${batt.currText}</b></div>
        <div class="stat"><span>Health</span><b>${batt.sohText}</b></div>
      </div>
    </section>
    <section class="card">
      <h3>Rate Now</h3>
      <div class="rate-value">${rate.rateText}</div>
      <div class="rate-periods">${chips}</div>
    </section>
    <section class="card">
      <h3>System</h3>
      <div class="stats">${renderStatRowsHTML(stats)}</div>
    </section>
  `;
}

export function renderFinancialHTML(states) {
  const chain = buildMoneyChain(states);
  const summary = buildFinancialSummary(states);
  const periods = buildFinancialRows(states);

  const chainRows = chain
    .map(
      r =>
        `<tr class="${r.op === '=' ? 'chain-total' : ''}"><td class="chain-op">${r.op}</td><td>${r.label}</td><td>${r.today}</td><td>${r.yesterday}</td></tr>`
    )
    .join('');

  const summaryRows = summary
    .map(r => `<tr><td>${r.label}</td><td>${r.today}</td><td>${r.yesterday}</td><td>${r.total}</td></tr>`)
    .join('');

  return `
    <section class="card">
      <h3>How the saving is made</h3>
      <table>
        <thead><tr><th></th><th>Metric</th><th>Today</th><th>Yesterday</th></tr></thead>
        <tbody>${chainRows}</tbody>
      </table>
      <p class="note">Avoided cost is what the energy your battery and solar supplied would have cost at the rate in force when you used it. Subtracting what you paid to charge gives the net saving.</p>
    </section>
    <section class="card">
      <h3>Detail</h3>
      <table>
        <thead><tr><th>Metric</th><th>Today</th><th>Yesterday</th><th>Lifetime</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </section>
    <section class="card">
      <h3>By tariff period</h3>
      <table>
        <thead><tr><th>Period</th><th>Today Saving</th><th>Today Arbitrage</th><th>Lifetime Saving</th><th>Lifetime Arbitrage</th></tr></thead>
        <tbody>${renderRowsHTML(periods)}</tbody>
      </table>
      <p class="note">Night Boost is normally negative &mdash; energy goes in and none comes out. Day and Peak are where it is paid back.</p>
    </section>
  `;
}

export function renderHistoryHTML(states) {
  return `
    <section class="card">
      <h3>Energy today</h3>
      <div class="stats">${renderStatRowsHTML(buildEnergyToday(states))}</div>
    </section>
    <section class="card">
      <h3>Grid import by tariff &mdash; last 30 days</h3>
      <div class="chart"><canvas id="chart-import"></canvas></div>
    </section>
    <section class="card">
      <h3>Net saving per day &mdash; last 30 days</h3>
      <div class="chart"><canvas id="chart-saving"></canvas></div>
      <p class="note" id="saving-caveat" hidden>Days before ${MODEL_CHANGE_DATE} were recorded gross, without subtracting what was paid to charge the battery. They are corrected here by subtracting that day&rsquo;s recorded charge cost, so the whole series is on the same net basis &mdash; the stored history itself is unchanged. ${MODEL_CHANGE_DATE} itself is omitted: its recorded figure spans both models and the meter reset, so it cannot be reconstructed.</p>
    </section>
    <p class="note" id="history-note">Loading statistics&hellip;</p>
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
      this._historyRendered = false;
      this._charts = {};
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
          .soc-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
          .soc-bar { flex: 1; height: 10px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden; }
          .soc-fill { height: 100%; background: #3b82f6; border-radius: 999px; }
          .soc-value { font: 600 20px 'JetBrains Mono', monospace; min-width: 64px; text-align: right; }
          .chart { position: relative; height: 260px; }
          .note { color: #6b7280; font-size: 12px; line-height: 1.5; margin: 12px 0 0; max-width: 720px; }
          .note.warn { color: #f59e0b; }
          .chart-empty { display: flex; align-items: center; justify-content: center; text-align: center; color: #6b7280; font-size: 13px; padding: 0 24px; }
          .chain-op { color: #6b7280; width: 1.5em; font-family: 'JetBrains Mono', monospace; }
          .chain-total td { border-top: 1px solid rgba(255,255,255,0.18); font-weight: 600; color: #22c55e; }
        </style>
        <div id="tabs"></div>
        <div id="panel-live" class="panel"></div>
        <div id="panel-history" class="panel"></div>
        <div id="panel-financial" class="panel"></div>
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
      const panels = {
        live: this.querySelector('#panel-live'),
        history: this.querySelector('#panel-history'),
        financial: this.querySelector('#panel-financial'),
      };
      if (!panels.live) return;

      // hass is set on every state change system-wide, so only touch the tab
      // strip when the selection actually moved.
      if (this._renderedTab !== this._activeTab) {
        this._renderedTab = this._activeTab;
        this.querySelector('#tabs').innerHTML = renderTabsHTML(TABS, this._activeTab);
        for (const [key, el] of Object.entries(panels)) el.hidden = key !== this._activeTab;
      }

      if (this._activeTab === 'live') {
        panels.live.innerHTML = renderLiveHTML(states);
      } else if (this._activeTab === 'financial') {
        panels.financial.innerHTML = renderFinancialHTML(states);
      } else if (this._activeTab === 'history') {
        // Charts own their canvases, so only rebuild the shell once — a
        // re-render on every state change would destroy them continuously.
        if (!this._historyRendered) {
          this._historyRendered = true;
          panels.history.innerHTML = renderHistoryHTML(states);
          this._loadHistory();
        }
      }
    }

    async _loadChartJS() {
      if (window.Chart) return;
      if (!this._chartPromise) {
        this._chartPromise = new Promise((resolve, reject) => {
          const el = document.createElement('script');
          el.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
          el.onload = resolve;
          el.onerror = () => reject(new Error('Chart.js failed to load'));
          document.head.appendChild(el);
        });
      }
      await this._chartPromise;
    }

    async _loadHistory() {
      const note = () => this.querySelector('#history-note');
      try {
        await this._loadChartJS();
        const [energy, money] = await Promise.all([
          this._hass.connection.sendMessagePromise(
            statisticsRequest(HISTORY_ENERGY_IDS, 30, ['sum'])
          ),
          this._hass.connection.sendMessagePromise(
            statisticsRequest(HISTORY_MONEY_IDS, 30, ['max'])
          ),
        ]);

        const importSeries = {};
        for (const id of HISTORY_ENERGY_IDS) {
          importSeries[PERIOD_LABELS[id.replace('sensor.grid_import_daily_', '')]] = dailyDeltas(energy?.[id]);
        }
        const importAligned = alignSeries(importSeries);
        if (importAligned.days.length) {
          this._drawStacked('chart-import', importAligned, 'kWh');
        } else {
          this._empty(
            'chart-import',
            'No daily statistics yet. The per-tariff meters start accumulating from their first full day, so this fills in one day at a time.'
          );
        }

        const savingAligned = alignSeries({
          'Net saving': correctedNetSaving(
            money?.['sensor.energy_saving_today'],
            money?.['sensor.battery_charge_cost_today']
          ),
        });
        if (savingAligned.days.length) {
          this._drawBars('chart-saving', savingAligned, '\u20ac');
          const warn = this.querySelector('#saving-caveat');
          if (warn) warn.hidden = false;
        } else {
          this._empty('chart-saving', 'No daily statistics yet.');
        }

        const n = note();
        if (n) n.textContent = 'From Home Assistant long-term statistics. Raw history on this system is purged after ~10 days, so these are the daily rollups, which are kept indefinitely.';
      } catch (e) {
        console.error('Energy dashboard history failed:', e);
        const n = note();
        if (n) n.textContent = `Could not load statistics: ${e.message}`;
      }
    }

    _chartBase(labels, datasets, unit) {
      return {
        type: 'bar',
        data: { labels: labels.map(formatDayLabel), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#e2e8f0', boxWidth: 12 } } },
          scales: {
            x: { stacked: true, ticks: { color: '#6b7280', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { stacked: true, ticks: { color: '#6b7280', callback: v => `${v}${unit === '\u20ac' ? '' : ' '}${unit}` }, grid: { color: 'rgba(255,255,255,0.04)' } },
          },
        },
      };
    }

    _drawStacked(canvasId, { days, datasets }, unit) {
      const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];
      const sets = Object.entries(datasets).map(([label, data], i) => ({
        label, data, backgroundColor: colors[i % colors.length],
      }));
      this._mount(canvasId, this._chartBase(days, sets, unit));
    }

    _drawBars(canvasId, { days, datasets }, unit) {
      const sets = Object.entries(datasets).map(([label, data]) => ({
        label,
        data,
        backgroundColor: data.map(v => (v < 0 ? '#ef4444' : '#22c55e')),
      }));
      this._mount(canvasId, this._chartBase(days, sets, unit));
    }

    // A chart with no rows renders as an empty grid, which reads as broken
    // rather than as "this metric has no history yet". Say which it is.
    _empty(canvasId, message) {
      const canvas = this.querySelector(`#${canvasId}`);
      if (!canvas) return;
      const box = canvas.parentElement;
      box.classList.add('chart-empty');
      box.textContent = message;
    }

    _mount(canvasId, config) {
      const canvas = this.querySelector(`#${canvasId}`);
      if (!canvas) return;
      this._charts = this._charts || {};
      this._charts[canvasId]?.destroy();
      this._charts[canvasId] = new window.Chart(canvas, config);
    }
  }

  customElements.define('energy-dashboard', EnergyDashboard);
}
