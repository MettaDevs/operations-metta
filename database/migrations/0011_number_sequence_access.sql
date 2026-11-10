-- Hak layar Nomor dokumen (number sequence), dengan rantai keamanan yang sama dengan layar Core lain: permission per
-- tingkat akses, privilege, lalu duty. Di CoreERP layar ini dijaga permission `manage-number-sequences`; di sini
-- membaca dan mengubah dipisah seperti layar organisasi.
--
-- Role pemilik tenant yang sudah ada ikut mendapat duty kelola, sama dengan role pemilik yang lahir dari
-- provisionEnvironment sesudah migration ini (semua duty Core). Role lain tidak disentuh.

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.number-sequence.form', 'core', 'Layar nomor dokumen', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.number-sequence.read', 'core', 'core.number-sequence.form', 'read', 'Lihat nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.number-sequence.update', 'core', 'core.number-sequence.form', 'update', 'Ubah nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.number-sequence.view', 'core', 'Melihat nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.number-sequence.maintain', 'core', 'Memelihara nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.number-sequence.view', 'core.number-sequence.read'),
       ('core.number-sequence.maintain', 'core.number-sequence.read'),
       ('core.number-sequence.maintain', 'core.number-sequence.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.number-sequence.inquire', 'core', 'Lihat nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.number-sequence.manage', 'core', 'Kelola nomor dokumen',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.number-sequence.inquire', 'core.number-sequence.view'),
       ('core.number-sequence.manage', 'core.number-sequence.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT id, 'core.number-sequence.manage' FROM public.roles WHERE is_owner AND deleted_at IS NULL
ON CONFLICT DO NOTHING;
