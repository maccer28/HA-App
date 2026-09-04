# Tariff-Period Financial Breakdown — Design

## Purpose

The planned Financial tab of the energy dashboard panel (see `CLAUDE.md`)
should show how much of the daily/lifetime savings and arbitrage profit came
from each tariff period (Night Boost / Night / Day / Peak), rather than only
a single blended daily figure. Building this also fixes an existing accuracy
gap: `Energy Cost Today` and `Energy Cost Without Battery Today` currently
allocate imported kWh to periods with a flat heuristic (first 3 kWh assumed
night boost, 10% of the remainder assumed peak, rest assumed day) rather than
tracking which period the energy actually moved in.

## Scope

- New HA-side sensors (backend), added to `configuration.yaml` on the HA
  host — not part of this git repo, but documented here for the
  implementation plan.
- Per-period tracking for: grid import, battery charge, battery discharge,
  solar generation.
- Derived per-period financial metrics: saving and arbitrage profit, for
  both "today" (resets nightly) and "lifetime" (cumulative since install)
  timeframes.
- Rewrite of `Energy Cost Today` / `Energy Cost Without Battery Today` to
  use accurate per-period sums instead of the flat heuristic.
- Panel-side (JS) display of the new sensors in the Financial tab as a
  small per-period table.

Out of scope: changes to the Live/Solar & Battery/Totals tabs, changes to
the tariff rates or schedule themselves, and any change to how the
existing `sensor.solis_s6_eh1p_total_energy_imported_from_grid` etc. raw
device sensors are produced.

## Tariff schedule (unchanged, replicated from `sensor.electricity_rate`)

| Period | Hours (local) | Rate (EUR/kWh) |
|---|---|---|
| Night Boost | 02:00–05:00 | 0.0824 |
| Night | 23:00–02:00, 05:00–08:00 | 0.2438 |
| Day | 08:00–17:00, 19:00–23:00 | 0.3233 |
| Peak | 17:00–19:00 | 0.4508 |

Standing charge (€0.9164/day) is not split by period — it remains a single
daily line item, unaffected by this work.

## 1. Period tracking mechanism

Four `utility_meter` blocks, one per raw quantity, each with `cycle: daily`
and `tariffs: [night_boost, night, day, peak]`:

- `utility_meter.grid_import_daily` ← `sensor.solis_s6_eh1p_total_energy_imported_from_grid`
- `utility_meter.battery_charge_daily` ← `sensor.solis_s6_eh1p_total_battery_charge_energy`
- `utility_meter.battery_discharge_daily` ← `sensor.solis_s6_eh1p_total_battery_discharge_energy`
- `utility_meter.solar_daily` ← `sensor.solar_total_yield`

Each `utility_meter` block auto-generates 4 sub-sensors (e.g.
`sensor.grid_import_daily_night_boost` … `_peak`) that reset nightly — 16
raw kWh sensors total — and its own `select` helper to choose the active
tariff.

One new automation keeps all 4 auto-created `select` helpers in sync with
the real period. It fires at the 6 tariff-boundary times (02:00, 05:00,
08:00, 17:00, 19:00, 23:00) and on `homeassistant_start` (so a restart
mid-period doesn't leave a stale tariff selected), calling
`select.select_option` on all 4 selects at once with the period computed
using the same hour-boundary logic as the existing `Electricity Rate`
sensor, so it stays consistent with current billing.

## 2. Financial sensors — today (per period)

For each period `P` with rate `rate_P` from the table above, using that
period's raw daily sensors:

```
imported_P             = grid_import_daily_P
charged_P              = battery_charge_daily_P
discharged_P           = battery_discharge_daily_P
solar_P                = solar_daily_P

cost_with_P             = imported_P * rate_P
consumption_without_P   = imported_P + discharged_P + solar_P
cost_without_P          = consumption_without_P * rate_P

saving_today_P    = cost_without_P - cost_with_P
arbitrage_today_P = (discharged_P * rate_P) - (charged_P * rate_P)
```

New sensors: `sensor.saving_today_{period}`,
`sensor.arbitrage_today_{period}` for `period` in
`{night_boost, night, day, peak}` — 8 sensors.

Night Boost's `arbitrage_today` will typically read negative (pure charge
cost, little/no discharge then); day/peak/night read positive (value of
discharging during that period). Summed across periods, this should
reconcile closely with the existing `sensor.arbitrage_profit_today`.

