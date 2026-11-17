-- Pembayaran ke vendor (src/foundation/purchasing/vendor-payment/), pola Business Central: Payment Journal yang
-- diterapkan ke Vendor Ledger Entry lewat Applies-to ID, lalu Unapply dan Reverse untuk membatalkannya. Belum ada buku
-- besar, jadi posting tidak menulis jurnal kas atau bank; ia menulis entri pembayaran di utang vendor dan mengurangi sisa
-- entri faktur yang dibayarnya.
--
-- Di sistem lama Adapotek menandai lunas 181.382 penerimaan (StatusBayar, TanggalBayar, TipePembayaran Tunai atau
-- Transfer, dan Bank berupa teks bebas: Mandiri atau BCA). Satu tanda lunas per penerimaan, tanpa bayar sebagian.
--
-- 1. Pembayaran dan barisnya.
-- 2. Entri utang vendor menerima entri pembayaran dan pembatalannya.
-- 3. Reference nomor pembayaran per legal entity.
-- 4. Trigger versi, aktor, dan change log.
-- 5. Katalog izin.

-- 1. Pembayaran ------------------------------------------------------------------------------------------------------

-- tanggal adalah Posting Date. jenis_bayar_id adalah Payment Method Code; hanya jenis bayar yang uangnya sudah di tangan
-- klinik (tunai dan non tunai) yang bisa dipakai membayar. bank teks bebas seperti kolom Bank sistem lama, karena Core
-- belum punya master rekening bank (Bank Account BC). no_referensi adalah External Document No., misalnya nomor bukti
-- transfer.
CREATE TABLE public.ap_tr_pembayaran (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    bank character varying(60),
    no_referensi character varying(35),
    keterangan character varying(200),
    status character varying(15) DEFAULT 'draf' NOT NULL,
    diposting_pada timestamp(0) without time zone,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ap_tr_pembayaran_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_pembayaran_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT ap_tr_pembayaran_status_check CHECK (status IN ('draf', 'diposting', 'dibatalkan')),
    CONSTRAINT ap_tr_pembayaran_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT ap_tr_pembayaran_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_pembayaran_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ap_tr_pembayaran_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ap_tr_pembayaran_nomor_unique
    ON public.ap_tr_pembayaran USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_pembayaran_vendor_index
    ON public.ap_tr_pembayaran USING btree (tenant_id, vendor_id) WHERE (deleted_at IS NULL);

-- Satu baris per entri utang yang dibayar (Applies-to ID dengan Amount to Apply). Baris pembayaran yang diposting adalah
-- catatan penerapannya: batal posting mengembalikan jumlah baris ke sisa entri itu.
CREATE TABLE public.ap_tr_pembayaran_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    pembayaran_id uuid NOT NULL,
    urutan smallint NOT NULL,
    entri_utang_id uuid NOT NULL,
    jumlah numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ap_tr_pembayaran_detail_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_pembayaran_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT ap_tr_pembayaran_detail_pembayaran_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, pembayaran_id)
        REFERENCES public.ap_tr_pembayaran(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_pembayaran_detail_entri_utang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, entri_utang_id)
        REFERENCES public.ap_tr_entri_utang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ap_tr_pembayaran_detail_entri_unique
    ON public.ap_tr_pembayaran_detail USING btree (tenant_id, pembayaran_id, entri_utang_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_pembayaran_detail_entri_utang_index
    ON public.ap_tr_pembayaran_detail USING btree (tenant_id, entri_utang_id) WHERE (deleted_at IS NULL);

-- 2. Entri utang vendor ----------------------------------------------------------------------------------------------

-- Entri pembayaran bernilai negatif dan langsung ditutup, karena seluruh jumlahnya diterapkan ke entri faktur di
-- barisnya. Batal posting pembayaran menulis entri pembatalan_pembayaran bernilai positif yang menutupnya, seperti
-- Reverse Transaction di BC sesudah Unapply. Entri faktur merujuk fakturnya, entri pembayaran merujuk pembayarannya.
ALTER TABLE public.ap_tr_entri_utang
    DROP CONSTRAINT ap_tr_entri_utang_jenis_check,
    ALTER COLUMN jenis TYPE character varying(25),
    ALTER COLUMN faktur_id DROP NOT NULL,
    ALTER COLUMN no_faktur_vendor DROP NOT NULL,
    ADD COLUMN pembayaran_id uuid,
    ADD CONSTRAINT ap_tr_entri_utang_pembayaran_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, pembayaran_id)
        REFERENCES public.ap_tr_pembayaran(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT ap_tr_entri_utang_jenis_check CHECK (
        (jenis = 'faktur' AND faktur_id IS NOT NULL AND pembayaran_id IS NULL AND no_faktur_vendor IS NOT NULL
            AND jumlah >= 0 AND sisa >= 0 AND sisa <= jumlah)
        OR (jenis = 'pembatalan' AND faktur_id IS NOT NULL AND pembayaran_id IS NULL AND no_faktur_vendor IS NOT NULL
            AND jumlah <= 0 AND sisa = 0)
        OR (jenis = 'pembayaran' AND pembayaran_id IS NOT NULL AND faktur_id IS NULL AND jumlah < 0 AND sisa = 0)
        OR (jenis = 'pembatalan_pembayaran' AND pembayaran_id IS NOT NULL AND faktur_id IS NULL
            AND jumlah > 0 AND sisa = 0));
-- Satu entri pembayaran dan satu pembatalannya per pembayaran: posting yang diulang tidak menulis entri kedua.
CREATE UNIQUE INDEX ap_tr_entri_utang_pembayaran_unique
    ON public.ap_tr_entri_utang USING btree (tenant_id, pembayaran_id, jenis) WHERE (pembayaran_id IS NOT NULL);

-- 3. Reference nomor -----------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1e93b-a18b-76ec-a4ca-0af57dae30e1', 'core', 'core.vendor-payment-number',
        'Nomor pembayaran ke vendor', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PV-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, legal_entity_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), l.tenant_id, r.id, 'legal_entity', l.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'core.vendor-payment-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 4. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ap_tr_pembayaran', 'ap_tr_pembayaran_detail']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END;
