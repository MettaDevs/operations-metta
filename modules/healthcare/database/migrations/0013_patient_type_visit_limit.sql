-- Batas kunjungan per poli per hari untuk setiap tipe pasien. Aturan puskesmas: pasien boleh didaftarkan ke poli yang
-- sama paling banyak n kali sehari, tergantung tipe pasiennya (misalnya BPJS sekali, Umum tanpa batas). Sistem lama
-- tidak punya kolom ini; ia atribut baru, diisi admin di layar Tipe pasien. Pendaftaran kunjungan kelak membacanya.
--
-- 0 berarti tanpa batas, jadi tipe yang sudah ada tetap tidak dibatasi. Migration ini sengaja tidak menebak tipe mana
-- yang BPJS: tenant sendiri yang mengisi 1 untuk tipenya.
ALTER TABLE public.sim_m_tipe_pasien
    ADD COLUMN maks_kunjungan_per_poli_per_hari integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT sim_m_tipe_pasien_maks_kunjungan_check CHECK (maks_kunjungan_per_poli_per_hari >= 0);
