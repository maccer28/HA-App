import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinancialRows,
  renderRowsHTML,
  fmtPower,
  fmtEnergy,
  fmtEuro,
  fmtNum,
  buildPowerFlow,
  buildRateNow,
  buildEnergyTable,
  buildPeriodTotals,
  ribbonSegments,
  buildTariffRibbon,
  batteryCycleSeries,
  buildFinancialSummary,
  buildSystemStats,
  renderTabsHTML,
  renderLiveHTML,
  renderFinancialHTML,
  buildBatteryStatus,
  buildMoneyChain,
  statisticsRequest,
  dailyDeltas,
  dailyMaxima,
  alignSeries,
  formatDayLabel,
  correctedNetSaving,
  TABS,
} from './energy-dashboard.js';

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
    key: 'night_boost',
    period: 'Night Boost',
    todaySaving: 1.23,
    todayArbitrage: -0.25,
    lifetimeSaving: 45.67,
    lifetimeArbitrage: -3.1,
  });
  assert.deepEqual(rows[2], {
    key: 'day',
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
    key: 'night_boost',
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
    { key: 'night_boost', period: 'Night Boost', todaySaving: 1.5, todayArbitrage: -0.2, lifetimeSaving: 10, lifetimeArbitrage: 2 },
  ]);
  assert.equal(
    html,
    '<tr class="period-night_boost"><td>Night Boost</td><td>€1.50</td><td>€-0.20</td><td>€10.00</td><td>€2.00</td></tr>'
  );
});

