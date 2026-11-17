-- Permintaan pembelian (src/foundation/purchasing/requisition/), pola Business Central: baris Requisition Worksheet
-- (tabel Requisition Line) yang diubah menjadi purchase order lewat Carry Out Action Message (report 493, codeunit
-- "Req. Wksh.-Make Order"). Lokasi atau unit mengajukan barang yang dibutuhkan; petugas pembelian mengisi vendor dan
-- harga, menandai baris yang disetujui (Accept Action Message), lalu Buat purchase order membuat satu order terbuka per
-- vendor dan lokasi. Nama tabel mengikuti nama legacy (BL_trPermintaan menjadi bl_tr_permintaan).
--
-- Bentuk sistem lama, satu dokumen permintaan dengan kepala dan detail yang berubah menjadi satu order, tidak dipakai.
-- Di data Adapotek setiap order berasal dari tepat satu permintaan (190.725 dan 190.725), jadi kepala permintaan hanya
-- menyalin kepala order. Lembar kerja baris BC membiarkan permintaan dari beberapa lokasi digabung ke satu vendor.
--
-- 1. Baris permintaan.
-- 2. Trigger versi, aktor, dan change log.
-- 3. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelola permintaan.

-- 1. Baris permintaan -----------------------------------------------------------------------------------------------

-- vendor_id dan harga_satuan diisi petugas pembelian (Vendor No. dan Direct Unit Cost). Harga kosong diisi harga
-- penerimaan terakhir barang itu saat order dibuat. order_detail_id terisi saat baris sudah menjadi baris order;
-- sesudah itu baris tidak bisa diubah, seperti baris yang dihapus BC sesudah Carry Out.
CREATE TABLE public.bl_tr_permintaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    tanggal_dibutuhkan date NOT NULL,
    keterangan character varying(200),
    diminta_oleh_user_id uuid NOT NULL,
    vendor_id uuid,
    harga_satuan numeric(18,4),
    disetujui boolean DEFAULT false NOT NULL,
    order_detail_id uuid,
    diproses_pada timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_permintaan_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_permintaan_konversi_check CHECK (konversi > 0),
    CONSTRAINT bl_tr_permintaan_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT bl_tr_permintaan_harga_satuan_check CHECK (harga_satuan IS NULL OR harga_satuan >= 0),
    CONSTRAINT bl_tr_permintaan_diproses_check CHECK ((order_detail_id IS NULL) = (diproses_pada IS NULL)),
    CONSTRAINT bl_tr_permintaan_hapus_check CHECK (deleted_at IS NULL OR order_detail_id IS NULL),
    CONSTRAINT bl_tr_permintaan_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_permintaan_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_permintaan_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_permintaan_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_permintaan_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_permintaan_order_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, order_detail_id)
        REFERENCES public.bl_tr_order_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX bl_tr_permintaan_terbuka_index
    ON public.bl_tr_permintaan USING btree (tenant_id, legal_entity_id, lokasi_id)
    WHERE (deleted_at IS NULL AND order_detail_id IS NULL);
CREATE INDEX bl_tr_permintaan_order_detail_index
    ON public.bl_tr_permintaan USING btree (tenant_id, order_detail_id) WHERE (order_detail_id IS NOT NULL);

-- 2. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.bl_tr_permintaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.bl_tr_permintaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.bl_tr_permintaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'bl_tr_permintaan', 'Permintaan pembelian', 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'bl_tr_permintaan');

-- 3. Katalog izin ----------------------------------------------------------------------------------------------------

-- Mengajukan dan memproses permintaan dua duty: petugas lokasi mengajukan, petugas pembelian menyetujui dan membuat
-- order. Vendor, harga, dan persetujuan hanya bisa diisi pemegang izin proses.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.purchase-requisition.form', 'core', 'Layar permintaan pembelian', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.purchase-requisition.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-requisition.read', 'read', 'Lihat permintaan pembelian'),
             ('core.purchase-requisition.update', 'update', 'Ajukan dan ubah permintaan pembelian'),
             ('core.purchase-requisition.process', 'invoke',
              'Setujui permintaan pembelian dan buat purchase order')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-requisition.view', 'Melihat permintaan pembelian'),
             ('core.purchase-requisition.maintain', 'Mengajukan dan mengubah permintaan pembelian'),
             ('core.purchase-requisition.processing', 'Menyetujui permintaan pembelian dan membuat purchase order'))
     AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.purchase-requisition.view', 'core.purchase-requisition.read'),
       ('core.purchase-requisition.maintain', 'core.purchase-requisition.read'),
       ('core.purchase-requisition.maintain', 'core.purchase-requisition.update'),
       ('core.purchase-requisition.processing', 'core.purchase-requisition.read'),
       ('core.purchase-requisition.processing', 'core.purchase-requisition.process')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-requisition.request', 'Ajukan permintaan pembelian'),
             ('core.purchase-requisition.manage', 'Proses permintaan pembelian menjadi purchase order')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.purchase-requisition.request'), ('core.purchase-requisition.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.purchase-requisition.maintain'), ('core.inventory-item.view'),
                   ('core.inventory-location.view'), ('core.inventory-unit.view')) AS p(privilege)
UNION ALL
SELECT 'core.purchase-requisition.manage', p.privilege
FROM (VALUES ('core.purchase-requisition.processing'), ('core.vendor.view'), ('core.purchase-order.maintain'))
     AS p(privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.purchase-requisition.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
