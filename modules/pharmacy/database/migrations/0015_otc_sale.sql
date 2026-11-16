-- Penjualan obat bebas di loket farmasi dalam satu langkah: petugas memilih obat, melihat total, menerima bayar, lalu
-- menyerahkan obatnya. Sistem lama punya satu "pembayaran obat bebas" yang mencampur penjualan dan pembayaran; di sini
-- polanya transaksi Commerce F&O (baris penjualan dan baris tender dalam satu transaksi) dan dokumen penjualan BC yang
-- dibayar saat diposting. Resep tetap dua langkah (Siapkan di farmasi, lalu kasir). Module ini tidak membaca module
-- layanan kesehatan, jadi apotek yang berdiri sendiri tanpa module itu bisa menjual obat bebas.
--
-- 1. far_m_lokasi_penjualan: lokasi stok yang boleh menjual obat bebas, dengan kelompok harga bawaannya. Baris hidup
--    berarti lokasi itu boleh menjual; menghapus barisnya (lunak) berarti tidak lagi. Kelompok harga kosong berarti
--    harga dasar, sama dengan resep tanpa kelompok harga.
-- 2. bill_farmasi menjadi dokumen penyerahan resep atau penjualan obat bebas. Penjualan obat bebas tidak punya resep;
--    ia membawa kelompok harga, Patient KTP, dan pembelinya sendiri, karena tidak ada resep yang menyimpannya. Ia lahir
--    langsung diserahkan dengan waktu dan pengguna siap dan serah yang sama, jadi tidak pernah draf, disiapkan, atau
--    dipanggil, dan tidak memakai nomor palsu di kolom mana pun. Constraint bill_farmasi_penjualan_check mengikat
--    kolom pembeli ke jenisnya.
-- 3. bill_farmasi_detail.resep_detail_id kosong untuk baris penjualan obat bebas.
-- 4. Katalog izin: loket penjualan obat bebas (lihat dan jual) dan setelan lokasinya. Duty loket baru; setelan lokasi
--    masuk duty setelan farmasi yang sudah ada. Role pemilik tenant yang sudah memasang module ini mendapat duty loket;
--    pemasangan berikutnya mendapatkannya lewat installModule, yang memberi semua duty module.
-- 5. Trigger versi, aktor, dan change log untuk tabel setelan.

-- 1. Lokasi penjualan obat bebas -----------------------------------------------------------------------------------

CREATE TABLE public.far_m_lokasi_penjualan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    kelompok_harga_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_lokasi_penjualan_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_lokasi_penjualan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_lokasi_penjualan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_lokasi_penjualan_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_m_lokasi_penjualan_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_lokasi_penjualan_lokasi_unique
    ON public.far_m_lokasi_penjualan USING btree (tenant_id, lokasi_id) WHERE (deleted_at IS NULL);

-- 2. Penjualan obat bebas di bill_farmasi -------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi
    ALTER COLUMN resep_id DROP NOT NULL,
    ADD COLUMN kelompok_harga_id uuid,
    ADD COLUMN pasien_ktp boolean,
    ADD COLUMN pembeli_pihak_id uuid,
    ADD COLUMN pembeli_nama character varying(255),
    ADD CONSTRAINT bill_farmasi_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT bill_farmasi_pembeli_foreign
        FOREIGN KEY (tenant_id, pembeli_pihak_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT bill_farmasi_penjualan_check CHECK (
        (resep_id IS NOT NULL
            AND kelompok_harga_id IS NULL AND pasien_ktp IS NULL AND pembeli_pihak_id IS NULL AND pembeli_nama IS NULL)
        OR (resep_id IS NULL AND pasien_ktp IS NOT NULL AND status IN ('diserahkan', 'dibatalkan')));

-- 3. Baris penjualan obat bebas -----------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi_detail ALTER COLUMN resep_detail_id DROP NOT NULL;

-- 4. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
SELECT e.code, 'pharmacy', e.name, 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.otc-sale.form', 'Layar penjualan obat bebas'),
             ('pharmacy.otc-sale-location.form', 'Layar lokasi penjualan obat bebas')) AS e(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.otc-sale.read', 'pharmacy.otc-sale.form', 'read', 'Lihat penjualan obat bebas'),
             ('pharmacy.otc-sale.post', 'pharmacy.otc-sale.form', 'invoke', 'Jual obat bebas'),
             ('pharmacy.otc-sale-location.read', 'pharmacy.otc-sale-location.form', 'read',
              'Lihat lokasi penjualan obat bebas'),
             ('pharmacy.otc-sale-location.update', 'pharmacy.otc-sale-location.form', 'update',
              'Ubah lokasi penjualan obat bebas')) AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.otc-sale.view', 'Melihat penjualan obat bebas'),
             ('pharmacy.otc-sale.selling', 'Menjual obat bebas di loket'),
             ('pharmacy.otc-sale-location.view', 'Melihat lokasi penjualan obat bebas'),
             ('pharmacy.otc-sale-location.maintain', 'Memelihara lokasi penjualan obat bebas')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.otc-sale.view', 'pharmacy.otc-sale.read'),
       ('pharmacy.otc-sale.selling', 'pharmacy.otc-sale.read'),
       ('pharmacy.otc-sale.selling', 'pharmacy.otc-sale.post'),
       ('pharmacy.otc-sale-location.view', 'pharmacy.otc-sale-location.read'),
       ('pharmacy.otc-sale-location.maintain', 'pharmacy.otc-sale-location.read'),
       ('pharmacy.otc-sale-location.maintain', 'pharmacy.otc-sale-location.update')
ON CONFLICT DO NOTHING;

-- Uangnya diterima lewat kasir Core di transaksi yang sama, jadi petugas loket juga butuh duty kasir Core (terima
-- pembayaran dan clerk). Duty ini hanya membuka loketnya.
INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('pharmacy.otc-sale.operate', 'pharmacy', 'Jual obat bebas di loket farmasi', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.otc-sale.operate', 'pharmacy.otc-sale.view'),
       ('pharmacy.otc-sale.operate', 'pharmacy.otc-sale.selling'),
       ('pharmacy.setup.inquire', 'pharmacy.otc-sale-location.view'),
       ('pharmacy.setup.manage', 'pharmacy.otc-sale-location.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'pharmacy.otc-sale.operate'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'pharmacy' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- 5. Trigger dan change log ----------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.far_m_lokasi_penjualan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.far_m_lokasi_penjualan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.far_m_lokasi_penjualan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'far_m_lokasi_penjualan', 'Lokasi penjualan obat bebas', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'far_m_lokasi_penjualan');