test('renderRowsHTML joins multiple rows with no separator needed between <tr> tags', () => {
  const html = renderRowsHTML([
    { key: 'day', period: 'Day', todaySaving: 1, todayArbitrage: 1, lifetimeSaving: 1, lifetimeArbitrage: 1 },
    { key: 'peak', period: 'Peak', todaySaving: 2, todayArbitrage: 2, lifetimeSaving: 2, lifetimeArbitrage: 2 },
  ]);
  assert.equal((html.match(/<tr class="period-/g) || []).length, 2);
});

// ─── Live tab ──────────────────────────────────────────────────────────

const DASH = '—';

const liveStates = {
  'sensor.solar_power': { state: '2450.4' },
  'sensor.solis_s6_eh1p_grid_power_net': { state: '-1200' },
  'sensor.solis_s6_eh1p_battery_charge_power': { state: '800' },
  'sensor.solis_s6_eh1p_battery_discharge_power': { state: '0' },
  'sensor.solis_s6_eh1p_household_load_power': { state: '450' },

  'sensor.current_tariff_period': { state: 'day' },
  'sensor.electricity_rate': { state: '0.3233' },

  'sensor.solar_today_kwh': { state: '8.42' },
  'sensor.solis_s6_eh1p_today_battery_charge_energy': { state: '3.1' },
  'sensor.solis_s6_eh1p_today_battery_discharge_energy': { state: '2.4' },
  'sensor.solis_s6_eh1p_today_energy_imported_from_grid': { state: '5.05' },
  'sensor.solis_s6_eh1p_today_energy_fed_into_grid': { state: '1.2' },
  'sensor.solis_s6_eh1p_household_load_today_energy': { state: '11.7' },

  'sensor.energy_cost_today': { state: '2.31' },
  'sensor.energy_cost_yesterday': { state: '2.90' },
  'sensor.energy_cost_without_battery_today': { state: '4.10' },
  'sensor.energy_cost_without_battery_yesterday': { state: '5.00' },
  'sensor.energy_saving_today': { state: '1.79' },
  'sensor.energy_saving_yesterday': { state: '2.10' },
  'sensor.total_energy_saving': { state: '312.45' },
  'sensor.arbitrage_profit_today': { state: '0.55' },
  'sensor.arbitrage_profit_yesterday': { state: '0.61' },
  'sensor.total_arbitrage_profit': { state: '48.20' },
  'sensor.battery_charge_cost_today': { state: '0.26' },
  'sensor.battery_charge_cost_yesterday': { state: '0.30' },
  'sensor.solar_value_today': { state: '2.72' },
  'sensor.solar_value_yesterday': { state: '3.01' },

  'sensor.solis_s6_eh1p_battery_soc': { state: '76.5' },
  'sensor.solis_s6_eh1p_battery_voltage': { state: '52.8' },
  'sensor.solis_s6_eh1p_battery_current': { state: '15.2' },
  'sensor.solis_s6_eh1p_temperature': { state: '31.4' },
  'sensor.solis_s6_eh1p_a_phase_voltage': { state: '236.1' },
  'sensor.solis_s6_eh1p_grid_frequency': { state: '49.98' },
  'sensor.solis_s6_eh1p_status_string': { state: 'Generating' },
};

test('fmtPower switches from W to kW at the 1000 W boundary', () => {
  assert.equal(fmtPower(0), '0 W');
  assert.equal(fmtPower(999), '999 W');
  assert.equal(fmtPower(999.4), '999 W');
  assert.equal(fmtPower(1000), '1.00 kW');
  assert.equal(fmtPower(2450.4), '2.45 kW');
  assert.equal(fmtPower(-1500), '-1.50 kW');
  assert.equal(fmtPower(null), DASH);
});

test('formatters render a dash rather than a misleading zero for missing values', () => {
  assert.equal(fmtEnergy(null), DASH);
  assert.equal(fmtEuro(null), DASH);
  assert.equal(fmtNum(null, 1, 'V'), DASH);

  assert.equal(fmtEnergy(8.4), '8.40 kWh');
  assert.equal(fmtEuro(-0.2), '€-0.20');
  assert.equal(fmtNum(49.98, 2, 'Hz'), '49.98 Hz');
  assert.equal(fmtNum(5, 0, ''), '5');
});

test('buildPowerFlow returns the four nodes with grid and battery direction', () => {
  const nodes = buildPowerFlow(liveStates);

  assert.deepEqual(nodes.map(n => n.key), ['solar', 'grid', 'battery', 'home']);
  assert.equal(nodes[0].text, '2.45 kW');
  assert.equal(nodes[1].text, '1.20 kW');
  assert.equal(nodes[1].direction, 'Export');
  assert.equal(nodes[2].text, '800 W');
  assert.equal(nodes[2].direction, 'Charging');
  assert.equal(nodes[3].text, '450 W');
});

test('buildPowerFlow reports grid import for a positive net and export for a negative one', () => {
  const importing = buildPowerFlow({ 'sensor.solis_s6_eh1p_grid_power_net': { state: '1200' } });
  assert.equal(importing[1].direction, 'Import');
  assert.equal(importing[1].text, '1.20 kW');

  const exporting = buildPowerFlow({ 'sensor.solis_s6_eh1p_grid_power_net': { state: '-1200' } });
  assert.equal(exporting[1].direction, 'Export');
  assert.equal(exporting[1].text, '1.20 kW');
});

test('buildPowerFlow reads battery direction from the dedicated charge/discharge sensors', () => {
  // Verified live 2026-09-05: battery_discharge_power 127 / charge_power 0 while
  // SOC fell 60 -> 59, so these two sensors are authoritative and the sign of
  // battery_power is NOT charge-positive.
  const discharging = buildPowerFlow({
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '0' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '127' },
  });
  assert.equal(discharging[2].direction, 'Discharging');
  assert.equal(discharging[2].text, '127 W');

  const charging = buildPowerFlow({
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '800' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '0' },
  });
  assert.equal(charging[2].direction, 'Charging');
  assert.equal(charging[2].text, '800 W');

  const idle = buildPowerFlow({
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '0' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '0' },
  });
  assert.equal(idle[2].direction, 'Idle');
  assert.equal(idle[2].text, '0 W');
});

test('buildPowerFlow dashes the battery when neither charge nor discharge is reported', () => {
  const nodes = buildPowerFlow({});
  assert.equal(nodes[2].text, '—');
  assert.equal(nodes[2].direction, null);
});

