-- Layout cetak unggahan per legal entity (Sys Admin › Layout cetak), pola Custom Report Layouts dan Report Layout
-- Selection Business Central. Tabel report_layouts dan report_layout_defaults dari baseline CoreERP dipakai lagi:
-- CoreERP menyimpan berkasnya di disk, sedangkan image runtime ini tidak punya volume tulis, jadi isi berkas pindah ke
-- kolom bytea. Database lingkungan sudah terpisah per tenant dan sudah dicadangkan, jadi layout ikut tanpa penyimpanan
-- kedua. Baris layout tidak pernah diubah isinya: mengganti layout berarti mengunggah baris baru, sehingga riwayatnya
-- adalah daftar barisnya sendiri.

-- 1. Isi berkas dan sifat yang dibaca saat unggah --------------------------------------------------------------------

ALTER TABLE public.report_layouts ALTER COLUMN file_path DROP NOT NULL;
ALTER TABLE public.report_layouts ADD COLUMN isi bytea;
ALTER TABLE public.report_layouts ADD COLUMN sha256 character(64);
ALTER TABLE public.report_layouts ADD COLUMN bahasa character varying(5);
ALTER TABLE public.report_layouts ADD COLUMN kertas_lebar_mm integer;
ALTER TABLE public.report_layouts ADD COLUMN kertas_tinggi_mm integer;
ALTER TABLE public.report_layouts ADD COLUMN deleted_at timestamp(0) without time zone;
ALTER TABLE public.report_layouts
    ADD CONSTRAINT report_layouts_isi_check CHECK (file_path IS NOT NULL OR (isi IS NOT NULL AND sha256 IS NOT NULL
                                                                              AND bahasa IS NOT NULL));

-- Unggahan berkas yang sama untuk laporan dan legal entity yang sama menemukan baris yang sudah ada.
CREATE UNIQUE INDEX report_layouts_isi_unique ON public.report_layouts (tenant_id, legal_entity_id, report_code, sha256)
    WHERE deleted_at IS NULL AND sha256 IS NOT NULL;

-- 2. Change log ----------------------------------------------------------------------------------------------------
-- Trigger versi, aktor, dan change log kedua tabel sudah ada sejak baseline. Pilihan layout bawaan didaftarkan supaya
-- tenant bisa mencatat siapa mengganti layout yang dipakai. report_layouts sengaja tidak didaftarkan: barisnya tidak
-- pernah diubah isinya, dan isi berkasnya tidak berguna di log.

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'report_layout_defaults', 'Layout cetak yang dipakai', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'report_layout_defaults');

-- 3. Katalog izin ----------------------------------------------------------------------------------------------------
-- Mengelola layout butuh izin ini sekaligus izin baca dokumen laporannya, supaya admin farmasi tidak mengganti kuitansi.

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.report-layout.form', 'core', 'Layar layout cetak', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.report-layout.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.report-layout.read', 'read', 'Lihat layout cetak'),
             ('core.report-layout.update', 'update', 'Ubah layout cetak dan kop surat')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.report-layout.view', 'Melihat layout cetak'),
             ('core.report-layout.maintain', 'Memelihara layout cetak dan kop surat')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.report-layout.view', 'core.report-layout.read'),
       ('core.report-layout.maintain', 'core.report-layout.read'),
       ('core.report-layout.maintain', 'core.report-layout.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.report-layout.inquire', 'Melihat layout cetak'),
             ('core.report-layout.manage', 'Mengelola layout cetak dan kop surat')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.report-layout.inquire', 'core.report-layout.view'),
       ('core.report-layout.manage', 'core.report-layout.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('core.report-layout.inquire'), ('core.report-layout.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