## 3. Financial sensors — lifetime (per period)

Mirrors the existing `sensor.total_energy_saving` pattern. 8 new
`input_number` helpers: `input_number.total_saving_{period}`,
`input_number.total_arbitrage_{period}`. The automation that currently
rolls today's totals into `input_number.total_energy_savings` /
`total_arbitrage_profit` at midnight is extended to also add each period's
today-value into its own accumulator.

Then 8 template sensors:

```
sensor.total_saving_{period}    = input_number.total_saving_{period} + sensor.saving_today_{period}
sensor.total_arbitrage_{period} = input_number.total_arbitrage_{period} + sensor.arbitrage_today_{period}
```

## 4. Rewrite of existing heuristic sensors

`Energy Cost Today` and `Energy Cost Without Battery Today` are rewritten
to sum the per-period `cost_with_P` / `cost_without_P` values from section
2, each plus the standing charge (added once per sensor, matching the
existing formula where both cost sensors include standing — it cancels
out in `saving_today_P` but keeps the absolute cost values meaningful as
an estimate of the real daily bill). This replaces the flat heuristic
(first 3 kWh / 10% of remainder split). It changes the computed *values*
of these two existing sensors (not their entity IDs) — any automation or
history relying on the old heuristic's exact numbers will see a small
shift, but the new numbers are accurate rather than approximated.

## 5. Panel display (Financial tab)

The JS panel reads the 16 new sensors (`saving_today_*`,
`arbitrage_today_*`, `total_saving_*`, `total_arbitrage_*`) via
`hass.states` — no history query needed, since these are already-computed
running totals. Displayed as a 4-row table under the existing Financial
tab charts:

| Period | Today Saving | Today Arbitrage | Lifetime Saving | Lifetime Arbitrage |
|---|---|---|---|---|

Row color-tagging: night_boost/night use the existing battery-blue family,
day uses the solar-amber family, peak uses the existing red/warning tone —
consistent with the panel's existing design system in `CLAUDE.md`.

## 6. Error handling & verification

- Missing/unavailable source sensors default via `float(0)` in all new
  templates, matching existing style — a Modbus dropout shows 0 rather
  than erroring.
- `utility_meter` handles source-sensor resets (e.g. inverter counter
  rollover) natively; no extra logic needed.
- The `homeassistant_start` trigger on the tariff-sync automation prevents
  a restart from leaving the `select` helpers stuck on a stale period.
- Post-deploy verification: check Developer Tools → States for the 4 new
  `select.*` entities and confirm they change at the correct hour
  boundaries; spot-check that
  `saving_today_night_boost + saving_today_night + saving_today_day + saving_today_peak`
  is close to `sensor.energy_saving_today` (should match closely, since
  both now derive from the same per-period math).

## New entities summary

- 4× `utility_meter` config blocks → 16 raw daily per-period kWh sensors
  + 4 `select` helpers
- 1 new automation (tariff-sync across the 4 selects)
- 8 `sensor.saving_today_*` / `sensor.arbitrage_today_*` template sensors
- 8 `input_number.total_saving_*` / `total_arbitrage_*` helpers
- 8 `sensor.total_saving_*` / `sensor.total_arbitrage_*` template sensors
- 1 automation extended (midnight rollup, existing automation gains 8 more
  accumulator adds)
- 2 existing template sensors rewritten (`Energy Cost Today`,
  `Energy Cost Without Battery Today`)
- Financial tab (JS panel, not yet built) gains a per-period table
