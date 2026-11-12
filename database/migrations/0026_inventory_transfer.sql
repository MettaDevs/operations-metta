-- Amprah dan mutasi antar lokasi (src/foundation/inventory/transfer/), pola Transfer Order Business Central. Nama tabel
-- mengikuti nama legacy (GD_trAmprahan, GD_trMutasi beserta detailnya). Di sistem lama amprah, mutasi, proses, dan
-- posting dijaga bendera status di beberapa tabel; di sini amprah adalah satu dokumen yang dikirim dan diterima
-- sebagian, berkali-kali, dan setiap posting menjadi dokumen terposting sendiri.
--
-- 1. Amprah (Transfer Order): lokasi peminta meminta barang dari lokasi pemasok. Barisnya mencatat jumlah diminta,
--    dikirim, dan diterima secara kumulatif, serta jumlah yang akan dikirim dan diterima pada posting berikutnya.
-- 2. Mutasi (Posted Transfer Shipment): satu dokumen per posting kirim. Barisnya batch, kedaluwarsa, sumber dana,
--    program, dan tahun anggaran yang benar-benar diambil mesin posting. Cara mutasinya dicatat saat posting: langsung
--    memindahkan stok pemasok ke peminta dalam satu langkah, kirim-terima memindahkannya ke lokasi transit lebih dulu.
-- 3. Penerimaan mutasi (Posted Transfer Receipt): satu dokumen per posting terima dari lokasi transit.
-- 4. Reference nomor amprah, mutasi, dan penerimaan mutasi per legal entity.
-- 5. Trigger versi, aktor, dan change log. Baris dokumen terposting hanya boleh ditambah.
-- 6. Katalog izin: meminta, mengirim, menerima, dan membatalkan posting dipisah. Role pemilik tenant yang sudah ada
--    mendapat duty kelola.
--
-- BC menghapus Transfer Order setelah diterima penuh. Di sini amprah tidak pernah dihapus sesudah diajukan: statusnya
-- menjadi selesai, supaya jumlah yang diminta tetapi tidak dikirim tetap terbaca untuk audit dan LPLPO.
--
-- Baris kartu gudang dari mutasi dan penerimaan mutasi menunjuk baris amprah lewat sumber_baris_id (Order Line No. di
-- BC), karena baris mutasi baru lahir dari hasil pengambilan mesin. Stok di lokasi transit milik satu baris amprah
-- dikenali dari sumber_baris_id itu, sehingga penerimaan tidak pernah mengambil barang amprah lain.

-- 1. Amprah ----------------------------------------------------------------------------------------------------------

