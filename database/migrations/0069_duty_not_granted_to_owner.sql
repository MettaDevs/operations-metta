-- Duty yang tidak diberikan otomatis ke role pemilik. Selama ini penyiapan memberi role pemilik semua duty Core, dan
-- pemasangan module memberinya semua duty module itu. Keputusan pemilik produk 17 November 2026: mengubah harga obat,
-- diskon, dan biaya racik atau resep per baris adalah izin tersendiri yang bawaannya tidak dipegang role mana pun,
-- termasuk role pemilik. Tenant yang memakainya membuat role sendiri yang memegang duty itu.
--
-- Kolom ini dibaca pemasangan module (installModule). Duty yang sudah ada tetap diberikan seperti sebelumnya. Penyiapan
-- lingkungan belum membacanya, karena belum ada duty Core yang ditandai.

ALTER TABLE public.security_duties
    ADD COLUMN diberikan_ke_pemilik boolean DEFAULT true NOT NULL;
