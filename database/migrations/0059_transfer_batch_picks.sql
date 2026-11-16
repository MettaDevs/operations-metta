-- Batch pilihan lokasi pemasok pada baris amprah (src/foundation/inventory/transfer/), padanan Item Tracking Lines BC
-- saat Transfer Order dikirim. Bawaannya tetap pengambilan otomatis menurut setelan (FEFO atau FIFO); baris yang punya
-- pilihan mengambil tepat batch dan jumlah yang dipilih pada posting kirim berikutnya.
--
-- Jumlah dalam satuan dasar, seperti Quantity (Base) BC. Jumlah pilihan satu baris amprah selalu sama dengan jumlah
-- akan dikirimnya dalam satuan dasar; layanan amprah menolak penyimpanan yang tidak sama.
--
-- Pilihan hanya berlaku untuk posting kirim berikutnya. Setiap kali jumlah akan dikirim kembali ke sisanya (sesudah
-- posting kirim atau terima, dan sesudah pembatalan posting), pilihan amprah itu dihapus lunak, sehingga kiriman
-- berikutnya kembali otomatis sampai pengirim memilih lagi.

CREATE TABLE public.gd_tr_amprahan_detail_batch (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    amprahan_id uuid NOT NULL,
    amprahan_detail_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    jumlah_dasar numeric(18,4) NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    created_by_user_id uuid,
    deleted_at timestamp(0) without time zone,
    CONSTRAINT gd_tr_amprahan_detail_batch_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_amprahan_detail_batch_jumlah_check CHECK (jumlah_dasar > 0),
    CONSTRAINT gd_tr_amprahan_detail_batch_amprahan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_id)
        REFERENCES public.gd_tr_amprahan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_detail_batch_amprahan_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_detail_id)
        REFERENCES public.gd_tr_amprahan_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_detail_batch_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_tr_amprahan_detail_batch_unique
    ON public.gd_tr_amprahan_detail_batch USING btree (tenant_id, amprahan_detail_id, batch_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_amprahan_detail_batch_amprahan_index
    ON public.gd_tr_amprahan_detail_batch USING btree (tenant_id, amprahan_id) WHERE (deleted_at IS NULL);
