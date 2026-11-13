-- Kode KFA (Kamus Farmasi dan Alat Kesehatan Kemenkes) pada barang, untuk SATUSEHAT: Medication.code dengan system
-- http://sys-ids.kemkes.go.id/kfa, yang dirujuk MedicationRequest dan AllergyIntolerance (layanan kesehatan) dan
-- MedicationDispense (farmasi). Sistem lama tidak punya kolom KFA di master barang maupun obat, jadi kolom ini tambahan
-- untuk SATUSEHAT dan boleh kosong sampai kodenya diisi.
--
-- Kolomnya di barang Core, bukan di perluasan obat layanan kesehatan (sim_m_obat), karena kode yang sama dibaca dua
-- module yang tidak boleh saling membaca tabel, dan apotek yang berdiri tanpa layanan kesehatan tidak punya sim_m_obat.
-- Padanannya GTIN pada Item di BC: identitas produk nasional yang melekat pada barang itu sendiri. Tidak unik, karena
-- dua kemasan yang dicatat sebagai barang berbeda boleh menunjuk produk KFA yang sama.

ALTER TABLE public.gd_m_barang ADD COLUMN kode_kfa character varying(20);

COMMENT ON COLUMN public.gd_m_barang.kode_kfa IS
    'Kode KFA Kemenkes (SATUSEHAT Medication.code, system http://sys-ids.kemkes.go.id/kfa): angka saja, boleh kosong, '
    'tidak unik.';
