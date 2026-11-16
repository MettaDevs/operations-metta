-- Clerk End memisahkan Pembayaran Hutang dari penjualan. Sejak 0055 pelunasan bon dan piutang masuk Clerk End sebagai
-- uang di laci, dan ia juga dihitung di Jumlah Penjualan dan Jumlah Total. Bon lalu pelunasan tunainya tampak sebagai dua
-- penjualan, padahal bonnya sudah dihitung saat kunjungan dibayar.
--
-- 1. clerk.jumlah_pembayaran_hutang dan jumlah_total_pembayaran_hutang: banyaknya pelunasan dan nilainya, terpisah dari
--    jumlah_transaksi dan jumlah_total_system. Sistem lama (SIMtrClerk) tidak punya pasangan kolom ini, karena layar
--    Pembayaran Hutangnya tidak pernah terjangkau dari menu.
-- 2. Clerk yang sudah Clerk End dihitung ulang dengan arti baru: pelunasannya dipindah dari jumlah_transaksi dan
--    jumlah_total_system ke kolom baru. Jumlah sistem per jenis bayar (clerk_detail) dan selisih tidak berubah, karena
--    uang pelunasan tetap ada di laci.

ALTER TABLE public.clerk
    ADD COLUMN jumlah_pembayaran_hutang integer DEFAULT 0 NOT NULL,
    ADD COLUMN jumlah_total_pembayaran_hutang numeric(18,2) DEFAULT 0 NOT NULL;

UPDATE public.clerk c
SET jumlah_pembayaran_hutang = p.banyak,
    jumlah_total_pembayaran_hutang = p.nilai,
    jumlah_transaksi = c.jumlah_transaksi - p.banyak,
    jumlah_total_system = c.jumlah_total_system - p.nilai
FROM (SELECT tenant_id, clerk_id, count(*)::int AS banyak, sum(nilai) AS nilai
      FROM public.pembayaran_outstanding
      WHERE status = 'diposting'
      GROUP BY tenant_id, clerk_id) p
WHERE c.tenant_id = p.tenant_id AND c.id = p.clerk_id AND c.status = 'end';
