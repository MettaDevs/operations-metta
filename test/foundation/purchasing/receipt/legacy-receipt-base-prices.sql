-- Oracle harga dasar penerimaan sistem lama untuk legacy-receipt-base-prices.json. Dijalankan read-only (hanya SELECT)
-- pada 16 November 2026 di salinan database Seroja (METTA_KLINIK_SEROJA) dan Kuta 1 (dinkes-simpus-kuta-satu). Hanya
-- nilai uang dan persen yang diambil; tidak ada nama barang, vendor, atau data pasien.
--
-- Sistem lama mencatat harga yang dihitung setiap baris penerimaan (curHarga di Goods_receipt.php) lewat prosedur
-- InsertHargaChange ke mBarang_ChangePrice.UpPrice, satu baris per barang, section, dan tanggal. Baris penerimaan hanya
-- dipakai bila catatan tanggal itu pasti miliknya: barang itu satu-satunya baris penerimaan pada tanggal itu dan ada
-- tepat satu catatan harga. Prosedur itu tidak mencatat harga yang sama dengan catatan sebelumnya, jadi sebagian baris
-- tidak punya catatan dan tidak ikut.

-- 1. Kasus per baris. Jalankan sekali per database (ganti nama tiga bagiannya). Seroja: baris ber-PPN, berkonversi
--    selain 1, atau berdiskon (baris tanpa ketiganya hanya menyalin harga beli). Kuta 1: baris ber-PPN saja, karena
--    semua barisnya berkonversi 1 dan hanya dua yang berdiskon, keduanya ber-PPN.
WITH lines AS (
    SELECT h.Tgl_Penerimaan, d.Barang_ID, d.Harga_Beli, ISNULL(d.Rate_Pajak, 0) AS Rate_Pajak, d.Konversi,
           ISNULL(d.Diskon_1, 0) AS Diskon_1,
           COUNT(*) OVER (PARTITION BY d.Barang_ID, CAST(h.Tgl_Penerimaan AS date)) AS same_day
    FROM METTA_KLINIK_SEROJA.dbo.BL_trPenerimaanDetail d
    JOIN METTA_KLINIK_SEROJA.dbo.BL_trPenerimaan h ON h.Penerimaan_ID = d.Penerimaan_ID
    WHERE d.Konversi > 0
), logged AS (
    SELECT DISTINCT l.Harga_Beli, l.Rate_Pajak, l.Konversi, l.Diskon_1, c.UpPrice
    FROM lines l
    CROSS APPLY (SELECT COUNT(*) AS logs, MAX(c.UpPrice) AS UpPrice
                 FROM METTA_KLINIK_SEROJA.dbo.mBarang_ChangePrice c
                 WHERE c.Barang_ID = l.Barang_ID AND CAST(c.Tanggal AS date) = CAST(l.Tgl_Penerimaan AS date)) c
    WHERE l.same_day = 1 AND c.logs = 1
      AND (l.Rate_Pajak > 0 OR l.Konversi <> 1 OR l.Diskon_1 > 0)  -- Kuta 1: AND l.Rate_Pajak > 0
)
SELECT STUFF((SELECT ',["' + FORMAT(CAST(Harga_Beli AS decimal(19,4)), 'G29')
                     + '","' + FORMAT(CAST(Rate_Pajak AS decimal(19,4)), 'G29')
                     + '","' + FORMAT(CAST(Konversi AS decimal(19,4)), 'G29')
                     + '","' + FORMAT(CAST(Diskon_1 AS decimal(19,4)), 'G29')
                     + '","' + FORMAT(CAST(UpPrice AS decimal(19,4)), 'G29') + '"]'
              FROM logged ORDER BY Harga_Beli, Rate_Pajak, Konversi, Diskon_1
              FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 1, '') AS cases_json;

-- 2. Rantai harga dasar Kuta 1: setiap barang yang menerima baris ber-PPN dan lebih dari satu penerimaan, semua baris
--    penerimaannya berurutan tanggal, catatan harganya, dan Harga_Jual barang sekarang. Harga_Jual Kuta 1 tidak pernah
--    diubah tangan lewat penerimaan (tidak ada isian HPP seperti di Seroja), jadi Harga_Jual sekarang adalah hasil
--    akhir rantai. Barang 373 tidak ikut: Harga_Jual-nya 175, lebih tinggi dari harga setiap penerimaannya (174,27, 161,
--    161), jadi nilainya tidak berasal dari penerimaan. Seroja tidak punya rantai, karena layarnya membolehkan pengguna
--    menimpa HPP per baris (Harga_Jual detail) dan nilai itulah yang masuk mBarang.
SELECT d.Barang_ID, h.Penerimaan_ID, CONVERT(varchar(10), h.Tgl_Penerimaan, 120) AS tanggal,
       FORMAT(CAST(d.Harga_Beli AS decimal(19,4)), 'G29') AS harga_beli,
       FORMAT(CAST(d.Rate_Pajak AS decimal(19,4)), 'G29') AS tarif_ppn,
       FORMAT(CAST(d.Konversi AS decimal(19,4)), 'G29') AS konversi,
       FORMAT(CAST(d.Diskon_1 AS decimal(19,4)), 'G29') AS diskon_persen,
       FORMAT(CAST(c.UpPrice AS decimal(19,4)), 'G29') AS harga_baris,
       FORMAT(CAST(b.Harga_Jual AS decimal(19,4)), 'G29') AS harga_dasar_sekarang
FROM [dinkes-simpus-kuta-satu].dbo.BL_trPenerimaanDetail d
JOIN [dinkes-simpus-kuta-satu].dbo.BL_trPenerimaan h ON h.Penerimaan_ID = d.Penerimaan_ID
JOIN [dinkes-simpus-kuta-satu].dbo.mBarang b ON b.Barang_ID = d.Barang_ID
OUTER APPLY (SELECT TOP 1 c.UpPrice FROM [dinkes-simpus-kuta-satu].dbo.mBarang_ChangePrice c
             WHERE c.Barang_ID = d.Barang_ID AND CAST(c.Tanggal AS date) = CAST(h.Tgl_Penerimaan AS date)) c
WHERE d.Barang_ID IN (SELECT Barang_ID FROM [dinkes-simpus-kuta-satu].dbo.BL_trPenerimaanDetail WHERE Rate_Pajak > 0)
  AND d.Barang_ID IN (SELECT Barang_ID FROM [dinkes-simpus-kuta-satu].dbo.BL_trPenerimaanDetail
                      GROUP BY Barang_ID HAVING COUNT(*) > 1)
ORDER BY d.Barang_ID, h.Tgl_Penerimaan, h.Penerimaan_ID;
