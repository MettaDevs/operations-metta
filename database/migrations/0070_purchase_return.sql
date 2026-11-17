-- Retur ke vendor atas penerimaan yang sudah diposting (src/foundation/purchasing/purchase-return/), pola Business
-- Central: Purchase Return Order dengan baris dari Get Posted Document Lines to Reverse, lalu Post Ship. Di sini retur
-- langsung diposting saat disimpan, seperti retur obat farmasi. Nama tabel mengikuti nama legacy (BL_trRetur dan
-- BL_trReturDetail menjadi bl_tr_retur dan bl_tr_retur_detail). Di sistem lama Supplier_returns dan Return_Stock menulis
-- tabel yang sama tanpa merujuk penerimaan; di sini setiap baris retur merujuk baris penerimaannya, supaya stok keluar
-- tepat dari baris kartu gudang penerimaan itu (Appl.-to Item Entry).
--
-- 1. Dokumen retur dan barisnya.
-- 2. Reference nomor retur per legal entity.
-- 3. Trigger versi, aktor, dan change log.

-- 1. Dokumen retur ---------------------------------------------------------------------------------------------------

-- Retur tidak punya draf: barisnya lahir diposting. Batal retur mengisi status dibatalkan dan membalik kartu gudangnya.
CREATE TABLE public.bl_tr_retur (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    penerimaan_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    alasan character varying(200) NOT NULL,
    status character varying(15) DEFAULT 'diposting' NOT NULL,
    diposting_pada timestamp(0) without time zone NOT NULL,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_retur_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_retur_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bl_tr_retur_status_check CHECK (status IN ('diposting', 'dibatalkan')),
    CONSTRAINT bl_tr_retur_batal_check CHECK ((status = 'dibatalkan') = (dibatalkan_pada IS NOT NULL)),
    CONSTRAINT bl_tr_retur_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_retur_penerimaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, penerimaan_id)
        REFERENCES public.bl_tr_penerimaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bl_tr_retur_nomor_unique
    ON public.bl_tr_retur USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_retur_penerimaan_index
    ON public.bl_tr_retur USING btree (tenant_id, penerimaan_id) WHERE (deleted_at IS NULL);

-- jumlah dalam satuan baris retur; kartu gudang mengeluarkan jumlah x konversi dalam satuan dasar.
CREATE TABLE public.bl_tr_retur_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    retur_id uuid NOT NULL,
    penerimaan_detail_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_retur_detail_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_retur_detail_konversi_check CHECK (konversi > 0),
    CONSTRAINT bl_tr_retur_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT bl_tr_retur_detail_retur_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, retur_id)
        REFERENCES public.bl_tr_retur(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_retur_detail_penerimaan_detail_foreign
        FOREIGN KEY (penerimaan_detail_id) REFERENCES public.bl_tr_penerimaan_detail(id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_retur_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_retur_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX bl_tr_retur_detail_retur_index
    ON public.bl_tr_retur_detail USING btree (tenant_id, retur_id) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_retur_detail_penerimaan_detail_index
    ON public.bl_tr_retur_detail USING btree (tenant_id, penerimaan_detail_id) WHERE (deleted_at IS NULL);

-- 2. Reference nomor -----------------------------------------------------------------------------------------------

-- Satu sequence per legal entity, dibuat NumberSequences.createLegalEntityDefaults saat legal entity lahir; legal entity
-- yang sudah ada mendapatnya di bawah dengan setelan yang sama dengan nomor penerimaan.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a9105-3c6e-7d21-8f4a-6b2e1c0d7a01', 'core', 'core.purchase-return-number',
        'Nomor retur ke vendor', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"RPB-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, legal_entity_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), l.tenant_id, r.id, 'legal_entity', l.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'core.purchase-return-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bl_tr_retur', 'bl_tr_retur_detail']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END;
$$;

-- Dokumen transaksi tidak pernah dicatat bawaan (0066); tenant yang mau menyalakannya sendiri.
INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('bl_tr_retur', 'Retur ke vendor'),
             ('bl_tr_retur_detail', 'Baris retur ke vendor')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);
