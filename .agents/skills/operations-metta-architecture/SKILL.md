---
name: operations-metta-architecture
description: Guard operations-metta architecture boundaries, organization model, authorization, contracts, and lifecycle truth. Use when changing tenant or organization scope (`src/platform/access/` Workspace), legal entities, operating units, hierarchies, workforce/positions, roles/permissions/duties, the module catalog, entitlement, module installation, Core layers (`src/platform/`, `src/foundation/`, `modules/`), number sequences, migrations in `database/migrations/` or `modules/<module>/database/migrations/` (`bun run migrate`), or module availability UI/API. Also use when touching any surface reachable from outside the runtime — `contracts/`, `*.internal.routes.ts`, `*.integration.routes.ts`, published events, webhooks, event envelopes or versions — and before calling a module finished (load and correctness gate).
---

# operations-metta architecture

Preserve the distinctions between the SaaS tenant boundary, business organization model, authorization, commercial rights, deployed code, and live runtime state.

## Canonical sources

This repository's `AGENTS.md` is the first source: sections Susunan repo, Aturan module, Database, Kode dan nomor dokumen, Kapan sebuah alur dianggap pindah, and Kontrak. CoreERP stays the behaviour reference until every flow is ported; its design documents are frozen but readable. Read only the sections relevant to the task:

