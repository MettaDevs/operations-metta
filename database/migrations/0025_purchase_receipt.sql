-- Penerimaan barang dari vendor (src/foundation/purchasing/), pola Business Central: Purchase Order lalu Post Receive
-- diringkas menjadi satu dokumen penerimaan tanpa PO. Nama tabel mengikuti nama legacy (BL_trPenerimaan dan
-- BL_trPenerimaanDetail menjadi bl_tr_penerimaan dan bl_tr_penerimaan_detail). Kiriman gudang farmasi kabupaten (IFK)
-- bukan penerimaan; kelak ia mutasi antar entitas hierarki.
--
-- 1. Satuan kemasan barang (Item Unit of Measure): satuan selain satuan dasar beserta isinya dalam satuan dasar.
-- 2. Sumber dana dan program pengadaan (mSumberDana, mProgramPengadaan): daftar kode per legal entity.
-- 3. Sumber dana, program, dan tahun anggaran di kartu gudang. Di data sistem lama, 6 dari 13 batch yang diterima
--    lebih dari sekali datang dengan sumber dana berbeda, jadi ketiganya melekat pada baris masuk, bukan pada gd_m_batch
--    seperti rencana di 0024. Baris keluar dan mutasi mewarisinya dari baris masuk yang diambil, sama dengan batch dan
--    harga.
-- 4. Vendor per legal entity: nomornya unik per legal entity, seperti company di BC.
-- 5. Dokumen penerimaan dan barisnya.
-- 6. Reference nomor penerimaan dan nomor vendor per legal entity.
-- 7. Trigger versi, aktor, dan change log.
-- 8. Katalog izin. Role pemilik tenant yang sudah ada mendapat duty kelola penerimaan.

-- 1. Satuan kemasan ------------------------------------------------------------------------------------------------

-- Satuan dasar tidak dicatat di sini; isinya selalu 1 dan dibaca dari gd_m_barang.satuan_dasar_id. Baris dokumen
-- menyalin konversi saat disimpan, jadi mengubah konversi tidak mengubah dokumen yang sudah ada.
CREATE TABLE public.gd_m_barang_satuan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_barang_satuan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_barang_satuan_konversi_check CHECK (konversi > 0),
    CONSTRAINT gd_m_barang_satuan_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_m_barang_satuan_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_barang_satuan_unique
    ON public.gd_m_barang_satuan USING btree (tenant_id, barang_id, satuan_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_m_barang_satuan_satuan_index
    ON public.gd_m_barang_satuan USING btree (tenant_id, satuan_id) WHERE (deleted_at IS NULL);

-- 2. Sumber dana dan program pengadaan -----------------------------------------------------------------------------

CREATE TABLE public.gd_m_sumber_dana (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_sumber_dana_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_sumber_dana_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_sumber_dana_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_sumber_dana_kode_unique
    ON public.gd_m_sumber_dana USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

CREATE TABLE public.gd_m_program_pengadaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_program_pengadaan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_program_pengadaan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_m_program_pengadaan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_program_pengadaan_kode_unique
    ON public.gd_m_program_pengadaan USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 3. Sumber dana, program, dan tahun anggaran di kartu gudang -------------------------------------------------------

ALTER TABLE public.gd_tr_kartu_gudang
    ADD COLUMN sumber_dana_id uuid,
    ADD COLUMN program_pengadaan_id uuid,
    ADD COLUMN tahun_anggaran smallint,
    ADD CONSTRAINT gd_tr_kartu_gudang_sumber_dana_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, sumber_dana_id)
        REFERENCES public.gd_m_sumber_dana(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT gd_tr_kartu_gudang_program_pengadaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, program_pengadaan_id)
        REFERENCES public.gd_m_program_pengadaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
CREATE INDEX gd_tr_kartu_gudang_sumber_dana_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, sumber_dana_id) WHERE (sumber_dana_id IS NOT NULL);
CREATE INDEX gd_tr_kartu_gudang_program_pengadaan_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, program_pengadaan_id) WHERE (program_pengadaan_id IS NOT NULL);

-- 4. Vendor per legal entity ---------------------------------------------------------------------------------------

-- Baseline CoreERP menjaga nomor vendor unik per tenant dan juga per legal entity. Nomor vendor kini terbit per legal
-- entity (reference di bawah), jadi hanya yang kedua dipertahankan. Kunci scope dipakai rujukan dokumen penerimaan.
DROP INDEX public.vendors_tenant_number_unique;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_scope_unique UNIQUE (tenant_id, legal_entity_id, id);

-- 5. Dokumen penerimaan --------------------------------------------------------------------------------------------

