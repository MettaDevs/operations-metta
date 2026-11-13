-- Patient KTP (PasienKTP sistem lama): pasien memegang KTP setempat atau tidak. Di sistem lama ia atribut pasien
-- (mPasien.PasienKTP, bawaan 1 pada impor data) yang disalin ke kunjungan saat registrasi (SIMtrRegistrasi.PasienKTP,
-- registration_helper Kuta 1), dan harga membaca nilai kunjungan, bukan nilai pasien. Arahan pemilik produk 13 November
-- 2026: harga dipindah 1:1 lebih dulu. Yang membaca nilai kunjungan di sini: kunci Patient KTP harga tindakan
-- (sim_m_tindakan_harga.pasien_ktp, 0034) dan grading harga obat farmasi, lewat patient.ktp event
-- healthcare.prescription.issued.v1.
--
-- 1. sim_m_pasien.pasien_ktp, bawaan true untuk pasien baru dan pasien yang sudah ada.
-- 2. sim_tr_registrasi.pasien_ktp, disalin dari pasien saat kunjungan didaftarkan; mengubah pasien sesudahnya tidak
--    mengubah kunjungan yang sudah ada. Kunjungan yang sudah ada mendapat true, sama dengan nilai pasiennya, karena kolom
--    pasien juga baru dengan bawaan true.

ALTER TABLE public.sim_m_pasien ADD COLUMN pasien_ktp boolean DEFAULT true NOT NULL;

ALTER TABLE public.sim_tr_registrasi ADD COLUMN pasien_ktp boolean DEFAULT true NOT NULL;
