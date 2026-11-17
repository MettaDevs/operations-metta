-- Penerimaan barang dari purchase order, pola Business Central: baris order mencatat Quantity Received, sisa yang
-- belum datang adalah Outstanding Quantity, dan order yang sudah diterima seluruhnya selesai. Penerimaan tetap dokumen
-- draf yang diposting (src/foundation/purchasing/receipt/), seperti Warehouse Receipt dengan Get Source Documents:
-- Terima barang di order membuat draf penerimaan berisi sisa setiap baris, petugas mengubah jumlah yang benar-benar
-- datang beserta batch dan kedaluwarsanya, lalu memposting. Di data Adapotek 2.982 order diterima lebih dari sekali.
-- Penerimaan tanpa order tetap ada.
--
-- 1. Jumlah diterima di baris order dan status selesai.
-- 2. Rujukan order di penerimaan dan barisnya.
-- 3. Duty penerimaan ikut membaca order.

-- 1. Jumlah diterima dan status selesai ----------------------------------------------------------------------------

-- jumlah_diterima dalam satuan baris order. Ia hanya ditulis posting dan batal posting penerimaan, di transaksi yang
-- sama dengan kartu gudangnya, sambil kepala order dikunci. Constraint menjaga penerimaan tidak pernah melebihi order.
ALTER TABLE public.bl_tr_order_detail
    ADD COLUMN jumlah_diterima numeric(18,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT bl_tr_order_detail_jumlah_diterima_check CHECK (jumlah_diterima >= 0 AND jumlah_diterima <= jumlah);

ALTER TABLE public.bl_tr_order
    ADD COLUMN selesai_pada timestamp(0) without time zone,
    DROP CONSTRAINT bl_tr_order_status_check,
    ADD CONSTRAINT bl_tr_order_status_check CHECK (status IN ('terbuka', 'dirilis', 'selesai')),
    ADD CONSTRAINT bl_tr_order_selesai_check CHECK ((status = 'selesai') = (selesai_pada IS NOT NULL));

-- 2. Rujukan order -------------------------------------------------------------------------------------------------

ALTER TABLE public.bl_tr_penerimaan
    ADD COLUMN order_id uuid,
    ADD CONSTRAINT bl_tr_penerimaan_order_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, order_id)
        REFERENCES public.bl_tr_order(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
CREATE INDEX bl_tr_penerimaan_order_index
    ON public.bl_tr_penerimaan USING btree (tenant_id, order_id) WHERE (order_id IS NOT NULL AND deleted_at IS NULL);

-- Baris penerimaan dari order merujuk baris ordernya (Source No. dan Source Line No. di Warehouse Receipt Line BC).
ALTER TABLE public.bl_tr_penerimaan_detail
    ADD COLUMN order_detail_id uuid,
    ADD CONSTRAINT bl_tr_penerimaan_detail_order_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, order_detail_id)
        REFERENCES public.bl_tr_order_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
CREATE INDEX bl_tr_penerimaan_detail_order_detail_index
    ON public.bl_tr_penerimaan_detail USING btree (tenant_id, order_detail_id)
    WHERE (order_detail_id IS NOT NULL AND deleted_at IS NULL);

-- 3. Duty penerimaan membaca order ---------------------------------------------------------------------------------

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.purchase-receipt.inquire', 'core.purchase-order.view'),
       ('core.purchase-receipt.manage', 'core.purchase-order.view')
ON CONFLICT DO NOTHING;
