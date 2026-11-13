-- Satuan baris resep, penyerahan, dan retur (pola Unit of Measure Code dan Qty. per Unit of Measure pada baris dokumen
-- Business Central). Setiap baris menyimpan satuannya dan isi satuan itu dalam satuan dasar, disalin saat baris ditulis;
-- stok selalu bergerak dalam satuan dasar sebanyak jumlah x konversi. Baris yang sudah ada ditulis dalam satuan dasar,
-- jadi isinya 1.
--
-- 1. far_tr_resep_detail: jumlah dalam satuan_id (satuan yang ditulis dokter), konversi dari quantity_per_unit event
--    healthcare.prescription.issued.v1; event tanpa field itu ditulis dalam satuan dasar, jadi isinya 1.
-- 2. bill_farmasi_detail: satuan yang dipakai petugas farmasi saat menyerahkan, boleh berbeda dari satuan resep selama
--    satuan itu milik barang yang sama; jumlah dalam satuan itu.
-- 3. retur_farmasi_detail: satuan yang dipakai saat retur dicatat; jumlah dalam satuan itu.
-- Penyesuaian stok (gd_tr_penyesuaian_detail) tetap dalam satuan dasar.

-- 1. Baris resep ----------------------------------------------------------------------------------------------------

ALTER TABLE public.far_tr_resep_detail ADD COLUMN konversi numeric(18,4);

UPDATE public.far_tr_resep_detail SET konversi = 1 WHERE barang_id IS NOT NULL;

ALTER TABLE public.far_tr_resep_detail
    ADD CONSTRAINT far_tr_resep_detail_konversi_check
        CHECK (barang_id IS NULL OR (konversi IS NOT NULL AND konversi > 0));

-- 2. Baris penyerahan -----------------------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi_detail
    ADD COLUMN satuan_id uuid,
    ADD COLUMN konversi numeric(18,4);

UPDATE public.bill_farmasi_detail d
SET satuan_id = b.satuan_dasar_id, konversi = 1
FROM public.gd_m_barang b
WHERE b.tenant_id = d.tenant_id AND b.id = d.barang_id;

ALTER TABLE public.bill_farmasi_detail
    ALTER COLUMN satuan_id SET NOT NULL,
    ALTER COLUMN konversi SET NOT NULL,
    ADD CONSTRAINT bill_farmasi_detail_konversi_check CHECK (konversi > 0),
    ADD CONSTRAINT bill_farmasi_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT;

-- 3. Baris retur ----------------------------------------------------------------------------------------------------

ALTER TABLE public.retur_farmasi_detail
    ADD COLUMN satuan_id uuid,
    ADD COLUMN konversi numeric(18,4);

UPDATE public.retur_farmasi_detail d
SET satuan_id = b.satuan_dasar_id, konversi = 1
FROM public.gd_m_barang b
WHERE b.tenant_id = d.tenant_id AND b.id = d.barang_id;

ALTER TABLE public.retur_farmasi_detail
    ALTER COLUMN satuan_id SET NOT NULL,
    ALTER COLUMN konversi SET NOT NULL,
    ADD CONSTRAINT retur_farmasi_detail_konversi_check CHECK (konversi > 0),
    ADD CONSTRAINT retur_farmasi_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT;