CREATE TABLE public.gd_tr_amprahan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    lokasi_peminta_id uuid NOT NULL,
    lokasi_pemasok_id uuid NOT NULL,
    -- Wajib saat posting kirim bila cara mutasi lokasi pemasok kirim-terima; kosong bila langsung.
    lokasi_transit_id uuid,
    keterangan character varying(200),
    status character varying(15) DEFAULT 'draf' NOT NULL,
    diajukan_pada timestamp(0) without time zone,
    diajukan_oleh_user_id uuid,
    ditutup_pada timestamp(0) without time zone,
    ditutup_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_amprahan_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_amprahan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_amprahan_status_check CHECK (status IN ('draf', 'diajukan', 'selesai', 'dibatalkan')),
    CONSTRAINT gd_tr_amprahan_hapus_check CHECK (deleted_at IS NULL OR status = 'draf'),
    CONSTRAINT gd_tr_amprahan_lokasi_check CHECK (lokasi_peminta_id <> lokasi_pemasok_id),
    CONSTRAINT gd_tr_amprahan_transit_check
        CHECK (lokasi_transit_id IS NULL
               OR (lokasi_transit_id <> lokasi_peminta_id AND lokasi_transit_id <> lokasi_pemasok_id)),
    CONSTRAINT gd_tr_amprahan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_lokasi_peminta_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_peminta_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_lokasi_pemasok_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_pemasok_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_lokasi_transit_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_transit_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_tr_amprahan_nomor_unique
    ON public.gd_tr_amprahan USING btree (tenant_id, legal_entity_id, nomor) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_amprahan_lokasi_peminta_index
    ON public.gd_tr_amprahan USING btree (tenant_id, lokasi_peminta_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_amprahan_lokasi_pemasok_index
    ON public.gd_tr_amprahan USING btree (tenant_id, lokasi_pemasok_id) WHERE (deleted_at IS NULL);

-- Jumlah dalam satuan baris; kartu gudang menerima jumlah x konversi dalam satuan dasar. Konversi disalin saat disimpan.
-- Yang dikirim tidak pernah melebihi yang diminta, dan yang diterima tidak pernah melebihi yang dikirim: selisih
-- keduanya adalah barang yang masih di lokasi transit.
CREATE TABLE public.gd_tr_amprahan_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    amprahan_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah_diminta numeric(18,4) NOT NULL,
    jumlah_dikirim numeric(18,4) DEFAULT 0 NOT NULL,
    jumlah_diterima numeric(18,4) DEFAULT 0 NOT NULL,
    jumlah_akan_dikirim numeric(18,4) DEFAULT 0 NOT NULL,
    jumlah_akan_diterima numeric(18,4) DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_amprahan_detail_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_amprahan_detail_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_amprahan_detail_konversi_check CHECK (konversi > 0),
    CONSTRAINT gd_tr_amprahan_detail_diminta_check CHECK (jumlah_diminta > 0),
    CONSTRAINT gd_tr_amprahan_detail_kumulatif_check
        CHECK (jumlah_diterima >= 0 AND jumlah_diterima <= jumlah_dikirim AND jumlah_dikirim <= jumlah_diminta),
    CONSTRAINT gd_tr_amprahan_detail_akan_check CHECK (jumlah_akan_dikirim >= 0 AND jumlah_akan_diterima >= 0),
    CONSTRAINT gd_tr_amprahan_detail_amprahan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_id)
        REFERENCES public.gd_tr_amprahan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_amprahan_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX gd_tr_amprahan_detail_amprahan_index
    ON public.gd_tr_amprahan_detail USING btree (tenant_id, amprahan_id) WHERE (deleted_at IS NULL);
CREATE INDEX gd_tr_amprahan_detail_barang_index
    ON public.gd_tr_amprahan_detail USING btree (tenant_id, barang_id) WHERE (deleted_at IS NULL);

-- 2. Mutasi ----------------------------------------------------------------------------------------------------------

-- Dokumen terposting tidak pernah dihapus, hanya dibatalkan postingnya, jadi tidak punya deleted_at dan nomornya unik
-- penuh. versi_amprahan adalah versi amprah yang diposting: posting yang diulang dengan versi yang sama menemukan
-- dokumen ini dan tidak menulis apa pun.
CREATE TABLE public.gd_tr_mutasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    amprahan_id uuid NOT NULL,
    versi_amprahan integer NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    lokasi_asal_id uuid NOT NULL,
    lokasi_tujuan_id uuid NOT NULL,
    lokasi_transit_id uuid,
    cara_mutasi character varying(15) NOT NULL,
    status character varying(15) DEFAULT 'diposting' NOT NULL,
    diposting_pada timestamp(0) without time zone NOT NULL,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_mutasi_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_mutasi_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_mutasi_versi_unique UNIQUE (tenant_id, amprahan_id, versi_amprahan),
    CONSTRAINT gd_tr_mutasi_nomor_unique UNIQUE (tenant_id, legal_entity_id, nomor),
    CONSTRAINT gd_tr_mutasi_cara_mutasi_check CHECK (cara_mutasi IN ('langsung', 'kirim_terima')),
    CONSTRAINT gd_tr_mutasi_transit_check CHECK ((cara_mutasi = 'kirim_terima') = (lokasi_transit_id IS NOT NULL)),
    CONSTRAINT gd_tr_mutasi_status_check CHECK (status IN ('diposting', 'dibatalkan')),
    CONSTRAINT gd_tr_mutasi_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_amprahan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_id)
        REFERENCES public.gd_tr_amprahan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_lokasi_asal_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_asal_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_lokasi_tujuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_tujuan_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_lokasi_transit_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_transit_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX gd_tr_mutasi_amprahan_index ON public.gd_tr_mutasi USING btree (tenant_id, amprahan_id);