-- Draf boleh diubah dan dihapus; dokumen yang sudah diposting hanya bisa dibatalkan postingnya, selama stok yang
-- masuk belum dipakai. Operating unit mengikuti lokasi tujuan.
CREATE TABLE public.bl_tr_penerimaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    no_dokumen_vendor character varying(50),
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
    CONSTRAINT bl_tr_penerimaan_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_penerimaan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT bl_tr_penerimaan_status_check CHECK (status IN ('draf', 'diposting', 'dibatalkan')),
    CONSTRAINT bl_tr_penerimaan_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT bl_tr_penerimaan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_vendor_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, vendor_id) REFERENCES public.vendors(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bl_tr_penerimaan_nomor_unique
    ON public.bl_tr_penerimaan USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_penerimaan_vendor_index
    ON public.bl_tr_penerimaan USING btree (tenant_id, vendor_id) WHERE (deleted_at IS NULL);

-- jumlah dan harga_satuan dalam satuan baris; kartu gudang menerima jumlah x konversi dalam satuan dasar dan harga
-- per satuan dasar sesudah diskon. Batch dibuat mesin posting bila belum ada.
CREATE TABLE public.bl_tr_penerimaan_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    penerimaan_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah numeric(18,4) NOT NULL,
    harga_satuan numeric(18,4) NOT NULL,
    diskon_persen numeric(7,4) DEFAULT 0 NOT NULL,
    no_batch character varying(50),
    kedaluwarsa date,
    sumber_dana_id uuid,
    program_pengadaan_id uuid,
    tahun_anggaran smallint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bl_tr_penerimaan_detail_pkey PRIMARY KEY (id),
    CONSTRAINT bl_tr_penerimaan_detail_konversi_check CHECK (konversi > 0),
    CONSTRAINT bl_tr_penerimaan_detail_jumlah_check CHECK (jumlah > 0),
    CONSTRAINT bl_tr_penerimaan_detail_harga_satuan_check CHECK (harga_satuan >= 0),
    CONSTRAINT bl_tr_penerimaan_detail_diskon_check CHECK (diskon_persen >= 0 AND diskon_persen <= 100),
    CONSTRAINT bl_tr_penerimaan_detail_kedaluwarsa_check CHECK (kedaluwarsa IS NULL OR no_batch IS NOT NULL),
    CONSTRAINT bl_tr_penerimaan_detail_tahun_anggaran_check CHECK (tahun_anggaran BETWEEN 1900 AND 2999),
    CONSTRAINT bl_tr_penerimaan_detail_penerimaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, penerimaan_id)
        REFERENCES public.bl_tr_penerimaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_detail_sumber_dana_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, sumber_dana_id)
        REFERENCES public.gd_m_sumber_dana(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bl_tr_penerimaan_detail_program_pengadaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, program_pengadaan_id)
        REFERENCES public.gd_m_program_pengadaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX bl_tr_penerimaan_detail_penerimaan_index
    ON public.bl_tr_penerimaan_detail USING btree (tenant_id, penerimaan_id) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_penerimaan_detail_barang_index
    ON public.bl_tr_penerimaan_detail USING btree (tenant_id, barang_id) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_penerimaan_detail_sumber_dana_index
    ON public.bl_tr_penerimaan_detail USING btree (tenant_id, sumber_dana_id) WHERE (deleted_at IS NULL);
CREATE INDEX bl_tr_penerimaan_detail_program_pengadaan_index
    ON public.bl_tr_penerimaan_detail USING btree (tenant_id, program_pengadaan_id) WHERE (deleted_at IS NULL);

-- 6. Reference nomor -----------------------------------------------------------------------------------------------

-- Satu sequence per legal entity untuk masing-masing, dibuat NumberSequences.createLegalEntityDefaults saat legal
-- entity lahir; legal entity yang sudah ada mendapatnya di bawah dengan setelan yang sama.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d10e-58f3-7b1e-9a7c-1c0f6a2e4b01', 'core', 'core.purchase-receipt-number',
        'Nomor penerimaan barang', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PNR-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1d10e-58f3-7b1e-9a7c-1c0f6a2e4b02', 'core', 'core.vendor-number',
        'Nomor vendor', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"VND-"},{"type":"number","length":8}]}',
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
WHERE r.code IN ('core.purchase-receipt-number', 'core.vendor-number')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 7. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gd_m_barang_satuan', 'gd_m_sumber_dana', 'gd_m_program_pengadaan',
                             'bl_tr_penerimaan', 'bl_tr_penerimaan_detail']
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
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('gd_m_barang_satuan', 'Satuan kemasan barang'),
             ('gd_m_sumber_dana', 'Sumber dana'),
             ('gd_m_program_pengadaan', 'Program pengadaan'),
             ('bl_tr_penerimaan', 'Penerimaan barang'),
             ('bl_tr_penerimaan_detail', 'Baris penerimaan barang')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 8. Katalog izin ----------------------------------------------------------------------------------------------------