- [`docs/dev/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/README.md) is CoreERP's design index.
- [`docs/dev/01a-tenant-and-org-hierarchy.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/01a-tenant-and-org-hierarchy.md) defines the organization model.
- [`docs/dev/02-module-standard.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md) defines module ownership, soft delete, and Core reads of module tables.
- [`docs/dev/03-release-and-on-prem.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/03-release-and-on-prem.md) defines the N-1 schema rule that makes rolling back an image safe without touching the database. Releases themselves belong to control-plane-metta.
- [`docs/dev/04-api-and-integration.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md) defines contracts, event names, and the envelope.
- [`docs/dev/08-query-scopes-and-schema.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/08-query-scopes-and-schema.md) defines organization persistence and query scope.
- [`docs/dev/09-identity-and-access.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/09-identity-and-access.md) defines workforce and responsibility-based access.
- [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md) defines number sequences.
- [`docs/dev/20-load-and-concurrency-testing.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/20-load-and-concurrency-testing.md) defines load and concurrency testing.
- [`docs/references/dynamics-365-organization-model.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/references/dynamics-365-organization-model.md) records the Microsoft Dynamics 365 sources and the mapping decisions.

The Dynamics reference governs organization, workforce, and responsibility-based security inside a tenant. The tenant, entitlement, deployment, and on-prem boundaries remain separate decisions.

## Organization model guard

- Tenant is the contract and isolation boundary, not the root organization.
- Organization identity is stable and has exactly one classification: legal entity or operating unit.
- Legal entity owns legal, ledger, tax, currency, fiscal-calendar, and statutory consequences. Operating unit divides operational resources and processes; it cannot replace a legal entity when those consequences exist.
- Establishment is an operating unit placed in an effective hierarchy with purpose `Enterprise establishment structure`; it is not an `operating_units.type` value or a second legal entity.
- Parent-child belongs to a purpose-scoped, versioned hierarchy. Never store permanent `parent_id`, depth, or a single universal tree on organization identity.
- Preserve draft, publish, effective-date, and historical versions. Reparenting creates or changes a draft; it does not rewrite published history.
- Department is an operating unit. Job, position, worker assignment, position reporting, project WBS, warehouse/bin, chart of accounts, financial dimensions, and sales territory are separate domain structures.
- Every tenant-owned transaction/event carries `tenant_id`; legal/accounting facts also carry `legal_entity_id`; operational facts carry `org_unit_id` when relevant. These IDs are trusted context or opaque contract references, never cross-module foreign keys.
- Access follows role assignment → security role → duty → privilege → permission. Organization scope names the organization and the hierarchy used for descendants; hierarchy placement does not grant permission by itself.

If a requested model conflicts with these rules, stop and report the conflict against the canonical source instead of adding a compatibility layer.

## Trusted context in this repository

`Workspace` in `src/platform/access/` is the trusted context. `Workspace.resolve` reads the signed-in user from the session, the active tenant membership, the selected legal entity and operating unit, the module's permissions through the role chain, and the data policy grants for one policy code. A module gets it through its own helper (`moduleWorkspace` in `modules/<module>/src/module.ts`) and passes it to its services.

- `guard(resource, action)` rejects a request without the permission `<module>.<resource>.<action>`.
- `filter(alias, start)` returns the tenant, active legal entity, and policy predicate for a query; `require(legalEntityId, orgUnitId)` and `allows(...)` check one record.
- Tenant, company, and unit never come from a value the client sent without that check. Do not filter `tenant_id` by hand from a request field.

## One module shape

A module is a folder under `modules/<module>/`, one Bun workspace package (`@operations-metta/<module>`), running in the Core process against the same tenant database.

| | Module under `modules/` |
| --- | --- |
| Process | the Core runtime |
| Database | the same tenant database as Core |
| Table separation | a table name prefix, e.g. `aset_` |
| Calling Core | an import of a Core `index.ts` through `@core/...` |
| Contract required | only surfaces reachable from outside the runtime |
| Its own service token | no |

What holds, and is never relaxed (`AGENTS.md`, Aturan module):

- A module never touches another module's tables. PostgreSQL does not refuse a cross-module `JOIN`, so never write that the database guards this boundary. `bun run check:boundaries` rejects a module importing another module and the `aset_` prefix inside `src/`; it does not read SQL, so a query naming another module's table is caught only in review.
- Every module table carries `tenant_id`, and every query filters on it.
- Event names, envelopes, and versioning rules do not change.

The reverse direction is different: **Core may read module tables directly** — for reporting, analytics, or any engine that serves every module. This is the owner's decision of 3 October 2026. What stays forbidden is a module reading another module's tables. The reason is commercial as much as technical: a customer may buy a single module, a module that reads another cannot be installed alone, and Core is present in every installation. A read performed by Core follows four rules:

- Table and column names come from what the module registered, never hard-coded in Core. The module may not be installed, and the repository forbids hard-coding module names.
- It filters `tenant_id` and applies the data policy the module declared for that resource, through the fields the module named for it (see the data policy gate below).
- A read that combines several modules is offered only when every module involved is installed for that tenant.
- It reads only. Writes go through the owning module, where validation, numbering, workflow, and posting live.

How a module registers what Core may read has not been ported: CoreERP used the module manifest and dataset classes. Decide the place with the product owner before building it.

The `internal/v1` REST surface called by control-plane-metta is owned by this repository (`AGENTS.md`, Kontrak). It is the boundary for outside callers and third-party integrations, never module to module.

## Module lifecycle states

| State | Meaning | Valid source of truth |
| --- | --- | --- |
| Catalogued | The product and its contracts are known. | The module catalog (`apps` and the catalog tables from the CoreERP baseline) |
| Entitled | A tenant is allowed to use the module. | Tenant entitlement (`tenant_app_entitlements`) |
| Installed | Module migrations ran successfully and the installation row says so. | `core_module_installations` |

Never derive a later state from an earlier state:

- Entitlement is not installation.
- A catalog entry is not proof that the module is installed for a tenant. A module in the Core runtime has no container and no database of its own; what must exist is the migration record (`schema_migrations`, written by `src/migrate.ts` per owner) and the installation row for that tenant.
- `active` or `trial` entitlement cannot drive UI labelled "installed".

No code in this repository reads or writes `core_module_installations` yet; the table comes from the baseline. A module runs in this process: if Core is up and the module is installed, the module is up. There is no separate "ready" state.

## Required workflow

### Permission and duty decision gate

Before changing a module's entry points, roles, duties, privileges, permissions, protected menus, or protected procedures:

1. Classify the requested access as a resource and action, never as a job title or a menu alone.
2. Keep permissions granular enough that one resource can be managed without granting sibling resources.
3. Model each layer as itself. An **entry point** is the protected thing (`form`, `menu_item`, `api`, `report`, `action`). A **permission** pairs one entry point with one access level. A **privilege** bundles permissions into one task. A **duty** bundles privileges into part of a business process. Tenant roles then compose duties.
4. If the user has not explicitly stated which resources/actions belong together, do **not** edit code, migrations, or documentation as though the choice were settled. Recommend the smallest sensible permission/duty split, ask for confirmation, and wait.

Example: “master data” is not a sufficient scope. Recommend separate `entities.manage`, `groups.manage`, and `categories.manage`, then ask whether a combined “manage master” duty is wanted.

Permission codes, duties, and policy codes already granted to tenant roles are contracts. Renaming one silently removes access from every role that holds it.

#### The four layers must never be collapsed

The chain `role → duty → privilege → permission → entry point` has to survive into storage, not just into prose. `Workspace` resolves it through `security_role_duties`, `security_duty_privileges`, `security_privilege_permissions`, and `permissions`:

- Persist four distinct rows. A privilege that carries the same code as its only permission is the chain collapsed into one layer copied three times, and it silently removes the level tenants need in order to grant a task without granting the whole duty.
- Privilege codes must differ from permission codes. Reject a declaration that reuses one.
- `access_level` is declared, never derived. Splitting it out of a permission code string (`…archive` → access level `archive`) invents levels that do not exist.
- Valid access levels are exactly `read`, `update`, `create`, `correct`, `delete`, and `invoke`. Delete-lifecycle actions (`archive`, `void`, `retire`) use `delete`; a service operation with no CRUD meaning uses `invoke`.
- In CoreERP these declarations lived in the module manifest (`app.yaml` plus `manifest/`) and travelled with the release. This repository has no manifest yet; the catalog rows came from the CoreERP baseline. Where a module declares new security objects here is not decided: ask the product owner before creating a place.

#### Security role hierarchy

A security role may be built on other roles: a parent inherits the duties of every descendant (`security_role_children`). A role can have several parents and several children, so this is an acyclic directed graph, not a tree. Reject cycles at write time, and treat an inactive role as granting nothing and bridging nothing to its own children — `Workspace` already skips inactive roles while walking the graph. This is a hierarchy of responsibility and is unrelated to organization hierarchy; never resolve one against the other.

Security objects are **declared with the code** and travel with it. Tenants compose roles and duties from those declarations; they never mint new codes. Dynamics 365 F&O allows security objects to be created through the UI, which stores them only in that environment's database under generated GUID names — unreviewable, unversioned, and lost on refresh. CoreERP deliberately rejected that model ([`docs/dev/09-identity-and-access.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/09-identity-and-access.md)). Never add a path that lets a tenant create a permission code or entry point at runtime.

