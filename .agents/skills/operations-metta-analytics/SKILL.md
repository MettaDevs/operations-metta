---
name: operations-metta-analytics
description: Port and change the analytics engine — module datasets, the JSON query compiler, the read-only executor, dashboards and widgets, the result cache, publications, the OData feed, and embeds. Use when porting CoreERP's analytics to operations-metta, when declaring or changing a module's analytics dataset, when touching the `analytics_*` tables, when building analytics screens, or when exposing analytics data outside the runtime.
---

# operations-metta analytics

CoreERP has its own Power BI–style engine: modules declare datasets, Core compiles a JSON query into SQL against module tables and runs it read-only, users build dashboards without code, and (phase 2) data leaves the runtime only through publications (JSON/CSV, OData v4, embeds).

## Keadaan di repo ini

**The engine has not been ported.** This repository has no analytics code, no dataset declarations, and no analytics screens. What it has are the tables from the CoreERP baseline (`analytics_dashboards`, `analytics_widgets`, `analytics_saved_queries`, `analytics_query_cache`, `analytics_query_log` in `database/migrations/0001_coreerp_baseline.sql`); the baseline carries the schema, not the permission catalog rows.

Until it is ported, CoreERP's code is the behaviour reference, and the code wins over its documents:

| What | Where in CoreERP |
| --- | --- |
| Engine | [`apps/core/app/Platform/Analytics/`](https://github.com/MettaDevs/coreERP/tree/main/apps/core/app/Platform/Analytics) |
| Asset datasets | [`modules/apperp/management-aset/src/Analytics/`](https://github.com/MettaDevs/coreERP/tree/main/modules/apperp/management-aset/src/Analytics) |
| Canonical description | [`docs/dev/35-analitik.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/35-analitik.md) |
| Module catalogue | [`docs/apps/management-aset/transaction/analitik/index.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/apps/management-aset/transaction/analitik/index.md) |
| Query shape and SQL rules | [`docs/todo/analitik/mesin-query.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/analitik/mesin-query.md) |
| Permissions, policy, personal data | [`docs/todo/analitik/keamanan.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/analitik/keamanan.md) |
| Dashboards and visuals | [`docs/todo/analitik/dasbor-dan-visual.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/analitik/dasbor-dan-visual.md) |
| Outside access (phase 2) | [`docs/todo/analitik/akses-luar.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/analitik/akses-luar.md) |
| Cache, limits, load test | [`docs/todo/analitik/kinerja-dan-uji-beban.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/analitik/kinerja-dan-uji-beban.md) |
| Decisions (`KA-xx`), PRD, phase plans | [`docs/todo/analitik/`](https://github.com/MettaDevs/coreERP/tree/main/docs/todo/analitik) |

In CoreERP, phase 1 shipped the dataset contract, registry, and validator; the query model; the compiler, read-only executor, and results; read security and the permission chain; dashboard storage, screens, the widget builder, and the data explorer; the result cache, concurrency limits, and the masked query log; and the asset datasets. Phase 2–3 (slicers, drill, formulas, period comparison, cross-module drill-across, publications, Query API, OData, embeds, templates, rollups, alerts) is plan only, and a plan sentence is never evidence that code exists.

### Where a port goes

- The engine has no business vocabulary, so it is a Core capability under `src/platform/<capability>/` with one `index.ts` (table Susunan repo in `AGENTS.md`).
- Each module's datasets live inside that module, next to the area and feature they describe.
- How a module registers its datasets with Core is not decided. CoreERP used a singleton registry filled from each module's service provider; this repository has no provider mechanism. Ask the product owner before inventing one, and keep the rule below that Core never hard-codes a module table or column name.
- A ported query is finished when it meets the rule in `AGENTS.md` (Kapan sebuah alur dianggap pindah): a query that computes money amounts or numbers needs the parity harness to show the same rows and SQL obligations as CoreERP for the same input; other queries need database-backed tests that prove CoreERP's behaviour.

## Boundaries that never bend

- **Core may read module tables directly, but only through datasets the module registered.** Owner's decision, 3 October 2026 (`AGENTS.md`, Aturan module). No module table or column name is ever written in the engine. `bun run check:boundaries` already rejects the `aset_` prefix inside `src/`; CoreERP's analytics boundary test also read comments, so a module table name in a doc comment failed it.
- **A module never reads another module's tables**, and a dataset references only its own tables plus Core's public `index.ts` files. Cross-module analysis goes through shared dimensions (phase 2 drill-across: aggregate each dataset by the same shared dimension, merge on its values), never a row join.
- **Every read is tenant-filtered, then declared working-company-filtered for interactive users, then policy-filtered, then user-filtered.** Tenant comes from the trusted context (`Workspace` in `src/platform/access/`), never from the query. Data policy is applied on the columns the dataset declared; no grant means zero rows. Company-owned datasets explicitly declare their company column independently of their data policy; do not infer it from policy, field names, or the module. A missing active company means zero rows, even with unrestricted grants. Shared datasets explicitly declare that they are tenant-wide; missing either choice is rejected at registration, never silently treated as shared. Company context is part of the cache key. User filters only narrow. A locked filter (publication, embed) that is empty or names an unknown field means zero rows — an empty value must never read as "no filter".
- **Rights are checked before the query is validated against the dataset.** Order: normalize, find the dataset (404 `dataset_unknown`), module installed per `core_module_installations` and licensed (404), read permission of the dataset's resource (403 `dataset_forbidden`), validate with the personal-data gate, then cache, slot, compile, execute. A user without rights must not learn column names from errors, and a cache hit must never skip the rights check.
- **Every query runs read-only, time-boxed, and row-capped**: `set transaction read only`, `set local statement_timeout`, `LIMIT n + 1`, and a rollback at the end — never commit. Rollback to a savepoint is what undoes the read-only flag when the engine runs inside another transaction (tests, jobs); releasing the savepoint leaves it on for the rest of the outer transaction. `Database.transaction` in `src/platform/database/` commits (or releases the savepoint) on success, so the executor cannot use it unchanged.
- **Money is never summed across currencies, quantity never across units.** The compiler adds the currency or unit column as an implicit dimension (`c0…`), and the validator rejects a money measure without a currency column. A dataset with no currency column has no money measure.
- **Personal data.** Fields classified as end-user identifiable are invisible without the personal-data read permission — as dimension, filter, time-range column, and measure source alike. Sorting is covered because `sort` only accepts chosen keys. Pseudonymous ids may be grouped, but the names behind them are hidden unless the principal holds the right. Account data never enters a dataset. Publications, the OData feed, and embeds never carry personal data (phase 2).
- **Who the query runs as.** Dashboards, shared or not, run as the viewer: the principal comes from the requesting membership, never from the dashboard owner. Publications will run as their current owner narrowed by locked filters (phase 2).
- **The cache lives in the tenant database** (`analytics_query_cache`), never in a process-local store or a store shared across tenants or environments. The key includes tenant, dataset definition hash, normalized query, the principal's scope fingerprint, time zone, today's date, and the principal's row limit. Slot and stampede locks may live elsewhere only when their names carry nothing but the tenant id and a hash.
- **Permission codes come only from the catalog the owner approved** (KA-14, 3 October 2026; CoreERP migration `2026_10_03_120000_register_analytics_security_catalog`). Codes that reach tenant roles cannot be renamed silently. Read access to a dataset is the module's existing read permission (KA-15): modules add no permission codes for analytics. Only the Owner role holds the analytics duties automatically (PQ-04).
- **Names in code are English; user-facing text is plain Indonesian.** Screens never show `dataset`, `measure`, `tenant`, or other architecture words; they say Dasbor, Analisis, Kolom, Nilai, Saring, Bagikan, Arsipkan. No row is deleted physically; archiving fills `deleted_at` (the only exception is expired `analytics_query_cache` rows, which are computed copies).

## Declaring a dataset

When the engine is ported, every dataset decides, in this order:

1. **Company and policy.** For a company-owned resource, name the actual ownership column independently of the data policy. A unit-only resource stays tenant-wide with a policy on its unit column without inventing a legal-entity dimension. Read the module's list procedure and its service for the resource: the permission it checks and the columns it passes to `Workspace.filter` decide the dataset's permission and policy columns. Never infer policy columns from names. Use the module's exact policy code (the asset policy is spelled `asset-responsibility` on purpose; renaming it silently drops tenants' grants).
2. **Fields.** Free text, names, and pseudonymous ids are excluded (high cardinality, often personal data). A numeric column is a measure only if declared; `count` counts rows, `count_distinct` counts things. A "how many are already X" question is a **filtered measure** over a choice, boolean, or reference field using the module's status values, not a second dataset.
3. **Source.** A table plus joins when that can say it; a query source only when it cannot (currency or unit in another table, a value computed from several columns). A query source selects `tenant_id`, keeps the tenant filter, and declares every field with its classification. One dataset has one permission: split resources guarded by different permissions even when they share a table (CoreERP's `asset-sales` and `asset-scraps`).
4. **Version.** Adding a key is free; renaming a key needs a new version with the rename mapping; removing a key needs a new version and leaves affected widgets reading "column no longer available" (`field_removed`). Changing a policy column moves the visible rows exactly as it would on the module's list screen, so ship it with the parity test.

Each dataset gets tests for tenant isolation, policy parity against the module's list endpoint for four users (whole organization, unit A, unit B, no grant), 403 without the read permission, money per currency, every filtered measure over seed data that mixes the filtered values, and month/day buckets for one row at a month boundary under UTC, WIB, WITA, and WIT (a `date` column never shifts; a `timestamp` column holds UTC). Seed so a wrong policy column shows up as wrong rows (the opposite unit on the financial-dimension column), then break the policy column once and watch parity go red.

## SQL generation rules

- Never alias the base table when the tenant predicate is injected by table name. Query-source datasets use the engine's reserved source alias, and the outer query filters `tenant_id` again.
- Joins always carry `alias.tenant_id = <base>.tenant_id`; data joins add `alias.deleted_at IS NULL`; label joins include archived rows so archived masters keep their names. Every join is a `LEFT JOIN` with its conditions in `ON`, attached only when the query names one of its columns, so adding a grouping never changes the row count.
- Select dimensions as `d0, d1…` (with `d0_label` for module references), implicit currency/unit as `c0…`, measures as `m0…`, and group and order **by alias**. A parameterised expression repeated in `GROUP BY` becomes a different parameter and PostgreSQL rejects the grouping. Join aliases of the form letter+digits are reserved by the engine and rejected in datasets.
- Time buckets: `date` → `date_trunc(g, col)::date`; `timestamp` (UTC, the repository default) → `date_trunc(g, (col at time zone 'UTC') at time zone '<tz>')::date`; `timestamptz` → `date_trunc(g, col at time zone '<tz>')::date`. The zone is a literal checked against the runtime's list of IANA zones (`Intl.supportedValuesOf('timeZone')`). Never `to_char()` a `timestamptz` — it uses the session zone. Weeks start on Monday, written explicitly. Relative ranges (`@this_month`…) are computed in the user's zone from the principal's clock.
- Measure filters compile to `FILTER (WHERE …)` with bound parameters; `sum` is wrapped in `coalesce(…, 0)` — around the filter, `coalesce(sum(x) filter (where …), 0)`, since `FILTER` belongs to the aggregate call; `avg/min/max` stay null on empty groups.
- A descending sort on a nullable column (any dimension; `avg/min/max` measures) is preceded by an `IS NULL` key repeating the column's expression, because PostgreSQL does not accept an output alias inside an `ORDER BY` expression.
- Totals reuse the same filtering steps, group only by the measures' currency/unit columns under the same aliases as the result, and ignore `limit`.
- Gap filling happens after the query: zero for `count`/`sum`, empty for `avg/min/max`, per combination of the other dimensions, and skipped when the result is truncated, the first sort is not the period, or the fill would exceed the point or row limit.
- User filter values go through one filter-expression parser (CoreERP's K-30 BC syntax) — bound parameters only. A filter on an unknown column is rejected, never ignored.
- No SQL built by interpolating identifiers that did not come from a registered dataset. Every identifier is checked against the dataset's declared columns and quoted; every value is a bound parameter (`$n` through `Database`). Bind ids untyped or as `uuid`, never cast to a different type (`operations-metta-bun-elysia`).
- Decimals leave the server as strings; `count` as an integer.

## Dashboards and storage

- `analytics_dashboards`, `analytics_widgets`, `analytics_saved_queries` are tenant tables with audit columns, `version`, and their triggers, already in the baseline.
- Sharing rules (copied from report presets in CoreERP): private is owner only (others 404), shared is visible to every `dashboard.read` holder and editable with `shared-dashboard.update`; visible but not editable answers 403 with the reason.
- Path ids resolve only inside the active tenant (another tenant's id is 404 before the handler runs). CoreERP deliberately did not compare tenants a second time in the sharing check, so that its tenant isolation test could prove the single guard red. Do not "fix" it by adding a second check.
- Every change claims the row version (428 without a version, 409 for a stale one; `expectedVersion` in `src/platform/http/`). Use the `ETag` from the response.
- Widgets are validated on save against the current dataset and the **saver's** rights: unknown visual parts are rejected, not ignored. The saver's rights are not stored. A title or TTL change does not re-validate the query, so a widget whose column vanished can still be renamed or archived. Reading maps renamed keys and reports `field_removed` or `dataset_unavailable` instead of a 500.
- Widget count per dashboard is checked under the dashboard row lock; layout accepts only that dashboard's widgets, 12 columns.
- Archiving a dashboard archives its widgets; no row is deleted physically.

## Screens

Apply `operations-metta-ui` and `operations-metta-page-standard`. What CoreERP's analytics screens taught:

- Charts use `@operations-metta/ui/chart` (Recharts in CoreERP's `packages/ui`) with the `--chart-1…5` colours, loaded lazily. Every chart has a table fallback and an `aria-label` summary; colour is never the only signal.
- Grid widths come from a full class map (`lg:col-span-6`), never `col-span-${w}` — Tailwind never sees a composed class.
- All analytics number formatting goes through one formatter (`Intl` `id-ID`, compact "Rp 1,3 M"). It writes whole values without decimals and fractional values with full decimals (`Rp 240.500.000,50`) because Chrome and Node disagree on rupiah fraction digits. "Dihitung pukul …" uses the result's time zone and prints the zone.
- Widgets load when visible, fail individually with an actionable message, and show when their data was computed. Widget menus say Arsipkan, not Hapus.
- Overlays pass `portalContainer` to every `Select`; URL-owned state (explorer query, slicers) is derived from the URL each render, never copied into `useState`.
- **The five query steps are one component** (Data, Nilai, Kelompokkan menurut, Saring, Periode) serving both the widget builder and the explorer; the builder adds Tampilan and Pratinjau. The caller owns the state (builder: draft in state, explorer: URL).
- **Explorer state is the URL**: `?q=<compact query JSON>&view=<type>`, read on every render and written with a replace navigation. The server never reads it, and a truncated link opens an empty analysis with a notice.
- **Preview** waits 500 ms after the last change and aborts the previous request with `AbortController`; opening the screen and Muat ulang do not wait. Dim the previous result while the next one computes. A query the server rejects (422) cannot be saved from the screen.
- The screen's list of which view types fit which query mirrors the server's widget validation, with a visible reason when disabled. Change both together: the server decides, the screen only keeps users from building what will be refused.
- **Screen words**: widget = "bagian", saved query = "analisis tersimpan", dataset = "data", measure = "nilai". Server messages that reach the screen use the same words (no "widget", "query", or "tile" in text a user reads); the `analytics.*` codes do not change.
- Widget text is plain text: never render it as HTML or Markdown.

## Outside the runtime (phase 2, plan only — no code in CoreERP either)

- Publications reference a saved query or dashboard, list allowed integration clients, carry locked filters, and may suppress groups smaller than *k*.
- Callers outside read **publications only** (KA-11), via integration clients with scopes `analytics.read` / `analytics.embed`. Every outside surface is a hand-written contract under `contracts/integration/analytics/` (`operations-metta-architecture`, contract decision gate). The screen API is Core-UI-only, so it is not a contract.
- OData accepts Basic (`client_id:secret`) and a Web API key in the query string only on OData routes; the key is stripped before logging and scrubbed from proxy and error-report traces.
- Embed tokens: 32 random bytes, stored as sha256, short-lived, bound to one publication, one origin, and locked parameters; delivered by URL fragment then `postMessage`; the embed route has no session and no cookies and sends `frame-ancestors` for registered origins only.
- Formulas are a small closed language compiled to SQL (KA-19), not DAX. `compare` and `formulas` are rejected as "not available yet" until then, never silently ignored.

## Pitfalls

Each of these cost time while building the engine in CoreERP.

- Treating a numeric column as a measure. Only declared measures exist.
- Guessing the policy column (`financial_dimension_org_unit_id` instead of `responsible_org_unit_id` shows other units' assets). The parity test exists to catch exactly this.
- Filtering `tenant_id` by hand in a test or dataset when the engine is supposed to add it: the query stays right even if the engine's filter is removed, so the guard stops being measurable.
- Committing a read query, which leaves `READ ONLY` and `statement_timeout` active for the rest of an outer transaction.
- Caching tenant results anywhere but the tenant database.
- Letting `count` stand for "distinct things": it counts rows; use `count_distinct`.
- Testing the cache with a stub principal whose scope fingerprint is empty: different reaches share entries and isolation tests pass for the wrong reason. Use a real principal.
- Binding compressed bytes to a `bytea` column as a string: PostgreSQL rejects it as invalid UTF-8. Bind a byte array.
- A slot lease shorter than two statement timeouts plus a few seconds: one query runs two statements (result and totals), and a lease that expires mid-query frees the slot exactly when the server is busiest.
- Logging a filter value without masking it: values on personal, person-id, and unknown fields are hidden, and the log hash is taken from the masked form.
- Believing a guard that never failed: a `catch` that returns `null` or `[]` hides the failure it should report. See each guard red once before trusting it, and record in the pull request how you broke it.
- An emptied filter in a JSON body arriving as `null` or `""`: the parser must read both as empty, or the screen gets a 422 for a field the user cleared.
- Filtered measures and personal data: the gate checks a measure's source column only when it is a dataset field. A `min`/`max` over a column excluded from the field list has no classification and is not checked; keep it that way until the validator closes the gap.
- **Escape inside a `Sheet` closes the whole `Sheet`.** A combobox inside a Radix dialog forwards Escape to the dialog and the half-built query is lost. Stop it with `onEscapeKeyDown` that checks `event.target.closest('[data-slot="combobox-content"]')`. Every `Select` in a `Sheet` also needs `portalContainer`, or the list opens under the sheet and cannot be picked.
- Copying the explorer query into `useState`: the link and the screen drift apart, and the analysis cannot be shared. Derive it from the URL each render.
- Running a preview per keystroke, or letting a slow old answer overwrite a new one: debounce 500 ms and abort the previous request.
- Saving a widget whose filter text was never parsed: an unreadable filter (a non-number in a number field, a date that is not on the calendar) is saved and only fails when the part is computed. Parse filters on save, not only on run.
- Writing "widget", "query", or "tile" in a server message a user will read.

## Commands

From the repository root: `bun run typecheck`, `bun test`, `bun run format:check`, `bun run check:boundaries`. Datasets, the compiler, and the executor need tests against real PostgreSQL; a fake database cannot show tenant leaks, read-only rollback, or time-zone buckets.
