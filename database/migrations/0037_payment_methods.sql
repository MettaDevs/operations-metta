-- Jenis bayar dan merchan kasir (src/foundation/billing/), padanan mJenisBayar dan SIMmMerchan sistem lama, per legal
-- entity. Di sistem lama mJenisBayar sudah membawa flag (Cash, Bank, Jaminan, Others), tetapi layar dan kode kasir
-- menulis mati setiap jenis bayar, jadi jenis bayar baru tidak pernah muncul di layar. Di sini setiap jenis bayar memilih
-- satu perilaku dari katalog di kode (payment-method.behaviors.ts), seperti Payment Method di Business Central dan
-- tender type di Commerce, dan layar kasir digambar dari data ini. Jenis bayar baru dengan perilaku yang sudah ada cukup
-- berupa baris data.
--
-- 1. Tabel jenis_bayar. Kode pendek diketik pengguna, unik per legal entity selama barisnya belum dihapus. Paling banyak
--    satu jenis bayar tunai yang aktif dan satu jenis bayar penampung sisa yang aktif per legal entity, karena layar kasir
--    menggambar keduanya sebagai satu isian (uang diterima dan centang Pasien BON di sistem lama). id_bayar_lama mencatat
--    IDBayar sistem lama untuk baris hasil impor, supaya impor yang diulang tidak menambah baris.
--    Akun jenis bayar (mJenisBayar.Akun_Id) bukan kolom di sini; ia menyusul lewat setup posting finance.
-- 2. Tabel merchan: bank atau mesin EDC yang dipilih saat bayar dengan kartu. Isian form Merchan sistem lama tanpa akun
--    (Akun_ID_Tujuan menunggu finance). Persen dari 0 sampai 100.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelola setelan kasir, sama dengan role pemilik yang
--    lahir sesudah migration ini.

-- 1. Jenis bayar ----------------------------------------------------------------------------------------------------

CREATE TABLE public.jenis_bayar (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    label_kasir character varying(100),
    urutan smallint DEFAULT 0 NOT NULL,
    perilaku character varying(20) NOT NULL,
    pihak character varying(30) DEFAULT 'tidak' NOT NULL,
    wajib_merchan boolean DEFAULT false NOT NULL,
    wajib_referensi boolean DEFAULT false NOT NULL,
    biaya_tambahan boolean DEFAULT false NOT NULL,
    menampung_sisa boolean DEFAULT false NOT NULL,
    dihitung_tutup_kas boolean DEFAULT false NOT NULL,
    tampil_di_kasir boolean DEFAULT true NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    id_bayar_lama integer,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT jenis_bayar_pkey PRIMARY KEY (id),
    CONSTRAINT jenis_bayar_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT jenis_bayar_urutan_check CHECK (urutan >= 0),
    CONSTRAINT jenis_bayar_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX jenis_bayar_kode_unique
    ON public.jenis_bayar USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX jenis_bayar_tunai_unique
    ON public.jenis_bayar USING btree (tenant_id, legal_entity_id)
    WHERE (perilaku = 'tunai' AND aktif AND deleted_at IS NULL);
CREATE UNIQUE INDEX jenis_bayar_menampung_sisa_unique
    ON public.jenis_bayar USING btree (tenant_id, legal_entity_id)
    WHERE (menampung_sisa AND aktif AND deleted_at IS NULL);
CREATE UNIQUE INDEX jenis_bayar_id_bayar_lama_unique
    ON public.jenis_bayar USING btree (tenant_id, legal_entity_id, id_bayar_lama)
    WHERE (id_bayar_lama IS NOT NULL AND deleted_at IS NULL);

-- 2. Merchan --------------------------------------------------------------------------------------------------------

CREATE TABLE public.merchan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    add_charge_debet numeric(5,2) DEFAULT 0 NOT NULL,
    add_charge_kredit numeric(5,2) DEFAULT 0 NOT NULL,
    diskon numeric(5,2) DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT merchan_pkey PRIMARY KEY (id),
    CONSTRAINT merchan_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT merchan_persen_check CHECK (add_charge_debet BETWEEN 0 AND 100 AND add_charge_kredit BETWEEN 0 AND 100
                                           AND diskon BETWEEN 0 AND 100),
    CONSTRAINT merchan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX merchan_kode_unique
    ON public.merchan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.merchan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.merchan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.merchan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.table_caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('jenis_bayar', 'Jenis bayar'), ('merchan', 'Merchan')) AS t(table_name, table_caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
SELECT e.code, 'core', e.name, 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment-method.form', 'Layar jenis bayar'),
             ('core.merchant.form', 'Layar merchan')) AS e(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment-method.read', 'core.payment-method.form', 'read', 'Lihat jenis bayar'),
             ('core.payment-method.update', 'core.payment-method.form', 'update', 'Ubah jenis bayar'),
             ('core.merchant.read', 'core.merchant.form', 'read', 'Lihat merchan'),
             ('core.merchant.update', 'core.merchant.form', 'update', 'Ubah merchan'))
     AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment-method.view', 'Melihat jenis bayar'),
             ('core.payment-method.maintain', 'Memelihara jenis bayar'),
             ('core.merchant.view', 'Melihat merchan'),
             ('core.merchant.maintain', 'Memelihara merchan')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.payment-method.view', 'core.payment-method.read'),
       ('core.payment-method.maintain', 'core.payment-method.read'),
       ('core.payment-method.maintain', 'core.payment-method.update'),
       ('core.merchant.view', 'core.merchant.read'),
       ('core.merchant.maintain', 'core.merchant.read'),
       ('core.merchant.maintain', 'core.merchant.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.billing-setup.inquire', 'Lihat setelan kasir'),
             ('core.billing-setup.manage', 'Kelola setelan kasir')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.billing-setup.inquire', 'core.payment-method.view'),
       ('core.billing-setup.inquire', 'core.merchant.view'),
       ('core.billing-setup.manage', 'core.payment-method.maintain'),
       ('core.billing-setup.manage', 'core.merchant.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.billing-setup.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
