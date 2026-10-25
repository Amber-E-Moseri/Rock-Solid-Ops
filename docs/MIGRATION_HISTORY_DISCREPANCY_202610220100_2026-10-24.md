# Migration history discrepancy: 202610220100 (2026-10-24)

Status: documentation only. No database history, schema, grant or policy was changed.

## Observed (SELECT-only, read-only session)

| Check | Production (foundation-school, xelpsttqhrcqmttmjory) | Staging (Rock Solid Staging, hblahcaozlttknkzvkib) |
|---|---|---|
| Recorded versions | 160 | 159 |
| Latest recorded version | 202610220100 | 202610030004 |
| 202610220100 recorded in schema_migrations | yes (`repair_class_options_registration_columns`) | no |
| class_options.is_online (boolean, NOT NULL, default false) | present | present |
| class_options.confirmed_start_date (date, NULL) | present | present |
| Nine C1/C6 versions recorded | yes, statement counts and whitespace-normalised digests match staging | yes |

## Discrepancies with earlier documentation

- `docs/REGISTRATION_CLASS_OPTIONS_REPAIR_2026-10-22.md` line 3 says "Not executed on production". That is no longer consistent with production's recorded history.
- The same file (section 4a) says production's history ends at `202610030004`. Production now records `202610220100`.
- The same file says the repair "makes production match staging for the two registration columns". Both environments now have the columns. Staging has them without a history row.
- `docs/SCHEMA_DRIFT_INVENTORY_2026-10-22.md` records production history ending at `202610030004`. That is out of date.

## What is not known

- When production recorded `202610220100`, and by which route. The columns are present, but the repository does not record how they were added to either environment.
- Whether staging's columns came from the same statement or another source.

## Recommendation

- Staging needs a reconciliation, not a re-apply. The columns already match the repository migration. Any history row must come from an approved reconciliation procedure, not from this document.
- Do not insert a history row for `202610220100` without that procedure.
