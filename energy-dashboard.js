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

if (typeof HTMLElement !== 'undefined') {
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
          .period-night_boost td:first-child, .period-night td:first-child { border-left: 3px solid #3b82f6; }
          .period-day td:first-child { border-left: 3px solid #f59e0b; }
          .period-peak td:first-child { border-left: 3px solid #ef4444; }
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
}
