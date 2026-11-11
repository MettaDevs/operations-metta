-- Dua istilah layar yang diganti keputusan pemilik produk, 11 November 2026. Label milik module ini yang tersimpan di
-- database diganti di sini; teks di kode diganti langsung.
--
-- Pertama, entitas hukum ditulis "Legal entity" di layar, bukan "Perusahaan" ("jangan pakai perusahaan, kita ganti
-- pakai Legal entity aja, sesuai padanan di Microsoft, biar gak rancu"):
--
-- 1. Keterangan jenis data "Master pasien" di Sys Admin → Data sharing.
-- 2. Judul change log tabel yatim sim_m_kebijakan_berbagi_perusahaan, yang riwayat lamanya masih bisa dibuka. Nama
--    tabelnya sendiri tidak diganti: nama tabel tetap bahasa Indonesia, dan tabel yatim tidak diubah.
--
-- Kedua, tujuan hierarki `healthcare.patient-sharing` bernama "Tidak sharing master pasien", bukan "Kelompok sharing pasien",
-- supaya jelas hierarki ini memisahkan pasien antar unit dalam satu legal entity, bukan membuka sharing. Kodenya kunci
-- stabil dan tidak diubah. Keterangannya, dan keterangan jenis data di atas yang menyebutnya, ikut ditulis ulang.
--
-- Isian Perusahaan di kartu pasien (penjamin) tidak tersimpan sebagai label dan tidak tersentuh di sini.
UPDATE public.data_sharing_types
SET description = 'Legal entity yang ikut saling melihat pasien. Hierarki bertujuan Tidak sharing master pasien tetap memisahkan unit di dalam satu legal entity.',
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient'
  AND description = 'Perusahaan yang ikut saling melihat pasien. Kelompok di Hierarki organisasi tetap mempersempit di dalam satu perusahaan.';

UPDATE public.change_log_setup_tables
SET table_caption = 'Legal entity dalam kebijakan sharing pasien', updated_at = now() AT TIME ZONE 'utc'
WHERE table_name = 'sim_m_kebijakan_berbagi_perusahaan' AND table_caption = 'Perusahaan dalam kebijakan sharing pasien';

UPDATE public.hierarchy_purposes
SET name = 'Tidak sharing master pasien',
    description = 'Unit kerja teratas di setiap cabang beserta unit di bawahnya memakai data pasien dan nomor rekam medis sendiri, terpisah dari unit lain di legal entity yang sama.',
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient-sharing';
