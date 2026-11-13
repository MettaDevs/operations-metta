-- Kasus sintetis legacy-procedure-prices.json. Data asli ketiga database hanya memakai kunci wildcard (kelas XX, dokter
-- XX, spesialis ALL, kategori operasi 1, bukan cyto, KTP, lokasi RJ) dan tidak ada jasa bertanda Var_Cito atau
-- Var_KategoriOperasi, jadi sebagian besar langkah fungsi tarif tidak tercapai oleh kasus asli. Skrip ini membuat tabel
-- minimal sistem lama dengan tipe kolom salinan Kuta, mengisinya dengan baris sintetis yang mencapai setiap langkah,
-- menyalin view dan fungsi tarif apa adanya dari database sistem lama di server yang sama, lalu memanggil fungsi itu
-- seperti Services::datatable_charge_collection untuk setiap sel grid masukan.
--
-- Hanya untuk database scratch kosong di server lokal, tidak pernah untuk database sistem lama:
--
--   sqlcmd -S <server> -E -C -I -Q "CREATE DATABASE tarif_golden_scratch COLLATE SQL_Latin1_General_CP1_CI_AS"
--   sqlcmd -S <server> -E -C -I -y 0 -d tarif_golden_scratch -v SOURCE_DB=<database sistem lama> \
--          -i legacy-procedure-prices.synthetic.sql
--   sqlcmd -S <server> -E -C -I -Q "DROP DATABASE tarif_golden_scratch"
--
-- Dijalankan 13 November 2026 dua kali: SOURCE_DB salinan Kuta 1 (fungsinya sama dengan Penta), lalu dengan
-- GetTarifBiayaNonKerjasama_BUFF dan GetTarifBiayaJKN_BUFF salinan Seroja (keduanya berbeda; view, Vw_Dokter, dan
-- GetTarifBiayaNonKerjasama sama di ketiga database). Skrip ini aman diulang: semua tabel dan objek dibuat ulang.
--
-- Keluarannya: `procedures` dengan bentuk yang sama dengan legacy-procedure-prices.sql, `grid` (satu baris per
-- pemanggil dan jasa: tipe+N atau tipe+J|JasaID|ListHargaID baris pertama tiap sel atau '-', urutan sel seperti di
-- bawah), dan `price_mismatches`, banyaknya sel yang harga hasil fungsinya berbeda dengan kolom harga baris itu
-- (Harga_Baru untuk N, HargaBPJS untuk J); nilainya harus 0, sehingga id yang sama berarti harga yang sama.
--
-- Urutan sel: dokter (xx, D1, D2, D3) × kelas (XX, K1, K2) × (cyto, kategori operasi) ((0, 1), (1, 1), (0, 2)) ×
-- PasienKTP (0, 1) × Lokasi (RJ, UGD, kosong), sumbu terakhir berganti paling cepat.
SET NOCOUNT ON;

DROP FUNCTION IF EXISTS dbo.GetTarifBiayaNonKerjasama;
DROP FUNCTION IF EXISTS dbo.GetTarifBiayaNonKerjasama_BUFF;
DROP FUNCTION IF EXISTS dbo.GetTarifBiayaJKN_BUFF;
DROP VIEW IF EXISTS dbo.VW_ListHarga;
DROP VIEW IF EXISTS dbo.Vw_Dokter;
DROP TABLE IF EXISTS dbo.SIMdListHarga, dbo.SIMmListJasa, dbo.SIMmKelas, dbo.SIMmSpesialisasi, dbo.SIMmSubSpesialis,
    dbo.mDokter, dbo.SIMmKategoriBiaya;

CREATE TABLE dbo.SIMmKelas (KelasID varchar(10) NOT NULL PRIMARY KEY, NamaKelas varchar(100) NOT NULL);
CREATE TABLE dbo.SIMmSpesialisasi (SpesialisID int NOT NULL PRIMARY KEY, SpesialisName varchar(100) NOT NULL);
CREATE TABLE dbo.SIMmSubSpesialis (SubSpesialisID varchar(10) NOT NULL PRIMARY KEY,
                                   SubSpesialisName varchar(50) NOT NULL);
CREATE TABLE dbo.SIMmKategoriBiaya (KategoriJasaID varchar(10) NOT NULL PRIMARY KEY,
                                    KategoriJasaName varchar(100) NOT NULL);
