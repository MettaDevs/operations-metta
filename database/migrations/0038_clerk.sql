-- Clerk kasir (src/foundation/billing/clerk/), padanan SIMtrClerk dan SIMtrClerkDetail Puskesmas Kuta 1: sesi kas satu
-- kasir di satu legal entity, dari Clerk Start sampai Clerk End. Kasir tidak bisa membayar tanpa Clerk Start (pesan
-- sistem lama "Karena User belum melakukan Start Clerk!").
--
-- 1. Tabel clerk. Kode `C-ddmmYYYY-XXXXX` seperti sistem lama, tanggalnya tanggal setempat legal entity. Paling banyak
--    satu clerk berjalan per kasir per legal entity. Status `start` sampai Clerk End, lalu `end` bersama waktu akhirnya.
--    Angka diisi saat Clerk End:
--    - jumlah_transaksi dan jumlah_total_system: jumlah dan nilai pembayaran kasir itu selama sesi, semua jenis bayar,
--      sama dengan JumlahTransaksi dan JumlahTotalSystem sistem lama;
--    - jumlah_total_clerk: jumlah fisik yang diisi kasir;
--    - jumlah_total_selisih: jumlah selisih per jenis bayar yang dihitung saat tutup kas. Sistem lama menghitung
--      selisih atas semua jenis bayar, sehingga BPJS dan bon yang tidak ada di laci tercatat sebagai kekurangan (236 dari
--      693 sesi Kuta). Di sini hanya jenis bayar bertanda dihitung_tutup_kas yang diisi dan diselisihkan, seperti tender
--      declaration di Commerce.
--    Pembayaran membawa clerk-nya (menyusul bersama tabel pembayaran), tidak lagi dicocokkan lewat user dan jam saja.
-- 2. Tabel clerk_detail: satu baris per jenis bayar yang dihitung saat Clerk End. jumlah_total adalah JumlahTotal
--    sistem lama (jumlah fisik); jumlah_sistem disimpan sekalian supaya hasil Clerk End tidak berubah bila pembayaran
--    sesudahnya dikoreksi. Selisih dihitung database.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty clerk, sama dengan role pemilik yang lahir sesudah
--    migration ini.

-- 1. Clerk ----------------------------------------------------------------------------------------------------------

CREATE TABLE public.clerk (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(32) NOT NULL,
    user_id uuid NOT NULL,
    status character varying(10) DEFAULT 'start' NOT NULL,
    waktu_mulai timestamp(0) without time zone NOT NULL,
    waktu_akhir timestamp(0) without time zone,
    jumlah_transaksi integer DEFAULT 0 NOT NULL,
    jumlah_total_system numeric(18,2) DEFAULT 0 NOT NULL,
    jumlah_total_clerk numeric(18,2) DEFAULT 0 NOT NULL,
    jumlah_total_selisih numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT clerk_pkey PRIMARY KEY (id),
    CONSTRAINT clerk_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT clerk_kode_unique UNIQUE (tenant_id, kode),
    CONSTRAINT clerk_status_check CHECK ((status = 'start' AND waktu_akhir IS NULL)
                                         OR (status = 'end' AND waktu_akhir IS NOT NULL)),
    CONSTRAINT clerk_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT clerk_user_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX clerk_berjalan_unique
    ON public.clerk USING btree (tenant_id, legal_entity_id, user_id) WHERE (status = 'start');
CREATE INDEX clerk_waktu_mulai_index ON public.clerk USING btree (tenant_id, legal_entity_id, waktu_mulai);

-- 2. Clerk detail ---------------------------------------------------------------------------------------------------

CREATE TABLE public.clerk_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    clerk_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    jumlah_sistem numeric(18,2) NOT NULL,
    jumlah_total numeric(18,2) NOT NULL,
    jumlah_selisih numeric(18,2) GENERATED ALWAYS AS (jumlah_total - jumlah_sistem) STORED,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT clerk_detail_pkey PRIMARY KEY (id),
    CONSTRAINT clerk_detail_jenis_bayar_unique UNIQUE (clerk_id, jenis_bayar_id),
    CONSTRAINT clerk_detail_jumlah_check CHECK (jumlah_total >= 0),
    CONSTRAINT clerk_detail_clerk_foreign
        FOREIGN KEY (tenant_id, clerk_id) REFERENCES public.clerk(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT clerk_detail_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT
);

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.clerk
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.clerk
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.clerk
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.clerk_detail
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'clerk', 'Clerk', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'clerk');

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.clerk.form', 'core', 'Layar clerk', 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.clerk.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.clerk.read', 'read', 'Lihat clerk'),
             ('core.clerk.update', 'update', 'Clerk Start dan Clerk End')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.clerk.view', 'Melihat clerk'),
             ('core.clerk.maintain', 'Menjalankan clerk sendiri')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.clerk.view', 'core.clerk.read'),
       ('core.clerk.maintain', 'core.clerk.read'),
       ('core.clerk.maintain', 'core.clerk.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.clerk.inquire', 'Lihat clerk kasir'),
             ('core.clerk.operate', 'Menjalankan clerk kasir')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.clerk.inquire', 'core.clerk.view'),
       ('core.clerk.operate', 'core.clerk.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.clerk.operate'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
