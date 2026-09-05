# HA-App — Energy Dashboard

A custom Home Assistant panel showing live solar/battery/grid power flow
and financial savings (including a per-tariff-period breakdown), built as
a native web component. See `CLAUDE.md` for full technical details.

## Install (HACS)

1. In HA, go to **HACS → ⋮ → Custom repositories**.
2. Add this repository's URL, category **Plugin**.
3. Find "Energy Dashboard" in HACS and install it.
4. **Before** copying the package file (next step), edit your HA host's
   `configuration.yaml`. HA packages *merge* with the main config rather than
   overriding it, so a block left in place with the same `unique_id` means the
   package's accurate sensor is skipped (or lands as a duplicate `_2` entity)
   and the old one keeps being used everywhere downstream.

   **Delete these ten template sensor blocks** — each collides with a package
   sensor of the same `unique_id`:

   | Block | Why the package's version is better |
   |---|---|
   | `Electricity Rate` | lookup keyed off `sensor.current_tariff_period` instead of a third copy of the hour boundaries |
   | `Solar Value Today` | reads `sensor.solar_today_kwh`; no `/1000` on the Wh-denominated helper |
   | `Solar Value Yesterday` | read `sensor.solar_today_previous_period`, **which does not exist** — it silently evaluated to €0 |
   | `Energy Cost Yesterday` | actual per-tariff split instead of `min(imported, 3.0)` as night boost + 10% of the rest as peak |
   | `Energy Cost Without Battery Yesterday` | same, and its solar term was the non-existent entity above |
   | `Battery Charge Cost Today` | per-period rates instead of assuming all charging happens at the night boost rate |
   | `Battery Charge Cost Yesterday` | same |
   | `Arbitrage Profit Today` | per-period rates instead of charge@night-boost / discharge@day |
   | `Arbitrage Profit Yesterday` | same |
   | `Total Energy Saving` | **stops double-counting solar** — see step 4b |

   **Keep** `Energy Saving Today`, `Energy Saving Yesterday`,
   `Total Arbitrage Profit`, `Average Daily Saving`, `Projected Annual Saving`
   and `Days Since Install` — they derive from the sensors above and need no
   change.

   Optional cleanup (redundant, but no `unique_id` collision so they will not
   break anything): `Grid Import Rate Breakdown` duplicates
   `sensor.current_tariff_period`, and `Rate Arbitrage Lifetime Saving` prices
   all lifetime import at an invented flat €0.107/kWh.

   If a `panel_custom` block for `url_path: energy-dashboard` is present,
   delete that too — the package registers its own entry at the same
   `url_path` and HA errors on a duplicate `frontend_url_path`.

4b. **Fix the `Add Daily Saving at Midnight` automation.** It adds
   `sensor.solar_value_yesterday` on top of `sensor.energy_saving_yesterday`
   when accumulating `input_number.total_energy_savings`. Solar is already
   inside that saving figure: the accurate
   `energy_cost_without_battery_yesterday` prices
   (import + discharge + solar) while `energy_cost_yesterday` prices import
   alone, so their difference already contains solar's value. Adding it again
   double-counts it, permanently, into the lifetime total.

   This has been harmless only because `solar_value_yesterday` read €0 from a
   non-existent entity. Once the package makes it return real numbers, the
   error starts accumulating. Change the automation's value template to drop
   the `solar_value` term:

   ```jinja
   {% set current = states('input_number.total_energy_savings') | float(0) %}
   {% set yesterdays_saving = states('sensor.energy_saving_yesterday') | float(0) %}
   {{ (current + yesterdays_saving) | round(2) }}
   ```

   `Add Daily Arbitrage at Midnight` has no solar term and needs no change.
5. Copy `ha-config/packages/tariff_period_breakdown.yaml` from this repo
   into your HA config's `packages/` directory (create it if it doesn't
   exist, and add `packages: !include_dir_named packages` under the
   `homeassistant:` key in `configuration.yaml` if you haven't already).
