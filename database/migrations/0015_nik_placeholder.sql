-- NIK mengikuti validasi form pasien aplikasi lama (keputusan pemilik produk, 10 November 2026: "satu NIK satu orang,
-- pokoknya ikuti validasi aplikasi lama"). Sumbernya common/views/patients/form.php dan common/controllers/Patients.php
-- aplikasi puskesmas lama:
--
-- 1. Isian NIK adalah input angka (`type="number"`) tanpa batas panjang. Pola 16 angka dari CoreERP tidak ada di form
--    lama, jadi diganti menjadi angka saja. Nilai pengganti seperti 00000000 untuk bayi pun lolos format.
-- 2. Satu NIK satu orang tetap berlaku, kecuali nilai pengganti 9999999999999999. Form lama mengisinya otomatis untuk
--    warga negara asing dan tidak menolaknya walau dipakai banyak pasien. Indeks unik NIK per tenant dibuat ulang
--    dengan pengecualian itu.
--
-- Keduanya hanya melonggarkan, jadi kode rilis sebelumnya tetap berjalan di atas skema ini; kode itu sendiri masih
-- menolak NIK pengganti yang dipakai dua kali lewat pemeriksaan di aplikasi.

UPDATE public.party_identification_types
SET number_pattern = '^[0-9]+$', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'nik';

DROP INDEX public.party_identifications_nik_unique;
CREATE UNIQUE INDEX party_identifications_nik_unique
    ON public.party_identifications USING btree (tenant_id, number)
    WHERE (type_code = 'nik' AND deleted_at IS NULL AND number <> '9999999999999999');