CREATE TABLE dbo.mDokter (DokterID varchar(10) NOT NULL, NamaDOkter varchar(100) NOT NULL, Alamat varchar(150),
                          NoKontak varchar(50), SpesialisasiID varchar(10), SubSpesialisasiID varchar(10), Tetap bit,
                          THT float, HonorDefault float, KomisiDefault float, IDPersonal varchar(50),
                          KodeKategoriVendor varchar(10), Pajak float, Active bit NOT NULL, Kode_Customer varchar(50));
CREATE TABLE dbo.SIMmListJasa (JasaID varchar(10) NOT NULL PRIMARY KEY, JasaName varchar(200) NOT NULL,
                               KategoriJasaID varchar(10) NOT NULL, HonorDefault bit NOT NULL,
                               HonorDokterPengirim float, HonorDokterPerawat float, Var_KategoriOperasi bit,
                               Var_Cito bit, Aktif bit);
CREATE TABLE dbo.SIMdListHarga (ListHargaID numeric(18, 0) NOT NULL PRIMARY KEY, JasaID varchar(10) NOT NULL,
                                KelasID varchar(10) NOT NULL, JenisPasienID int, PasienKTP bit NOT NULL,
                                KategoriOperasiID tinyint NOT NULL, DokterID varchar(50) NOT NULL,
                                Harga_Lama money NOT NULL, Harga_Baru money NOT NULL, HargaHC_Lama money,
                                HargaHC_Baru money, TglHargaBaru datetime NOT NULL, SpesialisID varchar(10),
                                SubSpesialisID varchar(10), Cyto bit NOT NULL, Lokasi varchar(10), DiscHCUmum float,
                                HargaBPJS money, HargaBPJS_Lama money, TglHargaBaruBPJS datetime);

-- Dokter XX berspesialisasi 0, yang tidak ada di SIMmSpesialisasi, sama dengan Kuta: nama spesialisnya NULL.
INSERT INTO dbo.SIMmKelas VALUES ('XX', 'Semua kelas'), ('K1', 'Kelas satu'), ('K2', 'Kelas dua');
INSERT INTO dbo.SIMmSpesialisasi VALUES (1, 'Penyakit Dalam'), (2, 'Anak'), (99, 'ALL');
INSERT INTO dbo.SIMmKategoriBiaya VALUES ('KB1', 'Kategori sintetis');
INSERT INTO dbo.mDokter (DokterID, NamaDOkter, SpesialisasiID, KodeKategoriVendor, Active)
VALUES ('XX', 'None', '0', 'V-002', 1), ('D1', 'Dokter satu', '1', 'V-002', 1),
       ('D2', 'Dokter dua', '2', 'V-002', 1), ('D3', 'Dokter tiga', NULL, 'V-002', 1);

-- Jasa dan tandanya: Var_Cito, Var_KategoriOperasi.
INSERT INTO dbo.SIMmListJasa (JasaID, JasaName, KategoriJasaID, HonorDefault, Var_KategoriOperasi, Var_Cito, Aktif)
VALUES ('S01', 'Dokter, kelas, spesialis', 'KB1', 0, 0, 0, 1),
       ('S02', 'Spesialis cocok atau tidak', 'KB1', 0, 0, 0, 1),
       ('S03', 'Kelas dengan dokter lain, lalu tipe saja', 'KB1', 0, 0, 0, 1),
       ('S04', 'Hanya tipe lain', 'KB1', 0, 0, 0, 1),
       ('S05', 'Urutan lokasi', 'KB1', 0, 0, 0, 1),
       ('S06', 'KTP sesudah langkah', 'KB1', 0, 0, 0, 1),
       ('S07', 'Cyto, Var_Cito 1', 'KB1', 0, 0, 1, 1),
       ('S08', 'Cyto, Var_Cito 0', 'KB1', 0, 0, 0, 1),
       ('S09', 'Kategori operasi, Var_KategoriOperasi 1', 'KB1', 0, 1, 0, 1),
       ('S10', 'Kategori operasi, Var_KategoriOperasi 0', 'KB1', 0, 0, 0, 1),
       ('S11', 'Cyto dan kategori operasi', 'KB1', 0, 1, 1, 1),
       ('S12', 'BPJS tanpa kelas dan dokter umum', 'KB1', 0, 0, 0, 1),
       ('S13', 'Lokasi sesudah langkah', 'KB1', 0, 0, 0, 1),
       ('S14', 'Tanpa baris tarif', 'KB1', 0, 0, 0, 1),
       ('S15', 'BPJS dan KTP', 'KB1', 0, 0, 0, 1);

