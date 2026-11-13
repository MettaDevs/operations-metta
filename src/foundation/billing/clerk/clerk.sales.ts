import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';
import type { ClerkSales } from './clerk.close.ts';

// Penjualan kasir selama sesi: pembayaran yang membawa clerk itu dan tidak batal, jumlah dan nilainya, semua jenis
// bayar, dan nilai per jenis bayar dalam mata uang lokal dan dalam mata uang jenis bayar itu. Sistem lama mencocokkan
// pembayaran lewat user dan jam mulai clerk saja.
export async function clerkSales(
    db: Database,
    clerk: { tenantId: string; id: string },
): Promise<ClerkSales> {
    const [header] = await db.rows(
        z.object({ transactions: z.number(), total: z.string() }),
        `select count(*)::int as transactions,
                coalesce((select sum(d.nilai) from kasir_detail d join kasir k on k.id = d.kasir_id
                          where k.tenant_id = $1 and k.clerk_id = $2 and k.status = 'diposting'), 0)::text as total
         from kasir where tenant_id = $1 and clerk_id = $2 and status = 'diposting'`,
        [clerk.tenantId, clerk.id],
    );
    const byMethod = await db.rows(
        z.object({
            id: z.string(),
            local: z.string(),
            currency_amount: z.string(),
        }),
        `select d.jenis_bayar_id as id, sum(d.nilai)::text as local, sum(d.nilai_valuta)::text as currency_amount
         from kasir_detail d join kasir k on k.tenant_id = d.tenant_id and k.id = d.kasir_id
         where k.tenant_id = $1 and k.clerk_id = $2 and k.status = 'diposting'
         group by d.jenis_bayar_id`,
        [clerk.tenantId, clerk.id],
    );
    return {
        transactions: header?.transactions ?? 0,
        total: header?.total ?? '0',
        byMethod: new Map(
            byMethod.map((row) => [
                row.id,
                { local: row.local, currency: row.currency_amount },
            ]),
        ),
    };
}
