-- Cara tipe pasien mendapat tarif jasa, pengganti cabang yang ditulis mati di sistem lama. Arahan pemilik produk
-- 13 November 2026: jasa dan semua turunannya mengikuti sistem lama 1:1, termasuk angkanya; id dan cabang yang ditulis
-- mati menjadi data yang memberi hasil sama.
--
-- Sistem lama memilih fungsi tarif dari JenisKerjasamaID di PHP (Services::datatable_charge_collection): tipe dalam
-- daftar memanggil GetTarifBiayaNonKerjasama, tipe 9 memanggil GetTarifBiayaJKN_BUFF, tipe lain tidak dapat tarif.
-- Fungsi itu lalu mencari baris tarif kelompok lain dari tipe pasiennya: GetTarifBiayaNonKerjasama mengganti 2 menjadi
-- 3, _BUFF Kuta 1 dan Penta mengganti semua kecuali 4 menjadi 3, _BUFF Seroja mengganti tipe di luar 3, 4, 10, 11, 12
-- menjadi 3, dan JKN selalu mencari tipe 3. Langkah pencariannya juga berbeda per pemasangan (lihat
-- procedure-price.lookup.ts).
--
-- 1. tarif_jasa: kode dari procedureTariffs (procedure-price.options.ts). none = tanpa tarif; general dan
--    general_own_group = GetTarifBiayaNonKerjasama Kuta 1/Penta dan Seroja; bpjs dan bpjs_matching_only =
--    GetTarifBiayaJKN_BUFF Kuta 1/Penta dan Seroja. Tipe yang sudah ada dan tipe baru memakai general, supaya tipe
--    contoh tetap mendapat tarif.
-- 2. kelompok_harga_tarif_id: kelompok harga yang baris tarifnya dicari, hasil remap di atas. Kosong berarti kelompok
--    harga tipe itu sendiri (kelompok_harga_id). Contoh Kuta 1: IKS (2) dan BPJS (9) menunjuk kelompok UMUM (3), WNA
--    (4) kosong, PEMDA (10) tanpa tarif.
--
-- Remap disimpan per tipe pasien, bukan dengan mengarahkan tipe pasien ke kelompok harga bersama, karena fungsi harga
-- obat sistem lama (grading, #130) juga membaca kelompok harga tipe pasien dengan remap-nya sendiri. Mengganti
-- kelompok harga tipe untuk tarif jasa akan mengubah grading obatnya.

ALTER TABLE public.sim_m_tipe_pasien
    ADD COLUMN tarif_jasa character varying(30) DEFAULT 'general' NOT NULL,
    ADD COLUMN kelompok_harga_tarif_id uuid,
    ADD CONSTRAINT sim_m_tipe_pasien_tarif_jasa_check
        CHECK (tarif_jasa IN ('none', 'general', 'general_own_group', 'bpjs', 'bpjs_matching_only')),
    ADD CONSTRAINT sim_m_tipe_pasien_kelompok_harga_tarif_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_tarif_id) REFERENCES public.kelompok_harga(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_m_tipe_pasien_kelompok_harga_tarif_index
    ON public.sim_m_tipe_pasien USING btree (tenant_id, kelompok_harga_tarif_id) WHERE (deleted_at IS NULL);