test('buildPowerFlow dashes every node when no states are present', () => {
  const nodes = buildPowerFlow({});
  assert.equal(nodes.length, 4);
  for (const n of nodes) {
    assert.equal(n.text, DASH);
    assert.equal(n.value, null);
    assert.equal(n.direction, null);
  }
});

test('buildRateNow resolves the period label and rate from the backend sensors', () => {
  assert.deepEqual(buildRateNow(liveStates), {
    period: 'day',
    label: 'Day',
    rateText: '€0.3233/kWh',
    isKnown: true,
  });
});

test('buildRateNow refuses to guess when the tariff period sensor is not a known period', () => {
  for (const state of ['unknown', 'unavailable', '', 'constructor']) {
    const r = buildRateNow({ 'sensor.current_tariff_period': { state } });
    assert.equal(r.isKnown, false, `expected ${state} to be unknown`);
    assert.equal(r.period, null);
    assert.equal(r.label, DASH);
  }

  const missing = buildRateNow({});
  assert.equal(missing.isKnown, false);
  assert.equal(missing.rateText, DASH);
});

test('buildEnergyTable covers every real energy flow across today/yesterday/lifetime', () => {
  const rows = buildEnergyTable(liveStates);
  assert.deepEqual(rows.map(r => r.label), [
    'Solar', 'Grid import', 'Grid export', 'Battery charged',
    'Battery discharged', 'Home load', 'Backup load',
  ]);
  assert.equal(rows[0].today, '8.42 kWh');

  // Backup load has no yesterday sensor; it must dash, not fabricate a zero
  assert.equal(rows[6].yesterday, DASH);

  for (const r of buildEnergyTable({})) {
    assert.equal(r.today, DASH);
    assert.equal(r.lifetime, DASH);
  }
});

test('buildPeriodTotals exposes month and year figures', () => {
  const rows = buildPeriodTotals({
    'sensor.solis_s6_eh1p_household_load_month_energy': { state: '71' },
    'sensor.solis_s6_eh1p_household_load_year_energy': { state: '1198' },
  });
  assert.deepEqual(rows[0], { label: 'Home load', month: '71.00 kWh', year: '1198.00 kWh' });
  assert.equal(rows[1].month, DASH);
});

test('ribbonSegments merges consecutive hours into proportional bands', () => {
  const hours = [
    'night','night','night_boost','night_boost','night_boost','night','night','night',
    'day','day','day','day','day','day','day','day','day','peak','peak',
    'day','day','day','day','night',
  ];
  const segs = ribbonSegments(hours);
  assert.deepEqual(segs.map(s => `${s.key}@${s.start}x${s.span}`), [
    'night@0x2', 'night_boost@2x3', 'night@5x3', 'day@8x9', 'peak@17x2', 'day@19x4', 'night@23x1',
  ]);
  // widths must tile the whole day exactly
  assert.equal(segs.reduce((a, s) => a + s.span, 0), 24);
  assert.ok(Math.abs(segs.reduce((a, s) => a + s.pct, 0) - 100) < 1e-9);

  // anything that is not a full 24-hour map is refused rather than half-drawn
  assert.deepEqual(ribbonSegments(['day']), []);
  assert.deepEqual(ribbonSegments(undefined), []);
});

test('buildTariffRibbon reads the schedule from HA, not from JS', () => {
  const hours = Array(24).fill('day');
  hours[17] = hours[18] = 'peak';
  const states = {
    'sensor.current_tariff_period': {
      state: 'peak',
      attributes: { hours, rates: { day: 0.3233, peak: 0.4508 } },
    },
    'sensor.electricity_rate': { state: '0.4508' },
  };
  const r = buildTariffRibbon(states, new Date('2026-09-05T12:00:00'));
  assert.equal(r.activeKey, 'peak');
  assert.equal(r.label, 'Peak');
  assert.equal(r.rateText, '0.4508');
  assert.equal(r.nowPct, 50);
  assert.equal(r.segments.find(s => s.key === 'peak').rate, 0.4508);

  // with no schedule published there is nothing to draw, and nothing invented
  const bare = buildTariffRibbon({});
  assert.deepEqual(bare.segments, []);
  assert.equal(bare.activeKey, null);
  assert.equal(bare.rateText, DASH);
});

