-- Tagihan kasir untuk penjualan tanpa kunjungan, misalnya penjualan obat bebas di apotek: satu langkah di loket, barang
-- dan pembayaran dalam satu transaksi, pola transaksi Commerce F&O (baris penjualan dan baris tender) dan dokumen penjualan
-- BC yang dibayar saat diposting. Module penjual memanggil kasir Core langsung di transaksinya, jadi tagihannya lahir
-- bersama pembayarannya.
--
-- 1. tagihan_kasir.jenis: `kunjungan` (potret kunjungan selesai dari layanan kesehatan) atau `penjualan`. Constraint
--    tagihan_kasir_jenis_check mengikat kolom potret ke jenisnya: tagihan kunjungan wajib membawa pasien, tipe pasien,
--    waktu daftar, dan section, dan tidak punya pembeli; tagihan penjualan tidak membawa potret kunjungan, penjamin,
--    jenis bayar otomatis, atau jenis bayar yang dibatasi tipe pasien, dan tidak pernah `dibuka` (status itu milik
--    kunjungan yang diperiksa lagi). Tagihan yang sudah ada adalah tagihan kunjungan.
-- 2. tagihan_kasir.pembeli_pihak_id dan pembeli_nama: pembeli penjualan, pihak buku alamat Core atau nama yang diketik.
--    Keduanya kosong untuk pembeli umum.
-- 3. Satu tagihan per dokumen sumber: id dokumen unik per tenant tanpa memandang module, sehingga pembayaran dan baris
--    biaya, yang menunjuk tagihannya lewat id dokumen saja, tidak pernah mendua. Pembayaran kini wajib punya tagihan
--    (foreign key), karena pembayaran selalu dibuat dari tagihan yang dibuka.

-- 1-2. Jenis dan pembeli ---------------------------------------------------------------------------------------------

ALTER TABLE public.tagihan_kasir
    ADD COLUMN jenis character varying(20) DEFAULT 'kunjungan' NOT NULL,
    ADD COLUMN pembeli_pihak_id uuid,
    ADD COLUMN pembeli_nama character varying(255);
ALTER TABLE public.tagihan_kasir ALTER COLUMN jenis DROP DEFAULT;

ALTER TABLE public.tagihan_kasir
    ALTER COLUMN didaftarkan_pada DROP NOT NULL,
    ALTER COLUMN pasien_id DROP NOT NULL,
    ALTER COLUMN pasien_nrm DROP NOT NULL,
    ALTER COLUMN pasien_nama DROP NOT NULL,
    ALTER COLUMN tipe_pasien_id DROP NOT NULL,
    ALTER COLUMN tipe_pasien_nama DROP NOT NULL,
    ALTER COLUMN section_nama DROP NOT NULL;

ALTER TABLE public.tagihan_kasir
    ADD CONSTRAINT tagihan_kasir_jenis_check CHECK (
        (jenis = 'kunjungan'
            AND didaftarkan_pada IS NOT NULL AND pasien_id IS NOT NULL AND pasien_nrm IS NOT NULL
            AND pasien_nama IS NOT NULL AND tipe_pasien_id IS NOT NULL AND tipe_pasien_nama IS NOT NULL
            AND section_nama IS NOT NULL AND pembeli_pihak_id IS NULL AND pembeli_nama IS NULL)
        OR (jenis = 'penjualan'
            AND didaftarkan_pada IS NULL AND pasien_id IS NULL AND pasien_nrm IS NULL AND pasien_nama IS NULL
            AND tipe_pasien_id IS NULL AND tipe_pasien_nama IS NULL AND section_nama IS NULL
            AND penjamin_id IS NULL AND penjamin_nama IS NULL AND no_kartu IS NULL
            AND jenis_bayar_otomatis_id IS NULL AND cardinality(jenis_bayar_dibatasi) = 0 AND status <> 'dibuka')),
    ADD CONSTRAINT tagihan_kasir_pembeli_foreign
        FOREIGN KEY (tenant_id, pembeli_pihak_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT;

-- 3. Satu tagihan per dokumen sumber ---------------------------------------------------------------------------------

ALTER TABLE public.tagihan_kasir DROP CONSTRAINT tagihan_kasir_sumber_unique;
ALTER TABLE public.tagihan_kasir
    ADD CONSTRAINT tagihan_kasir_sumber_unique UNIQUE (tenant_id, sumber_dokumen_id);

DROP INDEX public.kasir_sumber_diposting_unique;
CREATE UNIQUE INDEX kasir_sumber_diposting_unique
    ON public.kasir USING btree (tenant_id, sumber_dokumen_id) WHERE (status = 'diposting');
ALTER TABLE public.kasir
    ADD CONSTRAINT kasir_tagihan_foreign FOREIGN KEY (tenant_id, sumber_dokumen_id)
        REFERENCES public.tagihan_kasir(tenant_id, sumber_dokumen_id) ON DELETE RESTRICT;