### Number sequence decision gate

Automatic numbers exist only for transaction documents and main masters searched by code (`AGENTS.md`, Kode dan nomor dokumen). Before adding or changing a number reference, its configuration, or a caller of the issuer:

1. Confirm the owning module, reference code, and allowed tenant/legal-entity/operating-unit scopes.
2. Confirm whether the reference is non-continuous, continuous, or allows manual values; reject continuous plus manual.
3. Confirm reset-period, format segments, counter limit, and whether preallocation is enabled. Preallocation must always be durable rows in the tenant database; never cache a counter or a number range in process memory, because several Bun processes and instances serve the same tenant. Non-continuous preallocates a block per scope. Continuous may also preallocate, but only as durable rows in the pool that stay individually accounted for, so a gap is impossible.
4. Confirm the reset period explicitly: `never`, `calendar_year`, `fiscal_year`, or `fiscal_period`. A reset period other than `never` requires a format segment that varies with that period.
5. Fiscal reset requires a legal entity in context, because the fiscal calendar belongs to the legal entity and never to an operating unit. Legal-entity scope resolves it from the scope itself. Operating-unit scope is allowed, but the caller must supply the legal entity per request — an operating unit is deliberately shared across legal entities, so it cannot imply one — and that legal entity becomes part of the counter's scope key. Tenant scope cannot use fiscal reset: it names no organization, so the caller's argument would be the only thing deciding the counter's identity.
6. Anything that splits a counter belongs in the scope key, never only in the period key. The uniqueness index is bounded by period, so a fact that varies the period while the scope key stays constant lets one declared scope hold two counters and issue the same document number twice without the database noticing.
7. A module calls `NumberIssuer` from `src/foundation/number-sequence/` and never reads or writes the counter, pool, issue, or reservation tables itself. Sharing the connection is the point — it lets a number be issued inside the document's own transaction, so a failed document leaves no gap. `NumberIssuer.issue` serves non-continuous references only; continuous reserve/confirm has not been ported.
8. If any of those choices are absent from the request, recommend the smallest safe setting and ask before changing code or documentation as if it were settled.

