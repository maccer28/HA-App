# HA-App — Energy Dashboard

A custom Home Assistant panel showing live solar/battery/grid power flow
and financial savings (including a per-tariff-period breakdown), built as
a native web component. See `CLAUDE.md` for full technical details.

## Install (HACS)

1. In HA, go to **HACS → ⋮ → Custom repositories**.
2. Add this repository's URL, category **Plugin**.
3. Find "Energy Dashboard" in HACS and install it.
4. **Before** copying the package file (next step), edit your HA host's
   `configuration.yaml` and delete:
   - the existing template sensor blocks with `unique_id: energy_cost_today`
     and `unique_id: energy_cost_without_battery_today` — the package below
     defines accurate replacements with the same `unique_id`s, and HA
     packages *merge* with the main config rather than overriding it, so
     leaving the old blocks in place means the new accurate sensors get
     skipped (or create duplicate `_2` entities) and the old inaccurate
     heuristic keeps being used everywhere downstream.
   - the existing template sensor blocks named `Electricity Rate`
     (`unique_id: electricity_rate_yaml`) and `Solar Value Today`
     (`unique_id: solar_value_today`) — same merge problem. The package's
     `Electricity Rate` is a lookup keyed off `sensor.current_tariff_period`
     instead of a third copy of the hour boundaries, and its
     `Solar Value Today` reads the unambiguous `sensor.solar_today_kwh`
     rather than dividing `sensor.solar_today` by 1000.
   - the template sensor block named `Grid Import Rate Breakdown` — it is an
     exact duplicate of the package's `sensor.current_tariff_period` and
     nothing references it.
   - the existing `panel_custom` block for `url_path: energy-dashboard` /
     `module_url: /local/energy-dashboard/energy-dashboard.js` — the
     package registers its own `panel_custom` entry at the same
     `url_path`, HA raises an error on a duplicate `frontend_url_path`,
     and there's a real risk the broken `/local/` entry (see CLAUDE.md's
     "Lessons learned" section on `NS_ERROR_CORRUPTED_CONTENT`) wins the
     conflict.
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

### Outstanding: the `sensor.solar_today` unit

`sensor.solar_total_yield` is confirmed genuinely kWh — the unit is declared
directly on its Modbus input register. Everything derived from it
(`sensor.solar_daily_*`, `sensor.solar_today_kwh`, `sensor.saving_today_*`,
`sensor.energy_cost_without_battery_today`, and the lifetime accumulators fed
by the nightly rollup) is therefore free of unit ambiguity.

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