test('batteryCycleSeries sums charge and discharge across tariff periods', () => {
  const out = batteryCycleSeries({
    'sensor.battery_charge_daily_night_boost': [{ start: '2026-09-01', sum: 0 }, { start: '2026-09-02', sum: 9 }],
    'sensor.battery_charge_daily_day': [{ start: '2026-09-01', sum: 0 }, { start: '2026-09-02', sum: 5 }],
    'sensor.battery_discharge_daily_day': [{ start: '2026-09-01', sum: 0 }, { start: '2026-09-02', sum: 8 }],
  });
  assert.deepEqual(out.Charged, [{ day: '2026-09-02', value: 14 }]);
  assert.deepEqual(out.Discharged, [{ day: '2026-09-02', value: 8 }]);
  assert.deepEqual(batteryCycleSeries({}), { Charged: [], Discharged: [] });
});

test('buildFinancialSummary lays out today/yesterday/total per metric', () => {
  const rows = buildFinancialSummary(liveStates);
  assert.deepEqual(rows[0], {
    label: 'Cost',
    today: '€2.31',
    yesterday: '€2.90',
    total: DASH,
  });
  assert.deepEqual(rows[2], {
    label: 'Saving',
    today: '€1.79',
    yesterday: '€2.10',
    total: '€312.45',
  });

  for (const r of buildFinancialSummary({})) {
    assert.equal(r.today, DASH);
    assert.equal(r.yesterday, DASH);
    assert.equal(r.total, DASH);
  }
});

test('buildSystemStats formats each reading with its own precision and unit', () => {
  const rows = buildSystemStats(liveStates);
  const byLabel = Object.fromEntries(rows.map(r => [r.label, r.text]));
  assert.equal(byLabel['Battery SOC'], '76.5 %');
  assert.equal(byLabel['Grid Frequency'], '49.98 Hz');
  assert.equal(byLabel['Inverter Temp'], '31.4 °C');
  assert.equal(byLabel['Status'], 'Generating');

  for (const r of buildSystemStats({})) assert.equal(r.text, DASH);
});

test('buildSystemStats escapes the inverter status string', () => {
  const rows = buildSystemStats({
    'sensor.solis_s6_eh1p_status_string': { state: '<img onerror=x>' },
  });
  const status = rows.find(r => r.label === 'Status');
  assert.equal(status.text, '&lt;img onerror=x&gt;');
});

test('renderTabsHTML marks exactly one tab active', () => {
  const html = renderTabsHTML(TABS, 'financial');
  assert.equal((html.match(/class="tab active"/g) || []).length, 1);
  assert.equal((html.match(/<button/g) || []).length, TABS.length);
  assert.match(html, /data-tab="financial" class="tab active"/);
  assert.match(html, /data-tab="live" class="tab"/);
});

test('renderLiveHTML names the active tariff period and tints it', () => {
  const hours = Array(24).fill('day');
  const known = renderLiveHTML({
    ...liveStates,
    'sensor.current_tariff_period': { state: 'day', attributes: { hours, rates: { day: 0.3233 } } },
  });
  assert.match(known, /class="eyebrow" style="color:#f0a12e">Day</, 'active period is named and tinted');
  assert.match(known, /class="seg on"/, 'the ribbon marks the band in force');
  assert.match(known, /2\.45 kW/);

  const unknown = renderLiveHTML({});
  assert.doesNotMatch(unknown, /class="seg on"/, 'no band is marked when the period is unknown');
  assert.match(unknown, /—/);
});

