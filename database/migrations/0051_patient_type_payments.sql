-- Pembatas jenis bayar per tipe pasien dan bayar otomatis di kasir (src/foundation/billing/), irisan 7 spesifikasi kasir.
-- Pengaturannya milik module layanan kesehatan; kasir menerimanya bersama potret kunjungan selesai
-- (healthcare.visit.completed.v1), jadi Core tidak membaca tipe pasien.
--
-- 1. kunjungan_kasir.jenis_bayar_dibatasi: jenis bayar yang dikhususkan tipe pasien lain, ditolak untuk kunjungan ini
--    dengan pesan sistem lama "Tidak Dapat Menggunakan Tipe Pembayaran, Karena berbeda tipe pasien". Sistem lama hanya
--    menolaknya di browser (form/payment.php, DIJAMIN BPJS dan PERUSAHAAN ditulis mati per JenisKerjasamaID).
-- 2. kasir.otomatis: pembayaran yang dibuat saat kunjungan selesai untuk tipe pasien yang lunas otomatis, padanan bayar
--    otomatis BPJS sistem lama. Pembayaran otomatis tidak diterima kasir, jadi tidak masuk clerk mana pun, dan
--    penggunanya pengguna yang menyelesaikan kunjungan bila ada. Pembayaran biasa tetap wajib punya clerk.

ALTER TABLE public.kunjungan_kasir
    ADD COLUMN jenis_bayar_dibatasi uuid[] DEFAULT '{}'::uuid[] NOT NULL;

ALTER TABLE public.kasir
    ADD COLUMN otomatis boolean DEFAULT false NOT NULL,
    ALTER COLUMN clerk_id DROP NOT NULL,
    ALTER COLUMN user_id DROP NOT NULL,
    ADD CONSTRAINT kasir_clerk_check CHECK (otomatis OR (clerk_id IS NOT NULL AND user_id IS NOT NULL));
