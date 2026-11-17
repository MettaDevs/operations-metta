-- Faktur pembelian dan utang ke vendor (src/foundation/purchasing/purchase-invoice/), pola Business Central: Purchase
-- Header berjenis Invoice dengan baris dari Get Receipt Lines (codeunit 74 "Purch.-Get Receipt"), lalu posting yang
-- menulis Vendor Ledger Entry. Belum ada buku besar, jadi posting tidak menulis jurnal; utangnya dicatat sebagai entri
-- utang vendor dengan sisa dan jatuh tempo.
--
-- Di sistem lama tagihan vendor menumpang di penerimaan: Adapotek mengisi jatuh tempo (Tgl_JatuhTempo) di 151.526
-- penerimaan dan menandai lunas (StatusBayar, TanggalBayar, TipePembayaran) di 181.382 penerimaan, sedangkan tabel faktur
-- (AP_trFaktur) kosong. Nomor dokumen vendor (No_DO) diisi di setiap penerimaan. Biaya angkut (Ongkos_Angkut) ada di
-- 10.317 penerimaan.
--
-- 1. Jumlah yang sudah difakturkan di baris penerimaan.
-- 2. Faktur pembelian dan barisnya.
-- 3. Entri utang vendor.
-- 4. Reference nomor faktur per legal entity.
-- 5. Trigger versi, aktor, dan change log.
-- 6. Katalog izin.

-- 1. Jumlah difakturkan --------------------------------------------------------------------------------------------

-- Quantity Invoiced di Purch. Rcpt. Line BC, dalam satuan baris penerimaan. Hanya ditulis posting dan batal posting
-- faktur, sambil kepala penerimaan dikunci. Constraint menjaga faktur tidak pernah melebihi yang diterima.
ALTER TABLE public.bl_tr_penerimaan_detail
    ADD COLUMN jumlah_difaktur numeric(18,4) DEFAULT 0 NOT NULL,
    ADD CONSTRAINT bl_tr_penerimaan_detail_jumlah_difaktur_check
        CHECK (jumlah_difaktur >= 0 AND jumlah_difaktur <= jumlah);

-- 2. Faktur pembelian ----------------------------------------------------------------------------------------------