6. Restart Home Assistant.
7. In HACS's file list for this repo, confirm the served path for
   `energy-dashboard.js` (usually `/hacsfiles/HA-App/energy-dashboard.js`)
   matches the `module_url` in `tariff_period_breakdown.yaml`'s
   `panel_custom` entry — edit and re-copy the package file if it differs.
8. Check the HA log for `Duplicate unique_id` — any hit means one of the
   blocks in step 4 was not deleted, and the old inaccurate sensor is still
   the one in use.
9. An "Energy" item should appear in the HA sidebar.

### Where yesterday's numbers come from

Each `utility_meter` tariff sensor exposes a `last_period` attribute holding its
previous completed cycle. The meters here are `cycle: daily`, so `last_period`
*is* yesterday — read directly, with no history query and no recorder
dependency, and restored across restarts.

The inverter also reports its own yesterday totals
(`sensor.solis_s6_eh1p_yesterday_*`). Those are authoritative but are single
daily numbers with **no tariff split**, so they cannot price yesterday against a
four-rate tariff — that limitation is what forced the old heuristics. There is
no inverter-side solar sensor at all (solar is a separate AC-coupled inverter on
Modbus slave 1), so for yesterday's solar the meters are the only source.

`sensor.tariff_meter_drift_yesterday` compares the two: the four grid-import
`last_period` values summed, minus the inverter's own yesterday import. It
should sit at ~0. A persistent non-zero value means the meters lost energy
(HA down across a tariff boundary, a restart mid-cycle) and yesterday's figures
are under-counting by that many kWh.

### The `sensor.solar_today` unit — retired, not outstanding

`sensor.solar_total_yield` is confirmed genuinely kWh — the unit is declared
directly on its Modbus input register. Everything derived from it
(`sensor.solar_daily_*`, `sensor.solar_today_kwh`, `sensor.solar_yesterday_kwh`,
`sensor.saving_today_*`, the cost sensors, and the lifetime accumulators fed by
the nightly rollup) is therefore free of unit ambiguity.

`sensor.solar_today` is a *different* sensor — a UI helper, not defined in any
YAML — whose Wh/kWh unit was never verified. Nothing in this package or in the
panel references it or `sensor.solar_today_previous_period` any more, so the
ambiguity no longer affects any displayed figure. Once the step 4 deletions are
made, both are unused and can be removed as helpers if you want.

`sensor.solar_today` is a *different* sensor — a UI helper, not defined in any
YAML — and its unit is still unverified. Two host templates disagree about it:
`Solar Value Yesterday` and `Energy Cost Without Battery Yesterday` read
`sensor.solar_today_previous_period` with no `/1000`, while the old
`Solar Value Today` divided by 1000. They are snapshots of the same meter, so
one of them is wrong by 1000x.

To settle it, open **Developer Tools → States → `sensor.solar_today`**. A value
like `8.4` means kWh; `8400` means Wh.

- **If Wh**: add `/ 1000` to the `solar` line in both `Solar Value Yesterday`
  and `Energy Cost Without Battery Yesterday` in the host's
  `configuration.yaml`. Until then those two overstate yesterday's solar 1000x,
  which inflates `sensor.energy_saving_yesterday`.
- **If kWh**: both are already correct, leave them alone.

Either way this now affects only the *yesterday* column — deleting the old
`Solar Value Today` in step 4 removes the ambiguity from today's figures and
from `sensor.total_energy_saving`.

## Development

- `npm test` — runs the unit tests for the panel's pure calculation/render
  functions (`energy-dashboard.test.js`).
- `python3 -m http.server` then open `dev/harness.html` — visually verify
  the panel's Live and Financial tabs against fake sensor data, without
  needing a real HA instance.
- `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml` — checks
  YAML and embedded Jinja template syntax before deploying config changes.
