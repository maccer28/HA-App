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

// Price ladder: cheap -> expensive. Used ONLY in tariff contexts, never
// alongside the flow colours below, so the two systems never compete.
const TARIFF = {'night_boost': '#14b8a6', 'night': '#6366f1', 'day': '#f0a12e', 'peak': '#ef4a5a'};

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

// Every real energy flow the inverter and CT meter report, today / yesterday /
// lifetime. Lifetime grid figures use the CT meter's readings rather than the
// inverter's whole-kWh integer counters, because they carry 2 decimal places.
// A null column means no sensor exists for that combination and renders as a
// dash rather than a fabricated zero.
const ENERGY_FLOWS = [
  ['Solar', 'sensor.solar_today_kwh', 'sensor.solar_yesterday_kwh', 'sensor.solar_total_yield'],
  [
    'Grid import',
    'sensor.solis_s6_eh1p_today_energy_imported_from_grid',
    'sensor.solis_s6_eh1p_yesterday_energy_imported_from_grid',
    'sensor.solis_s6_eh1p_meter_total_active_energy_from_grid',
  ],
  [
    'Grid export',
    'sensor.solis_s6_eh1p_today_energy_fed_into_grid',
    'sensor.solis_s6_eh1p_yesterday_energy_fed_into_grid',
    'sensor.solis_s6_eh1p_meter_total_active_energy_to_grid',
  ],
  [
    'Battery charged',
    'sensor.solis_s6_eh1p_today_battery_charge_energy',
    'sensor.solis_s6_eh1p_yesterday_battery_charge_energy',
    'sensor.solis_s6_eh1p_total_battery_charge_energy',
  ],
  [
    'Battery discharged',
    'sensor.solis_s6_eh1p_today_battery_discharge_energy',
    'sensor.solis_s6_eh1p_yesterday_battery_discharge_energy',
    'sensor.solis_s6_eh1p_total_battery_discharge_energy',
  ],
  [
    'Home load',
    'sensor.solis_s6_eh1p_household_load_today_energy',
    'sensor.solis_s6_eh1p_yesterday_energy_consumption',
    'sensor.solis_s6_eh1p_household_load_total_energy',
  ],
  [
    'Backup load',
    'sensor.solis_s6_eh1p_backup_load_today_energy',
    null,
    'sensor.solis_s6_eh1p_backup_load_total_energy',
  ],
];

export function buildEnergyTable(states) {
  const cell = id => (id === null ? DASH : fmtEnergy(numOrNull(states, id)));
  return ENERGY_FLOWS.map(([label, today, yesterday, lifetime]) => ({
    label,
    today: cell(today),
    yesterday: cell(yesterday),
    lifetime: cell(lifetime),
  }));
}

const PERIOD_TOTALS = [
  ['Home load', 'sensor.solis_s6_eh1p_household_load_month_energy', 'sensor.solis_s6_eh1p_household_load_year_energy'],
  ['Backup load', 'sensor.solis_s6_eh1p_backup_load_month_energy', 'sensor.solis_s6_eh1p_backup_load_year_energy'],
];

