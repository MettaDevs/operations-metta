-- Termin pembayaran (Payment Terms di BC, src/foundation/purchasing/payment-terms/): kode pendek yang diketik pengguna,
-- keterangan, dan jumlah hari sampai jatuh tempo. Jatuh tempo = tanggal faktur vendor + jumlah hari, seperti Due Date =
-- CalcDate("Due Date Calculation", "Document Date") di Purchase Header BC. Dicatat sebagai hari, bukan rumus tanggal
-- BC, karena data lama hanya mengenal selisih hari: di Adapotek 151.526 penerimaan membawa jatuh tempo 14, 21, atau
-- 30 hari sesudah tanggal terima, sedangkan kolom Term_Pembayaran tidak pernah diisi. Diskon bayar cepat (Discount
-- Date Calculation, Discount %) tidak ikut, karena tidak ada di data lama.
--
-- 1. Master termin pembayaran per legal entity.
-- 2. Termin bawaan di vendor dan termin di purchase order, disalin dari vendor.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Katalog izin.

-- 1. Termin pembayaran -----------------------------------------------------------------------------------------------

CREATE TABLE public.termin_pembayaran (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(10) NOT NULL,
    keterangan character varying(100) NOT NULL,
    jumlah_hari smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT termin_pembayaran_pkey PRIMARY KEY (id),
    CONSTRAINT termin_pembayaran_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT termin_pembayaran_jumlah_hari_check CHECK (jumlah_hari >= 0 AND jumlah_hari <= 3650),
    CONSTRAINT termin_pembayaran_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX termin_pembayaran_kode_unique
    ON public.termin_pembayaran USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 2. Termin di vendor dan purchase order ---------------------------------------------------------------------------

-- Payment Terms Code di kartu vendor BC: disalin ke dokumen baru dan boleh diganti di dokumen itu.
ALTER TABLE public.vendors
    ADD COLUMN termin_pembayaran_id uuid,
    ADD CONSTRAINT vendors_termin_pembayaran_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, termin_pembayaran_id)
        REFERENCES public.termin_pembayaran(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;

ALTER TABLE public.bl_tr_order
    ADD COLUMN termin_pembayaran_id uuid,
    ADD CONSTRAINT bl_tr_order_termin_pembayaran_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, termin_pembayaran_id)
        REFERENCES public.termin_pembayaran(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.termin_pembayaran
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.termin_pembayaran
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.termin_pembayaran
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'termin_pembayaran', 'Termin pembayaran', 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'termin_pembayaran');

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

-- Termin dikelola bersama vendor, karena di BC ia setelan yang dipilih di kartu vendor. Siapa pun yang membaca vendor
-- atau purchase order ikut melihat termin yang dirujuknya.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.payment-terms.form', 'core', 'Layar termin pembayaran', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.payment-terms.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment-terms.read', 'read', 'Lihat termin pembayaran'),
             ('core.payment-terms.update', 'update', 'Ubah termin pembayaran')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.payment-terms.view', 'Melihat termin pembayaran'),
             ('core.payment-terms.maintain', 'Memelihara termin pembayaran')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.payment-terms.view', 'core.payment-terms.read'),
       ('core.payment-terms.maintain', 'core.payment-terms.read'),
       ('core.payment-terms.maintain', 'core.payment-terms.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.vendor.inquire', 'core.payment-terms.view'),
       ('core.vendor.manage', 'core.payment-terms.maintain'),
       ('core.purchase-order.inquire', 'core.payment-terms.view'),
       ('core.purchase-order.manage', 'core.payment-terms.view')
ON CONFLICT DO NOTHING;
