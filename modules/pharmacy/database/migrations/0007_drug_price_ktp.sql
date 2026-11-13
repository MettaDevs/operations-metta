-- KTP pasien sebagai kunci grading harga obat. Setiap lookup GetHargaObatNew_WithStok sistem lama (Seroja dan Penta)
-- mencocokkan KTP=@KTP: KTP 1 untuk pasien yang memegang KTP setempat (mPasien.PasienKTP, disalin ke
-- SIMtrRegistrasi.PasienKTP saat registrasi), KTP 0 untuk yang tidak, dan baris Seroja berbeda menurut nilai itu
-- (FOREIGN XX: KTP 0 60 %, KTP 1 80 %; EXPART INJEKSI dan FOREIGN INJEKSI hanya ada untuk KTP 0). Migration 0005 tidak
-- membawanya; arahan pemilik produk 13 November 2026: harga obat dipindah 1:1 lebih dulu, jadi KTP menjadi kunci baris,
-- sama dengan harga tindakan layanan kesehatan (sim_m_tindakan_harga.pasien_ktp). Yang tetap tidak dibawa sebagai kode:
-- sistem lama memaksa KTP 1 untuk JenisKerjasamaID 9 (BPJS, id yang ditulis mati); kelompok harga yang tidak
-- membedakan KTP cukup diberi baris untuk kedua nilai.
--
-- 1. KTP pasien di resep: patient.ktp event healthcare.prescription.issued.v1, yaitu nilai kunjungan yang disalin dari
--    pasien saat registrasi. Pesan tanpa field itu dan resep yang sudah ada dianggap KTP, bawaan sistem lama.
-- 2. KTP di grading harga obat. Baris yang sudah ada berlaku untuk pasien KTP. Baris hanya cocok dengan resep yang
--    KTP-nya sama persis: pasien tanpa baris untuk KTP-nya jatuh ke baris semua barang untuk KTP-nya, lalu 0 %, tidak
--    pernah ke baris KTP lain. Rentang bertumpuk ditolak per kunci yang ikut membawa KTP.

ALTER TABLE public.far_tr_resep ADD COLUMN pasien_ktp boolean DEFAULT true NOT NULL;

ALTER TABLE public.far_m_grading_harga ADD COLUMN pasien_ktp boolean DEFAULT true NOT NULL;
