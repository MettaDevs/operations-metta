import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';
import { Currency } from './currency.ts';
import { Database, jsonObject, sqlErrorCode } from './db.ts';
import type { Bind } from './db.ts';
import { coded } from './errors.ts';
import { Inventory } from './inventory.ts';
import { nowIso, nowSql } from './model.ts';
import type { ReceiptDetail, ReceiptHeader } from './model.ts';
import { Decimal } from './money.ts';
import type { Workspace } from './security.ts';

const postingFailure =
    'Penerimaan gagal diselesaikan karena kesalahan sistem pada jurnal perolehannya. Tidak ada aset yang terdaftar; tim kami sudah diberi tahu.';
const accountLabels = {
    acquisition_account_id: 'harga perolehan',
    payable_account_id: 'lawan hutang',
    clearing_account_id: 'perantara',
    grant_offset_account_id: 'lawan hibah',
    input_vat_account_id: 'PPN Masukan',
};
type AccountColumn = keyof typeof accountLabels;
type JournalLine = {
    account_id: string | null;
    debit: string;
    credit: string;
    description: string;
    org_unit_id: string;
    mapping: { label: string; fix_url: string; reference: string };
};
type AssetDetail = {
    asset_code: string;
    group_aset_id: string;
    acquisition_value: string;
    tax_amount: string;
};
type Dimension = {
    code: string;
    display_name: string;
    value_code: string;
    value_display_name: string;
    value_id: string;
};
type PayloadLine = {
    line_no: number;
    account: { external_id: string; code: string; name: string } | null;
    debit: string;
    credit: string;
    description: string;
    financial_dimensions: Dimension[];
};
type Problem = {
    line_no: number;
    code: string;
    message: string;
    object: { type: string; id: string; label: string } | null;
    fix: { label: string; url: string } | null;
};
const accountSchema = z.object({
    id: z.string(),
    legal_entity_id: z.string().nullable(),
    external_id: z.string(),
    code: z.string(),
    name: z.string(),
    type: z.string(),
    active: z.boolean(),
});
const unitSchema = z.object({
    id: z.string(),
    name: z.string(),
    classification: z.string(),
    type: z.string().nullable(),
    number: z.string().nullable(),
});
const businessUnitSchema = z.object({
    version_id: z.string(),
    descendant_organization_id: z.string(),
    ancestor_organization_id: z.string(),
    name: z.string(),
    number: z.string().nullable(),
});
const existingSchema = z.object({
    id: z.string(),
    input_hash: z.string(),
    currency_decimals: z.number(),
    status: z.string(),
    payload: jsonObject,
    hold_reasons: z.array(jsonObject).nullable(),
});

