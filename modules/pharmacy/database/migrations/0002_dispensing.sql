-- Penyerahan obat (BILLFarmasi sistem lama, pengiriman pesanan penjualan di BC): satu dokumen aktif per resep.
-- Status draf → disiapkan → dipanggil → diserahkan. Siapkan memposting stok keluar di lokasi yang melayani resep,
-- di transaksi yang sama; Batal siapkan sebelum diserahkan membalik posting itu dan menutup dokumen sebagai dibatalkan,
-- lalu resep kembali ke antrean untuk disiapkan dengan dokumen baru, sama dengan batal posting dokumen persediaan Core.
--
-- 1. Katalog izin: siapkan dan panggil (asisten apoteker), serahkan dan batal siapkan (apoteker). Role pemilik tenant
--    yang sudah memasang module ini mendapat kedua duty barunya.
-- 2. Nomor penyerahan per operating unit resep.
-- 3. bill_farmasi + bill_farmasi_detail. Apoteker dan asisten adalah pengguna tenant, ditampilkan dengan namanya.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('pharmacy.dispensing.form', 'pharmacy', 'Layar penyerahan obat', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', 'pharmacy.dispensing.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing.prepare', 'update', 'Siapkan dan panggil resep'),
             ('pharmacy.dispensing.hand-over', 'invoke', 'Serahkan obat ke pasien'),
             ('pharmacy.dispensing.reverse', 'correct', 'Batal siapkan resep')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing.preparation', 'Menyiapkan dan memanggil resep'),
             ('pharmacy.dispensing.handover', 'Menyerahkan obat ke pasien'),
             ('pharmacy.dispensing.correction', 'Membatalkan penyiapan resep')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.dispensing.preparation', 'pharmacy.prescription.read'),
       ('pharmacy.dispensing.preparation', 'pharmacy.dispensing.prepare'),
       ('pharmacy.dispensing.handover', 'pharmacy.prescription.read'),
       ('pharmacy.dispensing.handover', 'pharmacy.dispensing.hand-over'),
       ('pharmacy.dispensing.correction', 'pharmacy.prescription.read'),
       ('pharmacy.dispensing.correction', 'pharmacy.dispensing.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'pharmacy', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing.prepare', 'Siapkan dan panggil resep'),
             ('pharmacy.dispensing.manage', 'Siapkan, panggil, serahkan, dan batal siapkan resep')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.dispensing.prepare', 'pharmacy.prescription.view'),
       ('pharmacy.dispensing.prepare', 'pharmacy.dispensing.preparation'),
       ('pharmacy.dispensing.manage', 'pharmacy.prescription.view'),
       ('pharmacy.dispensing.manage', 'pharmacy.dispensing.preparation'),
       ('pharmacy.dispensing.manage', 'pharmacy.dispensing.handover'),
       ('pharmacy.dispensing.manage', 'pharmacy.dispensing.correction')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('pharmacy.dispensing.prepare'), ('pharmacy.dispensing.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'pharmacy' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- 2. Nomor penyerahan ----------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_operating_unit,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a7f60-3c00-7000-8000-000000000001', 'pharmacy', 'pharmacy.dispensing-number',
        'Nomor penyerahan obat', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"scope"},{"type":"constant","value":"-FAR-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Setelan sama dengan yang dibuat NumberSequences.createUnitDefaults, hanya untuk tenant yang berhak memakai module ini.
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
WHERE r.code = 'pharmacy.dispensing-number'
  AND EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
              WHERE e.tenant_id = u.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                AND (e.ends_at IS NULL OR e.ends_at > current_timestamp))
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = u.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'operating_unit' AND s.operating_unit_id = u.organization_id);

-- 3. Penyerahan ----------------------------------------------------------------------------------------------------

-- lokasi_id dan tanggal diisi saat disiapkan: lokasi tempat stok keluar dan tanggal postingnya. Selama draf, lokasi
-- yang melayani resep dibaca dari resepnya (far_tr_resep.lokasi_id atau Lokasi layanan resep).
CREATE TABLE public.bill_farmasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    resep_id uuid NOT NULL,
    nomor character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'draf' NOT NULL,
    lokasi_id uuid,
    tanggal date,
    catatan character varying(500),
    apoteker_user_id uuid,
    asisten_user_id uuid,
    disiapkan_pada timestamp(0) without time zone,
    disiapkan_oleh_user_id uuid,
    dipanggil_pada timestamp(0) without time zone,
    dipanggil_oleh_user_id uuid,
    diserahkan_pada timestamp(0) without time zone,
    diserahkan_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bill_farmasi_pkey PRIMARY KEY (id),
    CONSTRAINT bill_farmasi_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bill_farmasi_status_check
        CHECK (status IN ('draf', 'disiapkan', 'dipanggil', 'diserahkan', 'dibatalkan')),
    CONSTRAINT bill_farmasi_posting_check
        CHECK (status = 'draf' OR (lokasi_id IS NOT NULL AND tanggal IS NOT NULL AND disiapkan_pada IS NOT NULL)),
    CONSTRAINT bill_farmasi_resep_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, resep_id) REFERENCES public.far_tr_resep(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_apoteker_foreign FOREIGN KEY (apoteker_user_id) REFERENCES public.users(id),
    CONSTRAINT bill_farmasi_asisten_foreign FOREIGN KEY (asisten_user_id) REFERENCES public.users(id)
);
-- Satu penyerahan aktif per resep. Yang dibatalkan tetap tercatat, dan resepnya boleh disiapkan lagi.
CREATE UNIQUE INDEX bill_farmasi_resep_aktif_unique
    ON public.bill_farmasi USING btree (tenant_id, resep_id) WHERE (deleted_at IS NULL AND status <> 'dibatalkan');
CREATE INDEX bill_farmasi_resep_index ON public.bill_farmasi USING btree (tenant_id, resep_id);

-- Satu baris per obat di resep (obat tunggal dan komponen racikan); kepala racikan hanya pengelompok di resep. jumlah
-- dalam satuan dasar barang, boleh kurang dari resep sampai 0 dengan alasan. batch_id diisi bila batch dipilih
-- petugas; kosong berarti diambil menurut cara pengambilan lokasi.
CREATE TABLE public.bill_farmasi_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    bill_farmasi_id uuid NOT NULL,
    resep_detail_id uuid NOT NULL,
    urutan integer NOT NULL,
    barang_id uuid NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    batch_id uuid,
    alasan character varying(200),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bill_farmasi_detail_pkey PRIMARY KEY (id),
    CONSTRAINT bill_farmasi_detail_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bill_farmasi_detail_jumlah_check CHECK (jumlah >= 0),
    CONSTRAINT bill_farmasi_detail_bill_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, bill_farmasi_id)
        REFERENCES public.bill_farmasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_detail_resep_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, resep_detail_id)
        REFERENCES public.far_tr_resep_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bill_farmasi_detail_baris_unique
    ON public.bill_farmasi_detail USING btree (tenant_id, bill_farmasi_id, resep_detail_id) WHERE (deleted_at IS NULL);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bill_farmasi', 'bill_farmasi_detail']
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
FROM (VALUES ('bill_farmasi', 'Penyerahan obat'),
             ('bill_farmasi_detail', 'Baris penyerahan obat')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);