### Data policy decision gate

For numbered records, apply the persistence gate in `number-sequence-design`: document unique indexes and lookup namespaces must match reference scope. An issuer-only test is insufficient. Fixtures must honor the reference scope, including cross-company persistence when numbering is per legal entity. See [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md), "Scope nomor harus sama dengan indeks dokumen".

Before creating or changing a module resource that stores or exposes operational records:

1. Classify the resource as tenant-wide reference data, legal-entity-scoped data, or data that needs an organization security policy. Do not make an operating unit a universal filter merely because it exists in the workspace.
2. For a policy-scoped resource, the module must declare one stable, namespaced policy code (for example `management-aset.asset-responsibility`, which `modules/asset-management/src/module.ts` passes to `Workspace.resolve`), the protected entry points/actions, the required legal-entity and operating-unit dimensions, and whether an organization grant may include descendants.
3. The module's contract or README must state which business record fields/relations it uses to enforce the policy. The module enforces it on its own procedures. When Core reads the module's tables itself, Core applies the same policy through those declared fields — never through its own guess about which column means legal entity or operating unit.
4. Core owns the policy catalog, role-assignment grants, hierarchy/version resolution, effective dates, provenance, and audit. The module owns enforcement on every list, search, detail, create, update, delete, and sensitive action procedure it serves; Core owns enforcement on every read it performs itself.
5. Keep working context separate from authorization. For a declared company-owned resource, ordinary reads/writes use the trusted active legal entity in addition to tenant and policy predicates. The selected operating unit remains a default or optional filter unless the approved resource design says otherwise. Shared resources stay shared; children inherit their owner's boundary. Explicit cross-company reports/integrations retain tenant and policy enforcement and use their declared trusted context. Neither workspace selection nor a browser-supplied organization ID grants access. Do not narrow the grant resolver to the active company: users still need their other companies when switching.
6. Define and test the combination rule before implementation when more than one role, policy, grant, automatic source, or temporary source can apply. Do not silently assume union; XDS policies may intersect, while a process can have its own documented organization-grant rule.

`Workspace.filter` today applies one shape: tenant, active legal entity, and grants on `responsible_org_unit_id`. A resource whose policy column differs needs that difference designed, not forced into this filter. The backlog behind this gate is CoreERP's [`docs/todo/addNewRulestoCoreforFleksibilitas/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/addNewRulestoCoreforFleksibilitas/README.md), with the Dynamics organization, Budget planning security, and XDS references linked there.

### Shared master and layer decision gate

Core code lives in layers that mirror Business Central: `src/platform/<capability>/` (engine with no business vocabulary, used by every request), `src/foundation/<service>/` (shared business masters and services), and `modules/` (sellable business capabilities). Dependencies point downward only: Platform never imports Foundation, a module reaches Core only through a capability's `index.ts` via `@core/...`, and Core imports modules only from the process files at the root of `src/`. `bun run check:boundaries` enforces the `index.ts` door, the `@core/` prefix, and module-to-module and Core-to-module imports; Platform-to-Foundation is not checked yet, so it is held in review. The layer is a code arrangement only — it never appears in a table name, permission code, event name, or URL.

Before adding any master, decide its owner:

- **Test availability without the first module.** If a customer does not buy the module proposing the feature, can another module that needs this master or shared capability still work? If not, route the ownership decision to Core immediately: business masters belong in Foundation; domain-neutral engines belong in Platform. Do not make the other module require buying/installing the first module, copy its master, or call its private tables/API. When these rules and the business meaning already settle ownership, recommend the Core move directly instead of asking the owner to choose the same rule again. Ask only about genuinely unresolved meaning or scope.
- An external consumer of a module's process facts does not by itself turn those facts into shared masters. Separate an optional integration from a prerequisite another module genuinely needs when installed alone. Cite the consumer/domain evidence for the decision.
- It belongs in **Foundation** when it is used, or certainly will be used, by two or more modules; or it identifies a party or legal entity; or its Business Central / Dynamics 365 equivalent lives in the shared layer. Otherwise it belongs to its module. Never create a shared master inside the first module that happens to need it.
- **One master, one page.** A module never builds a competing screen for a Foundation master. Fields only one module needs live in that module's own table keyed by the master id and appear as a section of the same page — the `pageextension` / `tableextension` pattern of Business Central.
- **Buying one module loses nothing.** A module brings its own menu entry to the master pages it uses, its default duties include the rights to them, and it never depends on another module. Cooperation between two modules is an add-on installed by the second one (extension point or event), so the first stays whole without it.
- **Keep it simple and keep the BC/F&O equivalent.** Do not invent a shape when Business Central or Dynamics 365 already has one; do not build a mechanism before something real uses it.