-- Satuan kemasan bagian dari kartu barang (Item Units of Measure di BC), jadi memakai izin barang.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
SELECT e.code, 'core', e.name, 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-funding-source.form', 'Layar sumber dana'),
             ('core.inventory-procurement-program.form', 'Layar program pengadaan'),
             ('core.purchase-receipt.form', 'Layar penerimaan barang')) AS e(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-funding-source.read', 'core.inventory-funding-source.form', 'read', 'Lihat sumber dana'),
             ('core.inventory-funding-source.update', 'core.inventory-funding-source.form', 'update',
              'Ubah sumber dana'),
             ('core.inventory-procurement-program.read', 'core.inventory-procurement-program.form', 'read',
              'Lihat program pengadaan'),
             ('core.inventory-procurement-program.update', 'core.inventory-procurement-program.form', 'update',
              'Ubah program pengadaan'),
             ('core.purchase-receipt.read', 'core.purchase-receipt.form', 'read', 'Lihat penerimaan barang'),
             ('core.purchase-receipt.update', 'core.purchase-receipt.form', 'update',
              'Ubah draf penerimaan barang'),
             ('core.purchase-receipt.post', 'core.purchase-receipt.form', 'invoke', 'Posting penerimaan barang'),
             ('core.purchase-receipt.reverse', 'core.purchase-receipt.form', 'correct',
              'Batalkan posting penerimaan barang')) AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-funding-source.view', 'Melihat sumber dana'),
             ('core.inventory-funding-source.maintain', 'Memelihara sumber dana'),
             ('core.inventory-procurement-program.view', 'Melihat program pengadaan'),
             ('core.inventory-procurement-program.maintain', 'Memelihara program pengadaan'),
             ('core.purchase-receipt.view', 'Melihat penerimaan barang'),
             ('core.purchase-receipt.maintain', 'Membuat dan mengubah draf penerimaan barang'),
             ('core.purchase-receipt.posting', 'Memposting penerimaan barang'),
             ('core.purchase-receipt.correction', 'Membatalkan posting penerimaan barang')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-funding-source.view', 'core.inventory-funding-source.read'),
       ('core.inventory-funding-source.maintain', 'core.inventory-funding-source.read'),
       ('core.inventory-funding-source.maintain', 'core.inventory-funding-source.update'),
       ('core.inventory-procurement-program.view', 'core.inventory-procurement-program.read'),
       ('core.inventory-procurement-program.maintain', 'core.inventory-procurement-program.read'),
       ('core.inventory-procurement-program.maintain', 'core.inventory-procurement-program.update'),
       ('core.purchase-receipt.view', 'core.purchase-receipt.read'),
       ('core.purchase-receipt.maintain', 'core.purchase-receipt.read'),
       ('core.purchase-receipt.maintain', 'core.purchase-receipt.update'),
       ('core.purchase-receipt.posting', 'core.purchase-receipt.read'),
       ('core.purchase-receipt.posting', 'core.purchase-receipt.post'),
       ('core.purchase-receipt.correction', 'core.purchase-receipt.read'),
       ('core.purchase-receipt.correction', 'core.purchase-receipt.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.purchase-receipt.inquire', 'Lihat penerimaan barang'),
             ('core.purchase-receipt.manage', 'Kelola dan posting penerimaan barang')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Sumber dana dan program ikut setelan master persediaan. Layar penerimaan membaca vendor, barang, lokasi, satuan,
-- sumber dana, dan program yang dirujuknya, jadi duty penerimaan ikut membawa hak lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.inventory-setup.inquire', 'core.inventory-funding-source.view'),
       ('core.inventory-setup.inquire', 'core.inventory-procurement-program.view'),
       ('core.inventory-setup.manage', 'core.inventory-funding-source.maintain'),
       ('core.inventory-setup.manage', 'core.inventory-procurement-program.maintain'),
       ('core.purchase-receipt.inquire', 'core.purchase-receipt.view'),
       ('core.purchase-receipt.inquire', 'core.vendor.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-item.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-location.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-unit.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-funding-source.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-procurement-program.view'),
       ('core.purchase-receipt.inquire', 'core.inventory-stock.view'),
       ('core.purchase-receipt.manage', 'core.purchase-receipt.maintain'),
       ('core.purchase-receipt.manage', 'core.purchase-receipt.posting'),
       ('core.purchase-receipt.manage', 'core.purchase-receipt.correction'),
       ('core.purchase-receipt.manage', 'core.vendor.view'),
       ('core.purchase-receipt.manage', 'core.inventory-item.view'),
       ('core.purchase-receipt.manage', 'core.inventory-location.view'),
       ('core.purchase-receipt.manage', 'core.inventory-unit.view'),
       ('core.purchase-receipt.manage', 'core.inventory-funding-source.view'),
       ('core.purchase-receipt.manage', 'core.inventory-procurement-program.view'),
       ('core.purchase-receipt.manage', 'core.inventory-stock.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('core.vendor.manage'), ('core.purchase-receipt.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
