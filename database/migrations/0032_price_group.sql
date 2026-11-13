-- Kelompok harga (src/foundation/pricing/): kunci harga yang dipakai bersama layanan kesehatan, farmasi, dan kasir.
-- Padanannya Customer Price Group di Business Central dan price group di F&O. Di sistem lama kunci harga adalah tipe
-- pasien (SIMmJenisKerjasama), yang sekaligus membawa cara bayar; data klinik Seroja menunjukkan tipe yang berbeda hanya
-- harganya (LOCAL, DOMESTIC, EXPART, FOREIGN), jadi kunci harga dipisah dari tipe pasien. Tipe pasien menunjuk
-- kelompok harga lewat kolom milik module, dan beberapa tipe boleh berbagi satu kelompok.
--
-- 1. Tabel kelompok_harga. Kode pendek diketik pengguna seperti field Code di BC, tanpa number sequence.
-- 2. Trigger versi, aktor, dan change log.
-- 3. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelola setelan harga, sama dengan role pemilik yang
--    lahir sesudah migration ini.

-- 1. Kelompok harga ------------------------------------------------------------------------------------------------

CREATE TABLE public.kelompok_harga (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kelompok_harga_pkey PRIMARY KEY (id),
    CONSTRAINT kelompok_harga_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX kelompok_harga_kode_unique
    ON public.kelompok_harga USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);

-- 2. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kelompok_harga
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kelompok_harga
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kelompok_harga
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'kelompok_harga', 'Kelompok harga', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'kelompok_harga');

-- 3. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.price-group.form', 'core', 'Layar kelompok harga', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.price-group.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.price-group.read', 'read', 'Lihat kelompok harga'),
             ('core.price-group.update', 'update', 'Ubah kelompok harga')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.price-group.view', 'Melihat kelompok harga'),
             ('core.price-group.maintain', 'Memelihara kelompok harga')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.price-group.view', 'core.price-group.read'),
       ('core.price-group.maintain', 'core.price-group.read'),
       ('core.price-group.maintain', 'core.price-group.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.pricing-setup.inquire', 'Lihat setelan harga'),
             ('core.pricing-setup.manage', 'Kelola setelan harga')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.pricing-setup.inquire', 'core.price-group.view'),
       ('core.pricing-setup.manage', 'core.price-group.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.pricing-setup.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
