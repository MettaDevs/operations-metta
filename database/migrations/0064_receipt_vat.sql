-- PPN pada penerimaan barang, port 1:1 dari BL_trPenerimaanDetail.Rate_Pajak dan BL_trPenerimaan.IncludePPN.
--
-- Sistem lama menaikkan Harga_Jual barang (di sini harga dasar) ke (Harga_Beli + Harga_Beli x Rate_Pajak / 100) /
-- Konversi, sebelum diskon (Goods_receipt.php). Tanpa tarif PPN di sini, harga dasar dari vendor yang harganya belum
-- termasuk PPN sekitar 11% terlalu rendah, begitu juga harga obat hasil grading yang dihitung dari harga dasar. Di data
-- lama, Rate_Pajak > 0 pada 274 dari 358 baris Seroja dan 24 dari 356 baris Kuta 1.
--
-- 1. tarif_ppn per baris (Rate_Pajak). Layar lama mengisi satu persen PPN di kepala dokumen lalu menyalinnya ke setiap
--    baris; di data lama nilainya 11, 0, dan sekali 21,15 (persen yang dihitung balik dari nilai PPN yang diketik).
--    Tidak ada master pajak (mPajak kosong di Seroja dan Kuta 1) dan tidak ada tarif bawaan di SetupAwal, jadi tarif
--    diketik pengguna dan tidak ada nilai bawaan selain 0.
-- 2. termasuk_ppn di kepala dokumen (IncludePPN). Di sistem lama tanda ini hanya dicatat dan ditampilkan: rumus harga
--    dasar dan nilai PPN dokumen (Pajak = subtotal x persen / 100, ditambahkan ke Total_Nilai) tidak membacanya. Satu
--    dokumen Seroja bertanda ini tetap menambahkan PPN 1.100 di atas subtotal 10.000. Di sini juga begitu; tanda ini
--    disimpan untuk pembukuan PPN masukan di finance, yang belum ada.
--
-- Nilai PPN dokumen tidak disimpan: ia jumlah nilai baris x tarif_ppn / 100, dihitung saat dibaca seperti nilai baris.
-- NoFakturPajak, TglFakturPajak, dan Tgl_JatuhTempo tidak ikut: layar lama tidak punya isiannya (jatuh tempo diisi
-- tanggal terima), dan di data Seroja maupun Kuta 1 nomor faktur pajak selalu kosong dan jatuh tempo selalu sama dengan
-- tanggal terima.

ALTER TABLE public.bl_tr_penerimaan ADD COLUMN termasuk_ppn boolean DEFAULT false NOT NULL;

ALTER TABLE public.bl_tr_penerimaan_detail
    ADD COLUMN tarif_ppn numeric(7,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT bl_tr_penerimaan_detail_tarif_ppn_check CHECK (tarif_ppn >= 0 AND tarif_ppn <= 100);

COMMENT ON COLUMN public.bl_tr_penerimaan.termasuk_ppn IS
    'Harga vendor sudah termasuk PPN (IncludePPN sistem lama). Hanya dicatat; tidak mengubah harga dasar maupun nilai PPN.';
COMMENT ON COLUMN public.bl_tr_penerimaan_detail.tarif_ppn IS
    'Tarif PPN baris dalam persen (Rate_Pajak sistem lama). Harga dasar barang = harga_satuan x (100 + tarif_ppn) / 100 '
    '/ konversi, sebelum diskon. Kartu gudang tetap memakai harga tanpa PPN.';
