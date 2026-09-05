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
  buildEnergyToday,
  buildFinancialSummary,
  buildSystemStats,
  renderTabsHTML,
  renderLiveHTML,
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
  assert.equal(nodes[1].text, '1.20 kW Export');
  assert.equal(nodes[1].direction, 'Export');
  assert.equal(nodes[2].text, '800 W Charging');
  assert.equal(nodes[2].direction, 'Charging');
  assert.equal(nodes[3].text, '450 W');
});

test('buildPowerFlow reports grid import for a positive net and export for a negative one', () => {
  const importing = buildPowerFlow({ 'sensor.solis_s6_eh1p_grid_power_net': { state: '1200' } });
  assert.equal(importing[1].direction, 'Import');
  assert.equal(importing[1].text, '1.20 kW Import');

  const exporting = buildPowerFlow({ 'sensor.solis_s6_eh1p_grid_power_net': { state: '-1200' } });
  assert.equal(exporting[1].direction, 'Export');
  assert.equal(exporting[1].text, '1.20 kW Export');
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
  assert.equal(discharging[2].text, '127 W Discharging');

  const charging = buildPowerFlow({
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '800' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '0' },
  });
  assert.equal(charging[2].direction, 'Charging');
  assert.equal(charging[2].text, '800 W Charging');

  const idle = buildPowerFlow({
    'sensor.solis_s6_eh1p_battery_charge_power': { state: '0' },
    'sensor.solis_s6_eh1p_battery_discharge_power': { state: '0' },
  });
  assert.equal(idle[2].direction, 'Idle');
  assert.equal(idle[2].text, '0 W Idle');
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

test('buildEnergyToday sources solar from the unambiguous kWh sensor', () => {
  const rows = buildEnergyToday(liveStates);
  assert.deepEqual(rows[0], { label: 'Solar', text: '8.42 kWh' });
  assert.deepEqual(rows.map(r => r.label), [
    'Solar',
    'Battery Charged',
    'Battery Discharged',
    'Grid Import',
    'Grid Export',
    'Home Load',
  ]);
  assert.equal(rows[5].text, '11.70 kWh');

  for (const r of buildEnergyToday({})) assert.equal(r.text, DASH);
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

test('renderLiveHTML highlights the active period only when it is known', () => {
  const known = renderLiveHTML(liveStates);
  assert.match(known, /class="rate-period active"/);
  assert.match(known, /2\.45 kW/);
  assert.match(known, /€312\.45/);

  const unknown = renderLiveHTML({});
  assert.doesNotMatch(unknown, /active/);
  assert.match(unknown, /—/);
});
