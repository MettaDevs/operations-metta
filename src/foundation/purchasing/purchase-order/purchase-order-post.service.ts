import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    HttpFailure,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    decimalInput,
    display,
    parseInput,
    quantityScale,
    toNumeric,
} from '../../inventory/index.ts';
import { PurchaseInvoices } from '../purchase-invoice/purchase-invoice.service.ts';
import { Receipts, type OrderLinePick } from '../receipt/receipt.service.ts';
import { purchaseOrderPostInputSchema } from './purchase-order.schema.ts';
import { PurchaseOrders } from './purchase-order.service.ts';

const messages = {
    mode: 'Pilih Terima, Faktur, atau Terima dan faktur.',
    posting_date: 'Isi tanggal posting yang benar.',
    lines: 'Satu order paling banyak 500 baris.',
    version: 'Muat ulang order, lalu ulangi posting.',
};

const quantityText = (value: bigint) => display(value, quantityScale);

const failureSchema = z.looseObject({
    errors: z.record(z.string(), z.array(z.string())),
});

// Penolakan dari penerimaan dan faktur memakai nomor baris dokumen itu. Di layar order, penolakan itu harus menunjuk
// baris order dan kolom yang diisi pengguna.
async function onOrderLines<T>(
    work: () => Promise<T>,
    rows: readonly number[],
    fields: Readonly<Record<string, string>>,
): Promise<T> {
    try {
        return await work();
    } catch (error) {
        if (!(error instanceof HttpFailure) || error.status !== 422)
            throw error;
        const failure = failureSchema.safeParse(error.body);
        if (!failure.success) throw error;
        const errors: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(failure.data.errors)) {
            const match = /^lines\.(\d+)\.(\w+)$/.exec(key);
            const row = match ? rows[Number(match[1])] : undefined;
            const name = match?.[2] ?? '';
            const target =
                row === undefined
                    ? key
                    : `lines.${row}.${fields[name] ?? fields._line ?? name}`;
            errors[target] = [...(errors[target] ?? []), ...value];
        }
        throw new HttpFailure(422, { ...failure.data, errors });
    }
}

type PlannedLine = {
    row: number;
    orderLineId: string;
    toReceive: bigint;
    toInvoice: bigint;
    batchNumber: string | null;
    expiry: string | null;
};

// Posting dari purchase order seperti BC (codeunit 90 Purch.-Post lewat PostingSelectionManagement): Terima menulis
// penerimaan, Faktur menulis faktur pembelian atas barang yang sudah diterima, Terima dan faktur keduanya. Dokumennya
// dibuat dan diposting dengan posting penerimaan dan faktur yang sama dengan jalur dokumen terpisah, dalam satu
// transaksi.
export class PurchaseOrderPosting {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async post(request: Request, orderId: string, body: unknown) {
        const data = parseInput(purchaseOrderPostInputSchema, body, messages);
        const receive = data.mode !== 'invoice';
        const invoice = data.mode !== 'receive';
        if (receive) this.workspace.guard('purchase-receipt', 'update');
        if (invoice) this.workspace.guard('purchase-invoice', 'update');
        const version = expectedVersion(request, body);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const planned: PlannedLine[] = [];
        for (const [row, line] of data.lines.entries()) {
            const quantity = (
                value: string | number | null | undefined,
                name: string,
            ) => {
                if (value === null || value === undefined || value === '')
                    return 0n;
                const parsed = decimalInput(value);
                if (parsed !== null && parsed >= 0n) return parsed;
                errors[`lines.${row}.${name}`] = 'Isi jumlah 0 atau lebih.';
                return 0n;
            };
            const toReceive = receive
                ? quantity(line.quantity_to_receive, 'quantity_to_receive')
                : 0n;
            const toInvoice = invoice
                ? quantity(line.quantity_to_invoice, 'quantity_to_invoice')
                : 0n;
            const batchNumber = line.batch_number?.trim().toUpperCase() || null;
            if (batchNumber && batchNumber.length > 50)
                errors[`lines.${row}.batch_number`] =
                    'Nomor batch paling banyak 50 karakter.';
            const expiry = line.expiry_date?.trim() || null;
            if (expiry !== null && !dateSchema.safeParse(expiry).success)
                errors[`lines.${row}.expiry_date`] =
                    'Isi tanggal kedaluwarsa yang benar.';
            planned.push({
                row,
                orderLineId: line.id,
                toReceive,
                toInvoice,
                batchNumber,
                expiry,
            });
        }
        if (receive && !planned.some((line) => line.toReceive > 0n))
            errors._form =
                'Isi Diterima sekarang di sedikitnya satu baris, untuk barang yang datang.';
        else if (invoice && !planned.some((line) => line.toInvoice > 0n))
            errors._form =
                'Isi Difakturkan sekarang di sedikitnya satu baris, untuk barang yang ditagih vendor.';
        if (Object.keys(errors).length) validation(errors);

