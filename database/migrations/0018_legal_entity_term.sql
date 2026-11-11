-- Entitas hukum ditulis "Legal entity" di layar, bukan "Perusahaan" atau "Entitas legal" (keputusan pemilik produk,
-- 11 November 2026: "jangan pakai perusahaan, kita ganti pakai Legal entity aja, sesuai padanan di Microsoft, biar gak
-- rancu"). Teks di kode diganti langsung; migration ini mengganti label milik Core yang tersimpan di database.
--
-- 1. Jenis party `legal_entity` di Buku alamat.
-- 2. Judul change log tabel peserta kebijakan data sharing, untuk baris bawaan maupun salinan tenant yang belum diubah.
--
-- Hubungan party `subsidiary` ("Anak perusahaan dari" / "Induk perusahaan dari") sengaja tidak diganti: ia hubungan
-- bisnis antar organisasi di Buku alamat, bukan legal entity tenant.
UPDATE public.party_types
SET name = 'Legal entity', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'legal_entity' AND name = 'Entitas legal';

UPDATE public.change_log_setup_tables
SET table_caption = 'Legal entity dalam kebijakan data sharing', updated_at = now() AT TIME ZONE 'utc'
WHERE table_name = 'data_sharing_policy_companies' AND table_caption = 'Perusahaan dalam kebijakan data sharing';
