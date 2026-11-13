-- Oracle tarif jasa sistem lama untuk kasus data asli legacy-procedure-prices.json. Dijalankan read-only (hanya SELECT,
-- tanpa menulis apa pun) pada 13 November 2026 di salinan database Puskesmas Kuta 1, Klinik Seroja, dan Klinik Penta.
-- Hanya nilai master dan harga yang diambil (baris tarif SIMdListHarga lewat VW_ListHarga dan hasil fungsi tarif),
-- tanpa data pasien. CI tidak punya SQL Server; test membaca berkas JSON itu saja.
--
-- Panggilan fungsi sama dengan Services::datatable_charge_collection (common/controllers/Services.php) yang mengisi
-- pilihan Biaya Tindakan poli: dokter 'xx' (tanpa dokter), kelas 'XX', cyto 0, kategori operasi 1, PasienKTP kosong
-- (SIMtrRegistrasi.PasienKTP Kuta NULL di semua baris, jadi saringan KTP tidak berlaku), Lokasi 'RJ', lalu
-- WHERE Lokasi = 'RJ' OR Lokasi = 'XX' ORDER BY Lokasi dan baris pertama. Tipe dalam daftar PHP memanggil
-- GetTarifBiayaNonKerjasama (N), tipe 9 memanggil GetTarifBiayaJKN_BUFF (J), tipe lain tidak dapat tarif (-). Kuta:
-- [2, 3, 4]; Seroja: [2, 3, 4, 10, 11, 12]. Penta tidak punya source PHP, jadi diuji di tingkat fungsi: N untuk setiap
-- tipe dan J untuk tipe 9, dengan saringan PHP yang sama dengan Kuta.
--
-- Sampel: jasa dikelompokkan menurut pola tipe pasien yang punya baris tarif (misalnya 3x1,4x1 atau '-' untuk jasa
-- tanpa tarif), lalu jasa pertama, tengah, dan terakhir menurut JasaID dari setiap pola, ditambah setiap jasa bertanda
-- Var_Cito atau Var_KategoriOperasi (tidak ada di ketiga database).
--
-- Ganti 'kuta' di CTE source menjadi 'seroja' atau 'penta' sesuai database yang dibuka. Keluarannya satu baris:
-- angka cakupan, `procedures` (satu baris per jasa: JasaID|Var_Cito|Var_KategoriOperasi|pola|baris tarif dipisah '/'
-- dengan kolom ListHargaID,JenisPasienID,KelasID,DokterID,SpesialisName,KategoriOperasiID,Cyto,PasienKTP,Lokasi,
-- Harga_Lama,Harga_Baru,TglHargaBaru,HargaBPJS_Lama,HargaBPJS,TglHargaBaruBPJS; NULL ditulis ~), dan `cases` (satu
-- baris per jasa dan panggilan: JasaID|JenisKerjasamaID|N, J, atau -|baris hasil sesudah saringan PHP dalam urutan
-- ORDER BY Lokasi, dipisah '/', dengan kolom ListHargaID,Harga_Lama,Harga_Baru,tanggal harga baru). Isinya disalin
-- ke legacy-procedure-prices.json; baris pertama hasil adalah tarif yang dipakai poli.
WITH source AS (SELECT 'kuta' AS name),
calls AS (
    SELECT c.JenisKerjasamaID, c.fn
    FROM (VALUES ('kuta', 2, 'N'), ('kuta', 3, 'N'), ('kuta', 4, 'N'), ('kuta', 9, 'J'), ('kuta', 10, '-'),
                 ('seroja', 2, 'N'), ('seroja', 3, 'N'), ('seroja', 9, 'J'), ('seroja', 10, 'N'), ('seroja', 11, 'N'),
                 ('seroja', 12, 'N'),
                 ('penta', 2, 'N'), ('penta', 3, 'N'), ('penta', 4, 'N'), ('penta', 9, 'N'), ('penta', 9, 'J'),
                 ('penta', 10, 'N'), ('penta', 11, 'N'), ('penta', 12, 'N'), ('penta', 13, 'N')
         ) c(source, JenisKerjasamaID, fn)
    JOIN source s ON s.name = c.source
),
patterns AS (
    SELECT j.JasaID, j.Var_Cito, j.Var_KategoriOperasi,
           isnull(stuff((SELECT ',' + cast(h.JenisPasienID AS varchar(10)) + 'x' + cast(count(*) AS varchar(10))
                         FROM SIMdListHarga h WHERE h.JasaID = j.JasaID
                         GROUP BY h.JenisPasienID ORDER BY h.JenisPasienID
                         FOR XML PATH('')), 1, 1, ''), '-') AS pattern
    FROM SIMmListJasa j
),
ranked AS (
    SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.pattern ORDER BY p.JasaID) AS rn,
           COUNT(*) OVER (PARTITION BY p.pattern) AS n
    FROM patterns p
),
sample AS (
    SELECT JasaID, Var_Cito, Var_KategoriOperasi, pattern FROM ranked
    WHERE rn = 1 OR rn = n OR rn = n / 2 + 1 OR Var_Cito = 1 OR Var_KategoriOperasi = 1
)
SELECT
    (SELECT count(*) FROM SIMdListHarga) AS table_rows,
    (SELECT count(*) FROM VW_ListHarga) AS view_rows,
    (SELECT count(DISTINCT JasaID) FROM SIMdListHarga) AS priced_procedures,
    (SELECT count(*) FROM patterns) AS procedures_total,
    (SELECT count(DISTINCT pattern) FROM patterns) AS pattern_count,
    (SELECT count(*) FROM sample) AS sampled,
    (SELECT s.JasaID + '|' + isnull(cast(s.Var_Cito AS char(1)), '~') + '|'
            + isnull(cast(s.Var_KategoriOperasi AS char(1)), '~') + '|' + s.pattern + '|'
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
                            FROM VW_ListHarga v WHERE v.JasaID = s.JasaID ORDER BY v.ListHargaID
                            FOR XML PATH('')), 1, 1, ''), '') + char(10)
     FROM sample s ORDER BY s.JasaID
     FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)') AS procedures,
    (SELECT s.JasaID + '|' + cast(c.JenisKerjasamaID AS varchar(10)) + '|' + c.fn + '|'
            + isnull(stuff(CASE c.fn
                    WHEN 'N' THEN (SELECT '/' + cast(f.ListHargaID AS varchar(20)) + ','
                                          + convert(varchar(30), f.Harga_Lama, 2) + ','
                                          + convert(varchar(30), f.Harga_Baru, 2) + ','
                                          + isnull(convert(varchar(10), f.TglHargaBaru, 23), '~')
                                   FROM dbo.GetTarifBiayaNonKerjasama(s.JasaID, 'xx', 'XX', 0, 1, c.JenisKerjasamaID, 1) f
                                   WHERE (f.Lokasi = 'RJ' OR f.Lokasi = 'XX')
                                   ORDER BY f.Lokasi
                                   FOR XML PATH(''))
                    WHEN 'J' THEN (SELECT '/' + cast(f.ListHargaID AS varchar(20)) + ','
                                          + isnull(convert(varchar(30), f.Harga_Lama, 2), '~') + ','
                                          + isnull(convert(varchar(30), f.Harga_Baru, 2), '~') + ','
                                          + isnull(convert(varchar(10), f.TglHargaBaruBPJS, 23), '~')
                                   FROM dbo.GetTarifBiayaJKN_BUFF(s.JasaID, 'xx', 'XX', 0, 1, '') f
                                   WHERE (f.Lokasi = 'RJ' OR f.Lokasi = 'XX')
                                   ORDER BY f.Lokasi
                                   FOR XML PATH(''))
                 END, 1, 1, ''), '') + char(10)
     FROM sample s CROSS JOIN calls c
     ORDER BY s.JasaID, c.JenisKerjasamaID, c.fn
     FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)') AS cases;