        const scope = {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
        const posted = await this.db.transaction(async () => {
            const order = lookupId(orderId)
                ? await this.db.one(
                      z.object({
                          version: z.number(),
                          vendor_id: z.string(),
                          payment_terms_id: z.string().nullable(),
                      }),
                      `select version, vendor_id, termin_pembayaran_id as payment_terms_id from bl_tr_order
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                       for update`,
                      [scope.tenantId, scope.legalEntityId, orderId],
                  )
                : undefined;
            if (!order) return abort(404, 'Not Found');
            if (order.version !== version)
                coded(409, 'stale_version', staleMessage);
            const orderLines = new Set(
                (
                    await this.db.rows(
                        z.object({ id: z.string() }),
                        `select id from bl_tr_order_detail
                         where tenant_id = $1 and order_id = $2 and deleted_at is null`,
                        [scope.tenantId, orderId],
                    )
                ).map((line) => line.id),
            );
            const unknown = planned.find(
                (line) => !orderLines.has(line.orderLineId),
            );
            if (unknown)
                validation({
                    [`lines.${unknown.row}.quantity_to_receive`]:
                        'Baris ini sudah tidak ada di order. Muat ulang order, lalu ulangi posting.',
                });

            const receipt = receive
                ? await this.receive(orderId, data, planned)
                : null;
            const purchaseInvoice = invoice
                ? await this.invoice(orderId, order, data, planned)
                : null;
            return { receipt, invoice: purchaseInvoice };
        });
        const shown = await new PurchaseOrders(this.db, this.workspace).show(
            orderId,
        );
        return {
            status: 200,
            headers: {},
            body: { ...shown, posted },
        };
    }

    private async receive(
        orderId: string,
        data: z.output<typeof purchaseOrderPostInputSchema>,
        planned: PlannedLine[],
    ) {
        const picks = new Map<string, OrderLinePick>();
        const rowOf = new Map<string, number>();
        for (const line of planned)
            if (line.toReceive > 0n) {
                picks.set(line.orderLineId, {
                    quantity: toNumeric(line.toReceive, quantityScale),
                    batchNumber: line.batchNumber,
                    expiry: line.expiry,
                });
                rowOf.set(line.orderLineId, line.row);
            }
        const receipts = new Receipts(this.db, this.workspace);
        const id = await onOrderLines(
            () =>
                receipts.receiveOrder(orderId, {
                    postingDate: data.posting_date,
                    vendorDocument: data.vendor_invoice_number?.trim() || null,
                    picks,
                }),
            [...rowOf.values()],
            { quantity: 'quantity_to_receive', item_id: 'quantity_to_receive' },
        );
        const { data: receipt } = await receipts.show(id);
        return { id: receipt.id, number: receipt.number };
    }

    private async invoice(
        orderId: string,
        order: { vendor_id: string; payment_terms_id: string | null },
        data: z.output<typeof purchaseOrderPostInputSchema>,
        planned: PlannedLine[],
    ) {
        const invoices = new PurchaseInvoices(this.db, this.workspace);
        const open = await invoices.orderReceiptLines(order.vendor_id, orderId);
        const errors: Record<string, string> = {};
        const lines: Record<string, unknown>[] = [];
        const rows: number[] = [];
        for (const line of planned) {
            let remaining = line.toInvoice;
            if (remaining === 0n) continue;
            const available = open.filter(
                (receiptLine) =>
                    receiptLine.order_line_id === line.orderLineId &&
                    receiptLine.open > 0n,
            );
            for (const receiptLine of available) {
                if (remaining === 0n) break;
                const taken =
                    remaining < receiptLine.open ? remaining : receiptLine.open;
                remaining -= taken;
                rows.push(line.row);
                lines.push({
                    kind: 'barang',
                    receipt_line_id: receiptLine.receipt_line_id,
                    quantity: toNumeric(taken, quantityScale),
                    unit_cost: receiptLine.unit_cost,
                    discount_percent: receiptLine.discount_percent,
                    vat_percent: receiptLine.vat_percent,
                });
            }
            if (remaining > 0n) {
                const most = line.toInvoice - remaining;
                errors[`lines.${line.row}.quantity_to_invoice`] =
                    most > 0n
                        ? `Paling banyak ${quantityText(most)}: yang sudah diterima dan belum difakturkan.`
                        : 'Barang baris ini belum diterima, atau sudah difakturkan seluruhnya. Terima barangnya lebih dulu.';
            }
        }
        if (Object.keys(errors).length) validation(errors);
        const created = await onOrderLines(
            () =>
                invoices.createAndPost({
                    vendor_id: order.vendor_id,
                    vendor_invoice_number: data.vendor_invoice_number ?? '',
                    document_date: data.posting_date,
                    posting_date: data.posting_date,
                    payment_terms_id: order.payment_terms_id,
                    lines,
                }),
            rows,
            { _line: 'quantity_to_invoice' },
        );
        return { id: created.id, number: created.number };
    }
}
