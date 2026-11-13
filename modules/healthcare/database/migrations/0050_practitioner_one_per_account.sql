-- Satu akun login tertaut ke paling banyak satu tenaga kesehatan aktif. Nakes pelaku yang dicatat dari akun
-- (sim_nakes_milik_pengguna, 0046) kosong bila akunnya tertaut ke lebih dari satu nakes aktif, sehingga tanda vital,
-- alergi, dan penyerahan obat dari akun itu tercatat tanpa Practitioner SATUSEHAT. Indeks ini membuat keadaan itu tidak
-- bisa terjadi. Nakes nonaktif dan yang sudah dihapus tidak dihitung, jadi akun bisa dipindah ke catatan nakes lain
-- setelah yang lama dinonaktifkan.
--
-- Sistem lama tidak menautkan pengguna ke nakes sama sekali; tautan ini milik repo ini.
CREATE UNIQUE INDEX sim_m_nakes_user_aktif_unique
    ON public.sim_m_nakes USING btree (tenant_id, user_id) WHERE (aktif AND deleted_at IS NULL);
