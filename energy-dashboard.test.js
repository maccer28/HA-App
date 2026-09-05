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
