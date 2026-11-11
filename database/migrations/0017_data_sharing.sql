-- Data sharing antar perusahaan sebagai konfigurasi umum Core, pola "Configure cross-company data sharing" F&O
-- (https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/cross-company-data-sharing).
-- Keputusan pemilik produk, 11 November 2026: kebijakan sharing pindah dari module ke Sys Admin.
--
-- 1. Katalog jenis data yang boleh di-share (`data_sharing_types`). Barisnya ditulis migration module pemilik datanya,
--    dengan kode stabil (`healthcare.patient`) dan nama yang tampil di layar ("Master pasien"), sama seperti tujuan
--    hierarki dan katalog izin. Core tidak menulis nama module atau tabel module. Satu jenis data setara satu kelompok
--    tabel di kebijakan F&O.
-- 2. Kebijakan milik tenant: nama, satu jenis data, status aktif, dan tanggal berlaku mulai, beserta perusahaan (legal
--    entity) yang ikut. Satu perusahaan hanya boleh ikut satu kebijakan aktif per jenis data, seperti aturan F&O "a
--    company and table can only be in one enabled policy"; aturan itu dijaga layanan Core di bawah kunci per tenant.
--    Perubahan tercatat di change log untuk semua tenant, dan perusahaan yang dilepas diarsipkan (deleted_at).
-- 3. Hak layar Data sharing dengan rantai keamanan Core: permission, privilege, duty. Role pemilik tenant yang sudah
--    ada mendapat duty kelola, sama dengan role pemilik yang lahir sesudah migration ini.

-- 1. Katalog jenis data ----------------------------------------------------------------------------------------------

CREATE TABLE public.data_sharing_types (
    code character varying(160) NOT NULL,
    app_id character varying(80) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT data_sharing_types_pkey PRIMARY KEY (code),
    CONSTRAINT data_sharing_types_app_id_foreign FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE RESTRICT
);

-- 2. Kebijakan ---------------------------------------------------------------------------------------------------------

CREATE TABLE public.data_sharing_policies (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    data_type_code character varying(160) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT data_sharing_policies_pkey PRIMARY KEY (id),
    CONSTRAINT data_sharing_policies_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT data_sharing_policies_tenant_id_foreign
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
    CONSTRAINT data_sharing_policies_data_type_foreign
        FOREIGN KEY (data_type_code) REFERENCES public.data_sharing_types(code) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX data_sharing_policies_name_unique
    ON public.data_sharing_policies USING btree (tenant_id, lower((name)::text)) WHERE (deleted_at IS NULL);

CREATE TABLE public.data_sharing_policy_companies (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT data_sharing_policy_companies_pkey PRIMARY KEY (id),
    CONSTRAINT data_sharing_policy_companies_policy_foreign
        FOREIGN KEY (tenant_id, policy_id) REFERENCES public.data_sharing_policies(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT data_sharing_policy_companies_legal_entity_foreign
        FOREIGN KEY (legal_entity_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX data_sharing_policy_companies_unique
    ON public.data_sharing_policy_companies USING btree (tenant_id, policy_id, legal_entity_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX data_sharing_policy_companies_legal_entity_index
    ON public.data_sharing_policy_companies USING btree (tenant_id, legal_entity_id);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.data_sharing_policies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.data_sharing_policy_companies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.data_sharing_policies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.data_sharing_policy_companies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.data_sharing_policies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.data_sharing_policy_companies
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('data_sharing_policies', 'Kebijakan data sharing'),
             ('data_sharing_policy_companies', 'Perusahaan dalam kebijakan data sharing')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 3. Hak layar ---------------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.data-sharing.form', 'core', 'Layar data sharing', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.data-sharing.read', 'core', 'core.data-sharing.form', 'read', 'Lihat kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.data-sharing.update', 'core', 'core.data-sharing.form', 'update', 'Ubah kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.data-sharing.view', 'core', 'Melihat kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.data-sharing.maintain', 'core', 'Memelihara kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.data-sharing.view', 'core.data-sharing.read'),
       ('core.data-sharing.maintain', 'core.data-sharing.read'),
       ('core.data-sharing.maintain', 'core.data-sharing.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.data-sharing.inquire', 'core', 'Lihat kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.data-sharing.manage', 'core', 'Kelola kebijakan data sharing',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.data-sharing.inquire', 'core.data-sharing.view'),
       ('core.data-sharing.manage', 'core.data-sharing.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT id, 'core.data-sharing.manage' FROM public.roles WHERE is_owner AND deleted_at IS NULL
ON CONFLICT DO NOTHING;
