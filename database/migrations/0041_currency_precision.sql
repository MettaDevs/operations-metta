-- Presisi angka uang dan harga satu sumber: tabel currency_precisions (baseline CoreERP, per tenant per mata uang,
-- padanan Currency BC) dilengkapi pembulatan tagihan, dan menjadi setelan yang dibaca kasir, farmasi, aset, dan
-- finance. Permintaan pemilik produk 13 November 2026: tidak ada lagi dua angka di belakang koma yang ditulis mati.
--
-- 1. invoice_rounding_precision dan invoice_rounding_type (Invoice Rounding Precision dan Invoice Rounding Type Currency
--    BC, field 10 dan 12). Bawaan 1 dan nearest, sama dengan round(..., 0) rumus total kasir Kuta 1. Sistem lama juga
--    punya Dibulatkan_Ke dan Metode_Pembulatan (1 Ke Atas, 2 Ke Bawah, 3 Ke Semua) di setelan sistem gudang, tetapi
--    tidak ada kode kasir yang membacanya. Akun selisih pembulatan (Rekening_Pembulatan) menunggu finance.
-- 2. Kolom uang clerk dari 0038 dilebarkan ke numeric(19,4), skala terbesar presisi jumlah, sama dengan tarif dan money
--    SQL Server. Pembulatan terjadi di perhitungan menurut presisi mata uang, bukan oleh skala kolom.
-- 3. Persen merchan dari 0037 memakai skala persen tunggal empat angka di belakang koma (numeric(9,4)).

-- 1. Pembulatan tagihan ---------------------------------------------------------------------------------------------

ALTER TABLE public.currency_precisions
    ADD COLUMN invoice_rounding_precision numeric(19,4) DEFAULT 1 NOT NULL,
    ADD COLUMN invoice_rounding_type character varying(10) DEFAULT 'nearest' NOT NULL,
    ADD CONSTRAINT currency_precisions_invoice_rounding_check
        CHECK (invoice_rounding_precision >= 0 AND invoice_rounding_type IN ('nearest', 'up', 'down'));

-- 2. Kolom uang clerk -----------------------------------------------------------------------------------------------

ALTER TABLE public.clerk
    ALTER COLUMN jumlah_total_system TYPE numeric(19,4),
    ALTER COLUMN jumlah_total_clerk TYPE numeric(19,4),
    ALTER COLUMN jumlah_total_selisih TYPE numeric(19,4);
ALTER TABLE public.clerk_detail DROP COLUMN jumlah_selisih;
ALTER TABLE public.clerk_detail
    ALTER COLUMN jumlah_sistem TYPE numeric(19,4),
    ALTER COLUMN jumlah_total TYPE numeric(19,4);
ALTER TABLE public.clerk_detail
    ADD COLUMN jumlah_selisih numeric(19,4) GENERATED ALWAYS AS (jumlah_total - jumlah_sistem) STORED;

-- 3. Persen merchan -------------------------------------------------------------------------------------------------

ALTER TABLE public.merchan
    ALTER COLUMN add_charge_debet TYPE numeric(9,4),
    ALTER COLUMN add_charge_kredit TYPE numeric(9,4),
    ALTER COLUMN diskon TYPE numeric(9,4);
