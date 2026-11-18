-- Cara pengadaan barang per lokasi, pola Replenishment System dan Transfer-from Code di Stockkeeping Unit BC (tabel
-- 5700): 'beli' dipesan ke vendor lewat purchase order, 'amprah' diminta dari lokasi_pemasok_id lewat amprah.
-- Hitung saran menulis saran amprah sebagai baris permintaan dengan lokasi_pemasok_id terisi (Transfer-from Code di
-- Requisition Line), tanpa vendor dan harga, dan Buat dokumen mengubahnya menjadi draf amprah.

ALTER TABLE public.gd_m_barang_lokasi
    ADD COLUMN cara_pengadaan character varying(10) DEFAULT 'beli' NOT NULL,
    ADD COLUMN lokasi_pemasok_id uuid,
    ADD CONSTRAINT gd_m_barang_lokasi_cara_pengadaan_check CHECK (cara_pengadaan IN ('beli', 'amprah')),
    ADD CONSTRAINT gd_m_barang_lokasi_pemasok_check
        CHECK ((cara_pengadaan = 'amprah') = (lokasi_pemasok_id IS NOT NULL) AND lokasi_pemasok_id <> lokasi_id),
    ADD CONSTRAINT gd_m_barang_lokasi_pemasok_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_pemasok_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bl_tr_permintaan
    ADD COLUMN lokasi_pemasok_id uuid,
    ADD COLUMN amprahan_detail_id uuid,
    DROP CONSTRAINT bl_tr_permintaan_diproses_check,
    DROP CONSTRAINT bl_tr_permintaan_hapus_check,
    ADD CONSTRAINT bl_tr_permintaan_diproses_check
        CHECK (num_nonnulls(order_detail_id, amprahan_detail_id) = CASE WHEN diproses_pada IS NULL THEN 0 ELSE 1 END),
    ADD CONSTRAINT bl_tr_permintaan_hapus_check CHECK (deleted_at IS NULL OR diproses_pada IS NULL),
    ADD CONSTRAINT bl_tr_permintaan_amprah_check
        CHECK (lokasi_pemasok_id IS NULL
               OR (vendor_id IS NULL AND harga_satuan IS NULL AND order_detail_id IS NULL
                   AND lokasi_pemasok_id <> lokasi_id)),
    ADD CONSTRAINT bl_tr_permintaan_amprah_detail_check CHECK (amprahan_detail_id IS NULL OR lokasi_pemasok_id IS NOT NULL),
    ADD CONSTRAINT bl_tr_permintaan_lokasi_pemasok_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_pemasok_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT bl_tr_permintaan_amprahan_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_detail_id)
        REFERENCES public.gd_tr_amprahan_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;

DROP INDEX public.bl_tr_permintaan_terbuka_index;
CREATE INDEX bl_tr_permintaan_terbuka_index
    ON public.bl_tr_permintaan USING btree (tenant_id, legal_entity_id, lokasi_id)
    WHERE (deleted_at IS NULL AND diproses_pada IS NULL);
DROP INDEX public.bl_tr_permintaan_saran_unique;
CREATE UNIQUE INDEX bl_tr_permintaan_saran_unique
    ON public.bl_tr_permintaan USING btree (tenant_id, legal_entity_id, lokasi_id, barang_id)
    WHERE (saran = 'baru' AND deleted_at IS NULL AND diproses_pada IS NULL);
CREATE INDEX bl_tr_permintaan_amprahan_detail_index
    ON public.bl_tr_permintaan USING btree (tenant_id, amprahan_detail_id) WHERE (amprahan_detail_id IS NOT NULL);

UPDATE public.change_log_setup_tables
SET table_caption = 'Stok minimum, maksimum, cara pesan ulang, dan cara pengadaan barang per lokasi'
WHERE tenant_id IS NULL AND table_name = 'gd_m_barang_lokasi';
