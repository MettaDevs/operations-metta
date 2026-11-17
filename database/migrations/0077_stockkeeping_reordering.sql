-- Cara pesan ulang barang per lokasi (src/foundation/inventory/stockkeeping-unit/), pola Business Central: field
-- Reordering Policy dan Reorder Quantity di tabel Stockkeeping Unit (5700). Stok minimum yang sudah ada menjadi Reorder
-- Point dan stok maksimum menjadi Maximum Inventory, sama dengan Min_Stok dan Max_Stok di mBarangLokasiNew sistem lama:
-- prosedur BuatkanOrderanAutomatis di sana memesan barang yang stoknya di bawah Min_Stok.
--
-- Kebijakan kosong berarti barang ini tidak dihitung saran pesannya di lokasi itu, sama dengan Reordering Policy kosong.
-- Dua kebijakan yang dipakai:
-- - jumlah_tetap (Fixed Reorder Qty.): pesan jumlah_pesan_ulang, diulang sampai stok di atas stok minimum.
-- - maksimum (Maximum Qty.): pesan sampai stok maksimum.
-- Syaratnya mengikuti codeunit "Inventory Profile Offsetting": jumlah tetap butuh Reorder Quantity (TestField), dan
-- maksimum butuh Maximum Inventory di atas Reorder Point (CalcMaximumReorderQty).

ALTER TABLE public.gd_m_barang_lokasi
    ADD COLUMN kebijakan_pesan_ulang character varying(20),
    ADD COLUMN jumlah_pesan_ulang numeric(18,4),
    ADD CONSTRAINT gd_m_barang_lokasi_kebijakan_check
        CHECK (kebijakan_pesan_ulang IS NULL OR kebijakan_pesan_ulang IN ('jumlah_tetap', 'maksimum')),
    ADD CONSTRAINT gd_m_barang_lokasi_jumlah_pesan_ulang_check CHECK (jumlah_pesan_ulang > 0),
    ADD CONSTRAINT gd_m_barang_lokasi_jumlah_tetap_check
        CHECK (kebijakan_pesan_ulang IS DISTINCT FROM 'jumlah_tetap'
               OR (stok_minimum IS NOT NULL AND jumlah_pesan_ulang IS NOT NULL)),
    ADD CONSTRAINT gd_m_barang_lokasi_maksimum_check
        CHECK (kebijakan_pesan_ulang IS DISTINCT FROM 'maksimum'
               OR (stok_minimum IS NOT NULL AND stok_maksimum > stok_minimum));

UPDATE public.change_log_setup_tables
SET table_caption = 'Stok minimum, maksimum, dan cara pesan ulang barang per lokasi'
WHERE tenant_id IS NULL AND table_name = 'gd_m_barang_lokasi';
