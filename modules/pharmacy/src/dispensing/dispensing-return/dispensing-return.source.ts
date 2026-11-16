import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { abort, lookupId } from '@core/platform/http/index.ts';
import { lockChargeForChange } from '@core/foundation/billing/index.ts';
import type { Viewer } from '@core/platform/access/index.ts';
import {
    paidMessage,
    publishDispensingCharges,
} from '../dispensing/dispensing.events.ts';
import { replaceOtcSaleBill } from '../otc-sale/otc-sale.service.ts';
import {
    publishReturn,
    type returnPosted,
    type returnReversed,
} from './dispensing-return.events.ts';

type Scope = { tenantId: string; legalEntityId: string };
type ReturnEvent = typeof returnPosted | typeof returnReversed;

export type ReturnSourceKind = 'prescription' | 'otc-sale';

// Dokumen yang dibuka pengguna untuk meretur: resep (retur dibuka dari resepnya, seperti penyerahannya) atau penjualan
// obat bebas.
export type ReturnDocument = { kind: ReturnSourceKind; id: string };

// Penyerahan yang diretur beserta dua hal yang berbeda menurut asalnya, ditentukan sekali per request. lock dipanggil
// sebelum retur diposting atau dibatalkan: tagihan yang sudah dibayar kasir menolaknya dengan pesan sistem lama.
// settle dipanggil sesudahnya, di transaksi yang sama: resep memberi tahu layanan kesehatan dan kasir lewat event,
// penjualan obat bebas menulis ulang tagihan penjualannya dengan Qty bersih.
export type ReturnSource = {
    dispensingId: string;
    operatingUnitId: string;
    locationId: string;
    lock: (viewer: Viewer) => Promise<void>;
    settle: (returnId: string, event: ReturnEvent) => Promise<void>;
};

type Definition = {
    // Izin baca dokumennya; izin retur sama untuk kedua asal (pharmacy.return.create dan .reverse).
    readResource: 'prescription' | 'otc-sale';
    // Kata untuk pesan ke pengguna: "Muat ulang resep ini" atau "Muat ulang penjualan ini".
    label: string;
    notHandedOver: string;
    // Penyerahan yang diserahkan untuk dokumen ini, atau null bila belum ada. Dokumen yang tidak dikenal dijawab 404.
    // lock mengunci baris dokumennya, seperti setiap perubahan penyerahan.
    resolve: (
        db: Database,
        scope: Scope,
        id: string,
        lock: boolean,
    ) => Promise<ReturnSource | null>;
};

const handedOverSchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    location_id: z.string(),
    visit_id: z.string().nullable(),
});

export const returnSources: Record<ReturnSourceKind, Definition> = {
    prescription: {
        readResource: 'prescription',
        label: 'resep ini',
        notHandedOver:
            'Obat resep ini belum diserahkan, jadi belum ada yang bisa diretur.',
        async resolve(db, scope, id, lock) {
            const prescription = lookupId(id)
                ? await db.one(
                      z.object({ id: z.string() }),
                      `select id from far_tr_resep
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                       ${lock ? 'for update' : ''}`,
                      [scope.tenantId, scope.legalEntityId, id],
                  )
                : undefined;
            if (!prescription) abort(404, 'Not Found');
            const row = await db.one(
                handedOverSchema,
                `select h.id, h.operating_unit_id, h.lokasi_id as location_id, r.kunjungan_id as visit_id
                 from bill_farmasi h
                 join far_tr_resep r on r.tenant_id = h.tenant_id and r.id = h.resep_id
                 where h.tenant_id = $1 and h.resep_id = $2 and h.status = 'diserahkan' and h.deleted_at is null`,
                [scope.tenantId, prescription.id],
            );
            if (!row) return null;
            return {
                dispensingId: row.id,
                operatingUnitId: row.operating_unit_id,
                locationId: row.location_id,
                // Retur mengurangi Qty obat di tagihan kunjungan, jadi kunjungan yang sudah dibayar kasir menolaknya.
                // Resep tanpa kunjungan belum punya tagihan.
                lock: async (workspace) => {
                    if (row.visit_id)
                        await lockChargeForChange(db, workspace, {
                            documentId: row.visit_id,
                            message: paidMessage,
                        });
                },
                settle: async (returnId, event) => {
                    await publishReturn(db, scope, returnId, event);
                    await publishDispensingCharges(db, scope, row.id);
                },
            };
        },
    },
    'otc-sale': {
        readResource: 'otc-sale',
        label: 'penjualan ini',
        notHandedOver:
            'Penjualan ini dibatalkan, jadi tidak ada yang bisa diretur.',
        async resolve(db, scope, id, lock) {
            const sale = lookupId(id)
                ? await db.one(
                      z.object({
                          id: z.string(),
                          operating_unit_id: z.string(),
                          location_id: z.string(),
                          status: z.string(),
                      }),
                      `select id, operating_unit_id, lokasi_id as location_id, status
                       from bill_farmasi
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and resep_id is null
                         and deleted_at is null
                       ${lock ? 'for update' : ''}`,
                      [scope.tenantId, scope.legalEntityId, id],
                  )
                : undefined;
            if (!sale) abort(404, 'Not Found');
            if (sale.status !== 'diserahkan') return null;
            return {
                dispensingId: sale.id,
                operatingUnitId: sale.operating_unit_id,
                locationId: sale.location_id,
                // Penjualan itu sendiri dokumen sumber tagihan penjualannya di kasir.
                lock: (workspace) =>
                    lockChargeForChange(db, workspace, {
                        documentId: sale.id,
                        message: paidMessage,
                    }),
                // Tidak ada resep, jadi tidak ada event ke layanan kesehatan.
                settle: async () => {
                    await replaceOtcSaleBill(db, scope, sale.id);
                },
            };
        },
    },
};
