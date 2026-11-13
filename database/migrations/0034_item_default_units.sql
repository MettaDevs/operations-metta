-- Satuan beli dan satuan jual bawaan barang, padanan Purch. Unit of Measure dan Sales Unit of Measure pada Item di
-- Business Central. Kosong berarti satuan dasar. Selain satuan dasar, isinya harus satuan kemasan barang itu sendiri
-- (gd_m_barang_satuan), dan layanan barang yang menjaganya; FK di sini hanya menjaga satuannya ada di legal entity yang
-- sama.

ALTER TABLE public.gd_m_barang
    ADD COLUMN satuan_beli_id uuid,
    ADD COLUMN satuan_jual_id uuid,
    ADD CONSTRAINT gd_m_barang_satuan_beli_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_beli_id)
        REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT gd_m_barang_satuan_jual_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_jual_id)
        REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
