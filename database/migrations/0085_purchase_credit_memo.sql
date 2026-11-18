-- Nota kredit pembelian (src/foundation/purchasing/purchase-credit-memo/), pola Business Central: Purchase Header
-- berjenis Credit Memo dengan baris dari Get Return Shipment Lines (codeunit 6648 "Purch.-Get Return Shipments"), lalu
-- posting yang menulis Vendor Ledger Entry negatif, opsional diterapkan ke faktur lewat Applies-to Doc. No. Belum ada
-- buku besar, jadi posting tidak menulis jurnal.
--
-- Sistem lama tidak punya nota kredit vendor: di BO PIP tidak ada faktur bernilai negatif di AP_trFaktur (4.310 faktur)
-- dan tidak ada voucher yang merujuk retur (AP_trVoucher.No_Retur kosong di 2.922 voucher); BL_trRetur hanya satu baris.
-- Adapotek mencatat 2.579 retur penerimaan (BL_trReturPenerimaan) tanpa dokumen pengurang utang.
--
-- 1. Jumlah yang sudah dikreditkan di baris retur.
-- 2. Nota kredit dan barisnya.
-- 3. Entri utang nota kredit, dan baris pembayaran yang memakai kredit terbuka.
-- 4. Reference nomor nota kredit per legal entity.
-- 5. Trigger versi, aktor, dan change log.
-- 6. Katalog izin.

-- 1. Jumlah dikreditkan --------------------------------------------------------------------------------------------

