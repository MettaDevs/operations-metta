-- Izin layar Pembayaran kasir (src/foundation/billing/invoice/): Daftar Pembayaran dan Form Pembayaran. Lihat untuk
-- membaca daftar dan rincian biaya; terima pembayaran untuk Simpan, yang menyusul. Role pemilik tenant yang sudah ada
-- mendapat duty terima pembayaran, sama dengan role pemilik yang lahir sesudah migration ini.

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.payment.form', 'core', 'Layar pembayaran kasir', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.payment.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment.read', 'read', 'Lihat pembayaran kasir'),
             ('core.payment.update', 'update', 'Terima pembayaran kasir')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment.view', 'Melihat pembayaran kasir'),
             ('core.payment.maintain', 'Menerima pembayaran kasir')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.payment.view', 'core.payment.read'),
       ('core.payment.maintain', 'core.payment.read'),
       ('core.payment.maintain', 'core.payment.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment.inquire', 'Lihat pembayaran kasir'),
             ('core.payment.operate', 'Menerima pembayaran kasir')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.payment.inquire', 'core.payment.view'),
       ('core.payment.operate', 'core.payment.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.payment.operate'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
