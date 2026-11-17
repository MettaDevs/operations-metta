-- Purchase order ke vendor (src/foundation/purchasing/purchase-order/), pola Business Central: Purchase Header dan
-- Purchase Line berjenis Order, dengan status Open dan Released (codeunit 415 "Release Purchase Document"). Nama tabel
-- mengikuti nama legacy (BL_trOrder dan BL_trOrderDetail menjadi bl_tr_order dan bl_tr_order_detail). Di data apotek
-- Adapotek setiap penerimaan berasal dari order (191.634 penerimaan, 190.725 order), jadi penerimaan tanpa order tetap
-- ada untuk klinik yang tidak memesan lebih dulu.
--
-- Status terbuka berarti order masih boleh diubah; dirilis berarti isinya terkunci dan siap dikirim ke vendor serta
-- diterima. Buka lagi mengembalikan order dirilis ke terbuka, seperti Reopen di BC. Penerimaan dari order menyusul.
--
-- 1. Dokumen order dan barisnya.
-- 2. Reference nomor order per legal entity.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelola order.

-- 1. Dokumen order ---------------------------------------------------------------------------------------------------

-- tanggal_diharapkan di kepala adalah Expected Receipt Date bawaan; baris yang tanggalnya kosong mengikuti kepala.
-- Operating unit mengikuti lokasi tujuan, sama dengan penerimaan.
CREATE TABLE public.bl_tr_order (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    tanggal_diharapkan date,
    keterangan character varying(200),
    termasuk_ppn boolean DEFAULT false NOT NULL,
    status character varying(15) DEFAULT 'terbuka' NOT NULL,
    dirilis_pada timestamp(0) without time zone,
    dirilis_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_order_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_order_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bl_tr_order_status_check CHECK (status IN ('terbuka', 'dirilis')),
    CONSTRAINT bl_tr_order_hapus_check CHECK (deleted_at IS NULL OR status = 'terbuka'),
    CONSTRAINT bl_tr_order_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_order_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_order_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_order_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bl_tr_order_nomor_unique
    ON public.bl_tr_order USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_order_vendor_index
    ON public.bl_tr_order USING btree (tenant_id, vendor_id) WHERE (deleted_at IS NULL);

-- jumlah dan harga_satuan dalam satuan baris, sama dengan baris penerimaan; nilai baris dihitung saat dibaca.
CREATE TABLE public.bl_tr_order_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    order_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    harga_satuan numeric(18,4) NOT NULL,
    diskon_persen numeric(7,4) DEFAULT 0 NOT NULL,
    tarif_ppn numeric(7,4) DEFAULT 0 NOT NULL,
    tanggal_diharapkan date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_order_detail_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_order_detail_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bl_tr_order_detail_konversi_check CHECK (konversi > 0),
    CONSTRAINT bl_tr_order_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT bl_tr_order_detail_harga_satuan_check CHECK (harga_satuan >= 0),
    CONSTRAINT bl_tr_order_detail_diskon_check CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
    CONSTRAINT bl_tr_order_detail_tarif_ppn_check CHECK (tarif_ppn >= 0 AND tarif_ppn <= 100),
    CONSTRAINT bl_tr_order_detail_order_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, order_id)
        REFERENCES public.bl_tr_order(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_order_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_order_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX bl_tr_order_detail_order_index
    ON public.bl_tr_order_detail USING btree (tenant_id, order_id) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_order_detail_barang_index
    ON public.bl_tr_order_detail USING btree (tenant_id, barang_id) WHERE (deleted_at IS NULL);

-- 2. Reference nomor -----------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a9105-3c6e-7d21-8f4a-6b2e1c0d7a02', 'core', 'core.purchase-order-number',
        'Nomor purchase order', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PO-"},{"type":"number","length":8}]}',
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
WHERE r.code = 'core.purchase-order-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['bl_tr_order', 'bl_tr_order_detail']
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

-- Dokumen transaksi tidak pernah dicatat bawaan (0066); tenant yang mau menyalakannya sendiri.
INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('bl_tr_order', 'Purchase order'),
             ('bl_tr_order_detail', 'Baris purchase order')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

-- Rilis dan Buka lagi satu izin, seperti tombol Release dan Reopen yang berpasangan di Purchase Order BC.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.purchase-order.form', 'core', 'Layar purchase order', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.purchase-order.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-order.read', 'read', 'Lihat purchase order'),
             ('core.purchase-order.update', 'update', 'Ubah purchase order yang masih terbuka'),
             ('core.purchase-order.release', 'invoke', 'Rilis dan buka lagi purchase order')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-order.view', 'Melihat purchase order'),
             ('core.purchase-order.maintain', 'Membuat dan mengubah purchase order'),
             ('core.purchase-order.releasing', 'Merilis dan membuka lagi purchase order')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.purchase-order.view', 'core.purchase-order.read'),
       ('core.purchase-order.maintain', 'core.purchase-order.read'),
       ('core.purchase-order.maintain', 'core.purchase-order.update'),
       ('core.purchase-order.releasing', 'core.purchase-order.read'),
       ('core.purchase-order.releasing', 'core.purchase-order.release')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-order.inquire', 'Lihat purchase order'),
             ('core.purchase-order.manage', 'Kelola dan rilis purchase order')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Layar order membaca vendor, barang, lokasi, dan satuan yang dirujuknya, jadi duty order ikut membawa hak lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.purchase-order.inquire'), ('core.purchase-order.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.purchase-order.view'), ('core.vendor.view'), ('core.inventory-item.view'),
                   ('core.inventory-location.view'), ('core.inventory-unit.view')) AS p(privilege)
UNION ALL
SELECT 'core.purchase-order.manage', p.privilege
FROM (VALUES ('core.purchase-order.maintain'), ('core.purchase-order.releasing')) AS p(privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.purchase-order.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
