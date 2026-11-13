-- E-Resep menampilkan obat yang dipegang pasien: yang diserahkan farmasi dikurangi yang dikembalikan, seperti "Obat
-- Direalisasi" di CPPT sistem lama (BILLFarmasiDetail.JmlObat - JmlRetur). Module farmasi menerbitkan
-- pharmacy.return.posted.v1 saat retur diposting dan pharmacy.return.reversed.v1 saat retur dibatalkan, keduanya
-- membawa total retur yang masih berlaku per baris resep dalam satuan dasar barang, satuan yang sama dengan jumlah dan
-- jumlah_diserahkan; module ini menyalinnya ke kolom ini.
--
-- Kosong berarti belum pernah ada retur, atau farmasi tidak terpasang. 0 berarti semua returnya dibatalkan.

ALTER TABLE public.sim_tr_resep_detail ADD COLUMN jumlah_diretur numeric(18,4);
