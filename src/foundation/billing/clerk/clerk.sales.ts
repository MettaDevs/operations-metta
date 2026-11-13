import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';
import type { ClerkOpenings, ClerkSales } from './clerk.close.ts';

// Uang yang diterima kasir selama sesi, per baris jenis bayar: baris pembayaran yang membawa clerk itu dan tidak batal,
// ditambah pembayaran hutang (pelunasan bon) di clerk itu yang tidak batal, karena uang pelunasan juga masuk laci,
// dikurangi pengembalian nota kredit yang diposting di clerk itu, karena uangnya keluar dari laci clerk itu. Pembayaran
// yang dikoreksi nota kredit tetap dihitung di clerk-nya sendiri: uangnya memang masuk laci clerk itu. Pelunasan selalu
// mata uang lokal. Sistem lama mencocokkan pembayaran lewat user dan jam mulai clerk saja.
const receiptsSql = `select d.jenis_bayar_id, d.nilai, d.nilai_valuta
                     from kasir_detail d join kasir k on k.tenant_id = d.tenant_id and k.id = d.kasir_id
                     where k.tenant_id = $1 and k.clerk_id = $2 and k.status in ('diposting', 'dikreditkan')
                     union all
                     select o.jenis_bayar_id, o.nilai, o.nilai
                     from pembayaran_outstanding o
                     where o.tenant_id = $1 and o.clerk_id = $2 and o.status = 'diposting'
                     union all
                     select r.jenis_bayar_id, -r.nilai, -r.nilai_valuta
                     from nota_kredit_detail r join nota_kredit n on n.tenant_id = r.tenant_id and n.id = r.nota_kredit_id
                     where n.tenant_id = $1 and n.clerk_id = $2`;

// Penjualan kasir selama sesi: jumlah transaksi (pembayaran, pembayaran hutang, dan nota kredit) dan nilainya, semua
// jenis bayar, dan nilai per jenis bayar dalam mata uang lokal dan dalam mata uang jenis bayar itu.
export async function clerkSales(
    db: Database,
    clerk: { tenantId: string; id: string },
): Promise<ClerkSales> {
    const [header] = await db.rows(
        z.object({ transactions: z.number(), total: z.string() }),
        `select (select count(*) from kasir
                 where tenant_id = $1 and clerk_id = $2 and status in ('diposting', 'dikreditkan'))::int
                + (select count(*) from pembayaran_outstanding
                   where tenant_id = $1 and clerk_id = $2 and status = 'diposting')::int
                + (select count(*) from nota_kredit where tenant_id = $1 and clerk_id = $2)::int as transactions,
                coalesce((select sum(nilai) from (${receiptsSql}) receipts), 0)::text as total`,
        [clerk.tenantId, clerk.id],
    );
    const byMethod = await db.rows(
        z.object({
            id: z.string(),
            local: z.string(),
            currency_amount: z.string(),
        }),
        `select jenis_bayar_id as id, sum(nilai)::text as local, sum(nilai_valuta)::text as currency_amount
         from (${receiptsSql}) receipts
         group by jenis_bayar_id`,
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

// Uang awal laci yang diisi saat Clerk Start, per jenis bayar dalam mata uangnya.
export async function clerkOpenings(
    db: Database,
    clerk: { tenantId: string; id: string },
): Promise<ClerkOpenings> {
    const rows = await db.rows(
        z.object({ id: z.string(), amount: z.string() }),
        `select jenis_bayar_id as id, trim_scale(jumlah)::text as amount
         from clerk_uang_awal where tenant_id = $1 and clerk_id = $2`,
        [clerk.tenantId, clerk.id],
    );
    return new Map(rows.map((row) => [row.id, row.amount]));
}
