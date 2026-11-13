-- Biaya obat resep ke kasir Core, irisan 9 spesifikasi kasir.
--
-- 1. far_tr_resep.kunjungan_id: kunjungan asal resep dari healthcare.prescription.issued.v1, supaya baris obat masuk
--    tagihan kunjungan yang benar. Resep yang diterima sebelum migration ini tidak membawanya, dan biayanya tidak
--    dikirim ke kasir.
-- 2. far_m_lokasi_layanan.termasuk_jasa: obat yang dilayani dari unit atau section ini termasuk jasa (IncludeJasa sistem
--    lama), jadi bernilai 0 di tagihan kasir. Kuta 1 menandai hampir semua BILLFarmasi IncludeJasa = 1; Seroja menagih
--    obat dengan harga jualnya. Bawaannya ditagih.
-- 3. bill_farmasi.termasuk_jasa: potret tanda itu saat Siapkan, supaya pengaturan yang berubah sesudahnya tidak mengubah
--    tagihan penyerahan yang sudah disiapkan. Kosong selama penyerahan masih draf.

ALTER TABLE public.far_tr_resep
    ADD COLUMN kunjungan_id uuid;

ALTER TABLE public.far_m_lokasi_layanan
    ADD COLUMN termasuk_jasa boolean DEFAULT false NOT NULL;

ALTER TABLE public.bill_farmasi
    ADD COLUMN termasuk_jasa boolean;
UPDATE public.bill_farmasi SET termasuk_jasa = false WHERE status <> 'draf';
ALTER TABLE public.bill_farmasi
    ADD CONSTRAINT bill_farmasi_termasuk_jasa_check CHECK (status = 'draf' OR termasuk_jasa IS NOT NULL);