Page sections per module and module menu entries that point to Core pages are not built; the plan and the open decisions are in CoreERP's [`docs/todo/master-bersama/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/todo/master-bersama/README.md).

Outbound integration (`internal/v1` feeds, signed push) is for systems outside the runtime only, never module to module. The finance feed contract v1 (CoreERP's `apps/core/contracts/internal/integrasi-finance.yaml`) is used by an external team; `src/foundation/finance-posting/` holds the posting service, but the feed endpoints have not been ported. When they are, its URLs, payload, signature headers, and ack rules do not change in place.

### Contract decision gate

A contract is the promise a module makes to code it does not control. It is not documentation of the code, and it is not optional once an endpoint or event crosses the runtime boundary.

This repository has no contract files yet. Where they go is fixed (`AGENTS.md`, Susunan repo): `contracts/internal/` for procedures control-plane-metta calls (`*.internal.routes.ts`), `contracts/integration/<domain>/` for outside systems (`*.integration.routes.ts`), `contracts/events/` for events. `bun run new-feature ... --audience internal|integration` creates those route files empty until Core has their authentication.

Before adding or changing anything reachable from outside the runtime — any `internal/v1` procedure, any published event, any webhook, any signed payload:

1. **Decide the transport from the semantics, not from convenience.** REST is a command or a query: "do this", "give me that". An event is a fact that already happened. A synchronous call documented as a channel, or a fact modelled as a command, is a wrong contract even when the code works.
2. **The contract is written by hand, never generated from code.** A generated file cannot be the source of truth for a promise, because changing the code silently changes the promise. An OpenAPI document generated from the oRPC router, if one is ever produced, is never the contract.
3. **An undocumented cross-runtime surface is an incomplete change.** If a route exists that control-plane-metta or an outside system calls and it is absent from the contract, the change is not finished. Absence is the most common failure here and it is invisible in tests — nothing fails when a contract omits an endpoint. CoreERP guarded it with `contracts/bundle.py` and `check-contract-coverage.py`, run in CI; this repository has no coverage check yet. Until one exists, compare the router with the contract by hand in every change that adds a route. When one is built, three things decide whether it is worth having:

   - **Read routes from the router, not from the route file's text.** Paths here are built from template strings (`/api/modules/${moduleId}/v1/aset`), so a regular expression over the file reports a clean run while missing most of the surface. Walk the oRPC router object.
   - **Expand path templates whose parameter carries an `enum` before comparing.** One templated path can legitimately document several concrete resources. Compared literally it reports real, documented endpoints as missing, and a check that keeps raising false alarms is a check people learn to skip — worse than having none.
   - **Name deferred gaps; never allowlist them silently.** A gap that is known and owned belongs in an explicit list carrying its reason, printed on every run. An entry that no longer matches a live route must fail, or a stale exemption quietly excuses whatever route later claims that path.

   **Readers outside the runtime get one root per domain, not one root for everything.** A finance integration and a later HR integration each get their own spec under `contracts/integration/<domain>/`, with their own guide and version, so a partner reads only what it uses.
4. **Code must not accept what the contract forbids.** A handler validating a field the contract declares impossible — `additionalProperties: false` with that key absent — advertises a capability nobody can use. It is not merely dead code; the next reader concludes the publisher can send it. Where the contract defers a field, the code waits for the contract, never the other way round.
5. **Events carry the full envelope and an explicit version.** Channel names are `module.aggregate.action.vN` per [`docs/dev/04-api-and-integration.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/04-api-and-integration.md#kontrak-wajib); the envelope carries `id`, `type`, `occurred_at`, `tenant_id`, `correlation_id`, and `data`, plus `legal_entity_id` when the fact has legal or accounting consequence and `org_unit_id` when an operating unit owns it. A channel without `.vN` has no way to change without breaking every consumer.
6. **Document what is true, then name the gap.** When the code does not yet satisfy the canonical rule, the contract describes the code and states the gap in `info.description`. Never write the aspirational shape — a consumer would build against a field that never arrives.
7. **A published version is immutable.** Adding a required field, removing one, or narrowing a type is `vN+1`, not an edit to `vN`. Widening an enum a consumer switches on is also breaking.
8. **Both sides move together.** Publisher and caller live in separate repositories (this one and control-plane-metta); a change to one is incomplete until the other matches in the same piece of work. State explicitly which files in which repositories were changed. The caller's tests validate its requests against the contract file, not against a fake with fixed answers: in CoreERP, Core checked `Authorization: Bearer`, the console sent a different header, and both suites stayed green. A published event is only real when all three legs exist: the publisher writes it, the transport routes it to a URL, and the consumer has a route that accepts it. Two of the three is a fact nobody receives.

   Because such a change lands as several branches, start each from the updated default branch. `git checkout -b` branches from wherever you are standing, so continuing straight from the previous feature branch silently carries its commits along; every PR then targets the default branch and shows the same work again. When one change genuinely builds on another, branch from it deliberately and set the PR's base to that branch.
9. **Transport security is part of the contract.** Signature headers, the exact string that is signed, and the failure status belong in the spec. A consumer cannot verify a signature it has to reverse-engineer from the publisher's source.
10. **Split before the file becomes unreviewable.** Past roughly 1500 lines, break the spec into `paths/` and `components/` joined by `$ref`, and commit a bundled artifact next to the split source for tooling that cannot resolve cross-file refs, with a CI check that the bundle matches its sources. One 10k-line spec guarantees merge conflicts between unrelated features.
11. **A list of values the reader must choose from is found by searching, not by reading everything.** Give the list its own guide heading and its own schema in `components/schemas`, name every value in the parameter that accepts it, and pin all the places that repeat it with a test.
    - A list that grows is written with `examples`, not `enum`: rule 7 makes widening an enum breaking.
    - Guide headings carry no inline code. Scalar builds the search link from the whole heading text but drops the code when it gives the rendered heading its id, so the search result points at an anchor that does not exist.
    - Do not add an endpoint only to list static values; the owner chose documentation.

#### Envelope fields cannot be added retroactively

CoreERP's `core.workflow.decision` reached `v2` because `v1` shipped without `correlation_id`. The lesson is about *when* a field must exist, not about that one field:

- **A field that records what happened at request time must be persisted at request time.** A workflow decision is emitted days after the request that started it, so reading the correlation from the current request is impossible — it has to live on the aggregate (`workflow_instances.correlation_id`) before it can reach the event. Any envelope field describing the *origin* of a fact has this shape.
- **History cannot be backfilled.** Events already delivered without a correlation are permanently uncorrelated. This is why the cost of omitting such a field grows with time while the cost of adding it stays flat — add it when the table is created.
- **Batch envelope changes into one version.** `correlation_id` and `legal_entity_id` went out together in `v2` because making every consumer migrate twice for one envelope is a cost with no benefit. Before bumping a version, check whether any other known envelope gap should ride along.
- **A publisher must refuse to emit a payload that violates its own contract.** When a required envelope field is missing, hold the row back and report it. Sending a half-formed event moves the failure to the consumer, where it looks like a bug in code that did nothing wrong.
- **Deriving a field is part of the design, not an afterthought.** `legal_entity_id` is not on the workflow instance; it is reached through the configuration version the instance ran against. If a required envelope field has no obvious source, resolve where it comes from before promising it in the contract.
- **The caller's transport client sends what the publisher needs.** A correlation only exists if the caller supplies it (`X-Correlation-Id`). An envelope field nobody populates is a contract that is true and useless.

Before implementing module-availability UI or API:

1. Translate the user's exact noun into a lifecycle state.
2. Locate that state's persisted source of truth.
3. Check tenant and expiry scope where applicable.
4. Name props, methods, procedures, and labels after the actual state.
5. Add a test proving one lifecycle state cannot impersonate another.

Before implementing organization, workforce, or access changes:

1. Classify each noun as tenant, legal entity, operating unit, hierarchy placement, workforce fact, financial dimension, or authorization fact.
2. Identify the owning module/service and persisted source of truth.
3. Determine whether records/events need `tenant_id`, `legal_entity_id`, and/or `org_unit_id`.
4. For descendants, name the hierarchy, purpose, and effective version explicitly.
5. Add the smallest test that rejects cross-tenant references, invalid classification, hierarchy cycles/history rewrites, or scope escalation relevant to the change.

If the required source of truth does not exist, stop and report the missing registry or schema. Do not substitute entitlement, hard-coded catalog data, or optimistic UI and call it installed.

### Schema change and rollback gate

Apply before writing or reviewing any migration in `database/migrations/` or `modules/<module>/database/migrations/`. Migrations are plain SQL files applied in order by `bun run migrate` (`src/migrate.ts`), Core first, then modules, each recorded per owner in `schema_migrations`. The canonical rule is CoreERP's [`docs/dev/03-release-and-on-prem.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/03-release-and-on-prem.md), section "Perubahan skema dan mundur". Improving CoreERP's schema is allowed under the conditions in `AGENTS.md`, section Database; this gate decides how such a change ships, not whether it may.

**A bad release is rolled back by running the previous image, never by rolling back the database.** Migrations here have no down step. Restoring a backup discards every transaction written after the update, which on a clinic server means medical records and receipts.

Every release must therefore be **N-1 compatible**: the schema after release N's migrations must still work with release N-1's code.

- **Allowed in one release:** new tables; new columns that are nullable or have a default; indexes; constraints that only loosen.
- **Not allowed in the release that needs them:**
  - dropping or renaming a column or table;
  - changing a column type;
  - `SET NOT NULL`;
  - adding a required column without a default to an existing table;
  - a constraint that tightens.
- **Breaking changes use expand/contract across releases:**
  1. add the new column or table;
  2. write both and backfill;
  3. read the new one;
  4. drop the old one at least one release after no code reads it.
- **The drop migration** states its reason in a comment at the top of the SQL file, and so does a pattern that looks destructive but is safe for old code, such as widening a type. Both are reviewed decisions, not silent exceptions.
- CoreERP guarded this rule with `MigrasiKompatibelMundurTest`; no such guard exists here yet, so it is held in review.
- The id and user-id migrations (`0002_*`, `0003_*`) are one-time conversions of the CoreERP baseline before this repository has any customer data. They are not a precedent for later migrations.
- **After an update, recover in this order:**
  1. turn the feature off;
  2. roll forward to a fix release;
  3. run the previous image on the current database.

  Restoring the database happens only inside the update itself or as a human disaster-recovery decision, never as a button. Release numbering, images, and the update procedure belong to control-plane-metta.

If a requested change cannot be made N-1 compatible in one release, stop and propose the expand/contract split instead of writing the destructive migration.

## Module completion gate: concurrency and load

A module is **not finished when its tests pass**, and a flow is not ported until it meets `AGENTS.md` (Kapan sebuah alur dianggap pindah): the parity harness reports it identical to CoreERP when it computes or records money or numbers, and database-backed tests prove CoreERP's behaviour otherwise. Tests run one request at a time in one process. They structurally cannot observe connection exhaustion, lost updates, duplicate issued numbers, a tenant boundary that only leaks under interleaving, or an idempotency key that races itself.

Before reporting any new module complete, run a load test that satisfies **all** of:

| Dimension | Minimum |
| --- | --- |
| Concurrent virtual users | 1000+, sustained — not a burst |
| Distinct tenants driven simultaneously | 100+ |
| API server instances behind a load balancer | 2+, 4 recommended |
| Database | real PostgreSQL |
| Duration at full load | 90s+ after warm-up |
| Number Sequence | every issued number recorded so duplicates are found afterwards |

Multiple instances are not decoration. They are the only way to prove the module keeps no counter, no tenant identity, and no permission cache in the memory of one process. No load-test scenario has been ported to this repository yet; CoreERP's example is [`modules/apperp/management-aset/loadtest/`](https://github.com/MettaDevs/coreERP/tree/main/modules/apperp/management-aset/loadtest), and the running rules are in `operations-metta-runtime-operations`.

### Replace endpoints must hold the row they replace

An endpoint that swaps a whole set — "these are now the linked records" — deletes and re-inserts. Inside a transaction that still is not enough: two callers can interleave so one deletes, the other deletes and inserts, then the first inserts on top. The result is the **union of both sets**, which neither caller asked for and which no database constraint rejects, because every surviving row is individually valid. Take `select ... for update` on the owning row inside the transaction (`Database.transaction`), before the delete.

A join table edited from **both** ends needs more care. Locking each direction's own owner does not serialise anything — the two directions hold locks on different tables and still overwrite each other. Both directions must lock the **same** side, over the union of the old and new sets, so that any two operations touching link `(a, b)` share a lock. Take those locks in a fixed order (`order by id ... for update`) or two transactions will grab the same rows in opposite order and wait on each other forever.

Tests cannot show any of this, and neither can a code review that only reads one request at a time. It belongs in the load test.

### Correctness gate — hard, applies on any hardware

These must be **exactly zero**. They do not scale with CPU, so a slow laptop is never an excuse:

- application 5xx (a 502/504 from the load balancer is saturation, not a defect — attribute it explicitly)
- duplicate `kode` or duplicate `creation_key` within one tenant
- any child row whose parent belongs to a different tenant, or whose parent does not exist
- any read, list, or write that crosses a tenant boundary
- any permission on one resource granting access to a sibling resource
- two concurrent requests with the same `Idempotency-Key` producing two records
- any number-sequence prefix belonging to a different reference than the master that stored it

Verify these with SQL against the database after the run, not through the API. The API is the thing under test; it cannot be its own oracle.

**A scenario that never contends proves nothing.** Spreading virtual users evenly across every tenant and every record is the right shape for saturation, and the wrong shape for a race: two writers almost never meet, the run comes back green, and the defect ships. Race scenarios concentrate — many users, few records, writing deliberately conflicting values — and assert the read-back equals one of the values submitted, never a blend of them. Keep them as their own profile alongside saturation; each answers a question the other cannot.

**Every new surface needs its own scenario.** A module whose load test covers the masters it shipped with, but not the ones added later, is unverified for the part that changed. Check the scenario's resource list against the routes before claiming a module is covered.

### Latency gate — measured at sustainable concurrency

Report percentiles at the highest concurrency that still meets the SLO, not at the saturation point. Latency at saturation measures queue depth, not code.

| Operation | p95 | p99 |
| --- | --- | --- |
| Read (show, list) | < 200 ms | < 500 ms |
| Write (create, update, archive), incl. number issue | < 400 ms | < 900 ms |

Also record the **uncontended single-request budget**, which is portable across hardware in a way that percentiles under load are not:

| Path | Budget |
| --- | --- |
| No auth, no database | < 25 ms |
| Authenticated, single-table read | < 50 ms |
| Authenticated write incl. Number Sequence call | < 120 ms |

### Naming the bottleneck is part of the gate

An absolute requests-per-second number means nothing without the hardware it was measured on. What is always meaningful: **which resource saturated first**. Report it with evidence (CPU per container, connection counts, process counts). "It was slow" is not a result; "PostgreSQL burned 5.5 cores because every request opened a new connection, 36,809 sessions for 282,000 transactions" is.

Connection handling dominates before module code does. Check this first, every time: each Bun process keeps a postgres.js pool and a request reserves one connection; processes × instances × `DB_POOL_SIZE` must stay under `max_connections`. The measured settings are in `operations-metta-bun-elysia`.

If a load test cannot be run because the environment is missing (no Docker, no real database), say so plainly and report the module as unverified under concurrency. Do not report it complete.

### An undocumented module is also incomplete

The rules a module enforces — what may not change after a record exists, which value is copied rather than referenced, why one permission is split from its neighbour — are invisible in the schema and only half-visible in the code. Left unwritten they survive in one person's memory and in comments, and both are lost when that person moves on.

A module is finished when its behaviour is documented in `modules/<module>/README.md`. See the `operations-metta-docs` skill for the pattern and the coverage sweep that proves nothing was missed.

## Launcher rule

A launcher labelled "produk terpasang" must query `core_module_installations` for the active tenant, filtering `status=installed`. Entitlement may be checked additionally for authorization, never as installation evidence.
