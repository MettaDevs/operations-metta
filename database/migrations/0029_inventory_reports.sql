-- Laporan persediaan (src/foundation/inventory/stock-by-location/ dan src/foundation/inventory/lplpo/) beserta setelan
-- yang dibacanya. Laporan dibaca langsung dari kartu gudang dengan agregat SQL; tidak ada stored procedure dan tidak
-- ada saldo yang disimpan.
--
-- 1. Stok minimum dan maksimum per barang per lokasi (Stockkeeping Unit di BC; legacy mBarangLokasiNew). Stok maksimum
--    menjadi stok optimum LPLPO. Baris ini setelan, bukan stok: lokasi tanpa baris tetap boleh menyimpan barang itu.
-- 2. Alasan penyesuaian yang mencatat stok keluar sebagai pemakaian (Consumption di BC), misalnya pemakaian unit.
--    Dokumen penyesuaian dengan alasan ini menulis jenis 'pemakaian' di kartu gudang, bukan penyesuaian, sehingga
--    LPLPO menghitungnya di kolom pemakaian. Alasan bawaan PEMAKAIAN ditandai, termasuk yang sudah lahir.
-- 3. Trigger versi, aktor, dan change log untuk setelan barang per lokasi.
-- 4. Katalog izin laporan. Role pemilik tenant yang sudah ada mendapat duty lihatnya, sama dengan role pemilik yang lahir
--    sesudah migration ini.

-- 1. Stok minimum dan maksimum per barang per lokasi -----------------------------------------------------------------

-- Isian kosong berarti tidak ditetapkan; sedikitnya satu dari keduanya diisi. Lokasi transit tidak boleh dipilih,
-- dijaga layanan karena kolom transit milik lokasi.
CREATE TABLE public.gd_m_barang_lokasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    stok_minimum numeric(18,4),
    stok_maksimum numeric(18,4),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_barang_lokasi_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_barang_lokasi_isi_check CHECK (stok_minimum IS NOT NULL OR stok_maksimum IS NOT NULL),
    CONSTRAINT gd_m_barang_lokasi_stok_check
        CHECK (stok_minimum >= 0 AND stok_maksimum >= 0 AND stok_maksimum >= stok_minimum),
    CONSTRAINT gd_m_barang_lokasi_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_lokasi_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_lokasi_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_barang_lokasi_unique
    ON public.gd_m_barang_lokasi USING btree (tenant_id, barang_id, lokasi_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_m_barang_lokasi_lokasi_index
    ON public.gd_m_barang_lokasi USING btree (tenant_id, lokasi_id) WHERE (deleted_at IS NULL);

-- 2. Alasan yang dicatat sebagai pemakaian ---------------------------------------------------------------------------

ALTER TABLE public.gd_m_alasan ADD COLUMN pemakaian boolean DEFAULT false NOT NULL;

UPDATE public.gd_m_alasan SET pemakaian = true WHERE kode = 'PEMAKAIAN' AND deleted_at IS NULL;

-- Sama dengan 0024, ditambah tanda pemakaian pada alasan bawaan PEMAKAIAN.
CREATE OR REPLACE FUNCTION public.gd_isi_acuan(p_tenant uuid, p_legal_entity uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.gd_m_parameter (id, tenant_id, legal_entity_id, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant, p_legal_entity, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
    ON CONFLICT (tenant_id, legal_entity_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.gd_m_alasan WHERE tenant_id = p_tenant AND legal_entity_id = p_legal_entity) THEN
        INSERT INTO public.gd_m_alasan (id, tenant_id, legal_entity_id, kode, nama, pemakaian, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, p_legal_entity, v.kode, v.nama, v.pemakaian, now() AT TIME ZONE 'utc',
               now() AT TIME ZONE 'utc'
        FROM (VALUES ('SALDO-AWAL', 'Saldo awal', false),
                     ('PEMAKAIAN', 'Pemakaian unit', true),
                     ('PEMUSNAHAN', 'Pemusnahan', false),
                     ('KEDALUWARSA', 'Kedaluwarsa', false)) AS v(kode, nama, pemakaian);
    END IF;
END;
$$;

-- 3. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.gd_m_barang_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.gd_m_barang_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.gd_m_barang_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'gd_m_barang_lokasi', 'Stok minimum dan maksimum barang per lokasi', 'all', 'all',
       'all', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'gd_m_barang_lokasi');

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.inventory-report.form', 'core', 'Layar laporan persediaan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.inventory-report.read', 'core', 'core.inventory-report.form', 'read',
        'Lihat laporan stok per lokasi dan LPLPO', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.inventory-report.view', 'core', 'Melihat laporan stok per lokasi dan LPLPO',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-report.view', 'core.inventory-report.read')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.inventory-report.inquire', 'core', 'Lihat laporan stok per lokasi dan LPLPO',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Saringan laporan memilih lokasi, operating unit, kategori, dan barang, jadi duty ini ikut membawa hak lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.inventory-report.inquire', 'core.inventory-report.view'),
       ('core.inventory-report.inquire', 'core.inventory-location.view'),
       ('core.inventory-report.inquire', 'core.inventory-category.view'),
       ('core.inventory-report.inquire', 'core.inventory-item.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.inventory-report.inquire'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
