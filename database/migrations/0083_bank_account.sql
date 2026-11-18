-- Rekening bank (Bank Account BC, table 270, src/foundation/bank/bank-account/): rekening milik legal entity yang
-- dipakai membayar dan menerima uang. Sistem lama tidak punya master rekening: SIMmClaimBank kosong di setiap database,
-- dan bank pembayaran ke vendor dicatat sebagai teks bebas di BL_trPenerimaan.Bank (Adapotek 56.949 penerimaan, dua
-- nilai: Mandiri dan BCA).
--
-- 1. Master rekening bank per legal entity.
-- 2. Rekening bank di pembayaran ke vendor. Kolom teks `bank` tetap ada untuk pembayaran yang sudah dicatat.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Katalog izin.

-- 1. Rekening bank ---------------------------------------------------------------------------------------------------

-- kode adalah No., nama adalah Name, nomor_rekening adalah Bank Account No., mata_uang adalah Currency Code (kosong
-- berarti mata uang lokal), diblokir adalah Blocked. nama_bank tidak ada di BC; di sana nama bank biasanya ikut Name.
CREATE TABLE public.rekening_bank (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    nama_bank character varying(100) NOT NULL,
    nomor_rekening character varying(30) NOT NULL,
    mata_uang character(3),
    diblokir boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT rekening_bank_pkey PRIMARY KEY (id),
    CONSTRAINT rekening_bank_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT rekening_bank_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT rekening_bank_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX rekening_bank_kode_unique
    ON public.rekening_bank USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 2. Rekening bank di pembayaran ke vendor -------------------------------------------------------------------------

-- Bal. Account No. berjenis Bank Account di baris Payment Journal.
ALTER TABLE public.ap_tr_pembayaran
    ADD COLUMN rekening_bank_id uuid,
    ADD CONSTRAINT ap_tr_pembayaran_rekening_bank_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, rekening_bank_id)
        REFERENCES public.rekening_bank(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
CREATE INDEX ap_tr_pembayaran_rekening_bank_index
    ON public.ap_tr_pembayaran USING btree (tenant_id, rekening_bank_id)
    WHERE (rekening_bank_id IS NOT NULL AND deleted_at IS NULL);

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.rekening_bank
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.rekening_bank
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.rekening_bank
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'rekening_bank', 'Rekening bank', 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'rekening_bank');

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

-- Pola faktur pembelian: duty lihat dan duty kelola sendiri. Pembayaran ke vendor ikut melihat rekening, karena
-- rekening dipilih di sana.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.bank-account.form', 'core', 'Layar rekening bank', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.bank-account.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.bank-account.read', 'read', 'Lihat rekening bank'),
             ('core.bank-account.update', 'update', 'Ubah rekening bank')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.bank-account.view', 'Melihat rekening bank'),
             ('core.bank-account.maintain', 'Memelihara rekening bank')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.bank-account.view', 'core.bank-account.read'),
       ('core.bank-account.maintain', 'core.bank-account.read'),
       ('core.bank-account.maintain', 'core.bank-account.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.bank-account.inquire', 'Lihat rekening bank'),
             ('core.bank-account.manage', 'Kelola rekening bank')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.bank-account.inquire', 'core.bank-account.view'),
       ('core.bank-account.manage', 'core.bank-account.maintain'),
       ('core.vendor-payment.inquire', 'core.bank-account.view'),
       ('core.vendor-payment.manage', 'core.bank-account.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.bank-account.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
