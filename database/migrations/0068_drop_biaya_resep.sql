-- tagihan_kasir_detail.biaya_resep (BiayaResep GetDetailRincianBiaya sistem lama) tidak pernah diisi dan tidak dibaca.
-- Biaya resep dan biaya racik farmasi masuk tagihan sebagai baris sendiri (Qty 1, Nilai biayanya), sehingga rumus total
-- kasir Kuta yang dipakai di sini tetap utuh dan diskon kasir bisa memilih barisnya seperti jasa lain.
ALTER TABLE public.tagihan_kasir_detail DROP COLUMN biaya_resep;