-- Satu baris per baris amprah, batch, dan sumber dana yang diambil, dalam satuan dasar. Satuan dan konversi baris
-- amprah disalin untuk tampilan.
CREATE TABLE public.gd_tr_mutasi_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    mutasi_id uuid NOT NULL,
    amprahan_detail_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah_dasar numeric(18,4) NOT NULL,
    batch_id uuid,
    kedaluwarsa date,
    sumber_dana_id uuid,
    program_pengadaan_id uuid,
    tahun_anggaran smallint,
    nilai numeric(18,2) NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    created_by_user_id uuid,
    CONSTRAINT gd_tr_mutasi_detail_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_mutasi_detail_jumlah_check CHECK (jumlah_dasar > 0),
    CONSTRAINT gd_tr_mutasi_detail_mutasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, mutasi_id)
        REFERENCES public.gd_tr_mutasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_amprahan_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_detail_id)
        REFERENCES public.gd_tr_amprahan_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_sumber_dana_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, sumber_dana_id)
        REFERENCES public.gd_m_sumber_dana(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_detail_program_pengadaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, program_pengadaan_id)
        REFERENCES public.gd_m_program_pengadaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX gd_tr_mutasi_detail_mutasi_index ON public.gd_tr_mutasi_detail USING btree (tenant_id, mutasi_id);
CREATE INDEX gd_tr_mutasi_detail_amprahan_detail_index
    ON public.gd_tr_mutasi_detail USING btree (tenant_id, amprahan_detail_id);

-- 3. Penerimaan mutasi -----------------------------------------------------------------------------------------------

CREATE TABLE public.gd_tr_mutasi_terima (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    amprahan_id uuid NOT NULL,
    versi_amprahan integer NOT NULL,
    nomor character varying(60) NOT NULL,
    tanggal date NOT NULL,
    lokasi_transit_id uuid NOT NULL,
    lokasi_tujuan_id uuid NOT NULL,
    status character varying(15) DEFAULT 'diposting' NOT NULL,
    diposting_pada timestamp(0) without time zone NOT NULL,
    diposting_oleh_user_id uuid,
    dibatalkan_pada timestamp(0) without time zone,
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_tr_mutasi_terima_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_mutasi_terima_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT gd_tr_mutasi_terima_versi_unique UNIQUE (tenant_id, amprahan_id, versi_amprahan),
    CONSTRAINT gd_tr_mutasi_terima_nomor_unique UNIQUE (tenant_id, legal_entity_id, nomor),
    CONSTRAINT gd_tr_mutasi_terima_status_check CHECK (status IN ('diposting', 'dibatalkan')),
    CONSTRAINT gd_tr_mutasi_terima_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_amprahan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_id)
        REFERENCES public.gd_tr_amprahan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_lokasi_transit_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_transit_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_lokasi_tujuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_tujuan_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX gd_tr_mutasi_terima_amprahan_index ON public.gd_tr_mutasi_terima USING btree (tenant_id, amprahan_id);