test('the Live tab stays simple: no money on it, money lives on Financial', () => {
  const live = renderLiveHTML(liveStates);
  // The current rate is live data and belongs here; running totals do not.
  assert.match(live, /0\.3233/, 'the rate in force now is live data');
  for (const total of ['312.45', '48.20', '2.31', '1.79']) {
    assert.ok(!live.includes(total), `Live tab should not carry the running total ${total}`);
  }
  assert.doesNotMatch(live, /Saving|Arbitrage|Avoided/, 'financial labels belong on the Financial tab');
  assert.match(live, /class="ribbon"/, 'the tariff ribbon is the Live hero');
  assert.match(live, /class="soc-bar"/, 'Live tab should show battery state of charge');

  const fin = renderFinancialHTML(liveStates);
  assert.match(fin, /€312\.45/);
  assert.match(fin, /Net saving/);
});

test('buildMoneyChain lays the saving out as avoided - charge = net', () => {
  const chain = buildMoneyChain({
    'sensor.energy_avoided_cost_today': { state: '3.56' },
    'sensor.battery_charge_cost_today': { state: '1.20' },
    'sensor.energy_saving_today': { state: '2.36' },
  });
  assert.deepEqual(chain.map(r => r.op), ['+', '\u2212', '=']);
  assert.deepEqual(chain.map(r => r.today), ['€3.56', '€1.20', '€2.36']);
  // the chain must actually add up, or the display is lying
  assert.equal((3.56 - 1.20).toFixed(2), '2.36');
  for (const r of buildMoneyChain({})) assert.equal(r.today, DASH);
});

test('buildBatteryStatus reports SOC and clamps nothing away when missing', () => {
  const b = buildBatteryStatus({
    'sensor.solis_s6_eh1p_battery_soc': { state: '59' },
    'sensor.solis_s6_eh1p_battery_soh': { state: '100' },
  });
  assert.equal(b.soc, 59);
  assert.equal(b.socText, '59 %');
  assert.equal(b.sohText, '100 %');
  const empty = buildBatteryStatus({});
  assert.equal(empty.soc, null);
  assert.equal(empty.socText, DASH);
});

test('statisticsRequest asks for daily long-term statistics over the window', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const req = statisticsRequest(['sensor.a', 'sensor.b'], 30, ['sum'], now);
  assert.equal(req.type, 'recorder/statistics_during_period');
  assert.equal(req.period, 'day');
  assert.deepEqual(req.statistic_ids, ['sensor.a', 'sensor.b']);
  assert.deepEqual(req.types, ['sum']);
  assert.equal(req.end_time, '2026-09-05T12:00:00.000Z');
  assert.equal(req.start_time, '2026-08-06T12:00:00.000Z');
});

test('dailyDeltas turns a rising statistics sum into per-day energy', () => {
  const rows = [
    { start: '2026-09-01T00:00:00', sum: 10 },
    { start: '2026-09-02T00:00:00', sum: 14.5 },
    { start: '2026-09-03T00:00:00', sum: 20 },
  ];
  assert.deepEqual(dailyDeltas(rows), [
    { day: '2026-09-02', value: 4.5 },
    { day: '2026-09-03', value: 5.5 },
  ]);
  // the first row has no predecessor, so it must not be reported as a day's total
  assert.equal(dailyDeltas(rows).length, rows.length - 1);
  // a meter reset must never produce negative energy
  assert.deepEqual(dailyDeltas([{ start: '2026-09-01', sum: 10 }, { start: '2026-09-02', sum: 2 }]),
    [{ day: '2026-09-02', value: 0 }]);
  assert.deepEqual(dailyDeltas(undefined), []);
});

test('dailyMaxima takes the end-of-day value of a measurement sensor', () => {
  assert.deepEqual(
    dailyMaxima([{ start: '2026-09-02T00:00:00', max: 2.36 }, { start: '2026-09-03T00:00:00', max: 1.9 }]),
    [{ day: '2026-09-02', value: 2.36 }, { day: '2026-09-03', value: 1.9 }]
  );
  assert.deepEqual(dailyMaxima(null), []);
});

