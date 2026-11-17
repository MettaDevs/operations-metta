-- E-Resep menampilkan obat pengganti yang diserahkan farmasi. Sejak pharmacy 0021 apoteker boleh menyerahkan obat
-- pengganti sebagai ganti obat yang ditulis dokter (Item Substitution BC), dan pharmacy.prescription.dispensed.v1
-- membawa `substitution` per baris: obat resep, persetujuan, alasan, waktu, dan pengguna. Tanpa kolom ini E-Resep
-- menampilkan jumlah yang diserahkan di bawah nama obat resep, padahal pasien menerima obat lain.
--
-- Obat yang diserahkan disalin dari event: id barang Core dan namanya saat diserahkan, tanpa foreign key, karena
-- penerima event tidak boleh gagal karena data module lain. Resep dokter (obat_id) tidak berubah. Kosong berarti obat
-- yang diserahkan adalah obat resep, juga untuk penyerahan sebelum kolom ini ada.

ALTER TABLE public.sim_tr_resep_detail
    ADD COLUMN obat_diserahkan_id uuid,
    ADD COLUMN nama_obat_diserahkan character varying(200),
    ADD COLUMN persetujuan_ganti character varying(20),
    ADD COLUMN alasan_ganti character varying(200),
    ADD CONSTRAINT sim_tr_resep_detail_ganti_check CHECK (
        (obat_diserahkan_id IS NULL AND nama_obat_diserahkan IS NULL AND persetujuan_ganti IS NULL
         AND alasan_ganti IS NULL)
        OR (obat_diserahkan_id IS NOT NULL AND nama_obat_diserahkan IS NOT NULL AND persetujuan_ganti IS NOT NULL
            AND alasan_ganti IS NOT NULL));
