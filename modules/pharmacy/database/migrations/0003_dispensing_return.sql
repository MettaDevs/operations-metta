-- Retur obat pasien (RETURFARMASI sistem lama, retur penjualan BC): sebagian obat yang sudah diserahkan kembali ke
-- lokasi stok asalnya, dengan batch, kedaluwarsa, harga satuan, dan sumber dana yang sama dengan saat keluar, seperti
-- Appl.-from Item Entry pada retur penjualan BC. Retur langsung diposting saat disimpan; Batal retur membaliknya selama
-- stok yang masuk belum terpakai. Di Kuta 1 retur jarang: 8 dari 12.177 penyerahan, Desember 2025 sampai Juni 2026.
--
-- 1. Katalog izin: retur dan batal retur, bagian duty apoteker (pharmacy.dispensing.manage).
-- 2. Nomor retur per operating unit resep.
-- 3. retur_farmasi + retur_farmasi_detail.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', 'pharmacy.dispensing.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.return.create', 'create', 'Retur obat dari pasien'),
             ('pharmacy.return.reverse', 'correct', 'Batal retur obat')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.return.receive', 'Menerima retur obat dari pasien'),
             ('pharmacy.return.correction', 'Membatalkan retur obat')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.return.receive', 'pharmacy.prescription.read'),
       ('pharmacy.return.receive', 'pharmacy.return.create'),
       ('pharmacy.return.correction', 'pharmacy.prescription.read'),
       ('pharmacy.return.correction', 'pharmacy.return.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.dispensing.manage', 'pharmacy.return.receive'),
       ('pharmacy.dispensing.manage', 'pharmacy.return.correction')
ON CONFLICT DO NOTHING;

UPDATE public.security_duties
SET name = 'Siapkan, panggil, serahkan, batal siapkan, dan retur obat', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'pharmacy.dispensing.manage';

-- 2. Nomor retur ---------------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_operating_unit,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a7f60-3c00-7000-8000-000000000002', 'pharmacy', 'pharmacy.return-number',
        'Nomor retur obat', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"scope"},{"type":"constant","value":"-RTF-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, operating_unit_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), u.tenant_id, r.id, 'operating_unit', u.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.operating_units u
JOIN public.organizations o ON o.id = u.organization_id AND o.tenant_id = u.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'pharmacy.return-number'
  AND EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
              WHERE e.tenant_id = u.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                AND (e.ends_at IS NULL OR e.ends_at > current_timestamp))
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = u.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'operating_unit' AND s.operating_unit_id = u.organization_id);

-- 3. Retur ---------------------------------------------------------------------------------------------------------

CREATE TABLE public.retur_farmasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    bill_farmasi_id uuid NOT NULL,
    nomor character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'diposting' NOT NULL,
    tanggal date NOT NULL,
    lokasi_id uuid NOT NULL,
    alasan character varying(200) NOT NULL,
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
    CONSTRAINT retur_farmasi_pkey PRIMARY KEY (id),
    CONSTRAINT retur_farmasi_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT retur_farmasi_status_check CHECK (status IN ('diposting', 'dibatalkan')),
    CONSTRAINT retur_farmasi_bill_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, bill_farmasi_id)
        REFERENCES public.bill_farmasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT retur_farmasi_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT retur_farmasi_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX retur_farmasi_bill_index ON public.retur_farmasi USING btree (tenant_id, bill_farmasi_id);

-- Satu baris per obat dan batch yang kembali. batch_id kosong untuk stok tanpa batch.
CREATE TABLE public.retur_farmasi_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    retur_farmasi_id uuid NOT NULL,
    bill_farmasi_detail_id uuid NOT NULL,
    urutan integer NOT NULL,
    barang_id uuid NOT NULL,
    batch_id uuid,
    jumlah numeric(18,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT retur_farmasi_detail_pkey PRIMARY KEY (id),
    CONSTRAINT retur_farmasi_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT retur_farmasi_detail_retur_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, retur_farmasi_id)
        REFERENCES public.retur_farmasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT retur_farmasi_detail_bill_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, bill_farmasi_detail_id)
        REFERENCES public.bill_farmasi_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT retur_farmasi_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT retur_farmasi_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX retur_farmasi_detail_retur_index
    ON public.retur_farmasi_detail USING btree (tenant_id, retur_farmasi_id);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['retur_farmasi', 'retur_farmasi_detail']
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

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('retur_farmasi', 'Retur obat'),
             ('retur_farmasi_detail', 'Baris retur obat')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);
