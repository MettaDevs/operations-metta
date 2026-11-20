-- Setelan pribadi pengguna, padanan My Settings / User Personalization BC: disimpan per akun, bukan per peramban,
-- karena satu komputer klinik dipakai bergantian oleh beberapa petugas.
--
-- Kolom ini hanya menyimpan pilihan yang memang pernah diubah pengguna, sehingga nilai bawaan yang kelak berubah ikut
-- sampai ke pengguna yang belum pernah memilih. Nama kolom mengikuti bahasa tabel users yang lain.
ALTER TABLE public.users ADD COLUMN preferences jsonb DEFAULT '{}'::jsonb NOT NULL;
