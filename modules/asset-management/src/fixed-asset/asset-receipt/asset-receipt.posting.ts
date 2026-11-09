import { z } from 'zod';
import type { Currency } from '@core/foundation/currency/index.ts';
import type {
    FinancePostings,
    JournalLine,
    PostingInput,
} from '@core/foundation/finance-posting/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import type { Database } from '@core/platform/database/index.ts';
import { nowIso } from '@core/platform/database/index.ts';
import { Decimal } from '@core/platform/money/index.ts';
import type { Inventory } from '../asset/asset.service.ts';
import type { ReceiptDetail, ReceiptHeader } from './asset-receipt.schema.ts';

const accountLabels = {
    acquisition_account_id: 'harga perolehan',
    payable_account_id: 'lawan hutang',
    clearing_account_id: 'perantara',
    grant_offset_account_id: 'lawan hibah',
    input_vat_account_id: 'PPN Masukan',
};
type AccountColumn = keyof typeof accountLabels;
type AssetDetail = {
    asset_code: string;
    group_aset_id: string;
    acquisition_value: string;
    tax_amount: string;
};

export class AcquisitionPosting {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly currency: Currency,
        private readonly inventory: Inventory,
        private readonly finance: FinancePostings,
    ) {}

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
            (await this.finance.mode(
                receipt.legal_entity_id,
                receipt.tanggal.slice(0, 10),
            )) === 'direct_payable'
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

    private async input(
        receipt: ReceiptHeader,
        lines: ReceiptDetail[],
        assets: AssetDetail[] | null,
    ): Promise<PostingInput | null> {
        const precision = (await this.currency.precision(receipt.currency_code))
            .amount_decimals;
        const mode = await this.finance.mode(
            receipt.legal_entity_id,
            receipt.tanggal.slice(0, 10),
        );
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
                : await this.finance.vendor(receipt.vendor_id);
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
        return input ? this.finance.evaluate(input, ignoreMissingVendor) : null;
    }

    async publish(
        receipt: ReceiptHeader,
        lines: ReceiptDetail[],
        assets: AssetDetail[],
    ): Promise<void> {
        if (!this.db.inTransaction)
            throw new Error('Posting requires the receipt transaction.');
        const input = await this.input(receipt, lines, assets);
        if (input) await this.finance.publish(input);
    }
}
