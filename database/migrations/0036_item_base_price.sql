-- Harga dasar barang per satuan dasar, makna mBarang.Harga_Jual sistem lama: harga beli tertinggi per satuan stok.
-- Penerimaan barang di Kuta 1 (Goods_receipt.php) menghitung (Harga_Beli + Harga_Beli x Rate_Pajak / 100) / Konversi,
-- yaitu harga beli per satuan stok termasuk pajak dan sebelum diskon, lalu menaikkan Harga_Jual bila hasilnya lebih
-- tinggi; ia tidak pernah menurunkannya. Di sini posting penerimaan melakukan hal yang sama, batal posting tidak
-- menurunkannya, dan pengguna boleh mengubahnya di kartu barang. Harga jual obat di farmasi dihitung dari harga ini
-- (grading harga obat), jadi kolom ini harga acuan, bukan harga jual itu sendiri. Padanan terdekat di BC adalah
-- Last Direct Cost pada Item, dengan aturan "tertinggi" sistem lama.

ALTER TABLE public.gd_m_barang
    ADD COLUMN harga_dasar numeric(18,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT gd_m_barang_harga_dasar_check CHECK (harga_dasar >= 0);

COMMENT ON COLUMN public.gd_m_barang.harga_dasar IS
    'Harga dasar per satuan dasar (Harga_Jual mBarang sistem lama): harga beli tertinggi per satuan dasar dari '
    'penerimaan, sebelum diskon; tidak turun saat penerimaan dibatalkan; boleh diubah tangan.';
