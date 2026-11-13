-- Satuan baris resep (pola Unit of Measure Code dan Qty. per Unit of Measure pada baris dokumen Business Central).
-- Dokter menulis jumlah obat dalam satuan yang ia pilih, bawaannya satuan jual obat, misalnya 2 STRIP. Isi satuan itu
-- dalam satuan dasar disalin ke konversi saat baris disimpan, jadi mengubah isi kemasan di kartu barang sesudahnya
-- tidak mengubah resep yang sudah ditulis.
--
-- Makna jumlah pada sim_tr_resep_detail sesudah migration ini:
-- - jumlah dalam satuan_id; jumlah x konversi adalah jumlah dalam satuan dasar barang.
-- - jumlah_diserahkan dan jumlah_diretur tetap dalam satuan dasar, karena keduanya datang dari event farmasi sebagai
--   jumlah satuan dasar (pharmacy.prescription.dispensed.v1 base_quantity, pharmacy.return.*.v1
--   returned_base_quantity).
--
-- Baris obat yang sudah ada ditulis dalam satuan dasar, jadi satuannya diisi satuan dasar barang dengan isi 1. Kepala
-- racikan tidak punya satuan.

ALTER TABLE public.sim_tr_resep_detail
    ADD COLUMN satuan_id uuid,
    ADD COLUMN konversi numeric(18,4);

UPDATE public.sim_tr_resep_detail d
SET satuan_id = b.satuan_dasar_id, konversi = 1
FROM public.gd_m_barang b
WHERE b.tenant_id = d.tenant_id AND b.id = d.obat_id AND d.obat_id IS NOT NULL;

ALTER TABLE public.sim_tr_resep_detail
    ADD CONSTRAINT sim_tr_resep_detail_satuan_check CHECK (
        (obat_id IS NULL AND satuan_id IS NULL AND konversi IS NULL)
        OR (obat_id IS NOT NULL AND satuan_id IS NOT NULL AND konversi IS NOT NULL AND konversi > 0)),
    ADD CONSTRAINT sim_tr_resep_detail_satuan_foreign
        FOREIGN KEY (satuan_id) REFERENCES public.gd_m_satuan(id) ON DELETE RESTRICT;