-- Nama dari AP_trFaktur sistem lama. no_faktur_vendor adalah Vendor Invoice No. (Code[35] di BC). tanggal_faktur adalah
-- Document Date, dasar jatuh tempo; tanggal adalah Posting Date.
CREATE TABLE public.ap_tr_faktur (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    no_faktur_vendor character varying(35) NOT NULL,
    tanggal_faktur date NOT NULL,
    tanggal date NOT NULL,
    termin_pembayaran_id uuid,
    jatuh_tempo date NOT NULL,
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
    CONSTRAINT ap_tr_faktur_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_faktur_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT ap_tr_faktur_status_check CHECK (status IN ('draf', 'diposting', 'dibatalkan')),
    CONSTRAINT ap_tr_faktur_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT ap_tr_faktur_jatuh_tempo_check CHECK (jatuh_tempo >= tanggal_faktur),
    CONSTRAINT ap_tr_faktur_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_faktur_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ap_tr_faktur_termin_pembayaran_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, termin_pembayaran_id)
        REFERENCES public.termin_pembayaran(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ap_tr_faktur_nomor_unique
    ON public.ap_tr_faktur USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
-- Satu nomor faktur vendor hanya dicatat sekali per vendor, seperti CheckExternalDocumentNumber di Purch.-Post. Faktur
-- yang postingnya dibatalkan melepas nomornya, supaya tagihan yang sama bisa dicatat ulang dengan benar.
CREATE UNIQUE INDEX ap_tr_faktur_no_faktur_vendor_unique
    ON public.ap_tr_faktur USING btree (tenant_id, legal_entity_id, vendor_id, upper(no_faktur_vendor))
    WHERE (deleted_at IS NULL AND status <> 'dibatalkan');
CREATE INDEX ap_tr_faktur_vendor_index
    ON public.ap_tr_faktur USING btree (tenant_id, vendor_id) WHERE (deleted_at IS NULL);

-- Baris barang merujuk baris penerimaan yang diposting (Receipt No. dan Receipt Line No. di Purchase Line BC); barang,
-- satuan, dan isinya dibaca dari baris penerimaan itu. Baris biaya (G/L Account di BC, Ongkos_Angkut di sistem lama)
-- hanya keterangan dan nilai. jumlah dalam satuan baris penerimaan.
CREATE TABLE public.ap_tr_faktur_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    faktur_id uuid NOT NULL,
    urutan smallint NOT NULL,
    jenis character varying(10) NOT NULL,
    penerimaan_detail_id uuid,
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
    CONSTRAINT ap_tr_faktur_detail_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_faktur_detail_jenis_check CHECK (
        (jenis = 'barang' AND penerimaan_detail_id IS NOT NULL)
        OR (jenis = 'biaya' AND penerimaan_detail_id IS NULL AND keterangan IS NOT NULL AND jumlah = 1)),
    CONSTRAINT ap_tr_faktur_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT ap_tr_faktur_detail_harga_satuan_check CHECK (harga_satuan >= 0),
    CONSTRAINT ap_tr_faktur_detail_diskon_check CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
    CONSTRAINT ap_tr_faktur_detail_tarif_ppn_check CHECK (tarif_ppn >= 0 AND tarif_ppn <= 100),
    CONSTRAINT ap_tr_faktur_detail_faktur_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, faktur_id)
        REFERENCES public.ap_tr_faktur(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_faktur_detail_penerimaan_detail_foreign
        FOREIGN KEY (penerimaan_detail_id) REFERENCES public.bl_tr_penerimaan_detail(id) ON DELETE RESTRICT
);
CREATE INDEX ap_tr_faktur_detail_faktur_index
    ON public.ap_tr_faktur_detail USING btree (tenant_id, faktur_id) WHERE (deleted_at IS NULL);
CREATE INDEX ap_tr_faktur_detail_penerimaan_detail_index
    ON public.ap_tr_faktur_detail USING btree (tenant_id, penerimaan_detail_id)
    WHERE (penerimaan_detail_id IS NOT NULL AND deleted_at IS NULL);

-- 3. Entri utang vendor ----------------------------------------------------------------------------------------------