$$;

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('ap_tr_pembayaran', 'Pembayaran ke vendor'),
             ('ap_tr_pembayaran_detail', 'Baris pembayaran ke vendor')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 5. Katalog izin ----------------------------------------------------------------------------------------------------

-- Pola faktur pembelian: lihat, ubah draf, posting, dan batal posting sebagai izin terpisah. Kedua duty ikut melihat
-- faktur dan utang vendor, karena baris pembayaran adalah entri utang dan membuka fakturnya.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.vendor-payment.form', 'core', 'Layar pembayaran ke vendor', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.vendor-payment.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.vendor-payment.read', 'read', 'Lihat pembayaran ke vendor'),
             ('core.vendor-payment.update', 'update', 'Ubah draf pembayaran ke vendor'),
             ('core.vendor-payment.post', 'invoke', 'Posting pembayaran ke vendor'),
             ('core.vendor-payment.reverse', 'invoke', 'Batalkan posting pembayaran ke vendor')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.vendor-payment.view', 'Melihat pembayaran ke vendor'),
             ('core.vendor-payment.maintain', 'Membuat dan mengubah draf pembayaran ke vendor'),
             ('core.vendor-payment.posting', 'Memposting pembayaran ke vendor'),
             ('core.vendor-payment.correction', 'Membatalkan posting pembayaran ke vendor')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.vendor-payment.view', 'core.vendor-payment.read'),
       ('core.vendor-payment.maintain', 'core.vendor-payment.read'),
       ('core.vendor-payment.maintain', 'core.vendor-payment.update'),
       ('core.vendor-payment.posting', 'core.vendor-payment.read'),
       ('core.vendor-payment.posting', 'core.vendor-payment.post'),
       ('core.vendor-payment.correction', 'core.vendor-payment.read'),
       ('core.vendor-payment.correction', 'core.vendor-payment.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.vendor-payment.inquire', 'Lihat pembayaran ke vendor'),
             ('core.vendor-payment.manage', 'Kelola dan posting pembayaran ke vendor')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.vendor-payment.inquire'), ('core.vendor-payment.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.vendor-payment.view'), ('core.vendor.view'), ('core.purchase-invoice.view'))
    AS p(privilege)
UNION ALL
SELECT 'core.vendor-payment.manage', p.privilege
FROM (VALUES ('core.vendor-payment.maintain'), ('core.vendor-payment.posting'),
             ('core.vendor-payment.correction')) AS p(privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.vendor-payment.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
