-- Saran pesan ulang di permintaan pembelian (src/foundation/purchasing/requisition/), pola Calculate Plan di
-- Requisition Worksheet Business Central (report 699): Hitung saran menulis baris permintaan untuk barang yang stok
-- tersedianya di lokasi sampai di stok minimum, dengan jumlah menurut cara pesan ulang di gd_m_barang_lokasi.
--
-- saran mencatat asal baris: kosong untuk baris yang diajukan orang, 'baru' untuk saran yang belum disentuh orang, dan
-- 'diubah' untuk saran yang sudah diubah atau disetujui. Hitung saran hanya menulis ulang dan menghapus baris 'baru';
-- baris yang sudah disentuh orang tetap, dan jumlahnya ikut dihitung sebagai stok yang akan datang. BC menghapus semua
-- baris barang itu di lembar kerja; di sini lembar kerja dipakai bersama lokasi yang mengajukan, jadi baris orang tidak
-- disentuh.

ALTER TABLE public.bl_tr_permintaan
    ADD COLUMN saran character varying(10),
    ADD CONSTRAINT bl_tr_permintaan_saran_check CHECK (saran IS NULL OR saran IN ('baru', 'diubah'));

-- Satu saran yang belum disentuh per barang dan lokasi, supaya Hitung saran yang diulang menulis baris yang sama.
CREATE UNIQUE INDEX bl_tr_permintaan_saran_unique
    ON public.bl_tr_permintaan USING btree (tenant_id, legal_entity_id, lokasi_id, barang_id)
    WHERE (saran = 'baru' AND deleted_at IS NULL AND order_detail_id IS NULL);
