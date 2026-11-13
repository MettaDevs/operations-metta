-- Periode persediaan per legal entity (Inventory Period di BC, tabel 5814, ditutup dan dibuka lagi oleh codeunit 5820
-- Close Inventory Period). Sistem lama tidak punya padanannya: Kuta 1 tidak pernah menutup persediaan.
--
-- 1. Tabel periode. Periode yang ditutup mengunci kartu gudang sampai tanggal akhirnya: mesin posting menolak posting
--    dan pembatalan posting bertanggal di dalamnya. Menutup satu periode ikut menutup periode yang lebih awal, dan
--    membuka lagi ikut membuka periode sesudahnya, jadi periode yang ditutup selalu berurutan dari yang paling awal.
-- 2. Trigger versi, aktor, dan change log, sama dengan master persediaan lain. Change log menyimpan riwayat tutup dan
--    buka lagi (Inventory Period Entry di BC).
-- 3. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelolanya, sama dengan role pemilik yang lahir
--    sesudah migration ini.

-- 1. Periode persediaan -----------------------------------------------------------------------------------------------

CREATE TABLE public.gd_m_periode_persediaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    tanggal_akhir date NOT NULL,
    nama character varying(50) NOT NULL,
    ditutup boolean DEFAULT false NOT NULL,
    ditutup_pada timestamp(0) without time zone,
    ditutup_oleh_user_id uuid,
    dibuka_lagi_pada timestamp(0) without time zone,
    dibuka_lagi_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_periode_persediaan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_periode_persediaan_hapus_check CHECK (deleted_at IS NULL OR NOT ditutup),
    CONSTRAINT gd_m_periode_persediaan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_periode_persediaan_tanggal_unique
    ON public.gd_m_periode_persediaan USING btree (tenant_id, legal_entity_id, tanggal_akhir)
    WHERE (deleted_at IS NULL);

-- 2. Trigger versi, aktor, dan change log -----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.gd_m_periode_persediaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.gd_m_periode_persediaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.gd_m_periode_persediaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'gd_m_periode_persediaan', 'Periode persediaan', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'gd_m_periode_persediaan');

-- 3. Katalog izin -----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.inventory-period.form', 'core', 'Layar periode persediaan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.inventory-period.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-period.read', 'read', 'Lihat periode persediaan'),
             ('core.inventory-period.update', 'update', 'Ubah periode persediaan'),
             ('core.inventory-period.close', 'invoke', 'Tutup periode persediaan'),
             ('core.inventory-period.reopen', 'correct', 'Buka lagi periode persediaan')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-period.view', 'Melihat periode persediaan'),
             ('core.inventory-period.maintain', 'Memelihara periode persediaan'),
             ('core.inventory-period.closing', 'Menutup periode persediaan'),
             ('core.inventory-period.reopening', 'Membuka lagi periode persediaan')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-period.view', 'core.inventory-period.read'),
       ('core.inventory-period.maintain', 'core.inventory-period.read'),
       ('core.inventory-period.maintain', 'core.inventory-period.update'),
       ('core.inventory-period.closing', 'core.inventory-period.read'),
       ('core.inventory-period.closing', 'core.inventory-period.close'),
       ('core.inventory-period.reopening', 'core.inventory-period.read'),
       ('core.inventory-period.reopening', 'core.inventory-period.reopen')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-period.inquire', 'Lihat periode persediaan'),
             ('core.inventory-period.manage', 'Kelola, tutup, dan buka lagi periode persediaan')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.inventory-period.inquire', 'core.inventory-period.view'),
       ('core.inventory-period.manage', 'core.inventory-period.maintain'),
       ('core.inventory-period.manage', 'core.inventory-period.closing'),
       ('core.inventory-period.manage', 'core.inventory-period.reopening')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.inventory-period.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