-- Quantity Invoiced di Return Shipment Line BC, dalam satuan baris retur. Hanya ditulis posting dan batal posting nota
-- kredit, sambil baris retur dikunci. Constraint menjaga kredit tidak pernah melebihi yang diretur.
ALTER TABLE public.bl_tr_retur_detail
    ADD COLUMN jumlah_dikredit numeric(18,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT bl_tr_retur_detail_jumlah_dikredit_check
        CHECK (jumlah_dikredit >= 0 AND jumlah_dikredit <= jumlah);

-- 2. Nota kredit ---------------------------------------------------------------------------------------------------

-- no_nota_vendor adalah Vendor Cr. Memo No. (Code[35] di BC). tanggal_nota adalah Document Date, tanggal adalah Posting
-- Date. entri_utang_tujuan_id adalah Applies-to Doc. No.: entri faktur vendor yang sama yang langsung dikurangi saat
-- posting.
CREATE TABLE public.ap_tr_nota_kredit (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    no_nota_vendor character varying(35) NOT NULL,
    tanggal_nota date NOT NULL,
    tanggal date NOT NULL,
    entri_utang_tujuan_id uuid,
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
    CONSTRAINT ap_tr_nota_kredit_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_nota_kredit_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT ap_tr_nota_kredit_status_check CHECK (status IN ('draf', 'diposting', 'dibatalkan')),
    CONSTRAINT ap_tr_nota_kredit_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT ap_tr_nota_kredit_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_nota_kredit_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ap_tr_nota_kredit_entri_utang_tujuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, entri_utang_tujuan_id)
        REFERENCES public.ap_tr_entri_utang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ap_tr_nota_kredit_nomor_unique
    ON public.ap_tr_nota_kredit USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
-- Satu nomor nota kredit vendor dicatat sekali per vendor (CheckExternalDocumentNumber di Purch.-Post). Berbeda dengan
-- faktur, nota yang postingnya dibatalkan tetap memegang nomornya, seperti entri vendor BC yang tetap ada sesudah Cancel.
CREATE UNIQUE INDEX ap_tr_nota_kredit_no_nota_vendor_unique
    ON public.ap_tr_nota_kredit USING btree (tenant_id, legal_entity_id, vendor_id, upper(no_nota_vendor))
    WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_nota_kredit_vendor_index
    ON public.ap_tr_nota_kredit USING btree (tenant_id, vendor_id) WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_nota_kredit_entri_utang_tujuan_index
    ON public.ap_tr_nota_kredit USING btree (tenant_id, entri_utang_tujuan_id)
    WHERE (entri_utang_tujuan_id IS NOT NULL AND deleted_at IS NULL);

-- Baris retur merujuk baris retur yang diposting (Return Shipment No. dan Line No. di Purchase Line BC); barang, satuan,
-- dan harga bawaannya dibaca dari baris retur dan baris penerimaannya. Baris potongan harga merujuk baris faktur yang
-- diposting, tanpa barang yang kembali. jumlah dalam satuan baris yang dirujuk.
CREATE TABLE public.ap_tr_nota_kredit_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    nota_kredit_id uuid NOT NULL,
    urutan smallint NOT NULL,
    jenis character varying(10) NOT NULL,
    retur_detail_id uuid,
    faktur_detail_id uuid,
    keterangan character varying(200),
    jumlah numeric(18,4) NOT NULL,
    harga_satuan numeric(19,4) NOT NULL,
    diskon_persen numeric(7,4) DEFAULT 0 NOT NULL,
    tarif_ppn numeric(7,4) DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ap_tr_nota_kredit_detail_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_nota_kredit_detail_jenis_check CHECK (
        (jenis = 'retur' AND retur_detail_id IS NOT NULL AND faktur_detail_id IS NULL)
        OR (jenis = 'potongan' AND faktur_detail_id IS NOT NULL AND retur_detail_id IS NULL
            AND keterangan IS NOT NULL)),
    CONSTRAINT ap_tr_nota_kredit_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT ap_tr_nota_kredit_detail_harga_satuan_check CHECK (harga_satuan >= 0),
    CONSTRAINT ap_tr_nota_kredit_detail_diskon_check CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
    CONSTRAINT ap_tr_nota_kredit_detail_tarif_ppn_check CHECK (tarif_ppn >= 0 AND tarif_ppn <= 100),
    CONSTRAINT ap_tr_nota_kredit_detail_nota_kredit_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, nota_kredit_id)
        REFERENCES public.ap_tr_nota_kredit(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_nota_kredit_detail_retur_detail_foreign
        FOREIGN KEY (retur_detail_id) REFERENCES public.bl_tr_retur_detail(id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_nota_kredit_detail_faktur_detail_foreign
        FOREIGN KEY (faktur_detail_id) REFERENCES public.ap_tr_faktur_detail(id) ON DELETE RESTRICT
);
CREATE INDEX ap_tr_nota_kredit_detail_nota_kredit_index
    ON public.ap_tr_nota_kredit_detail USING btree (tenant_id, nota_kredit_id) WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_nota_kredit_detail_retur_detail_index
    ON public.ap_tr_nota_kredit_detail USING btree (tenant_id, retur_detail_id)
    WHERE (retur_detail_id IS NOT NULL AND deleted_at IS NULL);
CREATE INDEX ap_tr_nota_kredit_detail_faktur_detail_index
    ON public.ap_tr_nota_kredit_detail USING btree (tenant_id, faktur_detail_id)
    WHERE (faktur_detail_id IS NOT NULL AND deleted_at IS NULL);

-- 3. Entri utang nota kredit -----------------------------------------------------------------------------------------

-- Vendor Ledger Entry berjenis Credit Memo: jumlah negatif, sisa negatif selama kreditnya belum dipakai. Pembatalan
-- adalah entri pembalik yang menutupnya. no_faktur_vendor memuat nomor nota kredit vendor (External Document No.).
ALTER TABLE public.ap_tr_entri_utang
    DROP CONSTRAINT ap_tr_entri_utang_jenis_check,
    ADD COLUMN nota_kredit_id uuid,
    ADD CONSTRAINT ap_tr_entri_utang_nota_kredit_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, nota_kredit_id)
        REFERENCES public.ap_tr_nota_kredit(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT ap_tr_entri_utang_jenis_check CHECK (
        (jenis = 'faktur' AND faktur_id IS NOT NULL AND pembayaran_id IS NULL AND nota_kredit_id IS NULL
            AND no_faktur_vendor IS NOT NULL AND jumlah >= 0 AND sisa >= 0 AND sisa <= jumlah)
        OR (jenis = 'pembatalan' AND faktur_id IS NOT NULL AND pembayaran_id IS NULL AND nota_kredit_id IS NULL
            AND no_faktur_vendor IS NOT NULL AND jumlah <= 0 AND sisa = 0)
        OR (jenis = 'pembayaran' AND pembayaran_id IS NOT NULL AND faktur_id IS NULL AND nota_kredit_id IS NULL
            AND jumlah < 0 AND sisa = 0)
        OR (jenis = 'pembatalan_pembayaran' AND pembayaran_id IS NOT NULL AND faktur_id IS NULL
            AND nota_kredit_id IS NULL AND jumlah > 0 AND sisa = 0)
        OR (jenis = 'nota_kredit' AND nota_kredit_id IS NOT NULL AND faktur_id IS NULL AND pembayaran_id IS NULL
            AND no_faktur_vendor IS NOT NULL AND jumlah < 0 AND sisa <= 0 AND sisa >= jumlah)
        OR (jenis = 'pembatalan_nota_kredit' AND nota_kredit_id IS NOT NULL AND faktur_id IS NULL
            AND pembayaran_id IS NULL AND jumlah > 0 AND sisa = 0));
CREATE UNIQUE INDEX ap_tr_entri_utang_nota_kredit_unique
    ON public.ap_tr_entri_utang USING btree (tenant_id, nota_kredit_id, jenis) WHERE (nota_kredit_id IS NOT NULL);
DROP INDEX public.ap_tr_entri_utang_terbuka_index;
CREATE INDEX ap_tr_entri_utang_terbuka_index
    ON public.ap_tr_entri_utang USING btree (tenant_id, legal_entity_id, vendor_id, jatuh_tempo) WHERE (sisa <> 0);

-- Baris pembayaran yang memakai kredit terbuka bernilai negatif, seperti entri credit memo yang ikut di Applies-to ID
-- Payment Journal BC. Tanda jumlah mengikuti tanda sisa entrinya, dan pemeriksaannya di posting.
ALTER TABLE public.ap_tr_pembayaran_detail
    DROP CONSTRAINT ap_tr_pembayaran_detail_jumlah_check,
    ADD CONSTRAINT ap_tr_pembayaran_detail_jumlah_check CHECK (jumlah <> 0);

-- 4. Reference nomor -----------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1f2c4-6b1e-7c3a-9d52-3e8f0a4b7c11', 'core', 'core.purchase-credit-memo-number',
        'Nomor nota kredit pembelian', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PCM-"},{"type":"number","length":8}]}',
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
WHERE r.code = 'core.purchase-credit-memo-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 5. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ap_tr_nota_kredit', 'ap_tr_nota_kredit_detail']
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
FROM (VALUES ('ap_tr_nota_kredit', 'Nota kredit pembelian'),
             ('ap_tr_nota_kredit_detail', 'Baris nota kredit pembelian')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Katalog izin ----------------------------------------------------------------------------------------------------

-- Pola faktur pembelian: lihat, ubah draf, posting, dan batal posting sebagai izin terpisah.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.purchase-credit-memo.form', 'core', 'Layar nota kredit pembelian', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.purchase-credit-memo.form', p.level, p.name,
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-credit-memo.read', 'read', 'Lihat nota kredit pembelian'),
             ('core.purchase-credit-memo.update', 'update', 'Ubah draf nota kredit pembelian'),
             ('core.purchase-credit-memo.post', 'invoke', 'Posting nota kredit pembelian'),
             ('core.purchase-credit-memo.reverse', 'invoke', 'Batalkan posting nota kredit pembelian'))
    AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-credit-memo.view', 'Melihat nota kredit pembelian'),
             ('core.purchase-credit-memo.maintain', 'Membuat dan mengubah draf nota kredit pembelian'),
             ('core.purchase-credit-memo.posting', 'Memposting nota kredit pembelian'),
             ('core.purchase-credit-memo.correction', 'Membatalkan posting nota kredit pembelian')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.purchase-credit-memo.view', 'core.purchase-credit-memo.read'),
       ('core.purchase-credit-memo.maintain', 'core.purchase-credit-memo.read'),
       ('core.purchase-credit-memo.maintain', 'core.purchase-credit-memo.update'),
       ('core.purchase-credit-memo.posting', 'core.purchase-credit-memo.read'),
       ('core.purchase-credit-memo.posting', 'core.purchase-credit-memo.post'),
       ('core.purchase-credit-memo.correction', 'core.purchase-credit-memo.read'),
       ('core.purchase-credit-memo.correction', 'core.purchase-credit-memo.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-credit-memo.inquire', 'Lihat nota kredit pembelian'),
             ('core.purchase-credit-memo.manage', 'Kelola dan posting nota kredit pembelian')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Layar nota kredit membaca vendor, retur, faktur, barang, dan satuan yang dirujuknya. Pembayaran ke vendor ikut melihat
-- nota kredit, karena kredit terbuka dipakai di sana.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.purchase-credit-memo.inquire'), ('core.purchase-credit-memo.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.purchase-credit-memo.view'), ('core.vendor.view'), ('core.purchase-invoice.view'),
                   ('core.purchase-receipt.view'), ('core.inventory-item.view'), ('core.inventory-location.view'),
                   ('core.inventory-unit.view')) AS p(privilege)
UNION ALL
SELECT 'core.purchase-credit-memo.manage', p.privilege
FROM (VALUES ('core.purchase-credit-memo.maintain'), ('core.purchase-credit-memo.posting'),
             ('core.purchase-credit-memo.correction')) AS p(privilege)
UNION ALL
SELECT d.duty, 'core.purchase-credit-memo.view'
FROM (VALUES ('core.vendor-payment.inquire'), ('core.vendor-payment.manage')) AS d(duty)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.purchase-credit-memo.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