export class AcquisitionPosting {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly currency: Currency,
        private readonly inventory: Inventory,
    ) {}

    async vendor(id: string) {
        const row = await this.db.one(
            z.object({
                id: z.string(),
                party_id: z.string(),
                legal_entity_id: z.string(),
                number: z.string(),
                status: z.string(),
            }),
            'select id,party_id,legal_entity_id,number,status from vendors where tenant_id=$1 and id=$2 limit 1',
            [this.workspace.tenantId, id],
        );
        if (!row) return null;
        const party = await this.db.one(
            z.object({ id: z.string(), name: z.string() }),
            'select id,name from parties where id=$1 limit 1',
            [row.party_id],
        );
        return {
            id: row.id,
            legal_entity_id: row.legal_entity_id,
            number: row.number,
            status: row.status,
            name: party?.name ?? '',
        };
    }

    async mode(receipt: ReceiptHeader): Promise<string> {
        const mode = await this.db.one(
            z.object({ mode: z.string() }),
            'select mode from finance_settlement_modes where tenant_id=$1 and legal_entity_id=$2 and effective_from<=$3 order by effective_from desc limit 1',
            [
                this.workspace.tenantId,
                receipt.legal_entity_id,
                receipt.tanggal.slice(0, 10),
            ],
        );
        return mode?.mode ?? 'direct_payable';
    }

    async blockers(receipt: ReceiptHeader, lines: ReceiptDetail[]) {
        const blockers: Record<string, string> = {};
        const precision = await this.currency.precision(receipt.currency_code);
        if (precision.amount_decimals > 2)
            blockers.currency_code = `Presisi nilai ${receipt.currency_code} (${precision.amount_decimals} desimal) lebih halus dari yang dapat dicatat register aset (2 desimal). Ubah presisinya di Data referensi › Mata uang.`;
        if (
            !['pembelian', 'hibah', 'saldo_awal'].includes(
                receipt.cara_perolehan,
            )
        )
            blockers.cara_perolehan =
                'Pilih pembelian, hibah, atau saldo awal.';
        if (
            receipt.cara_perolehan === 'pembelian' &&
            receipt.vendor_id === null &&
            (await this.mode(receipt)) === 'direct_payable'
        )
            blockers.vendor_id =
                'Pilih vendornya. Entitas legal ini mencatat pembelian aset langsung sebagai hutang ke vendor, jadi vendor wajib diisi.';
        for (const [index, line] of lines.entries()) {
            if (!(await this.inventory.postedBook(line.group_aset_id))) {
                const group = await this.inventory.group(line.group_aset_id);
                blockers[`details.${index}.group_aset_id`] =
                    `Group ${group.kode} belum punya buku yang di-post ke finance. Tambahkan buku yang lapisan posting-nya bukan "none" di matriks group x buku (Master data › Group aset), lalu selesaikan lagi.`;
            }
        }
        return blockers;
    }

    async amounts(receipt: ReceiptHeader, line: ReceiptDetail) {
        const decimals = (await this.currency.precision(receipt.currency_code))
            .amount_decimals;
        const value = Decimal.of(line.nilai_per_unit)
            .times(line.jumlah)
            .rounded(decimals);
        const tax = Decimal.of(line.ppn_per_unit)
            .times(line.jumlah)
            .rounded(decimals);
        await this.inventory.postedBook(line.group_aset_id);
        return {
            value: value.fixed(decimals),
            tax: tax.fixed(decimals),
            unitValues: value.split(line.jumlah, decimals),
            unitTaxes: tax.split(line.jumlah, decimals),
        };
    }

    private async businessUnits(unitIds: string[], date: string) {
        const result = new Map<
            string,
            { id: string; name: string; number: string | null }
        >();
        if (!unitIds.length) return result;
        const candidates = await this.db.rows(
            z.object({ id: z.string(), hierarchy_id: z.string() }),
            "select v.id,v.hierarchy_id from organization_hierarchy_versions v join organization_hierarchies h on h.id=v.hierarchy_id join organization_hierarchy_purposes l on l.hierarchy_id=h.id join hierarchy_purposes p on p.id=l.purpose_id where h.tenant_id=$1 and h.status='active' and p.code='management' and v.status='published' and v.effective_from<($2::date+interval '1 day') order by v.effective_from desc,v.version_number desc",
            [this.workspace.tenantId, date],
        );
        const versions = new Map<string, string>();
        for (const candidate of candidates)
            if (!versions.has(candidate.hierarchy_id))
                versions.set(candidate.hierarchy_id, candidate.id);
        if (!versions.size) return result;
        const versionIds = [...versions.values()];
        const rows = await this.db.rows(
            businessUnitSchema,
            `select c.version_id,c.descendant_organization_id,c.ancestor_organization_id,a.name,u.number from organization_hierarchy_closures c join operating_units u on u.organization_id=c.ancestor_organization_id join organizations a on a.id=c.ancestor_organization_id where c.version_id in (${versionIds.map((_, index) => `$${index + 2}`).join(',')}) and c.descendant_organization_id in (${unitIds.map((_, index) => `$${index + versionIds.length + 2}`).join(',')}) and u.type='business_unit' and a.tenant_id=$1 order by c.distance`,
            [this.workspace.tenantId, ...versionIds, ...unitIds],
        );
        const nearest = new Map<string, z.infer<typeof businessUnitSchema>>();
        for (const row of rows) {
            const key = row.descendant_organization_id + '|' + row.version_id;
            if (!nearest.has(key)) nearest.set(key, row);
        }
        for (const unitId of unitIds) {
            const choices = new Map(
                [...nearest.values()]
                    .filter((row) => row.descendant_organization_id === unitId)
                    .map((row) => [row.ancestor_organization_id, row]),
            );
            const row =
                choices.size === 1 ? [...choices.values()][0] : undefined;
            if (row)
                result.set(unitId, {
                    id: row.ancestor_organization_id,
                    name: row.name,
                    number: row.number,
                });
        }
        return result;
    }

    private async input(
        receipt: ReceiptHeader,
        lines: ReceiptDetail[],
        assets: AssetDetail[] | null,
    ) {
        const precision = (await this.currency.precision(receipt.currency_code))
            .amount_decimals;
        const mode = await this.mode(receipt);
        const groups = new Map<
            string,
            Awaited<ReturnType<Inventory['group']>>
        >();
        const partitions = new Map<
            string,
            { groupId: string; unitId: string; value: Decimal; tax: Decimal }
        >();
        for (const line of lines) {
            if (!groups.has(line.group_aset_id))
                groups.set(
                    line.group_aset_id,
                    await this.inventory.group(line.group_aset_id),
                );
            const unitId = await this.inventory.dimension(
                line.group_aset_id,
                receipt.lokasi_aset_id,
                receipt.responsible_org_unit_id,
            );
            const amounts = await this.amounts(receipt, line);
            const key = line.group_aset_id + '|' + unitId;
            const partition = partitions.get(key) ?? {
                groupId: line.group_aset_id,
                unitId,
                value: Decimal.of('0'),
                tax: Decimal.of('0'),
            };
            partition.value = partition.value.plus(Decimal.of(amounts.value));
            partition.tax = partition.tax.plus(Decimal.of(amounts.tax));
            partitions.set(key, partition);
        }
        const vendor =
            receipt.vendor_id === null
                ? null
                : await this.vendor(receipt.vendor_id);
        const mappingSchema = z.object(
            Object.fromEntries(
                Object.keys(accountLabels).map((key) => [
                    key,
                    z.string().nullable(),
                ]),
            ),
        );
        const mappings = new Map<
            string,
            z.infer<typeof mappingSchema> | undefined
        >();
        const journal: JournalLine[] = [];
        const append = async (
            partition: { groupId: string; unitId: string },
            column: AccountColumn,
            debit: string,
            credit: string,
            description: string,
        ) => {
            if (!mappings.has(partition.groupId))
                mappings.set(
                    partition.groupId,
                    await this.db.one(
                        mappingSchema,
                        'select acquisition_account_id,payable_account_id,clearing_account_id,grant_offset_account_id,input_vat_account_id from aset_m_posting_group where tenant_id=$1 and group_aset_id=$2 and deleted_at is null and effective_from<=$3 order by effective_from desc limit 1',
                        [
                            this.workspace.tenantId,
                            partition.groupId,
                            receipt.tanggal.slice(0, 10),
                        ],
                    ),
                );
            journal.push({
                account_id: mappings.get(partition.groupId)?.[column] ?? null,
                debit,
                credit,
                description: description.slice(0, 255),
                org_unit_id: partition.unitId,
                mapping: {
                    label: `Group ${groups.get(partition.groupId)?.kode ?? partition.groupId} · ${accountLabels[column]}`,
                    fix_url: `/${this.workspace.moduleId}/fixed-aset-posting-profiles`,
                    reference: `posting-group:${partition.groupId}:${column}`,
                },
            });
        };
        for (const partition of partitions.values())
            if (partition.value.compare(Decimal.of('0')) !== 0)
                await append(
                    partition,
                    'acquisition_account_id',
                    partition.value.fixed(precision),
                    '0',
                    receipt.kode +
                        ' · ' +
                        (groups.get(partition.groupId)?.nama ??
                            partition.groupId),
                );
        for (const partition of partitions.values())
            if (partition.tax.compare(Decimal.of('0')) !== 0)
                await append(
                    partition,
                    'input_vat_account_id',
                    partition.tax.fixed(precision),
                    '0',
                    'PPN Masukan · ' +
                        receipt.kode +
                        ' · ' +
                        (groups.get(partition.groupId)?.nama ??
                            partition.groupId),
                );
        for (const partition of partitions.values()) {
            const total = partition.value.plus(partition.tax);
            if (total.compare(Decimal.of('0')) === 0) continue;
            const column =
                receipt.cara_perolehan === 'hibah'
                    ? 'grant_offset_account_id'
                    : mode === 'clearing'
                      ? 'clearing_account_id'
                      : 'payable_account_id';
            const description =
                receipt.cara_perolehan === 'hibah'
                    ? 'Hibah · ' +
                      receipt.kode +
                      ' · ' +
                      (groups.get(partition.groupId)?.nama ?? partition.groupId)
                    : vendor
                      ? vendor.name + ' · ' + receipt.kode
                      : receipt.kode +
                        ' · ' +
                        (groups.get(partition.groupId)?.nama ??
                            partition.groupId);
            await append(
                partition,
                column,
                '0',
                total.fixed(precision),
                description,
            );
        }
        if (!journal.length) return null;
        const detailAssets = [];
        for (const asset of assets ?? [])
            detailAssets.push({
                asset_code: asset.asset_code,
                asset_group: groups.get(asset.group_aset_id)?.kode ?? null,
                book:
                    (await this.inventory.postedBook(asset.group_aset_id))
                        ?.kode ?? null,
                acquisition_value: asset.acquisition_value,
                tax_amount: asset.tax_amount,
            });
        return {
            tenant_id: this.workspace.tenantId,
            posting_id: 'AST-ACQ-' + receipt.id,
            posting_type: 'asset.acquisition',
            legal_entity_id: receipt.legal_entity_id,
            currency_code: receipt.currency_code,
            posting_date: receipt.tanggal.slice(0, 10),
            document_date: (
                receipt.vendor_invoice_date ?? receipt.tanggal
            ).slice(0, 10),
            occurred_at: nowIso(),
            settlement_mode: mode,
            requires_vendor:
                receipt.cara_perolehan === 'pembelian' &&
                mode === 'direct_payable',
            vendor_id: receipt.vendor_id,
            vendor_invoice_reference: receipt.vendor_invoice_reference,
            source_document: {
                module: this.workspace.moduleId,
                type: 'penerimaan-aset',
                number: receipt.kode,
                description: (
                    receipt.keterangan?.trim() ||
                    'Penerimaan aset ' + receipt.kode
                ).slice(0, 255),
                id: receipt.id,
                url: `/${this.workspace.moduleId}/inventarisasi-aset/penerimaan/${receipt.id}`,
            },
            lines: journal,
            details: {
                receipt: {
                    id: receipt.id,
                    number: receipt.kode,
                    purchase_order_reference: receipt.purchase_order_reference,
                    attachment_record_type: 'aset_tr_penerimaan_aset',
                },
                assets: detailAssets,
            },
        };
    }

    async evaluate(
        receipt: ReceiptHeader,
        lines: ReceiptDetail[],
        assets: AssetDetail[] | null = null,
        ignoreMissingVendor = false,
    ) {
        const input = await this.input(receipt, lines, assets);
        if (!input) return null;
        const existing = await this.db.one(
            existingSchema,
            'select id,input_hash,currency_decimals,status,payload,hold_reasons from finance_postings where tenant_id=$1 and posting_id=$2 limit 1',
            [this.workspace.tenantId, input.posting_id],
        );
        const organization = await this.db.one(
            z.object({ id: z.string() }),
            "select id from organizations where tenant_id=$1 and classification='legal_entity' and id=$2 limit 1",
            [this.workspace.tenantId, input.legal_entity_id],
        );
        if (!organization) coded(500, 'posting_failed', postingFailure);
        const company = await this.db.one(
            z.object({ company_code: z.string() }),
            'select company_code from legal_entities where organization_id=$1 limit 1',
            [organization.id],
        );
        const decimals =
            existing?.currency_decimals ??
            (await this.currency.precision(input.currency_code))
                .amount_decimals;
        const vendor =
            input.vendor_id === null
                ? null
                : await this.vendor(input.vendor_id);
        if (
            (input.vendor_id !== null &&
                (!vendor ||
                    vendor.legal_entity_id !== input.legal_entity_id)) ||
            (input.requires_vendor && !vendor && !ignoreMissingVendor)
        )
            coded(500, 'posting_failed', postingFailure);
        if (input.lines.length < 2 || input.lines.length > 5000)
            coded(500, 'posting_failed', postingFailure);
        const normalized = input.lines.map((line, index) => {
            const debit = Decimal.of(line.debit);
            const credit = Decimal.of(line.credit);
            if (
                (debit.compare(Decimal.of('0')) === 0) ===
                    (credit.compare(Decimal.of('0')) === 0) ||
                debit.compare(Decimal.of('0')) < 0 ||
                credit.compare(Decimal.of('0')) < 0 ||
                debit.scale > decimals ||
                credit.scale > decimals
            )
                coded(500, 'posting_failed', postingFailure);
            return {
                ...line,
                line_no: index + 1,
                debit: debit.fixed(decimals),
                credit: credit.fixed(decimals),
            };
        });
        const debit = normalized.reduce(
            (sum, line) => sum.plus(Decimal.of(line.debit)),
            Decimal.of('0'),
        );
        const credit = normalized.reduce(
            (sum, line) => sum.plus(Decimal.of(line.credit)),
            Decimal.of('0'),
        );
        if (debit.compare(credit) !== 0)
            coded(500, 'posting_failed', postingFailure);
        const hash = createHash('sha256')
            .update(
                JSON.stringify([
                    input.posting_type,
                    input.legal_entity_id,
                    input.currency_code,
                    input.posting_date,
                    input.document_date,
                    input.settlement_mode,
                    input.vendor_id,
                    null,
                    null,
                    normalized.map((line) => [
                        line.account_id,
                        line.debit,
                        line.credit,
                        line.org_unit_id,
                    ]),
                ]),
            )
            .digest('hex');
        if (existing) {
            if (existing.input_hash !== hash)
                coded(500, 'posting_failed', postingFailure);
            return {
                input,
                hash,
                decimals,
                total: debit.fixed(decimals),
                status: existing.status,
                manualReason: null,
                problems: existing.hold_reasons ?? [],
                payload: existing.payload,
                payloadLines: new Array<PayloadLine>(),
                tableLines: new Array<Record<string, Bind>>(),
                existing: true,
            };
        }
        const accountIds = [
            ...new Set(
                normalized.flatMap((line) =>
                    line.account_id ? [line.account_id] : [],
                ),
            ),
        ];
        const accounts = accountIds.length
            ? await this.db.rows(
                  accountSchema,
                  `select id,legal_entity_id,external_id,code,name,type,active from finance_reference_accounts where tenant_id=$1 and id in (${accountIds.map((_, index) => `$${index + 2}`).join(',')})`,
                  [this.workspace.tenantId, ...accountIds],
              )
            : [];
        const unitIds = [
            ...new Set(normalized.map((line) => line.org_unit_id)),
        ];
        const units = await this.db.rows(
            unitSchema,
            `select o.id,o.name,o.classification,u.type,u.number from organizations o left join operating_units u on u.organization_id=o.id where o.tenant_id=$1 and o.id in (${unitIds.map((_, index) => `$${index + 2}`).join(',')})`,
            [this.workspace.tenantId, ...unitIds],
        );
        const businessUnits = await this.businessUnits(
            unitIds,
            input.posting_date,
        );
        const problems: Problem[] = [];
        const payloadLines: PayloadLine[] = [];
        const tableLines: Record<string, Bind>[] = [];
        for (const line of normalized) {
            const account = accounts.find(
                (candidate) => candidate.id === line.account_id,
            );
            const unit = units.find(
                (candidate) => candidate.id === line.org_unit_id,
            );
            const fix = {
                label: 'Buka pemetaan akun',
                url: line.mapping.fix_url,
            };
            const accountObject = account
                ? {
                      type: 'account',
                      id: account.id,
                      label: account.code + ' ' + account.name,
                  }
                : null;
            const issue = (
                code: string,
                message: string,
                object: Problem['object'],
                fix: Problem['fix'],
            ) =>
                problems.push({
                    line_no: line.line_no,
                    code,
                    message,
                    object,
                    fix,
                });
            if (line.account_id === null)
                issue(
                    'ACCOUNT_NOT_MAPPED',
                    line.mapping.label + ' belum dipetakan ke akun.',
                    null,
                    fix,
                );
            else if (!account)
                issue(
                    'ACCOUNT_UNKNOWN',
                    line.mapping.label +
                        ' menunjuk akun yang tidak ada di daftar akun.',
                    {
                        type: 'account',
                        id: line.account_id,
                        label: line.mapping.label,
                    },
                    fix,
                );
            else if (!account.active)
                issue(
                    'ACCOUNT_INACTIVE',
                    `Akun ${account.code} ${account.name} nonaktif.`,
                    accountObject,
                    fix,
                );
            else if (
                account.legal_entity_id !== null &&
                account.legal_entity_id !== input.legal_entity_id
            )
                issue(
                    'ACCOUNT_OTHER_LEGAL_ENTITY',
                    `Akun ${account.code} ${account.name} khusus entitas legal lain.`,
                    accountObject,
                    fix,
                );
            const dimensions: Dimension[] = [];
            let businessUnitCode: string | null = null;
            let departmentCode: string | null = null;
            if (!unit || unit.classification !== 'operating_unit')
                issue(
                    'ORG_UNIT_UNKNOWN',
                    'Unit organisasi baris ini tidak ditemukan.',
                    {
                        type: 'organization',
                        id: line.org_unit_id,
                        label: line.org_unit_id,
                    },
                    null,
                );
            else {
                const businessUnit = businessUnits.get(line.org_unit_id);
                if (!businessUnit)
                    issue(
                        'BUSINESS_UNIT_UNRESOLVED',
                        `${unit.name} tidak berada di bawah tepat satu business unit pada hierarki manajemen yang berlaku ${input.posting_date}.`,
                        {
                            type: 'organization',
                            id: line.org_unit_id,
                            label: unit.name,
                        },
                        {
                            label: 'Buka hierarki organisasi',
                            url: '/settings/organization?section=hierarchies',
                        },
                    );
                else if (!businessUnit.number)
                    issue(
                        'BUSINESS_UNIT_NUMBER_MISSING',
                        `${businessUnit.name} belum punya nomor unit.`,
                        {
                            type: 'organization',
                            id: businessUnit.id,
                            label: businessUnit.name,
                        },
                        {
                            label: 'Buka organisasi',
                            url: '/settings/organization?section=operating-units',
                        },
                    );
                else {
                    businessUnitCode = businessUnit.number;
                    dimensions.push({
                        code: 'BUSINESS_UNIT',
                        display_name: 'Business unit',
                        value_code: businessUnit.number,
                        value_display_name: businessUnit.name,
                        value_id: businessUnit.id,
                    });
                }
                if (account?.type === 'profit_loss') {
                    if (unit.type !== 'department')
                        issue(
                            'DEPARTMENT_REQUIRED',
                            `Akun laba rugi ${account.code} membutuhkan department, tetapi ${unit.name} bukan department.`,
                            {
                                type: 'organization',
                                id: line.org_unit_id,
                                label: unit.name,
                            },
                            null,
                        );
                    else if (!unit.number)
                        issue(
                            'DEPARTMENT_NUMBER_MISSING',
                            `${unit.name} belum punya nomor unit.`,
                            {
                                type: 'organization',
                                id: line.org_unit_id,
                                label: unit.name,
                            },
                            {
                                label: 'Buka organisasi',
                                url: '/settings/organization?section=operating-units',
                            },
                        );
                    else {
                        departmentCode = unit.number;
                        dimensions.push({
                            code: 'DEPARTMENT',
                            display_name: 'Department',
                            value_code: unit.number,
                            value_display_name: unit.name,
                            value_id: line.org_unit_id,
                        });
                    }
                }
            }
            payloadLines.push({
                line_no: line.line_no,
                account: account
                    ? {
                          external_id: account.external_id,
                          code: account.code,
                          name: account.name,
                      }
                    : null,
                debit: line.debit,
                credit: line.credit,
                description: line.description,
                financial_dimensions: dimensions,
            });
            tableLines.push({
                line_no: line.line_no,
                account_id: account?.id ?? null,
                account_external_id: account?.external_id ?? null,
                account_code: account?.code ?? null,
                debit: line.debit,
                credit: line.credit,
                description: line.description,
                org_unit_id: line.org_unit_id,
                business_unit_code: businessUnitCode,
                department_code: departmentCode,
            });
        }
        const published = nowIso();
        const payload = {
            contract_version: 1,
            posting_id: input.posting_id,
            posting_type: input.posting_type,
            settlement_mode: input.settlement_mode,
            legal_entity: {
                id: input.legal_entity_id,
                code: company?.company_code ?? null,
            },
            currency: { code: input.currency_code, decimals },
            posting_date: input.posting_date,
            document_date: input.document_date,
            occurred_at: input.occurred_at,
            published_at: published,
            source_document: {
                module: input.source_document.module,
                type: input.source_document.type,
                number: input.source_document.number,
                description: input.source_document.description,
            },
            vendor: vendor
                ? { id: vendor.id, number: vendor.number, name: vendor.name }
                : null,
            vendor_invoice_reference: input.vendor_invoice_reference,
            journal_lines: payloadLines,
            totals: {
                debit: debit.fixed(decimals),
                credit: credit.fixed(decimals),
            },
            reverses_posting_id: null,
            adjusts_posting_id: null,
            details: input.details,
        };
        const settings = await this.db.one(
            z.object({
                enabled: z.boolean(),
                cutover_date: z.string().nullable(),
            }),
            'select enabled,cutover_date from finance_posting_settings where tenant_id=$1 and legal_entity_id=$2 limit 1',
            [this.workspace.tenantId, input.legal_entity_id],
        );
        const manualReason = !settings?.enabled
            ? 'feed_disabled'
            : settings.cutover_date !== null &&
                input.posting_date < settings.cutover_date
              ? 'before_cutover'
              : null;
        const status = manualReason
            ? 'manual'
            : problems.length
              ? 'held'
              : 'pending';
        return {
            input,
            hash,
            decimals,
            total: debit.fixed(decimals),
            status,
            manualReason,
            problems: status === 'held' ? problems : [],
            payload: jsonObject.parse(payload),
            payloadLines,
            tableLines,
            existing: false,
        };
    }

    async publish(
        receipt: ReceiptHeader,
        lines: ReceiptDetail[],
        assets: AssetDetail[],
    ): Promise<void> {
        if (!this.db.inTransaction)
            throw new Error('Posting requires the receipt transaction.');
        const value = await this.evaluate(receipt, lines, assets);
        if (!value || value.existing) return;
        try {
            await this.db.transaction(async () => {
                const id = ulid().toLowerCase();
                const stamp = nowSql();
                await this.db.insert('finance_postings', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    legal_entity_id: value.input.legal_entity_id,
                    posting_id: value.input.posting_id,
                    posting_type: value.input.posting_type,
                    contract_version: 1,
                    source_module: value.input.source_document.module,
                    source_type: value.input.source_document.type,
                    source_number: value.input.source_document.number,
                    source_id: value.input.source_document.id,
                    currency_code: value.input.currency_code,
                    currency_decimals: value.decimals,
                    posting_date: value.input.posting_date,
                    document_date: value.input.document_date,
                    occurred_at: value.input.occurred_at,
                    published_at: stamp,
                    settlement_mode: value.input.settlement_mode,
                    status: value.status,
                    manual_reason: value.manualReason,
                    hold_reasons:
                        value.status === 'held'
                            ? JSON.stringify(value.problems)
                            : null,
                    vendor_id: value.input.vendor_id,
                    reverses_posting_id: null,
                    adjusts_posting_id: null,
                    total_debit: value.total,
                    total_credit: value.total,
                    payload: JSON.stringify(value.payload),
                    input: JSON.stringify(value.input),
                    input_hash: value.hash,
                    created_at: stamp,
                    updated_at: stamp,
                });
                for (const line of value.tableLines)
                    await this.db.insert('finance_posting_lines', {
                        ...line,
                        id: ulid().toLowerCase(),
                        tenant_id: this.workspace.tenantId,
                        finance_posting_id: id,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                await this.db.insert('finance_posting_events', {
                    id: ulid().toLowerCase(),
                    tenant_id: this.workspace.tenantId,
                    finance_posting_id: id,
                    event: 'published',
                    from_status: null,
                    to_status: value.status,
                    integration_client_id: null,
                    user_id: null,
                    data: JSON.stringify({ problems: value.problems.length }),
                    created_at: stamp,
                });
            });
        } catch (error) {
            if (sqlErrorCode(error) !== '23505') throw error;
            const existing = await this.db.one(
                existingSchema,
                'select id,input_hash,currency_decimals,status,payload,hold_reasons from finance_postings where tenant_id=$1 and posting_id=$2 limit 1',
                [this.workspace.tenantId, value.input.posting_id],
            );
            if (!existing || existing.input_hash !== value.hash)
                coded(500, 'posting_failed', postingFailure);
        }
    }

    async status(postingId: string) {
        const row = await this.db.one(
            z.object({
                posting_id: z.string(),
                status: z.string(),
                settlement_mode: z.string().nullable(),
                posting_date: z.string(),
                manual_reason: z.string().nullable(),
                external_reference: z.string().nullable(),
                reason_code: z.string().nullable(),
                reason: z.string().nullable(),
                acknowledged_at: z.string().nullable(),
                hold_reasons: z.array(jsonObject).nullable(),
            }),
            'select posting_id,status,settlement_mode,posting_date,manual_reason,external_reference,reason_code,reason,acknowledged_at,hold_reasons from finance_postings where tenant_id=$1 and posting_id=$2 limit 1',
            [this.workspace.tenantId, postingId],
        );
        if (!row) return null;
        const { hold_reasons, ...posting } = row;
        return {
            ...posting,
            acknowledged_at: posting.acknowledged_at
                ? posting.acknowledged_at.replace(' ', 'T') + '+00:00'
                : null,
            problems: hold_reasons ?? [],
        };
    }
}
