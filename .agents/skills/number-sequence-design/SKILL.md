---
name: number-sequence-design
description: Design or audit number-sequence references, prefixes, scopes, ranges, defaults, and previews for operations-metta modules, and callers of `NumberIssuer` in `src/foundation/number-sequence/`. Use whenever creating, porting, or reviewing a module that owns master data or transaction documents, even when the user has not explicitly mentioned numbering; also use for the `app_number_sequence_references` and `tenant_number_sequences` rows, migrations that seed or change them, imports, and number-sequence UI.
---

# Number Sequence Design

## Start from zero context

1. Read `AGENTS.md`, section Kode dan nomor dokumen, then CoreERP's [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md).
2. Read the owning module and, when the feature is being ported, CoreERP's manifest for it. Otherwise inspect only the relevant domain docs, navigation, UI labels, API contracts, schemas, and migrations needed to identify business records.
3. Read the approved number-reference decision from `module-discovery`; do not reopen whether a record needs a number unless the design changed. Automatic numbers exist only for transaction documents and main masters people search by code (owner decision, 4 November 2026). Small setup masters get no number sequence.
4. Treat each approved readable business identifier as a **reference**, following Dynamics 365 terminology.
5. Classify every candidate as:
   - **Master**: a main business record people search by code, such as an asset.
   - **Transaction**: a document or event with a lifecycle, such as an order, receipt, journal, or invoice.
6. For every candidate, determine the reference code, business title, scope, prefix, continuity, manual-entry policy, reset period, range, numeric width, segments, and preview.
7. Group all unresolved prefixes or document policies into one concise question. Do not edit uncertain declarations and never invent an answer silently.
8. Declare every approved reference where the owning module's references are declared. Never hardcode module-specific reference names or prefixes in Core. In CoreERP that place was the module manifest; this repository has no manifest yet, so ask the product owner where the first new reference is declared.
9. Verify that every declared reference reaches `app_number_sequence_references` and a tenant sequence in `tenant_number_sequences`, so `NumberIssuer.issue` finds an active sequence for it.

`module-discovery` owns the decision whether a record needs a number. This skill owns the approved reference's technical design and configuration.

## Follow the Dynamics 365 model

Use these Microsoft Learn references when current behavior must be checked:

- [Number sequences overview](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/number-sequence-overview)
- [Set up number sequences using a wizard](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/set-up-number-sequences-wizard)
- [Set up number sequences individually](https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/set-up-number-sequences-individual-basis)

Apply the same direction:

1. The owning module declares the references it requires.
2. Automatic generation gathers all declared references rather than guessing from database tables.
3. An administrator can review the generated code, minimum, maximum, continuity, scope, and format before use.
4. A declared reference can be deliberately excluded; absence must be an explicit decision, not an accidental omission.
5. A number sequence must be associated with its reference before that business record can request a number.
6. Scope controls independent counters even when the scope segment is not printed in the formatted number.
7. Prefer non-continuous numbering unless a regulatory or legal requirement demands gap prevention.
8. Do not convert a used non-continuous sequence into continuous. Create a new policy/sequence when the legal behavior changes.

Map that model to this repository:

| Dynamics 365 | operations-metta |
| --- | --- |
| Module number-sequence references | `app_number_sequence_references` rows for the owning module (declared in the CoreERP manifest; declaration place here not decided) |
| Generate wizard | Materializing every declared reference for a tenant — not ported |
| Number sequences page | CoreERP's **Atur nomor** screen — not ported |
| Reference association | The reference code passed to `NumberIssuer.issue(reference, key)` |
| Shared, Company, Legal entity, Operating unit | Tenant, legal entity, operating unit (`scope_type`) |
| Constant and alphanumeric segments | Segments `NumberIssuer` supports: `constant`, `number`, `context`, `year`, `scope`, `fiscal_year`, `fiscal_period` |

Keep intentional differences visible:

- The product default is active `1-19999` with a five-digit numeric segment; do not claim that this exact range is a Dynamics 365 default.
- Continuous numbering together with manual entry is forbidden.
- Dynamics 365 supports incrementing alphabetic `&` segments; this repository does not. Report the gap instead of emulating it with a prefix.
- Tenant configuration and counters live in durable rows in the tenant database (`tenant_number_sequences`, `number_sequence_counters`, `number_sequence_allocations`, `number_sequence_issues`); do not copy Dynamics 365's in-memory non-continuous cache design. Several Bun processes and instances serve one tenant, so nothing about a counter may live in process memory.
- `NumberIssuer.issue` serves non-continuous sequences and replays the same number for the same idempotency key. Continuous sequences need reserve/confirm/cancel, which has not been ported; the issuer refuses them.

## Automatic defaults

Use these defaults when the user has not specified another approved policy:

```yaml
status: active
scope_type: tenant
is_continuous: false
allow_manual: false
reset_period: never
preallocation_enabled: true
preallocation_quantity: 20
minimum_number: 1
maximum_number: 19999
segments:
  - type: number
    length: 5
```

If an approved prefix exists, place it before the number segment:

```yaml
segments:
  - type: constant
    value: ENTA
  - type: number
    length: 5
```

Require the UI preview to show both endpoints, for example `ENTA00001 - ENTA19999`, before saving. Ensure the maximum fits the numeric width.