CREATE TABLE public.gd_tr_mutasi_terima_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    mutasi_terima_id uuid NOT NULL,
    amprahan_detail_id uuid NOT NULL,
    urutan smallint NOT NULL,
    barang_id uuid NOT NULL,
    satuan_id uuid NOT NULL,
    konversi numeric(18,4) NOT NULL,
    jumlah_dasar numeric(18,4) NOT NULL,
    batch_id uuid,
    kedaluwarsa date,
    sumber_dana_id uuid,
    program_pengadaan_id uuid,
    tahun_anggaran smallint,
    nilai numeric(18,2) NOT NULL,
    created_at timestamp(0) without time zone NOT NULL,
    created_by_user_id uuid,
    CONSTRAINT gd_tr_mutasi_terima_detail_pkey PRIMARY KEY (id),
    CONSTRAINT gd_tr_mutasi_terima_detail_jumlah_check CHECK (jumlah_dasar > 0),
    CONSTRAINT gd_tr_mutasi_terima_detail_mutasi_terima_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, mutasi_terima_id)
        REFERENCES public.gd_tr_mutasi_terima(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_amprahan_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, amprahan_detail_id)
        REFERENCES public.gd_tr_amprahan_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, satuan_id) REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_batch_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, batch_id) REFERENCES public.gd_m_batch(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_sumber_dana_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, sumber_dana_id)
        REFERENCES public.gd_m_sumber_dana(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_tr_mutasi_terima_detail_program_pengadaan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, program_pengadaan_id)
        REFERENCES public.gd_m_program_pengadaan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX gd_tr_mutasi_terima_detail_mutasi_terima_index
    ON public.gd_tr_mutasi_terima_detail USING btree (tenant_id, mutasi_terima_id);
CREATE INDEX gd_tr_mutasi_terima_detail_amprahan_detail_index
    ON public.gd_tr_mutasi_terima_detail USING btree (tenant_id, amprahan_detail_id);

-- Stok transit satu baris amprah dicari lewat baris amprahnya.
CREATE INDEX gd_tr_kartu_gudang_sumber_baris_index
    ON public.gd_tr_kartu_gudang USING btree (tenant_id, sumber_baris_id) WHERE (sisa > 0);

-- 4. Reference nomor -------------------------------------------------------------------------------------------------

-- Satu sequence per legal entity untuk masing-masing, dibuat NumberSequences.createLegalEntityDefaults saat legal
-- entity lahir; legal entity yang sudah ada mendapatnya di bawah dengan setelan yang sama.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d3a0-6c2e-7d41-9b8e-5f3c2a1d0e01', 'core', 'core.inventory-transfer-order-number',
        'Nomor amprah', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"AMP-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1d3a0-6c2e-7d41-9b8e-5f3c2a1d0e02', 'core', 'core.inventory-transfer-shipment-number',
        'Nomor mutasi', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"MUT-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('01a1d3a0-6c2e-7d41-9b8e-5f3c2a1d0e03', 'core', 'core.inventory-transfer-receipt-number',
        'Nomor penerimaan mutasi', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"TRM-"},{"type":"number","length":8}]}',
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
WHERE r.code IN ('core.inventory-transfer-order-number', 'core.inventory-transfer-shipment-number',
                 'core.inventory-transfer-receipt-number')
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 5. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['gd_tr_amprahan', 'gd_tr_amprahan_detail', 'gd_tr_mutasi', 'gd_tr_mutasi_terima']
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

-- Baris dokumen terposting adalah catatan, seperti kartu gudang: hanya boleh ditambah.
CREATE TRIGGER tolak_ubah BEFORE UPDATE OR DELETE ON public.gd_tr_mutasi_detail
    FOR EACH ROW EXECUTE FUNCTION public.gd_tolak_ubah();
CREATE TRIGGER tolak_ubah BEFORE UPDATE OR DELETE ON public.gd_tr_mutasi_terima_detail
    FOR EACH ROW EXECUTE FUNCTION public.gd_tolak_ubah();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('gd_tr_amprahan', 'Amprah'),
             ('gd_tr_amprahan_detail', 'Baris amprah'),
             ('gd_tr_mutasi', 'Mutasi'),
             ('gd_tr_mutasi_terima', 'Penerimaan mutasi')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Katalog izin ----------------------------------------------------------------------------------------------------

