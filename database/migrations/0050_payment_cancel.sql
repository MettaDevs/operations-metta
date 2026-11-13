-- Batal pembayaran kasir (src/foundation/billing/payment/), padanan General_payment::cancel Kuta 1: SIMtrKasir.TglBatal,
-- BATAL, dan AlasanBatal, dengan penyetuju yang mengetik akunnya di modal yang sama (ListApprove fungsi
-- 'CANCEL INVOICE PASIEN' sistem lama).
--
-- 1. kasir: tgl_batal, alasan_batal, kasir yang membatalkan, dan penyetujunya. BATAL sistem lama adalah status `batal`
--    yang sudah ada sejak 0045. Pembayaran batal wajib membawa tanggal dan alasannya.
-- 2. Change log kasir, padanan InsertUserActivities "CANCEL KASIR" sistem lama: siapa membatalkan, kapan, dan isinya.
-- 3. Katalog izin menyetujui batal pembayaran. Role pemilik tenant yang sudah ada mendapatnya.
--
-- Trigger updtSIMtrKasir sistem lama menghapus kartu piutang (outSTandingKartu) nota yang dibatalkan. Piutang belum ada
-- di repo ini; saat dibangun, batal pembayaran juga menutup piutangnya.

-- 1. Kolom batal ----------------------------------------------------------------------------------------------------

ALTER TABLE public.kasir
    ADD COLUMN tgl_batal timestamp(0) without time zone,
    ADD COLUMN alasan_batal character varying(200),
    ADD COLUMN dibatalkan_oleh_user_id uuid,
    ADD COLUMN penyetuju_batal_user_id uuid,
    ADD CONSTRAINT kasir_batal_check CHECK (
        (status = 'diposting' AND tgl_batal IS NULL AND alasan_batal IS NULL)
        OR (status = 'batal' AND tgl_batal IS NOT NULL AND alasan_batal IS NOT NULL)),
    ADD CONSTRAINT kasir_dibatalkan_oleh_foreign
        FOREIGN KEY (dibatalkan_oleh_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT kasir_penyetuju_batal_foreign
        FOREIGN KEY (penyetuju_batal_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

-- 2. Change log -----------------------------------------------------------------------------------------------------

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'kasir', 'Pembayaran kasir', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'kasir');

-- 3. Izin menyetujui batal pembayaran ---------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.payment.cancel', 'core', 'core.payment.form', 'update', 'Setujui batal pembayaran kasir',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.payment-cancel.approve', 'core', 'Menyetujui batal pembayaran kasir', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.payment-cancel.approve', 'core.payment.cancel')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.payment-cancel.approve', 'core', 'Menyetujui batal pembayaran kasir', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.payment-cancel.approve', 'core.payment-cancel.approve')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.payment-cancel.approve'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
