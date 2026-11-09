---
name: module-discovery
description: Discover and propose an operations-metta module, master, transaction, or business feature before implementation, including porting one from CoreERP. Use whenever asked to add a module under `modules/`, a feature folder (`bun run new-feature`), master data, a transaction, workflow, approval, integration, or business process; research the relevant official Dynamics 365 documentation first and obtain user approval for material design decisions.
---

# Module Discovery

1. Read `AGENTS.md` (Susunan repo, Aturan module, Kode dan nomor dokumen), the owning module's `README.md` when one exists, and the relevant CoreERP canonical documents from [`docs/dev/README.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/README.md). When the feature is being ported, also read CoreERP's code and manifest for it: CoreERP stays the behaviour reference until the flow is ported, and area and feature names follow the CoreERP manifest.
2. Search official Microsoft Learn Dynamics 365 documentation for the closest business process. Report the direct links and whether the mapping is direct, adapted, or absent. Do not claim a Dynamics feature when no official reference was found.
3. Classify ownership: existing module feature, new module, Core capability (`src/platform/`) or shared business service (`src/foundation/`), or a future module whose owner is not available. Never place business facts in Core only for convenience. For every **master**, decide Foundation or module with the rule in CoreERP's [`docs/dev/02-module-standard.md#master-bersama-dan-modul-yang-berdiri-sendiri`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/02-module-standard.md#master-bersama-dan-modul-yang-berdiri-sendiri): used by two or more modules, a party/legal-entity identity, or shared-layer in BC/F&O → Foundation. A customer who buys one module must not need another module to fill a master that module uses.
4. Produce this proposal before code or migration edits, then wait for approval if a material choice is unresolved:

| Capability | Decision | Reason / Dynamics reference | User approval needed |
| --- | --- | --- | --- |
| Resource and lifecycle | | | |
| Tenant/legal entity/org-unit scope | | | |
| Security and data policy | | | |
| Number reference | | | |
| Workflow and SoD | | | |
| REST, event, reporting, attachment/audit | | | |

A new thing with no place in the table Susunan repo of `AGENTS.md` is a question for the product owner before anything is created.

## Data scope decision per resource

Ask these questions for each business resource, not once for the whole module. Present the closest official F&O behavior as a recommendation, its direct source, and whether the mapping is direct, adapted, or absent. Let the user select another supported business design and record the reason; do not silently settle an unanswered choice.

| Question for the user | Decision to record |
| --- | --- |
| Is this one shared identity/definition, a company's record, an operating unit's record, or a child of another document? | Data ownership: tenant, legal entity, operating unit, or inherited from the named parent. Foundation/module code ownership is a separate decision. |
| Does it carry accounting, tax, contractual, ledger, or statutory consequences? | Retain the responsible legal entity. Unit security may also apply; it does not replace the legal entity. |
| Should a user allowed companies A and B see only A while working in A? | Normal read/write context. Recommend active-company context for company-owned resources, shared access for shared resources, and explicit cross-company processing where needed. |
| Does access also need to follow a responsible/using unit and its hierarchy? | The policy, business fields, descendants rule, and grant combination. Do not make the selected unit a universal filter. |
| May reports, analytics, integrations, or background processes work across companies? | The explicit mode and trusted company source for each path. Jobs retain the document/request company; they never infer it from a later browser session. |
| Do you want the F&O recommendation or a different design? | Approved choice, reason, impact on related records/numbering, and any unresolved decision. |

For each proposal row, name the table or parent relation, company/unit fields, normal context, policy, and cross-company paths. A child inherits its owner's boundary; merely lacking a company column does not make it shared. A reference's code layer, table name, or existing company column does not prove its business scope.

Keep ownership, working context, and authorization separate. An unrestricted policy grant does not itself mean cross-company working context; selecting a company never grants access. The data policy declarations (CoreERP's manifest `security.data_policies`, the `app_data_policies` table here) describe access dimensions, not a declaration of automatic company filtering. Check the current implementation (`Workspace` in `src/platform/access/`) before claiming the proposal is enforced.

The scope verification matrix must cover an A+B user working in A and then B, shared records, list/search/detail, create/update/archive/post, child relations, replay/idempotency, reports/exports/analytics, and queued work where applicable. Include denied tenant/company/unit cases and numbering/unique-index scope. Treat missing enforcement on a reachable path as an implementation gap.

## Handoff after approval

Run these skills in order; do not duplicate their detailed rules here:

1. Always use `operations-metta-architecture` for ownership, organization scope, access chain, data-policy gate, contracts, and lifecycle truth.
2. Use `number-sequence-design` only when the approved proposal marks a number reference `required`.
3. Use `operations-metta-page-standard` and `operations-metta-ui` only when the approved change creates or changes a business screen.
4. Use `api-design`, `security-review`, and the contract decision gate only when the approved change exposes an API, internal command, webhook, or cross-runtime event.
5. Use the load and correctness gate in `operations-metta-architecture`, and for a ported flow that computes or records money or numbers the parity harness in `parity/` (`AGENTS.md`, Kapan sebuah alur dianggap pindah), before declaring an implemented module complete.

## Number reference decision

Automatic numbers exist only for transaction documents and main masters people search by code (owner decision, 4 November 2026; `AGENTS.md`, Kode dan nomor dokumen). Small setup masters get no number sequence: a short user-typed code like Business Central's `Code` field when people type or filter by it, otherwise only a name and an internal id. Document lines and ledger entries have no business code.

Inventory only readable business masters and documents; exclude IDs, joins, logs, and internal rows. For each candidate, explicitly decide `required`, `not required`, or `deferred`.

When required, the reference is a row in `app_number_sequence_references` for the owning module, and each tenant's configuration is a row in `tenant_number_sequences`; the module asks `NumberIssuer` in `src/foundation/number-sequence/` for a number by reference code. In CoreERP the module declared its references in its manifest and the tenant administrator adjusted them in **Atur nomor**; neither the declaration place nor that screen has been ported. Ask the product owner where a new reference is declared before adding one. Do not infer references from tables or hardcode module references in Core. After approval, use `number-sequence-design` for scope, prefix, range, format, and verification.

## Workflow and SoD decision

Propose workflow only for an approval, exception, irreversible/high-risk decision, or controlled handoff. Propose SoD when one person must not both initiate and verify/approve the same process. Otherwise state that neither is needed; do not add approval to ordinary CRUD.

## Completion

Record approved decisions in the owning module's `README.md` and contracts. Implement only approved decisions. Re-run this gate when a new document lifecycle or cross-runtime consumer is introduced.
