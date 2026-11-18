import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
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
    fromNumeric,
    parseInput,
    quantityScale,
    toNumeric,
} from '../../inventory/index.ts';
import { PurchaseInvoices } from '../purchase-invoice/purchase-invoice.service.ts';
import { Receipts, type OrderLinePick } from '../receipt/receipt.service.ts';
import {
    purchaseOrderPostInputSchema,
    purchaseOrderPostingInputSchema,
} from './purchase-order.schema.ts';
import {
    clearPostingFields,
    PurchaseOrders,
} from './purchase-order.service.ts';

const messages = {
    mode: 'Pilih Terima, Faktur, atau Terima dan faktur.',
    posting_date: 'Isi tanggal posting yang benar.',
    vendor_invoice_number: 'Isi nomor faktur vendor paling banyak 35 karakter.',
    lines: 'Satu order paling banyak 500 baris.',
    version: 'Muat ulang order, lalu ulangi perubahanmu.',
};

const quantityText = (value: bigint) => display(value, quantityScale);

const failureSchema = z.looseObject({
    errors: z.record(z.string(), z.array(z.string())),
});

async function withErrorsOnOrderRows<T>(
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

type PostingDocument = { postingDate: string; vendorInvoiceNumber: string };

const storedQuantity = (text: string | null) =>
    text === null ? null : fromNumeric(text, quantityScale);

// Posting dari purchase order seperti BC (codeunit 90 Purch.-Post lewat PostingSelectionManagement): Terima menulis
// penerimaan, Faktur menulis faktur pembelian atas barang yang sudah diterima, Terima dan faktur keduanya. Isian posting
// disimpan di order lebih dulu, seperti Qty. to Receive di Purchase Line, dan posting membaca yang tersimpan.
// Dokumennya dibuat dan diposting dengan posting penerimaan dan faktur yang sama dengan jalur dokumen terpisah, dalam
// satu transaksi.
export class PurchaseOrderPosting {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private async lockPostable(orderId: string, version: number) {
        const order = lookupId(orderId)
            ? await this.db.one(
                  z.object({
                      version: z.number(),
                      status: z.string(),
                      vendor_id: z.string(),
                      payment_terms_id: z.string().nullable(),
                      posting_date: z.string(),
                      vendor_invoice_number: z.string().nullable(),
                  }),
                  `select h.version, h.status, h.vendor_id, h.termin_pembayaran_id as payment_terms_id,
                          coalesce(h.tanggal_posting, (now() at time zone l.timezone)::date)::text as posting_date,
                          h.no_faktur_vendor as vendor_invoice_number
                   from bl_tr_order h
                   join legal_entities l on l.tenant_id = h.tenant_id and l.organization_id = h.legal_entity_id
                   where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null
                   for update of h`,
                  [this.scope.tenantId, this.scope.legalEntityId, orderId],
              )
            : undefined;
        if (!order) return abort(404, 'Not Found');
        if (order.version !== version)
            coded(409, 'stale_version', staleMessage);
        if (order.status === 'terbuka')
            validation({
                _form: 'Order ini sedang dibuka untuk diubah. Rilis ordernya lebih dulu.',
            });
        return order;
    }

    async save(request: Request, orderId: string, body: unknown) {
        if (!this.workspace.permissions.has('core.purchase-invoice.update'))
            this.workspace.guard('purchase-receipt', 'update');
        const data = parseInput(
            purchaseOrderPostingInputSchema,
            body,
            messages,
        );
        const version = expectedVersion(request, body);
        const errors: Record<string, string> = {};
        const postingDate = data.posting_date?.trim() || null;
        if (postingDate !== null && !dateSchema.safeParse(postingDate).success)
            errors.posting_date = messages.posting_date;
        const vendorInvoiceNumber = data.vendor_invoice_number?.trim() || null;
        if (vendorInvoiceNumber !== null && vendorInvoiceNumber.length > 35)
            errors.vendor_invoice_number = messages.vendor_invoice_number;
        const lines = data.lines.map((line, row) => {
            const quantity = (
                value: string | number | null | undefined,
                name: string,
            ) => {
                if (value === null || value === undefined || value === '')
                    return null;
                const parsed = decimalInput(value);
                if (parsed !== null && parsed >= 0n)
                    return toNumeric(parsed, quantityScale);
                errors[`lines.${row}.${name}`] = 'Isi jumlah 0 atau lebih.';
                return null;
            };
            const batchNumber = line.batch_number?.trim().toUpperCase() || null;
            if (batchNumber && batchNumber.length > 50)
                errors[`lines.${row}.batch_number`] =
                    'Nomor batch paling banyak 50 karakter.';
            const expiry = line.expiry_date?.trim() || null;
            if (expiry !== null && !dateSchema.safeParse(expiry).success)
                errors[`lines.${row}.expiry_date`] =
                    'Isi tanggal kedaluwarsa yang benar.';
            return {
                row,
                id: line.id,
                toReceive: quantity(
                    line.quantity_to_receive,
                    'quantity_to_receive',
                ),
                toInvoice: quantity(
                    line.quantity_to_invoice,
                    'quantity_to_invoice',
                ),
                batchNumber,
                expiry,
            };
        });
        if (Object.keys(errors).length) validation(errors);

        await this.db.transaction(async () => {
            await this.lockPostable(orderId, version);
            await this.db.execute(
                `update bl_tr_order set tanggal_posting = $1, no_faktur_vendor = $2, updated_at = $3
                 where tenant_id = $4 and id = $5`,
                [
                    postingDate,
                    vendorInvoiceNumber,
                    nowSql(),
                    this.scope.tenantId,
                    orderId,
                ],
            );
            for (const line of lines) {
                const updated = lookupId(line.id)
                    ? await this.db.one(
                          z.object({ id: z.string() }),
                          `update bl_tr_order_detail
                           set jumlah_terima_sekarang = $1, jumlah_faktur_sekarang = $2, no_batch = $3,
                               tanggal_kedaluwarsa = $4, updated_at = $5
                           where tenant_id = $6 and order_id = $7 and id = $8 and deleted_at is null
                           returning id`,
                          [
                              line.toReceive,
                              line.toInvoice,
                              line.batchNumber,
                              line.expiry,
                              nowSql(),
                              this.scope.tenantId,
                              orderId,
                              line.id,
                          ],
                      )
                    : undefined;
                if (!updated)
                    validation({
                        [`lines.${line.row}.quantity_to_receive`]:
                            'Baris ini sudah tidak ada di order. Muat ulang order, lalu ulangi perubahanmu.',
                    });
            }
        });
        return {
            status: 200,
            headers: {},
            body: await new PurchaseOrders(this.db, this.workspace).show(
                orderId,
            ),
        };
    }

    async post(request: Request, orderId: string, body: unknown) {
        const data = parseInput(purchaseOrderPostInputSchema, body, messages);
        const receive = data.mode !== 'invoice';
        const invoice = data.mode !== 'receive';
        if (receive) this.workspace.guard('purchase-receipt', 'update');
        if (invoice) this.workspace.guard('purchase-invoice', 'update');
        const version = expectedVersion(request, body);
        const orders = new PurchaseOrders(this.db, this.workspace);

        const posted = await this.db.transaction(async () => {
            const order = await this.lockPostable(orderId, version);
            const { data: stored } = await orders.show(orderId);
            const planned: PlannedLine[] = stored.lines.map((line, row) => {
                const toReceive = receive
                    ? (storedQuantity(line.quantity_to_receive) ??
                      (order.status === 'dirilis'
                          ? fromNumeric(
                                line.outstanding_quantity,
                                quantityScale,
                            )
                          : 0n))
                    : 0n;
                const open =
                    fromNumeric(line.quantity_received, quantityScale) -
                    fromNumeric(line.quantity_invoiced, quantityScale) +
                    toReceive;
                return {
                    row,
                    orderLineId: line.id,
                    toReceive,
                    toInvoice: invoice
                        ? (storedQuantity(line.quantity_to_invoice) ??
                          (open > 0n ? open : 0n))
                        : 0n,
                    batchNumber: line.batch_number,
                    expiry: line.expiry_date,
                };
            });
            if (receive && !planned.some((line) => line.toReceive > 0n))
                validation({
                    _form: 'Isi Diterima sekarang di sedikitnya satu baris, untuk barang yang datang.',
                });
            if (invoice && !planned.some((line) => line.toInvoice > 0n))
                validation({
                    _form: 'Isi Difakturkan sekarang di sedikitnya satu baris, untuk barang yang ditagih vendor.',
                });
            const document = {
                postingDate: order.posting_date,
                vendorInvoiceNumber: order.vendor_invoice_number ?? '',
            };
            const receipt = receive
                ? await this.receive(orderId, document, planned)
                : null;
            const purchaseInvoice = invoice
                ? await this.invoice(orderId, order, document, planned)
                : null;
            await clearPostingFields(this.db, this.scope.tenantId, orderId);
            return { receipt, invoice: purchaseInvoice };
        });
        const shown = await orders.show(orderId);
        return {
            status: 200,
            headers: {},
            body: { ...shown, posted },
        };
    }

    private async receive(
        orderId: string,
        document: PostingDocument,
        planned: PlannedLine[],
    ) {
        const receiving = planned.filter((line) => line.toReceive > 0n);
        const picks: OrderLinePick[] = receiving.map((line) => ({
            orderLineId: line.orderLineId,
            orderUnitQuantity: toNumeric(line.toReceive, quantityScale),
            batchNumber: line.batchNumber,
            expiry: line.expiry,
        }));
        const receipts = new Receipts(this.db, this.workspace);
        const id = await withErrorsOnOrderRows(
            () =>
                receipts.receiveOrder(orderId, {
                    postingDate: document.postingDate,
                    vendorDocument: document.vendorInvoiceNumber || null,
                    picks,
                }),
            receiving.map((line) => line.row),
            { quantity: 'quantity_to_receive', item_id: 'quantity_to_receive' },
        );
        const { data: receipt } = await receipts.show(id);
        return { id: receipt.id, number: receipt.number };
    }

    private async invoice(
        orderId: string,
        order: { vendor_id: string; payment_terms_id: string | null },
        document: PostingDocument,
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
        const created = await withErrorsOnOrderRows(
            () =>
                invoices.createAndPost({
                    vendor_id: order.vendor_id,
                    vendor_invoice_number: document.vendorInvoiceNumber,
                    document_date: document.postingDate,
                    posting_date: document.postingDate,
                    payment_terms_id: order.payment_terms_id,
                    lines,
                }),
            rows,
            { _line: 'quantity_to_invoice' },
        );
        return { id: created.id, number: created.number };
    }
}