-- Vendor Ledger Entry BC: satu entri per faktur yang diposting, dengan jumlah termasuk PPN dan sisa yang belum dibayar.
-- Entri hanya ditambah. Batal posting menulis entri pembatalan bernilai negatif dan menutup keduanya (Closed by Entry
-- No.), seperti faktur yang dibatalkan dengan credit memo di BC. Pembayaran kelak mengurangi sisa.
CREATE TABLE public.ap_tr_entri_utang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    faktur_id uuid NOT NULL,
    jenis character varying(15) NOT NULL,
    tanggal date NOT NULL,
    nomor_dokumen character varying(60) NOT NULL,
    no_faktur_vendor character varying(35) NOT NULL,
    jatuh_tempo date NOT NULL,
    jumlah numeric(19,4) NOT NULL,
    sisa numeric(19,4) NOT NULL,
    ditutup_oleh_entri_id uuid,
    ditutup_pada timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ap_tr_entri_utang_pkey PRIMARY KEY (id),
    CONSTRAINT ap_tr_entri_utang_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT ap_tr_entri_utang_jenis_check CHECK (
        (jenis = 'faktur' AND jumlah >= 0 AND sisa >= 0 AND sisa <= jumlah)
        OR (jenis = 'pembatalan' AND jumlah <= 0 AND sisa = 0)),
    CONSTRAINT ap_tr_entri_utang_tutup_check CHECK ((sisa = 0) = (ditutup_pada IS NOT NULL)),
    CONSTRAINT ap_tr_entri_utang_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ap_tr_entri_utang_faktur_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, faktur_id)
        REFERENCES public.ap_tr_faktur(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT ap_tr_entri_utang_ditutup_oleh_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, ditutup_oleh_entri_id)
        REFERENCES public.ap_tr_entri_utang(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
-- Satu entri faktur per faktur: posting yang diulang tidak bisa menulis utang kedua.
CREATE UNIQUE INDEX ap_tr_entri_utang_faktur_unique
    ON public.ap_tr_entri_utang USING btree (tenant_id, faktur_id, jenis);
CREATE INDEX ap_tr_entri_utang_terbuka_index
    ON public.ap_tr_entri_utang USING btree (tenant_id, legal_entity_id, vendor_id, jatuh_tempo) WHERE (sisa <> 0);

-- 4. Reference nomor -----------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a9105-3c6e-7d21-8f4a-6b2e1c0d7a03', 'core', 'core.purchase-invoice-number',
        'Nomor faktur pembelian', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PI-"},{"type":"number","length":8}]}',
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
WHERE r.code = 'core.purchase-invoice-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 5. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['ap_tr_faktur', 'ap_tr_faktur_detail', 'ap_tr_entri_utang']
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

-- Dokumen transaksi dan ledger tidak pernah dicatat bawaan (0066); tenant yang mau menyalakannya sendiri.
INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('ap_tr_faktur', 'Faktur pembelian'),
             ('ap_tr_faktur_detail', 'Baris faktur pembelian'),
             ('ap_tr_entri_utang', 'Entri utang vendor')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Katalog izin ----------------------------------------------------------------------------------------------------

-- Pola penerimaan barang: lihat, ubah draf, posting, dan batal posting sebagai izin terpisah, dengan batal posting di
-- duty kelola. Layar utang vendor memakai izin lihat faktur, karena isinya faktur yang sudah diposting.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.purchase-invoice.form', 'core', 'Layar faktur pembelian', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.purchase-invoice.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-invoice.read', 'read', 'Lihat faktur pembelian dan utang vendor'),
             ('core.purchase-invoice.update', 'update', 'Ubah draf faktur pembelian'),
             ('core.purchase-invoice.post', 'invoke', 'Posting faktur pembelian'),
             ('core.purchase-invoice.reverse', 'invoke', 'Batalkan posting faktur pembelian')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-invoice.view', 'Melihat faktur pembelian dan utang vendor'),
             ('core.purchase-invoice.maintain', 'Membuat dan mengubah draf faktur pembelian'),
             ('core.purchase-invoice.posting', 'Memposting faktur pembelian'),
             ('core.purchase-invoice.correction', 'Membatalkan posting faktur pembelian')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.purchase-invoice.view', 'core.purchase-invoice.read'),
       ('core.purchase-invoice.maintain', 'core.purchase-invoice.read'),
       ('core.purchase-invoice.maintain', 'core.purchase-invoice.update'),
       ('core.purchase-invoice.posting', 'core.purchase-invoice.read'),
       ('core.purchase-invoice.posting', 'core.purchase-invoice.post'),
       ('core.purchase-invoice.correction', 'core.purchase-invoice.read'),
       ('core.purchase-invoice.correction', 'core.purchase-invoice.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-invoice.inquire', 'Lihat faktur pembelian dan utang vendor'),
             ('core.purchase-invoice.manage', 'Kelola dan posting faktur pembelian')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Layar faktur membaca vendor, termin, penerimaan, barang, dan satuan yang dirujuknya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.purchase-invoice.inquire'), ('core.purchase-invoice.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.purchase-invoice.view'), ('core.vendor.view'), ('core.payment-terms.view'),
                   ('core.purchase-receipt.view'), ('core.inventory-item.view'), ('core.inventory-location.view'),
                   ('core.inventory-unit.view')) AS p(privilege)
UNION ALL
SELECT 'core.purchase-invoice.manage', p.privilege
FROM (VALUES ('core.purchase-invoice.maintain'), ('core.purchase-invoice.posting'),
             ('core.purchase-invoice.correction')) AS p(privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.purchase-invoice.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