## Scope, reset, and lifecycle

- Choose the narrowest scope that owns uniqueness:
  - `tenant` when one sequence is shared across the business.
  - `legal_entity` when each legal entity owns its counter or legal series.
  - `operating_unit` only when each unit truly owns an independent series.
- Add a scope segment only when users need to recognize the scope from the formatted number. Counter separation does not require printing it.
- Keep `reset_period: never` for ordinary master data.
- Propose calendar or fiscal reset only when the document policy requires it, and include a year/period segment so values cannot collide after reset.
- Use separate references when lifecycle, legal requirement, scope, reset, or continuity differs.
- Do not change structural format, scope, reset, or continuity after numbers have been issued.
- Master references use non-continuous mode, so gaps are allowed. Continuous mode is only for documents that are actually audited.

## Prefix rules

- Every reference must declare a prefix of exactly four uppercase letters (`A-Z`). A missing, shorter, longer, numeric, or mixed-case prefix fails the audit.
- Build the first three letters from the user-facing business title, then append the one-letter module code. The module code is the same final letter for every reference in a module and is agreed as module vocabulary; never use a table name or internal code.
- For a module audit, inventory every business reference first and assign all approved prefixes in one pass. Never seed only the examples already discussed while leaving sibling references blank.
- CoreERP approved these asset-management mappings before the 4 November 2026 rule. Reuse a prefix only for a record that still gets a number under that rule; setup masters such as conditions, manufacturers, and checklist items are decided again when they are ported, and most of them lose their number sequence:
  - `Entitas aset` -> `ENTA`
  - `Grup aset` -> `GRPA`
  - `Kategori aset` -> `KTGA`
  - `Jenis aset` -> `JNSA`
  - `Kondisi aset` -> `KNDA`
  - `Pabrikan aset` -> `PBRA`
  - `Item checklist maintenance` -> `ICMA`
  - `Analisa maintenance` -> `ANMA`
- These mappings are explicit project vocabulary, not an algorithm to reuse blindly in another domain.
- If a new title has no approved first-three-letter abbreviation, the module code is unknown, or the resulting four-letter prefix collides with another reference in the same module, ask once with the complete unresolved list. Do not leave the default prefix empty and do not silently invent a collision.

## Transaction rules

For every transaction reference:

1. Identify the actual business document and lifecycle from the owning module.
2. Check the corresponding current Dynamics 365 documentation on Microsoft Learn when an equivalent document exists.
3. Propose the reference code, familiar document abbreviation, scope, reset, continuity, manual-entry policy, range, segments, and first/last preview.
4. Explain briefly when legal requirements justify continuous numbering.
5. Ask the user to approve the proposal before editing the declaration.

Do not create a generic transaction number when distinct documents have different posting, cancellation, fiscal, or legal behavior.

## Declaration and verification

### Check persistence, not only the issuer

Compare the declared reference, materialized scope, caller context, document columns, active-record unique index, and lookups. A legal-entity counter with a tenant-wide document index fails when a second company receives the same number. If several references share a table, include their document-kind discriminator in the uniqueness namespace. Soft-deleted records need the active-record partial index (`WHERE deleted_at IS NULL`).

Fixtures must derive scope from the declared reference using the production default-scope rule and create real organization rows. Never force all references to `tenant` to simplify tests. Exercise two legal entities receiving the same formatted number and successfully persisting documents, rejection of a duplicate in one scope, and idempotent replay. Follow documents through the numbered records they generate.

An in-process issuer can still suffer database failures and bugs. Translate only known validation failures to 422 (`failSequence` raises `number_sequence_failed`); never catch every error and classify it as validation. Unexpected failures must reach the normal error path as 5xx, with a durable user-facing failure message.

Keep reference-to-document index coverage so a new scoped reference cannot silently skip verification, and prove the guard rejects a tenant-wide index. CoreERP's asset module did this in `NumberSequenceScopeTest`; no such test exists here yet. The rationale is in [`docs/dev/14-number-sequences.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/14-number-sequences.md#scope-nomor-harus-sama-dengan-indeks-dokumen).

Verify a migration on an empty database (`bun run migrate`) as well as on an existing one. Do not rely on a later step to add a column needed by an index being created inside that migration.

CoreERP declared references as module-owned data in the manifest, in this shape:

```yaml
number_sequences:
  references:
    - code: owning-module.business-reference
      name: Business title
      default_prefix: ABC
      allowed_scopes:
        - tenant
```

Then verify:

1. The declaration is accepted and reaches `app_number_sequence_references`.
2. Every declared reference has exactly one four-letter uppercase prefix, all references share the module's final letter, and prefixes do not collide within the module.
3. A tenant that has the module gets every declared reference exactly once.
4. New defaults are active and bounded.
5. All references appear in the number-sequence screen with first/last previews, once that screen exists.
6. Save persists after reload and validation errors are visible.
7. Automatic issue is idempotent and unique within scope.
8. Continuous flows, when approved, use reserve/confirm/cancel and recovery.

## Required audit output

Return a compact decision table:

| Reference | Type | Prefix | Scope | Reset | Continuous | Manual | Range | Preview | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Mark unresolved cells as `needs user approval`. Do not mark the audit complete while any required decision is unresolved.