-- Setiap baris berharga unik: Harga_Lama = id × 90, Harga_Baru = id × 100, HargaBPJS_Lama = id × 9,
-- HargaBPJS = id × 10.
WITH r AS (
    SELECT * FROM (VALUES
        (101, 'S01', 3, 'K1', 'D1', '99', 1, 0, 1, 'RJ'),
        (102, 'S01', 3, 'K1', 'XX', '99', 1, 0, 1, 'RJ'),
        (103, 'S01', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (104, 'S01', 4, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (105, 'S01', 11, 'K1', 'XX', '99', 1, 0, 1, 'RJ'),
        (106, 'S01', 3, 'XX', 'D2', '2', 1, 0, 1, 'RJ'),
        (201, 'S02', 3, 'K1', 'XX', '1', 1, 0, 1, 'RJ'),
        (202, 'S02', 3, 'XX', 'XX', '2', 1, 0, 1, 'RJ'),
        (203, 'S02', 3, 'K1', 'D2', '1', 1, 0, 1, 'RJ'),
        (204, 'S02', 4, 'K2', 'XX', '2', 1, 0, 1, 'RJ'),
        (205, 'S02', 11, 'XX', 'XX', '1', 1, 0, 1, 'RJ'),
        (301, 'S03', 3, 'K1', 'D2', '1', 1, 0, 1, 'RJ'),
        (302, 'S03', 3, 'K2', 'D1', '99', 1, 0, 1, 'XX'),
        (303, 'S03', 11, 'K1', 'D1', '2', 1, 0, 1, 'RJ'),
        (304, 'S03', 3, 'K2', 'D3', '99', 1, 0, 1, 'RJ'),
        (401, 'S04', 4, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (402, 'S04', 9, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (403, 'S04', 12, 'K1', 'XX', '99', 1, 0, 1, 'RJ'),
        (501, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'XX'),
        (502, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'UGD'),
        (503, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (504, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'RI'),
        (505, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (506, 'S05', 3, 'XX', 'XX', '99', 1, 0, 1, 'XX'),
        (601, 'S06', 3, 'K1', 'XX', '99', 1, 0, 0, 'RJ'),
        (602, 'S06', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (603, 'S06', 3, 'XX', 'XX', '99', 1, 0, 0, 'RJ'),
        (701, 'S07', 3, 'K1', 'XX', '99', 1, 1, 1, 'RJ'),
        (702, 'S07', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (703, 'S07', 3, 'XX', 'XX', '99', 1, 1, 1, 'RJ'),
        (801, 'S08', 3, 'K1', 'XX', '99', 1, 1, 1, 'RJ'),
        (802, 'S08', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (803, 'S08', 3, 'XX', 'XX', '99', 1, 1, 1, 'RJ'),
        (901, 'S09', 3, 'XX', 'XX', '99', 2, 0, 1, 'RJ'),
        (902, 'S09', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (903, 'S09', 3, 'XX', 'XX', '99', 3, 0, 1, 'RJ'),
        (904, 'S09', 3, 'K1', 'XX', '99', 2, 0, 1, 'RJ'),
        (1001, 'S10', 3, 'XX', 'XX', '99', 2, 0, 1, 'RJ'),
        (1002, 'S10', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (1003, 'S10', 3, 'XX', 'XX', '99', 3, 0, 1, 'RJ'),
        (1004, 'S10', 3, 'K1', 'XX', '99', 2, 0, 1, 'RJ'),
        (1101, 'S11', 3, 'XX', 'XX', '99', 2, 1, 1, 'RJ'),
        (1102, 'S11', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (1103, 'S11', 3, 'XX', 'XX', '99', 2, 0, 1, 'RJ'),
        (1104, 'S11', 3, 'K1', 'XX', '99', 1, 1, 1, 'RJ'),
        (1201, 'S12', 3, 'K2', 'D1', '1', 1, 0, 1, 'RJ'),
        (1202, 'S12', 9, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (1301, 'S13', 3, 'K1', 'XX', '99', 1, 0, 1, 'UGD'),
        (1302, 'S13', 3, 'XX', 'XX', '99', 1, 0, 1, 'RJ'),
        (1501, 'S15', 3, 'XX', 'XX', '1', 1, 0, 0, 'RJ'),
        (1502, 'S15', 3, 'K1', 'XX', '2', 1, 0, 0, 'RJ'),
        (1503, 'S15', 3, 'K2', 'XX', '99', 1, 0, 1, 'UGD')
    ) v(ListHargaID, JasaID, JenisPasienID, KelasID, DokterID, SpesialisID, KategoriOperasiID, Cyto, PasienKTP, Lokasi)
)
INSERT INTO dbo.SIMdListHarga (ListHargaID, JasaID, KelasID, JenisPasienID, PasienKTP, KategoriOperasiID, DokterID,
                               Harga_Lama, Harga_Baru, TglHargaBaru, SpesialisID, Cyto, Lokasi, DiscHCUmum, HargaBPJS,
                               HargaBPJS_Lama, TglHargaBaruBPJS)
SELECT ListHargaID, JasaID, KelasID, JenisPasienID, PasienKTP, KategoriOperasiID, DokterID, ListHargaID * 90,
       ListHargaID * 100, '2026-01-01', SpesialisID, Cyto, Lokasi, 0, ListHargaID * 10, ListHargaID * 9, '1900-01-01'
FROM r;

-- View dan fungsi tarif disalin apa adanya dari database sistem lama SOURCE_DB: view dulu, lalu fungsi BUFF, lalu
-- GetTarifBiayaNonKerjasama yang memanggilnya.
DECLARE @definition nvarchar(max);
DECLARE legacy_objects CURSOR LOCAL FAST_FORWARD FOR
    SELECT m.definition
    FROM [$(SOURCE_DB)].sys.sql_modules m
    JOIN [$(SOURCE_DB)].sys.objects o ON o.object_id = m.object_id
    WHERE o.schema_id = 1
      AND o.name IN ('Vw_Dokter', 'VW_ListHarga', 'GetTarifBiayaNonKerjasama_BUFF', 'GetTarifBiayaJKN_BUFF',
                     'GetTarifBiayaNonKerjasama')
    ORDER BY CASE o.name WHEN 'Vw_Dokter' THEN 0 WHEN 'VW_ListHarga' THEN 0 WHEN 'GetTarifBiayaNonKerjasama' THEN 2
             ELSE 1 END;
OPEN legacy_objects;
FETCH NEXT FROM legacy_objects INTO @definition;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC sp_executesql @definition;
    FETCH NEXT FROM legacy_objects INTO @definition;
END;
CLOSE legacy_objects;
DEALLOCATE legacy_objects;
GO

SET NOCOUNT ON;
DROP TABLE IF EXISTS #cells;
WITH callers AS (SELECT * FROM (VALUES (1, 3, 'N'), (2, 4, 'N'), (3, 11, 'N'), (4, 9, 'J')) c(ord, type_id, fn)),
doctors AS (SELECT * FROM (VALUES (1, 'xx'), (2, 'D1'), (3, 'D2'), (4, 'D3')) d(ord, id)),
classes AS (SELECT * FROM (VALUES (1, 'XX'), (2, 'K1'), (3, 'K2')) k(ord, id)),
modes AS (SELECT * FROM (VALUES (1, 0, 1), (2, 1, 1), (3, 0, 2)) m(ord, cyto, category)),
ktps AS (SELECT * FROM (VALUES (1, 0), (2, 1)) t(ord, ktp)),
locations AS (SELECT * FROM (VALUES (1, 'RJ'), (2, 'UGD'), (3, '')) l(ord, location))
SELECT c.ord AS caller, cast(c.type_id AS varchar(10)) + c.fn AS caller_key, j.JasaID,
       ((((d.ord - 1) * 3 + k.ord - 1) * 3 + m.ord - 1) * 2 + t.ord - 1) * 3 + l.ord - 1 AS cell,
       CASE c.fn
           WHEN 'N' THEN (SELECT '/' + cast(f.ListHargaID AS varchar(20)) + ',' + convert(varchar(30), f.Harga_Baru, 2)
                          FROM dbo.GetTarifBiayaNonKerjasama(j.JasaID, d.id, k.id, m.cyto, m.category, c.type_id, 1) f
                          WHERE (t.ktp = 0 OR f.KTP = t.ktp)
                            AND (l.location = '' OR f.Lokasi = l.location OR f.Lokasi = 'XX')
                          ORDER BY f.Lokasi
                          FOR XML PATH(''))
           ELSE (SELECT '/' + cast(f.ListHargaID AS varchar(20)) + ',' + convert(varchar(30), f.Harga_Baru, 2)
                 FROM dbo.GetTarifBiayaJKN_BUFF(j.JasaID, d.id, k.id, m.cyto, m.category, '') f
                 WHERE (l.location = '' OR f.Lokasi = l.location OR f.Lokasi = 'XX')
                 ORDER BY f.Lokasi
                 FOR XML PATH(''))
       END AS result
INTO #cells
FROM callers c CROSS JOIN dbo.SIMmListJasa j CROSS JOIN doctors d CROSS JOIN classes k CROSS JOIN modes m
CROSS JOIN ktps t CROSS JOIN locations l;

WITH firsts AS (
    SELECT caller, caller_key, JasaID, cell, fn = right(caller_key, 1),
           first_id = CASE WHEN result IS NULL THEN NULL
                           ELSE cast(substring(result, 2, charindex(',', result) - 2) AS numeric(18, 0)) END,
           first_price = CASE WHEN result IS NULL THEN NULL
                              ELSE substring(result, charindex(',', result) + 1,
                                             charindex('/', result + '/', 2) - charindex(',', result) - 1) END
    FROM #cells
)
SELECT
    (SELECT s.JasaID + '|' + isnull(cast(s.Var_Cito AS char(1)), '~') + '|'
            + isnull(cast(s.Var_KategoriOperasi AS char(1)), '~') + '|-|'
            + isnull(stuff((SELECT '/' + cast(v.ListHargaID AS varchar(20)) + ','
                                   + isnull(cast(v.JenisPasienID AS varchar(10)), '~') + ',' + v.KelasID + ','
                                   + v.DokterID + ',' + v.SpesialisName + ','
                                   + cast(v.KategoriOperasiID AS varchar(3)) + ',' + cast(v.Cyto AS char(1)) + ','
                                   + cast(v.PasienKTP AS char(1)) + ',' + isnull(v.Lokasi, '~') + ','
                                   + convert(varchar(30), v.Harga_Lama, 2) + ','
                                   + convert(varchar(30), v.Harga_Baru, 2) + ','
                                   + convert(varchar(10), v.TglHargaBaru, 23) + ','
                                   + isnull(convert(varchar(30), v.HargaBPJS_Lama, 2), '~') + ','
                                   + isnull(convert(varchar(30), v.HargaBPJS, 2), '~') + ','
                                   + isnull(convert(varchar(10), v.TglHargaBaruBPJS, 23), '~')
                            FROM dbo.VW_ListHarga v WHERE v.JasaID = s.JasaID ORDER BY v.ListHargaID
                            FOR XML PATH('')), 1, 1, ''), '') + char(10)
     FROM dbo.SIMmListJasa s ORDER BY s.JasaID
     FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)') AS procedures,
    (SELECT g.caller_key + '|' + g.JasaID + '|'
            + stuff((SELECT ',' + isnull(cast(f.first_id AS varchar(20)), '-')
                     FROM firsts f WHERE f.caller = g.caller AND f.JasaID = g.JasaID ORDER BY f.cell
                     FOR XML PATH('')), 1, 1, '') + char(10)
     FROM (SELECT DISTINCT caller, caller_key, JasaID FROM firsts) g ORDER BY g.caller, g.JasaID
     FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)') AS grid,
    (SELECT count(*) FROM firsts f JOIN dbo.SIMdListHarga h ON h.ListHargaID = f.first_id
     WHERE f.first_price <> convert(varchar(30), CASE f.fn WHEN 'N' THEN h.Harga_Baru ELSE h.HargaBPJS END, 2))
        AS price_mismatches;