-- Lokasi peminta membuat dan mengajukan amprah, lokasi pemasok memposting kirim, dan lokasi peminta memposting terima;
-- ketiganya hak yang terpisah. Membatasi pengguna ke amprah lokasinya sendiri belum ada.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.inventory-transfer.form', 'core', 'Layar amprah dan mutasi', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.inventory-transfer.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-transfer.read', 'read', 'Lihat amprah dan mutasi'),
             ('core.inventory-transfer.update', 'update', 'Buat, ajukan, tutup, dan batalkan amprah'),
             ('core.inventory-transfer.ship', 'invoke', 'Posting kirim mutasi'),
             ('core.inventory-transfer.receive', 'invoke', 'Posting terima mutasi'),
             ('core.inventory-transfer.reverse', 'correct', 'Batalkan posting mutasi dan penerimaannya'))
     AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-transfer.view', 'Melihat amprah dan mutasi'),
             ('core.inventory-transfer.maintain', 'Membuat dan mengajukan amprah'),
             ('core.inventory-transfer.shipping', 'Memposting kirim mutasi'),
             ('core.inventory-transfer.receiving', 'Memposting terima mutasi'),
             ('core.inventory-transfer.correction', 'Membatalkan posting mutasi dan penerimaannya')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.inventory-transfer.view', 'core.inventory-transfer.read'),
       ('core.inventory-transfer.maintain', 'core.inventory-transfer.read'),
       ('core.inventory-transfer.maintain', 'core.inventory-transfer.update'),
       ('core.inventory-transfer.shipping', 'core.inventory-transfer.read'),
       ('core.inventory-transfer.shipping', 'core.inventory-transfer.ship'),
       ('core.inventory-transfer.receiving', 'core.inventory-transfer.read'),
       ('core.inventory-transfer.receiving', 'core.inventory-transfer.receive'),
       ('core.inventory-transfer.correction', 'core.inventory-transfer.read'),
       ('core.inventory-transfer.correction', 'core.inventory-transfer.reverse')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'core', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.inventory-transfer.inquire', 'Lihat amprah dan mutasi'),
             ('core.inventory-transfer.request', 'Minta barang lewat amprah dan terima kirimannya'),
             ('core.inventory-transfer.ship', 'Kirim barang yang diminta amprah'),
             ('core.inventory-transfer.manage', 'Kelola amprah, mutasi, dan pembatalan postingnya')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

-- Layar amprah membaca barang, lokasi, satuan, dan stok yang dirujuknya, jadi setiap duty ikut membawa hak lihatnya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
SELECT d.duty, p.privilege
FROM (VALUES ('core.inventory-transfer.inquire'), ('core.inventory-transfer.request'),
             ('core.inventory-transfer.ship'), ('core.inventory-transfer.manage')) AS d(duty)
CROSS JOIN (VALUES ('core.inventory-transfer.view'), ('core.inventory-item.view'),
                   ('core.inventory-location.view'), ('core.inventory-unit.view'),
                   ('core.inventory-stock.view')) AS p(privilege)
UNION ALL
SELECT d.duty, d.privilege
FROM (VALUES ('core.inventory-transfer.request', 'core.inventory-transfer.maintain'),
             ('core.inventory-transfer.request', 'core.inventory-transfer.receiving'),
             ('core.inventory-transfer.ship', 'core.inventory-transfer.shipping'),
             ('core.inventory-transfer.manage', 'core.inventory-transfer.maintain'),
             ('core.inventory-transfer.manage', 'core.inventory-transfer.shipping'),
             ('core.inventory-transfer.manage', 'core.inventory-transfer.receiving'),
             ('core.inventory-transfer.manage', 'core.inventory-transfer.correction')) AS d(duty, privilege)
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.inventory-transfer.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
