-- Kunjungan kasir yang dibuka kembali (src/foundation/billing/charge/). Keputusan pemilik produk, 13 November 2026:
-- rujuk internal boleh ditambah sesudah Selesai periksa selama kunjungan belum dibayar, seperti sistem lama yang tidak
-- memeriksa status saat merujuk (statuspasien_helper::RujukInternalFormSubmit). Kunjungan itu kembali diperiksa, dan
-- module layanan kesehatan menerbitkan healthcare.visit.reopened.v1. Kasir menandai barisnya `dibuka`, sehingga
-- kunjungan itu keluar dari Daftar Pembayaran dan tidak bisa dibayar sampai healthcare.visit.completed.v1 berikutnya
-- mengembalikannya ke `selesai`.

ALTER TABLE public.kunjungan_kasir DROP CONSTRAINT kunjungan_kasir_status_check;
ALTER TABLE public.kunjungan_kasir
    ADD CONSTRAINT kunjungan_kasir_status_check CHECK (status IN ('selesai', 'dibuka', 'batal'));