export function buildPeriodTotals(states) {
  return PERIOD_TOTALS.map(([label, month, year]) => ({
    label,
    month: fmtEnergy(numOrNull(states, month)),
    year: fmtEnergy(numOrNull(states, year)),
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

export const HISTORY_BATTERY_IDS = [
  'sensor.battery_charge_daily_night_boost',
  'sensor.battery_charge_daily_night',
  'sensor.battery_charge_daily_day',
  'sensor.battery_charge_daily_peak',
  'sensor.battery_discharge_daily_night_boost',
  'sensor.battery_discharge_daily_night',
  'sensor.battery_discharge_daily_day',
  'sensor.battery_discharge_daily_peak',
];

// Charge and discharge summed across tariff periods, per day. The gap between
// them is round-trip loss plus any change in stored energy across midnight.
export function batteryCycleSeries(result) {
  const sumOf = prefix => {
    const totals = new Map();
    for (const [id, rows] of Object.entries(result || {})) {
      if (!id.startsWith(prefix)) continue;
      for (const { day, value } of dailyDeltas(rows)) {
        totals.set(day, Number(((totals.get(day) ?? 0) + value).toFixed(3)));
      }
    }
    return [...totals].map(([day, value]) => ({ day, value }));
  };
  return {
    Charged: sumOf('sensor.battery_charge_daily_'),
    Discharged: sumOf('sensor.battery_discharge_daily_'),
  };
}

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

// ─── Tariff ribbon (the signature element) ────────────────────────────
// The day drawn as proportional price bands. The schedule comes from
// sensor.current_tariff_period's `hours` attribute so the boundaries live in
// exactly one place (the HA package), not in a fifth copy here.

export function ribbonSegments(hours) {
  if (!Array.isArray(hours) || hours.length !== 24) return [];
  const out = [];
  for (let h = 0; h < 24; h++) {
    const last = out[out.length - 1];
    if (last && last.key === hours[h]) last.span += 1;
    else out.push({ key: hours[h], start: h, span: 1 });
  }
  return out.map(seg => ({ ...seg, pct: (seg.span / 24) * 100 }));
}

export function buildTariffRibbon(states, now = new Date()) {
  const attrs = states['sensor.current_tariff_period']?.attributes || {};
  const rates = attrs.rates || {};
  const segments = ribbonSegments(attrs.hours).map(seg => ({
    ...seg,
    label: PERIOD_LABELS[seg.key] || seg.key,
    rate: rates[seg.key] ?? null,
  }));
  const rate = numOrNull(states, 'sensor.electricity_rate');
  const active = strOrNull(states, 'sensor.current_tariff_period');
  const isKnown = active !== null && Object.hasOwn(PERIOD_LABELS, active);
  return {
    segments,
    activeKey: isKnown ? active : null,
    label: isKnown ? PERIOD_LABELS[active] : DASH,
    rate,
    rateText: rate === null ? DASH : rate.toFixed(4),
    // Fraction of the day elapsed, for the "now" marker.
    nowPct: ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100,
  };
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

function ribbonHTML(r) {
  const segs = r.segments
    .map(
      s =>
        `<span class="seg${r.activeKey === s.key ? ' on' : ''}" style="width:${s.pct}%;background:${TARIFF[s.key] || '#3a4150'}" title="${s.label}"></span>`
    )
    .join('');
  const ticks = r.segments
    .filter(s => s.start !== 0)
    .map(s => `<span class="tick" style="left:${(s.start / 24) * 100}%">${String(s.start).padStart(2, '0')}</span>`)
    .join('');
  const marker = `<span class="now" style="left:${r.nowPct}%"></span>`;
  return `<div class="ribbon">${segs}${marker}</div><div class="ticks">${ticks}</div>`;
}

export function renderLiveHTML(states, now = new Date()) {
  const r = buildTariffRibbon(states, now);
  const flow = buildPowerFlow(states);
  const batt = buildBatteryStatus(states);
  const stats = buildSystemStats(states);
  const accent = r.activeKey ? TARIFF[r.activeKey] : '#7d8797';
  const pct = batt.soc === null ? 0 : Math.max(0, Math.min(100, batt.soc));

  const nodes = flow
    .map(
      n => `<div class="node">
        <span class="k">${n.label}</span>
        <b class="v" style="color:${n.color}">${n.text}</b>
      </div>`
    )
    .join('');

  return `
    <section class="hero">
      <span class="eyebrow" style="color:${accent}">${r.label}</span>
      <div class="rate"><span class="cur">€</span>${r.rateText}<span class="per">/kWh</span></div>
      ${ribbonHTML(r)}
    </section>
    <section class="card">
      <h3>Power</h3>
      <div class="grid4">${nodes}</div>
    </section>
    <section class="card">
      <h3>Battery</h3>
      <div class="soc"><div class="soc-bar"><i style="width:${pct}%"></i></div><b>${batt.socText}</b></div>
      <dl class="pairs">
        <div><dt>Voltage</dt><dd>${batt.voltText}</dd></div>
        <div><dt>Current</dt><dd>${batt.currText}</dd></div>
        <div><dt>Health</dt><dd>${batt.sohText}</dd></div>
      </dl>
    </section>
    <section class="card">
      <h3>System</h3>
      <dl class="pairs">${stats.map(x => `<div><dt>${x.label}</dt><dd>${x.text}</dd></div>`).join('')}</dl>
    </section>
  `;
}

function tableHTML(head, rows) {
  return `<div class="scroll"><table>
    <thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export function renderHistoryHTML(states) {
  const energy = buildEnergyTable(states)
    .map(r => `<tr><th scope="row">${r.label}</th><td class="num">${r.today}</td><td class="num">${r.yesterday}</td><td class="num">${r.lifetime}</td></tr>`)
    .join('');
  const totals = buildPeriodTotals(states)
    .map(r => `<tr><th scope="row">${r.label}</th><td class="num">${r.month}</td><td class="num">${r.year}</td></tr>`)
    .join('');

  return `
    <section class="card">
      <h3>Energy</h3>
      ${tableHTML(['Flow', 'Today', 'Yesterday', 'Lifetime'], energy)}
    </section>
    <section class="card">
      <h3>Longer run</h3>
      ${tableHTML(['Flow', 'This month', 'This year'], totals)}
    </section>
    <section class="card">
      <h3>Grid import by tariff <em>30 days</em></h3>
      <div class="chart"><canvas id="chart-import"></canvas></div>
    </section>
    <section class="card">
      <h3>Battery cycled <em>30 days</em></h3>
      <div class="chart"><canvas id="chart-battery"></canvas></div>
      <p class="note">The gap between charged and discharged is round-trip loss plus whatever stayed in the battery overnight.</p>
    </section>
    <section class="card">
      <h3>Net saving per day <em>30 days</em></h3>
      <div class="chart"><canvas id="chart-saving"></canvas></div>
      <p class="note" id="saving-caveat" hidden>Days before ${MODEL_CHANGE_DATE} were recorded gross, before charge cost was subtracted; they are corrected here using that day&rsquo;s recorded charge cost. ${MODEL_CHANGE_DATE} itself is omitted &mdash; its figure spans both models and the meter reset, so it cannot be reconstructed.</p>
    </section>
    <p class="note" id="history-note">Loading statistics&hellip;</p>
  `;
}

export function renderFinancialHTML(states) {
  const chain = buildMoneyChain(states)
    .map(r => `<tr class="${r.op === '=' ? 'sum' : ''}"><td class="op">${r.op}</td><th scope="row">${r.label}</th><td class="num">${r.today}</td><td class="num">${r.yesterday}</td></tr>`)
    .join('');
  const detail = buildFinancialSummary(states)
    .map(r => `<tr><th scope="row">${r.label}</th><td class="num">${r.today}</td><td class="num">${r.yesterday}</td><td class="num">${r.total}</td></tr>`)
    .join('');
  const periods = buildFinancialRows(states)
    .map(
      r => `<tr><th scope="row"><span class="dot" style="background:${TARIFF[r.key]}"></span>${r.period}</th>
        <td class="num">${fmtEuro(r.todaySaving)}</td><td class="num">${fmtEuro(r.todayArbitrage)}</td>
        <td class="num">${fmtEuro(r.lifetimeSaving)}</td><td class="num">${fmtEuro(r.lifetimeArbitrage)}</td></tr>`
    )
    .join('');

  return `
    <section class="card">
      <h3>How the saving is made</h3>
      ${tableHTML(['', 'Metric', 'Today', 'Yesterday'], chain)}
      <p class="note">Avoided cost is what the energy your battery and solar supplied would have cost at the rate in force when you used it. Take off what you paid to charge, and what is left is the saving.</p>
    </section>
    <section class="card">
      <h3>Detail</h3>
      ${tableHTML(['Metric', 'Today', 'Yesterday', 'Lifetime'], detail)}
    </section>
    <section class="card">
      <h3>By tariff period</h3>
      ${tableHTML(['Period', 'Saving today', 'Arbitrage today', 'Saving lifetime', 'Arbitrage lifetime'], periods)}
      <p class="note">Night Boost runs negative by design &mdash; energy goes in and none comes out. Day and Peak are where it comes back.</p>
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
      this._historyRendered = false;
      this._charts = {};
    }

    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;
      this.style.cssText = 'display:block;min-height:100vh;background:#0b0e14;color:#e6ebf2;font-family:Inter,system-ui,-apple-system,sans-serif;overflow-x:hidden;';
      // Hardcoded hex throughout, never CSS variables — HA injects its own
      // theme variables into the page and would override them.
      this.innerHTML = `
        <style>
          /* Instrument-panel aesthetic: the numbers are the typography. Hardcoded
             hex throughout — HA injects its own CSS variables and would win. */
          #dashboard { max-width: 980px; margin: 0 auto; padding: 0 0 40px; }
          #dashboard *, #dashboard *::before, #dashboard *::after { box-sizing: border-box; }

          #tabs {
            position: sticky; top: 0; z-index: 5; display: flex; gap: 2px;
            padding: 6px 12px 0; background: rgba(11,14,20,0.92);
            backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255,255,255,0.06);
            overflow-x: auto; scrollbar-width: none;
          }
          #tabs::-webkit-scrollbar { display: none; }
          .tab {
            flex: 0 0 auto; min-height: 44px; padding: 0 16px; cursor: pointer;
            background: none; border: 0; border-bottom: 2px solid transparent;
            color: #7d8797; font: 600 13px/44px Inter, system-ui, sans-serif;
            letter-spacing: 0.04em; white-space: nowrap;
          }
          .tab:hover { color: #b9c2d0; }
          .tab.active { color: #e6ebf2; border-bottom-color: #e6ebf2; }
          .tab:focus-visible { outline: 2px solid #14b8a6; outline-offset: -2px; }

          .panel { padding: 12px; display: grid; gap: 12px; }
          .panel[hidden] { display: none; }

          .hero, .card {
            background: #141922; border: 1px solid rgba(255,255,255,0.06);
            border-radius: 14px; padding: 16px;
          }
          .hero { background: linear-gradient(180deg, #171d28 0%, #12172010 100%), #141922; padding: 20px 16px 18px; }

          h3 {
            margin: 0 0 14px; color: #7d8797;
            font: 600 10px Inter, system-ui, sans-serif;
            letter-spacing: 0.18em; text-transform: uppercase;
          }
          h3 em { font-style: normal; color: #4d5666; letter-spacing: 0.08em; float: right; text-transform: none; }

          .eyebrow {
            display: block; font: 700 11px Inter, system-ui, sans-serif;
            letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 6px;
          }
          .rate {
            font: 600 clamp(40px, 13vw, 68px)/1 ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
            font-variant-numeric: tabular-nums; letter-spacing: -0.03em;
            color: #e6ebf2; margin-bottom: 18px;
          }
          .rate .cur { color: #7d8797; margin-right: 2px; }
          .rate .per { font-size: 0.3em; letter-spacing: 0.06em; color: #7d8797; margin-left: 6px; }

          /* The signature: the day as proportional price bands. */
          .ribbon { position: relative; display: flex; height: 14px; border-radius: 7px; overflow: hidden; }
          .ribbon .seg { display: block; height: 100%; opacity: 0.42; transition: opacity 0.3s ease; }
          .ribbon .seg.on { opacity: 1; }
          .ribbon .now {
            position: absolute; top: -3px; width: 2px; height: 20px; margin-left: -1px;
            background: #e6ebf2; border-radius: 1px; box-shadow: 0 0 6px rgba(230,235,242,0.9);
          }
          .ticks { position: relative; height: 14px; margin-top: 5px; }
          .ticks .tick {
            position: absolute; transform: translateX(-50%);
            font: 500 10px ui-monospace, 'JetBrains Mono', monospace; color: #4d5666;
          }

          .grid4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 10px; }
          .node { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
          .node .k { color: #7d8797; font: 500 11px Inter, system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
          .node .v {
            font: 600 clamp(17px, 5vw, 21px) ui-monospace, 'JetBrains Mono', monospace;
            font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
            overflow-wrap: anywhere;
          }

          .soc { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
          .soc-bar { flex: 1; height: 8px; background: rgba(255,255,255,0.07); border-radius: 4px; overflow: hidden; }
          .soc-bar i { display: block; height: 100%; background: #3b82f6; border-radius: 4px; transition: width 0.6s ease; }
          .soc b {
            font: 600 22px ui-monospace, 'JetBrains Mono', monospace;
            font-variant-numeric: tabular-nums; min-width: 62px; text-align: right;
          }

          .pairs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 18px; margin: 0; }
          .pairs > div {
            display: flex; justify-content: space-between; gap: 10px;
            padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
          }
          .pairs dt { color: #7d8797; font-size: 12px; }
          .pairs dd {
            margin: 0; font: 500 13px ui-monospace, 'JetBrains Mono', monospace;
            font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere;
          }

          .scroll { overflow-x: auto; margin: 0 -16px; padding: 0 16px; scrollbar-width: thin; }
          table { border-collapse: collapse; width: 100%; min-width: 320px; }
          th, td { text-align: left; padding: 9px 10px 9px 0; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: nowrap; }
          thead th {
            color: #4d5666; font: 600 10px Inter, system-ui, sans-serif;
            letter-spacing: 0.12em; text-transform: uppercase; padding-bottom: 8px;
          }
          tbody th { font: 500 13px Inter, system-ui, sans-serif; color: #b9c2d0; }
          td.num, th.num {
            text-align: right; padding-right: 0;
            font: 500 13px ui-monospace, 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums;
          }
          thead th.num { font-family: Inter, system-ui, sans-serif; }
          tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
          td.op { color: #4d5666; width: 1.4em; padding-right: 4px; font-family: ui-monospace, monospace; }
          tr.sum th, tr.sum td { border-top: 1px solid rgba(255,255,255,0.16); color: #34d399; font-weight: 600; }
          .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }

          .chart { position: relative; height: 220px; }
          .chart-empty {
            display: flex; align-items: center; justify-content: center; text-align: center;
            color: #7d8797; font-size: 13px; padding: 0 20px; line-height: 1.5;
          }
          .note { color: #7d8797; font-size: 12px; line-height: 1.55; margin: 12px 0 0; }

          @media (min-width: 620px) {
            .panel { padding: 16px; gap: 16px; }
            .hero, .card { padding: 20px; }
            .grid4 { grid-template-columns: repeat(4, 1fr); }
            .pairs { grid-template-columns: repeat(3, 1fr); }
            .scroll { margin: 0 -20px; padding: 0 20px; }
            .chart { height: 260px; }
          }
          @media (prefers-reduced-motion: reduce) {
            #dashboard *, #dashboard *::before { transition: none !important; animation: none !important; }
          }
        </style>
        <div id="dashboard"><div id="tabs"></div>
        <div id="panel-live" class="panel"></div>
        <div id="panel-history" class="panel"></div>
        <div id="panel-financial" class="panel"></div></div>
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
        const [energy, battery, money] = await Promise.all([
          this._hass.connection.sendMessagePromise(statisticsRequest(HISTORY_ENERGY_IDS, 30, ['sum'])),
          this._hass.connection.sendMessagePromise(statisticsRequest(HISTORY_BATTERY_IDS, 30, ['sum'])),
          this._hass.connection.sendMessagePromise(statisticsRequest(HISTORY_MONEY_IDS, 30, ['max'])),
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

        const cycles = alignSeries(batteryCycleSeries(battery));
        if (cycles.days.length) {
          this._drawGrouped('chart-battery', cycles, 'kWh');
        } else {
          this._empty('chart-battery', 'No daily statistics yet. Fills in once the battery meters complete their first full day.');
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
          plugins: { legend: { labels: { color: '#b9c2d0', boxWidth: 10, boxHeight: 10, font: { size: 11 } } } },
          scales: {
            x: { stacked: true, ticks: { color: '#4d5666', maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
            y: { stacked: true, ticks: { color: '#4d5666', font: { size: 10 }, callback: v => `${v}${unit === '\u20ac' ? '' : ' '}${unit}` }, grid: { color: 'rgba(255,255,255,0.05)' } },
          },
        },
      };
    }

    _drawStacked(canvasId, { days, datasets }, unit) {
      const colors = [TARIFF.night_boost, TARIFF.night, TARIFF.day, TARIFF.peak];
      const sets = Object.entries(datasets).map(([label, data], i) => ({
        label, data, backgroundColor: colors[i % colors.length],
      }));
      this._mount(canvasId, this._chartBase(days, sets, unit));
    }

    _drawGrouped(canvasId, { days, datasets }, unit) {
      const colors = { Charged: '#6366f1', Discharged: '#14b8a6' };
      const sets = Object.entries(datasets).map(([label, data]) => ({
        label, data, backgroundColor: colors[label] || '#7d8797',
      }));
      const cfg = this._chartBase(days, sets, unit);
      cfg.options.scales.x.stacked = false;
      cfg.options.scales.y.stacked = false;
      this._mount(canvasId, cfg);
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
