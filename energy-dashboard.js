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
