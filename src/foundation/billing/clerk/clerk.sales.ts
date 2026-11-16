import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';
import type { ClerkOpenings, ClerkSales } from './clerk.close.ts';

// Penjualan kasir selama sesi, per baris jenis bayar: baris pembayaran yang membawa clerk itu dan tidak batal, dikurangi
// pengembalian nota kredit yang diposting di clerk itu, karena uangnya keluar dari laci clerk itu. Pembayaran yang
// dikoreksi nota kredit tetap dihitung di clerk-nya sendiri: uangnya memang masuk laci clerk itu. Sistem lama
// mencocokkan pembayaran lewat user dan jam mulai clerk saja.
const salesSql = `select d.jenis_bayar_id, d.nilai, d.nilai_valuta
                  from kasir_detail d join kasir k on k.tenant_id = d.tenant_id and k.id = d.kasir_id
                  where k.tenant_id = $1 and k.clerk_id = $2 and k.status in ('diposting', 'dikreditkan')
                  union all
                  select r.jenis_bayar_id, -r.nilai, -r.nilai_valuta
                  from nota_kredit_detail r join nota_kredit n on n.tenant_id = r.tenant_id and n.id = r.nota_kredit_id
                  where n.tenant_id = $1 and n.clerk_id = $2`;

// Pembayaran hutang (pelunasan bon dan piutang) di clerk itu yang tidak batal. Ia bukan penjualan: bonnya sudah
// dihitung saat kunjungan dibayar, jadi pelunasannya dihitung terpisah. Uangnya tetap masuk laci. Pelunasan selalu mata
// uang lokal.
const receivablePaymentsSql = `select o.jenis_bayar_id, o.nilai, o.nilai as nilai_valuta
                               from pembayaran_outstanding o
                               where o.tenant_id = $1 and o.clerk_id = $2 and o.status = 'diposting'`;

// Penjualan kasir selama sesi: jumlah transaksi (pembayaran dan nota kredit) dan nilainya, semua jenis bayar. Nilai per
// jenis bayar, dalam mata uang lokal dan dalam mata uang jenis bayar, adalah uang yang masuk laci, jadi pembayaran hutang
// ikut di sana: itulah yang dibandingkan dengan jumlah fisik.
export async function clerkSales(
    db: Database,
    clerk: { tenantId: string; id: string },
): Promise<ClerkSales> {
    const [header] = await db.rows(
        z.object({ transactions: z.number(), total: z.string() }),
        `select (select count(*) from kasir
                 where tenant_id = $1 and clerk_id = $2 and status in ('diposting', 'dikreditkan'))::int
                + (select count(*) from nota_kredit where tenant_id = $1 and clerk_id = $2)::int as transactions,
                coalesce((select sum(nilai) from (${salesSql}) sales), 0)::text as total`,
        [clerk.tenantId, clerk.id],
    );
    const byMethod = await db.rows(
        z.object({
            id: z.string(),
            local: z.string(),
            currency_amount: z.string(),
        }),
        `select jenis_bayar_id as id, sum(nilai)::text as local, sum(nilai_valuta)::text as currency_amount
         from (${salesSql} union all ${receivablePaymentsSql}) receipts
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

// Pembayaran hutang selama sesi, di luar penjualan: banyaknya pelunasan dan nilainya.
export async function clerkReceivablePayments(
    db: Database,
    clerk: { tenantId: string; id: string },
): Promise<{ transactions: number; total: string }> {
    const [row] = await db.rows(
        z.object({ transactions: z.number(), total: z.string() }),
        `select count(*)::int as transactions, coalesce(sum(nilai), 0)::text as total
         from (${receivablePaymentsSql}) payments`,
        [clerk.tenantId, clerk.id],
    );
    return { transactions: row?.transactions ?? 0, total: row?.total ?? '0' };
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
