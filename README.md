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
8. Verify `sensor.solar_total_yield` is genuinely in kWh (e.g. compare its
   value against a known recent daily solar total, or cross-check with
   `sensor.solar_today`) before trusting `sensor.saving_today_*` and
   `sensor.energy_cost_without_battery_today` — if `solar_total_yield`
   turns out to actually be in Wh, every one of those sensors will
   overstate savings by roughly 1000x, and since the nightly rollup
   automation feeds `saving_today_*` into the `input_number.total_saving_*`
   lifetime accumulators, that error becomes permanent until manually
   corrected.
9. An "Energy" item should appear in the HA sidebar.

## Development

- `npm test` — runs the unit tests for the panel's pure calculation/render
  functions (`energy-dashboard.test.js`).
- `python3 -m http.server` then open `dev/harness.html` — visually verify
  the panel's Financial table against fake sensor data, without needing a
  real HA instance.
- `python3 scripts/validate_ha_yaml.py ha-config/packages/*.yaml` — checks
  YAML and embedded Jinja template syntax before deploying config changes.
