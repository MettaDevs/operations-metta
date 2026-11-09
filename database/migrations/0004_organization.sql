-- Organization pindah dari CoreERP: legal entity, operating unit, dan hierarchy organisasi.
--
-- 1. Data acuan yang di CoreERP ditulis migration, bukan skema, sehingga tidak ada di 0001: katalog keamanan
--    layar organisasi (migration CoreERP 2026_09_25_120100_register_core_security_catalog, kelompok
--    `organization` saja) dan tujuan hierarchy (2026_07_20_010000_add_organization_structure_and_closure dan
--    2026_07_22_070000_align_establishment_hierarchy_purpose). Isinya sama dengan CoreERP, dan baris yang sudah
--    ada tidak ditimpa, jadi database hasil `--adopt-coreerp` tidak berubah.
-- 2. Melepas organisasi dari draft hierarchy di CoreERP menghapus baris node dan closure-nya secara fisik. Di
--    repo ini tidak ada baris yang dihapus fisik, jadi keduanya mendapat deleted_at. Organisasi yang sama boleh
--    ditempatkan lagi di draft yang sama: indeks unik node menjadi parsial, dan baris closure yang terhapus
--    dihidupkan lagi oleh penempatan berikutnya, karena satu pasangan atas-bawah dalam satu versi tetap satu fakta.

INSERT INTO public.apps (id, name, version, status, database_name, description, created_at, updated_at)
VALUES ('core', 'CoreERP', '1.0.0', 'internal', NULL,
        'Pemilik referensi nomor milik Core sendiri, misalnya nomor vendor. Bukan produk yang dipasang.',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.organization.form', 'core', 'Layar organisasi dan buku alamat', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.organization.read', 'core', 'core.organization.form', 'read', 'Lihat organisasi',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.organization.update', 'core', 'core.organization.form', 'update', 'Ubah organisasi',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.organization.view', 'core', 'Melihat organisasi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.organization.maintain', 'core', 'Memelihara organisasi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.organization.view', 'core.organization.read'),
       ('core.organization.maintain', 'core.organization.read'),
       ('core.organization.maintain', 'core.organization.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.organization.inquire', 'core', 'Lihat organisasi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.organization.manage', 'core', 'Kelola organisasi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.organization.inquire', 'core.organization.view'),
       ('core.organization.manage', 'core.organization.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.hierarchy_purposes (id, code, name, description, created_at, updated_at)
VALUES ('01a1bef9-22f0-7401-b0ba-64d007f432b8', 'management', 'Management reporting',
        'Struktur untuk pelaporan dan pengelolaan internal.', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1bef9-22f0-7402-9b7c-dd3dbe30404c', 'policy', 'Business policy',
        'Struktur untuk penerapan kebijakan pada unit organisasi.', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1bef9-22f0-7403-857c-a52e2cd64bde', 'procurement', 'Procurement',
        'Struktur untuk kebijakan dan proses pengadaan.', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1bef9-22f0-7404-90c2-85d763c24508', 'establishment', 'Enterprise establishment structure',
        'Struktur operating unit yang berperan sebagai establishment di bawah legal entity.',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.organization_hierarchy_nodes ADD COLUMN deleted_at timestamp(0) without time zone;
ALTER TABLE public.organization_hierarchy_nodes
    DROP CONSTRAINT organization_hierarchy_nodes_version_id_organization_id_unique;
CREATE UNIQUE INDEX organization_hierarchy_nodes_version_id_organization_id_unique
    ON public.organization_hierarchy_nodes USING btree (version_id, organization_id) WHERE (deleted_at IS NULL);

ALTER TABLE public.organization_hierarchy_closures ADD COLUMN deleted_at timestamp(0) without time zone;
