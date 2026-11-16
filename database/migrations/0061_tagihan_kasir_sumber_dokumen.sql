-- Kunci tagihan kasir menjadi dokumen sumber, bukan kunjungan. Tagihan penjualan obat bebas di apotek tidak punya
-- kunjungan; dokumen sumbernya penjualan itu sendiri. Pilihan lainnya, membuat kunjungan_id dan no_reg opsional, butuh
-- kunci kedua untuk tagihan tanpa kunjungan, sehingga baris biaya dan pembayaran punya dua jalan ke headernya. Dengan
-- satu kunci, setiap tagihan menemukan baris dan pembayarannya lewat kolom yang sama.
--
-- 1. tagihan_kasir.kunjungan_id menjadi sumber_dokumen_id, dan no_reg menjadi sumber_nomor: id dan nomor dokumen yang
--    ditagih. Untuk tagihan kunjungan isinya tetap id kunjungan dan No. Reg.
-- 2. kasir.kunjungan_id menjadi sumber_dokumen_id, pasangan sumber_module yang sudah ada.
-- 3. tagihan_kasir_detail.kunjungan_id menjadi tagihan_sumber_dokumen_id: dokumen sumber tagihan tempat baris ini
--    ditagih. Namanya berbeda dari sumber_dokumen_id baris itu, yang menunjuk dokumen asal barisnya (pemeriksaan atau
--    penyerahan obat).
--
-- Isi dan perilakunya tidak berubah. Index dan constraint yang membawa nama lama ikut diganti.

ALTER TABLE public.tagihan_kasir RENAME COLUMN kunjungan_id TO sumber_dokumen_id;
ALTER TABLE public.tagihan_kasir RENAME COLUMN no_reg TO sumber_nomor;
ALTER TABLE public.tagihan_kasir RENAME CONSTRAINT tagihan_kasir_kunjungan_unique TO tagihan_kasir_sumber_unique;

ALTER TABLE public.kasir RENAME COLUMN kunjungan_id TO sumber_dokumen_id;
ALTER INDEX public.kasir_kunjungan_diposting_unique RENAME TO kasir_sumber_diposting_unique;

ALTER TABLE public.tagihan_kasir_detail RENAME COLUMN kunjungan_id TO tagihan_sumber_dokumen_id;
ALTER INDEX public.tagihan_kasir_detail_kunjungan_index RENAME TO tagihan_kasir_detail_tagihan_index;