test('alignSeries gaps a missing day rather than shifting later days left', () => {
  const { days, datasets } = alignSeries({
    Day: [{ day: '2026-09-01', value: 3 }, { day: '2026-09-03', value: 5 }],
    Peak: [{ day: '2026-09-02', value: 1 }],
  });
  assert.deepEqual(days, ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual(datasets.Day, [3, null, 5]);
  assert.deepEqual(datasets.Peak, [null, 1, null]);
});

test('statistics timestamps are epoch milliseconds, not ISO strings', () => {
  // Regression: HA returns `start` as a number. Slicing it as text put raw
  // epoch values like "1785970800" on the chart axis.
  const rows = [{ start: 1785970800000, max: 4.84 }];
  const [point] = dailyMaxima(rows);
  assert.match(point.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(point.day, new Date(1785970800000).getFullYear() + '-' +
    String(new Date(1785970800000).getMonth() + 1).padStart(2, '0') + '-' +
    String(new Date(1785970800000).getDate()).padStart(2, '0'));

  // ISO strings must still work, and dailyDeltas shares the same parsing
  assert.equal(dailyMaxima([{ start: '2026-09-05T00:00:00', max: 1 }])[0].day, '2026-09-05');
});

test('formatDayLabel renders a readable axis label', () => {
  assert.equal(formatDayLabel('2026-09-05'), '5 Sep');
  assert.equal(formatDayLabel('2026-12-31'), '31 Dec');
  assert.equal(formatDayLabel('nonsense'), 'nonsense');
});

test('correctedNetSaving puts pre-change days on a net basis', () => {
  const saving = [
    { start: '2026-09-03T00:00:00', max: 5.77 },
    { start: '2026-09-04T00:00:00', max: 3.79 },
    { start: '2026-09-05T00:00:00', max: 2.41 },
  ];
  const charge = [
    { start: '2026-09-03T00:00:00', max: 0.99 },
    { start: '2026-09-04T00:00:00', max: 1.20 },
    { start: '2026-09-05T00:00:00', max: 0.78 },
  ];
  const out = correctedNetSaving(saving, charge, '2026-09-05');

  // gross figures before the cutoff get the charge cost taken off
  assert.deepEqual(out[0], { day: '2026-09-03', value: 4.78, corrected: true });
  assert.deepEqual(out[1], { day: '2026-09-04', value: 2.59, corrected: true });
  // the changeover day spans both models plus a meter reset -> unreconstructable
  assert.equal(out.length, 2, 'the changeover day must be omitted, not plotted');
  assert.ok(!out.some(p => p.day === '2026-09-05'));
});

test('correctedNetSaving keeps days after the changeover untouched', () => {
  const out = correctedNetSaving(
    [{ start: '2026-09-06T00:00:00', max: 2.2 }, { start: '2026-09-07T00:00:00', max: 2.6 }],
    [{ start: '2026-09-06T00:00:00', max: 1.0 }],
    '2026-09-05'
  );
  assert.deepEqual(out, [
    { day: '2026-09-06', value: 2.2, corrected: false },
    { day: '2026-09-07', value: 2.6, corrected: false },
  ]);
});

test('correctedNetSaving leaves a day alone when no charge cost was recorded', () => {
  const out = correctedNetSaving(
    [{ start: '2026-08-01T00:00:00', max: 3.0 }], [], '2026-09-05'
  );
  assert.equal(out[0].value, 3.0, 'a missing charge cost must not be treated as a correction');
});

test('the power-flow direction renders as its own element, not appended to the value', () => {
  // Regression: the caption CSS shipped in v0.3.1 while the markup edit silently
  // failed to apply, so .node .d was styled but never emitted. Assert the markup.
  const html = renderLiveHTML({
    'sensor.solis_s6_eh1p_grid_power_net': { state: '25' },
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '0' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '357' },
  });
  assert.match(html, /<span class="d">Import<\/span>/);
  assert.match(html, /<span class="d">Discharging<\/span>/);
  // and the figure itself must not carry the word
  assert.doesNotMatch(html, /357 W Discharging/);
});
