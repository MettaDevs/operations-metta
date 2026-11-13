-- Kelompok harga tipe pasien. Di sistem lama tipe pasien (SIMmJenisKerjasama) sekaligus kunci harga dan cara bayar:
-- GetTarifBiayaNonKerjasama mencari tarif menurut JenisKerjasamaID. Di sini kunci harga dipisah ke master Core
-- kelompok_harga (Customer Price Group di BC), dan tipe pasien menunjuknya. Beberapa tipe boleh berbagi satu kelompok,
-- misalnya Umum dan Pemda. Kosong berarti tipe ini hanya memakai harga yang berlaku untuk semua kelompok.

ALTER TABLE public.sim_m_tipe_pasien
    ADD COLUMN kelompok_harga_id uuid,
    ADD CONSTRAINT sim_m_tipe_pasien_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX sim_m_tipe_pasien_kelompok_harga_index
    ON public.sim_m_tipe_pasien USING btree (tenant_id, kelompok_harga_id) WHERE (deleted_at IS NULL);
