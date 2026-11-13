-- Oracle harga obat sistem lama untuk legacy-drug-prices.json. Dijalankan read-only (hanya SELECT, tanpa menulis apa
-- pun) pada 13 November 2026 di salinan database Kuta 1, Seroja, dan Penta, memanggil fungsi sistem lama
-- dbo.GetHargaObatNew_WithStok(tipe, 'xx', 1, barang, 0, '', 0): tipe pasien (kelompok harga), section 'xx', KTP 1,
-- barang, CustomerKerjasamaID 0 (tanpa kontrak penjamin), dan dua parameter lain kosong. Seroja dan Penta dijalankan
-- sekali lagi dengan KTP 0 (argumen ketiga 0) untuk barang yang sama. Keluarannya, beserta baris SIMmGradingHargaObat
-- TipePelayanan STANDARD untuk setiap nilai KTP, adalah isi legacy-drug-prices.json. Hanya nilai master dan harga yang
-- diambil, tanpa data pasien. CI tidak punya SQL Server; test membaca berkas JSON itu saja.
--
-- Sampel per database: harga dasar (mBarang.Harga_Jual) terendah, tengah, dan tertinggi per kelompok grading, untuk
-- setiap tipe pasien yang punya baris grading.

-- Penta: JenisKerjasamaID 2 IKS, 3 UMUM, 4 WNA, 9 BPJS, 11 EKSPATRIAT, 12 TOURIST INSURANCE, 13 APOTEK. Dijalankan
-- dua kali, untuk kelompok PENTA G1 sampai G3 lalu G4 sampai G6.
WITH items AS (
    SELECT b.Barang_ID, b.KelompokGrading, b.Harga_Jual,
           ROW_NUMBER() OVER (PARTITION BY b.KelompokGrading ORDER BY b.Harga_Jual, b.Barang_ID) AS rn,
           COUNT(*) OVER (PARTITION BY b.KelompokGrading) AS n
    FROM mBarang b
    WHERE b.Harga_Jual > 0
)
SELECT p.KelompokGrading, p.Harga_Jual, j.JenisKerjasamaID, h.Harga_Baru, h.Disc
FROM items p
CROSS JOIN (SELECT JenisKerjasamaID FROM SIMmJenisKerjasama WHERE JenisKerjasamaID IN (2, 3, 4, 9, 11, 12, 13)) j
CROSS APPLY dbo.GetHargaObatNew_WithStok(j.JenisKerjasamaID, 'xx', 1, p.Barang_ID, 0, '', 0) h
WHERE p.rn = 1 OR p.rn = p.n OR p.rn = p.n / 2 + 1;

-- Seroja: JenisKerjasamaID 2 IKS, 3 LOCAL, 9 BPJS, 10 DOMESTIC, 11 EXPART, 12 FOREIGN. Fungsi salinan Seroja juga
-- mencocokkan kelas barang (Kelas_ID), jadi sampel dipartisi per kelompok grading dan kelas, ditambah peringkat 2, 40,
-- 200, dan 500 untuk kelompok XX.
WITH items AS (
    SELECT b.Barang_ID, b.KelompokGrading, b.Kelas_ID, b.Harga_Jual,
           ROW_NUMBER() OVER (PARTITION BY b.KelompokGrading, b.Kelas_ID ORDER BY b.Harga_Jual, b.Barang_ID) AS rn,
           COUNT(*) OVER (PARTITION BY b.KelompokGrading, b.Kelas_ID) AS n
    FROM mBarang b
    WHERE b.Harga_Jual > 0
)
SELECT p.KelompokGrading, p.Kelas_ID, p.Harga_Jual, j.JenisKerjasamaID, h.Harga_Baru, h.Disc
FROM items p
CROSS JOIN (SELECT JenisKerjasamaID FROM SIMmJenisKerjasama WHERE JenisKerjasamaID IN (2, 3, 9, 10, 11, 12)) j
CROSS APPLY dbo.GetHargaObatNew_WithStok(j.JenisKerjasamaID, 'xx', 1, p.Barang_ID, 0, '', 0) h
WHERE p.rn = 1 OR p.rn = p.n OR p.rn = p.n / 2 + 1
   OR (p.KelompokGrading = 'XX' AND p.rn IN (2, 40, 200, 500));

-- Kuta 1: semua barang berkelompok XX, jadi satu partisi dengan peringkat 1, 2, 100, 1000, tengah, n - 100, dan n.
-- JenisKerjasamaID 2 IKS, 3 UMUM, 9 BPJS.
WITH items AS (
    SELECT b.Barang_ID, b.KelompokGrading, b.Harga_Jual,
           ROW_NUMBER() OVER (ORDER BY b.Harga_Jual, b.Barang_ID) AS rn,
           COUNT(*) OVER () AS n
    FROM mBarang b
    WHERE b.Harga_Jual > 0
)
SELECT p.KelompokGrading, p.Harga_Jual, j.JenisKerjasamaID, h.Harga_Baru, h.Disc
FROM items p
CROSS JOIN (SELECT JenisKerjasamaID FROM SIMmJenisKerjasama WHERE JenisKerjasamaID IN (2, 3, 9)) j
CROSS APPLY dbo.GetHargaObatNew_WithStok(j.JenisKerjasamaID, 'xx', 1, p.Barang_ID, 0, '', 0) h
WHERE p.rn IN (1, 2, 100, 1000, p.n / 2 + 1, p.n - 100, p.n);
