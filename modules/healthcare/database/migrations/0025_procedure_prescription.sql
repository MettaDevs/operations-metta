-- Pemeriksaan rawat jalan tahap 2, bagian E3: panel Biaya Tindakan dan E-Resep tab "Rekam Medis" poli sistem lama
-- puskesmas (poly/views/form/rekammedis/Services.php dan Eresep/FormEresep.php, simpan di helpers/rekammedis_helper.php
-- dan helpers/eresep_helper.php), sesudah Prognosa seperti urutan aslinya. Keputusan pemilik produk, 12 November 2026.
--
-- Bedanya dengan sistem lama:
-- - Tarif tindakan belum dihitung dan tidak disimpan. Tarif dan tagihan menyusul bersama kasir (keputusan pemilik
--   produk). Sistem lama memilih fungsi tarif dari JenisKerjasamaID yang ditulis mati (2, 3, 4, 9).
-- - Master obat dibuat sekecil mungkin (kode opsional, nama, satuan, bentuk sediaan, aktif). Module farmasi kelak
--   mengambil alih. Belum ada stok, jadi tidak ada pemeriksaan stok.
-- - Aturan pakai (lima pilihan di FormEresep.php) dan satuan obat (mSatuan) menjadi data acuan per tenant. Bentuk
--   sediaan dan kelompok tindakan dimulai kosong; sistem lama tidak punya tabel bentuk sediaan, dan SIMmGroupJasa berisi
--   data klinik itu sendiri.
-- - Sistem lama mengirim resep ke farmasi saat Simpan Resep (Farmasi_SectionID = 'SEC025' ditulis mati). Di sini resep
--   disimpan sebagai draf bersama rekam medis, lalu dikirim lewat Kirim ke farmasi, yang memberi nomor resep.
-- - Racikan ditandai nomor racikan pada baris, seperti IDRacikan. Sistem lama membatasi Racikan 1 sampai 5 di view; di
--   sini nomornya tidak dibatasi.
-- - Alergi obat per pasien (SIMtrRiwayatAlergiObat) dan larangan obat ganda dan obat alergi diperiksa server. Sistem
--   lama hanya memeriksanya di peramban.
-- - Sistem lama menghapus fisik lalu menyisipkan ulang baris tindakan, resep, dan alergi obat. Di sini baris diubah di
--   tempat atau diberi deleted_at.
--
-- 1. Katalog izin.
-- 2. Data acuan: daftar pendek, sim_m_tindakan, sim_m_obat.
-- 3. Transaksi: sim_tr_pemeriksaan_tindakan, sim_m_pasien_alergi_obat, sim_tr_resep, sim_tr_resep_detail.
-- 4. Reference nomor resep.
-- 5. Trigger versi, aktor, dan change log.
-- 6. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya.
-- 7. Menu: Setup → Klinis.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.procedure.form', 'healthcare', 'Layar tindakan', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc'),
       ('healthcare.drug.form', 'healthcare', 'Layar obat', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.procedure.read', 'healthcare.procedure.form', 'read', 'Lihat tindakan'),
             ('healthcare.procedure.create', 'healthcare.procedure.form', 'create', 'Tambah tindakan'),
             ('healthcare.procedure.update', 'healthcare.procedure.form', 'update', 'Ubah tindakan'),
             ('healthcare.procedure.delete', 'healthcare.procedure.form', 'delete', 'Hapus tindakan'),
             ('healthcare.drug.read', 'healthcare.drug.form', 'read', 'Lihat obat'),
             ('healthcare.drug.create', 'healthcare.drug.form', 'create', 'Tambah obat'),
             ('healthcare.drug.update', 'healthcare.drug.form', 'update', 'Ubah obat'),
             ('healthcare.drug.delete', 'healthcare.drug.form', 'delete', 'Hapus obat')) AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.procedure.view', 'Melihat tindakan'),
             ('healthcare.procedure.register', 'Menambah tindakan dari pemeriksaan'),
             ('healthcare.procedure.maintain', 'Memelihara tindakan'),
             ('healthcare.procedure.retire', 'Menghapus tindakan'),
             ('healthcare.drug.view', 'Melihat obat'),
             ('healthcare.drug.register', 'Menambah obat dari pemeriksaan'),
             ('healthcare.drug.maintain', 'Memelihara obat'),
             ('healthcare.drug.retire', 'Menghapus obat')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.procedure.view', 'healthcare.procedure.read'),
       ('healthcare.procedure.register', 'healthcare.procedure.read'),
       ('healthcare.procedure.register', 'healthcare.procedure.create'),
       ('healthcare.procedure.maintain', 'healthcare.procedure.read'),
       ('healthcare.procedure.maintain', 'healthcare.procedure.create'),
       ('healthcare.procedure.maintain', 'healthcare.procedure.update'),
       ('healthcare.procedure.retire', 'healthcare.procedure.read'),
       ('healthcare.procedure.retire', 'healthcare.procedure.delete'),
       ('healthcare.drug.view', 'healthcare.drug.read'),
       ('healthcare.drug.register', 'healthcare.drug.read'),
       ('healthcare.drug.register', 'healthcare.drug.create'),
       ('healthcare.drug.maintain', 'healthcare.drug.read'),
       ('healthcare.drug.maintain', 'healthcare.drug.create'),
       ('healthcare.drug.maintain', 'healthcare.drug.update'),
       ('healthcare.drug.retire', 'healthcare.drug.read'),
       ('healthcare.drug.retire', 'healthcare.drug.delete')
ON CONFLICT DO NOTHING;

-- Setup klinis memelihara tindakan dan obat. Pemeriksa membacanya untuk mengisi baris, dan yang boleh memeriksa juga
-- boleh menambahnya dari baris tindakan dan resep, seperti ICD-10. Role yang sudah memegang duty itu ikut membawanya.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.clinical-setup.inquire', 'healthcare.procedure.view'),
       ('healthcare.clinical-setup.inquire', 'healthcare.drug.view'),
       ('healthcare.clinical-setup.manage', 'healthcare.procedure.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.procedure.retire'),
       ('healthcare.clinical-setup.manage', 'healthcare.drug.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.drug.retire'),
       ('healthcare.examination.inquire', 'healthcare.procedure.view'),
       ('healthcare.examination.inquire', 'healthcare.drug.view'),
       ('healthcare.examination.manage', 'healthcare.procedure.register'),
       ('healthcare.examination.manage', 'healthcare.drug.register')
ON CONFLICT DO NOTHING;

-- Daftar pendek baru memakai izin daftar diagnosa yang sama (lihat bagian 2), jadi namanya diperluas.
UPDATE public.permissions
SET name = CASE access_level WHEN 'read' THEN 'Lihat daftar pendek klinis'
                             WHEN 'create' THEN 'Tambah daftar pendek klinis'
                             WHEN 'update' THEN 'Ubah daftar pendek klinis'
                             ELSE 'Hapus daftar pendek klinis' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.diagnosis-reference.read', 'healthcare.diagnosis-reference.create',
               'healthcare.diagnosis-reference.update', 'healthcare.diagnosis-reference.delete');

UPDATE public.security_privileges
SET name = CASE code WHEN 'healthcare.diagnosis-reference.view' THEN 'Melihat daftar pendek klinis'
                     WHEN 'healthcare.diagnosis-reference.maintain' THEN 'Memelihara daftar pendek klinis'
                     ELSE 'Menghapus daftar pendek klinis' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.diagnosis-reference.view', 'healthcare.diagnosis-reference.maintain',
               'healthcare.diagnosis-reference.retire');

-- 2. Data acuan ----------------------------------------------------------------------------------------------------

-- Empat daftar pendek berbentuk sama dengan daftar diagnosa (0023): kelompok tindakan (SIMmGroupJasa), satuan obat
-- (mSatuan), bentuk sediaan, dan aturan pakai.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_tindakan_kelompok', 'sim_m_satuan_obat', 'sim_m_bentuk_sediaan', 'sim_m_aturan_pakai']
    LOOP
        EXECUTE format('CREATE TABLE public.%1$I (
                            id uuid NOT NULL,
                            tenant_id uuid NOT NULL,
                            kode character varying(40) NOT NULL,
                            nama character varying(150) NOT NULL,
                            urutan smallint DEFAULT 0 NOT NULL,
                            aktif boolean DEFAULT true NOT NULL,
                            created_at timestamp(0) without time zone,
                            updated_at timestamp(0) without time zone,
                            deleted_at timestamp(0) without time zone,
                            created_by_user_id uuid,
                            updated_by_user_id uuid,
                            version integer DEFAULT 1 NOT NULL,
                            CONSTRAINT %1$s_pkey PRIMARY KEY (id),
                            CONSTRAINT %1$s_tenant_id_id_unique UNIQUE (tenant_id, id))', t);
        EXECUTE format('CREATE UNIQUE INDEX %1$s_kode_unique ON public.%1$I USING btree (tenant_id, lower((kode)::text))
                            WHERE (deleted_at IS NULL)', t);
    END LOOP;
END;
$$;

-- Tindakan (SIMmListJasa): JasaID menjadi kode, JasaName menjadi nama, GroupJasaID menjadi kelompok. Tanpa tarif.
CREATE TABLE public.sim_m_tindakan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(200) NOT NULL,
    kelompok_id uuid,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tindakan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tindakan_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_tindakan_kelompok_foreign
        FOREIGN KEY (tenant_id, kelompok_id) REFERENCES public.sim_m_tindakan_kelompok(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tindakan_kode_unique
    ON public.sim_m_tindakan USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_kelompok_index
    ON public.sim_m_tindakan USING btree (tenant_id, kelompok_id) WHERE (deleted_at IS NULL);

-- Obat (mBarang), sekecil yang dibutuhkan resep: Kode_Barang (opsional), Nama_Barang, Stok_Satuan_ID (satuan yang
-- tampil di baris resep), bentuk sediaan, dan Aktif. Module farmasi kelak mengambil alih master ini.
CREATE TABLE public.sim_m_obat (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(30),
    nama character varying(200) NOT NULL,
    satuan_id uuid NOT NULL,
    bentuk_sediaan_id uuid,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_obat_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_obat_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_obat_satuan_foreign
        FOREIGN KEY (tenant_id, satuan_id) REFERENCES public.sim_m_satuan_obat(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_obat_bentuk_sediaan_foreign
        FOREIGN KEY (tenant_id, bentuk_sediaan_id) REFERENCES public.sim_m_bentuk_sediaan(tenant_id, id)
            ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_obat_kode_unique
    ON public.sim_m_obat USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL AND kode IS NOT NULL);
CREATE INDEX sim_m_obat_satuan_index
    ON public.sim_m_obat USING btree (tenant_id, satuan_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_obat_bentuk_sediaan_index
    ON public.sim_m_obat USING btree (tenant_id, bentuk_sediaan_id) WHERE (deleted_at IS NULL);

-- 3. Transaksi -----------------------------------------------------------------------------------------------------

-- Biaya Tindakan (SIMtrRJTransaksi) tanpa tarif. Satu tindakan sekali per pemeriksaan, seperti pesan sistem lama
-- "Biaya Tindakan %s sudah ada pada daftar Jasa", jadi baris dikenali dari tindakannya. Dokter mengikuti kolom Nama
-- Dokter sistem lama. Pengisi dan jamnya dibaca dari created_by_user_id dan created_at.
CREATE TABLE public.sim_tr_pemeriksaan_tindakan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    urutan smallint NOT NULL,
    tindakan_id uuid NOT NULL,
    jumlah integer DEFAULT 1 NOT NULL,
    dokter_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_tindakan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_tindakan_jumlah_check CHECK (jumlah >= 1),
    CONSTRAINT sim_tr_pemeriksaan_tindakan_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_tindakan_tindakan_foreign
        FOREIGN KEY (tenant_id, tindakan_id) REFERENCES public.sim_m_tindakan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_tindakan_dokter_foreign
        FOREIGN KEY (tenant_id, dokter_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_tindakan_unique
    ON public.sim_tr_pemeriksaan_tindakan USING btree (tenant_id, pemeriksaan_id, tindakan_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_pemeriksaan_tindakan_tindakan_index
    ON public.sim_tr_pemeriksaan_tindakan USING btree (tenant_id, tindakan_id) WHERE (deleted_at IS NULL);

-- Alergi obat pasien (SIMtrRiwayatAlergiObat), milik pasien, bukan kunjungan. pemeriksaan_id mencatat pemeriksaan
-- tempat alergi itu terakhir disimpan.
CREATE TABLE public.sim_m_pasien_alergi_obat (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    obat_id uuid NOT NULL,
    pemeriksaan_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_pasien_alergi_obat_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_pasien_alergi_obat_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.sim_m_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_obat_obat_foreign
        FOREIGN KEY (tenant_id, obat_id) REFERENCES public.sim_m_obat(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_obat_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_pasien_alergi_obat_unique
    ON public.sim_m_pasien_alergi_obat USING btree (tenant_id, pasien_id, obat_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_pasien_alergi_obat_obat_index
    ON public.sim_m_pasien_alergi_obat USING btree (tenant_id, obat_id) WHERE (deleted_at IS NULL);

-- Resep (SIMtrResep). draf: diisi bersama rekam medis; dikirim: sudah dikirim ke farmasi dan tidak dapat diubah lagi;
-- dibatalkan: disediakan untuk farmasi kelak. Nomor diberi saat dikirim. Dokter dan perawat diambil dari Anamnesa,
-- seperti pilihan terkunci di FormEresep.php. Paling banyak satu draf per pemeriksaan.
CREATE TABLE public.sim_tr_resep (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    nomor character varying(50),
    status character varying(20) DEFAULT 'draf' NOT NULL,
    dokter_id uuid,
    perawat_id uuid,
    catatan character varying(500),
    dikirim_pada timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_resep_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_resep_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_tr_resep_status_check CHECK (status IN ('draf', 'dikirim', 'dibatalkan')),
    CONSTRAINT sim_tr_resep_nomor_check CHECK (status = 'draf' OR nomor IS NOT NULL),
    CONSTRAINT sim_tr_resep_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_resep_dokter_foreign
        FOREIGN KEY (tenant_id, dokter_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_resep_perawat_foreign
        FOREIGN KEY (tenant_id, perawat_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_resep_draf_unique
    ON public.sim_tr_resep USING btree (tenant_id, pemeriksaan_id) WHERE (status = 'draf' AND deleted_at IS NULL);
CREATE UNIQUE INDEX sim_tr_resep_nomor_unique
    ON public.sim_tr_resep USING btree (tenant_id, nomor) WHERE (nomor IS NOT NULL AND deleted_at IS NULL);
CREATE INDEX sim_tr_resep_pemeriksaan_index
    ON public.sim_tr_resep USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Baris resep (SIMtrResepDetail). Tiga bentuk, seperti sistem lama:
-- - obat tunggal: obat_id terisi, racikan_ke kosong;
-- - kepala racikan (Barang_ID 0, "Racikan N"): obat_id kosong, racikan_ke N, jumlah_permintaan (QtyRacik), signa dan
--   aturan pakai racikan;
-- - komponen racikan: obat_id terisi, racikan_ke N, jumlahnya sendiri, tanpa signa dan aturan pakai.
-- Satu obat sekali per resep, termasuk di dalam racikan ("obat ini sudah ada dalam resep").
CREATE TABLE public.sim_tr_resep_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    resep_id uuid NOT NULL,
    urutan smallint NOT NULL,
    obat_id uuid,
    racikan_ke smallint,
    jumlah numeric(10,2),
    jumlah_permintaan numeric(10,2),
    signa character varying(100),
    aturan_pakai_id uuid,
    keterangan character varying(500),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_resep_detail_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_resep_detail_bentuk_check CHECK (
        (obat_id IS NOT NULL AND jumlah IS NOT NULL AND jumlah_permintaan IS NULL)
        OR (obat_id IS NULL AND racikan_ke IS NOT NULL AND jumlah IS NULL)),
    CONSTRAINT sim_tr_resep_detail_komponen_check CHECK (
        obat_id IS NULL OR racikan_ke IS NULL OR (signa IS NULL AND aturan_pakai_id IS NULL)),
    CONSTRAINT sim_tr_resep_detail_resep_foreign
        FOREIGN KEY (tenant_id, resep_id) REFERENCES public.sim_tr_resep(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_resep_detail_obat_foreign
        FOREIGN KEY (tenant_id, obat_id) REFERENCES public.sim_m_obat(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_resep_detail_aturan_pakai_foreign
        FOREIGN KEY (tenant_id, aturan_pakai_id) REFERENCES public.sim_m_aturan_pakai(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_resep_detail_obat_unique
    ON public.sim_tr_resep_detail USING btree (tenant_id, resep_id, obat_id)
    WHERE (obat_id IS NOT NULL AND deleted_at IS NULL);
CREATE UNIQUE INDEX sim_tr_resep_detail_racikan_unique
    ON public.sim_tr_resep_detail USING btree (tenant_id, resep_id, racikan_ke)
    WHERE (obat_id IS NULL AND deleted_at IS NULL);
CREATE INDEX sim_tr_resep_detail_obat_index
    ON public.sim_tr_resep_detail USING btree (tenant_id, obat_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_resep_detail_aturan_pakai_index
    ON public.sim_tr_resep_detail USING btree (tenant_id, aturan_pakai_id) WHERE (deleted_at IS NULL);

-- 4. Reference nomor resep -----------------------------------------------------------------------------------------

-- NoResep, satu sequence per operating unit seperti NoReg (0015). Nomornya unik per tenant, jadi format bawaan mencetak
-- nomor unit: <nomor unit>-RSP-00000001. Sistem lama: yymmdd + "RSP#" + nomor unit bisnis + urutan per tahun.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_operating_unit,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a7a10-5c00-7000-8000-000000000003', 'healthcare', 'healthcare.prescription-number',
        'Nomor resep (NoResep)', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"scope"},{"type":"constant","value":"-RSP-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Setelan sama dengan yang dibuat NumberSequences.createUnitDefaults, hanya untuk tenant yang berhak memakai module ini.
INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, operating_unit_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), u.tenant_id, r.id, 'operating_unit', u.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.operating_units u
JOIN public.organizations o ON o.id = u.organization_id AND o.tenant_id = u.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'healthcare.prescription-number'
  AND EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
              WHERE e.tenant_id = u.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                AND (e.ends_at IS NULL OR e.ends_at > current_timestamp))
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = u.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'operating_unit' AND s.operating_unit_id = u.organization_id);

-- 5. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_tindakan_kelompok', 'sim_m_satuan_obat', 'sim_m_bentuk_sediaan',
                             'sim_m_aturan_pakai', 'sim_m_tindakan', 'sim_m_obat', 'sim_tr_pemeriksaan_tindakan',
                             'sim_m_pasien_alergi_obat', 'sim_tr_resep', 'sim_tr_resep_detail']
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
FROM (VALUES ('sim_m_tindakan_kelompok', 'Kelompok tindakan'),
             ('sim_m_satuan_obat', 'Satuan obat'),
             ('sim_m_bentuk_sediaan', 'Bentuk sediaan'),
             ('sim_m_aturan_pakai', 'Aturan pakai'),
             ('sim_m_tindakan', 'Tindakan'),
             ('sim_m_obat', 'Obat'),
             ('sim_tr_pemeriksaan_tindakan', 'Tindakan pemeriksaan'),
             ('sim_m_pasien_alergi_obat', 'Alergi obat pasien'),
             ('sim_tr_resep', 'Resep'),
             ('sim_tr_resep_detail', 'Baris resep')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant dari sistem lama: satuan obat dari mSatuan (Kode_Satuan, Nama_Satuan, urutan Satuan_ID) dan
-- aturan pakai dari pilihan Dosis2 di FormEresep.php (kode = nilai yang disimpan sistem lama). Setiap tabel diisi hanya
-- bila tenant belum punya baris sama sekali di tabel itu, termasuk yang sudah dihapus.
CREATE FUNCTION public.sim_isi_acuan_resep(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_satuan_obat WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_satuan_obat (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('TUBE', 'TUBE', 1), ('TABLET', 'TAB', 2), ('BOTOL', 'BOTOL', 3), ('PCS', 'PCS', 4),
                     ('SACHET', 'SACHET', 5), ('SIRUP', 'SIRUP', 6), ('VIAL', 'VIAL', 7), ('BLISTER', 'BLISTER', 8),
                     ('LEMBAR', 'LEMBAR', 9), ('RECTAL', 'RECTAL', 10), ('AMPUL', 'AMPUL', 11), ('ROLL', 'ROLL', 12),
                     ('BOX', 'BOX', 13), ('SUPP', 'SUPPO', 14), ('ROL', 'ROL', 15), ('OVULA', 'OVULA', 16),
                     ('POU', 'POU', 17), ('BUNGKUS', 'BUNGKUS', 18), ('CC', 'CC', 19), ('FLESH', 'FLESH', 20),
                     ('UNIT', 'UNIT', 21), ('KAPSUL', 'CAPSUL', 22), ('STRIP', 'STRIP', 23), ('PACK', 'PACK', 24),
                     ('Bag', 'Bag', 25), ('Can', 'Can', 26), ('Galon', 'Galon', 27), ('Kaplet', 'Kaplet', 28),
                     ('Kardus', 'Kardus', 29), ('Kit', 'Kit', 30), ('Pak', 'Pak', 31), ('Paket', 'Paket', 32),
                     ('Pasang', 'Pasang', 33), ('Pet', 'Pet', 34), ('Piece', 'Piece', 35), ('Pot', 'Pot', 36),
                     ('Psg', 'Psg', 37), ('Set', 'Set', 38), ('Sheet', 'Sheet', 39), ('Syringe', 'Syringe', 40),
                     ('Test', 'Test', 41), ('DUS', 'DUS', 42), ('KANTONG', 'KANTONG', 43), ('Biji', 'Biji', 44),
                     ('Bok', 'Bok', 45), ('Buah', 'Buah', 46), ('Kotak', 'Kotak', 47), ('Tes', 'Tes', 48),
                     ('BotolPlast', 'Botol Plastik', 49), ('Canister', 'Canister', 50),
                     ('Cartridges', 'Cartridges', 51), ('ChewingGum', 'Chewing Gum', 52), ('Film', 'Film', 53),
                     ('FlexyBag', 'Flexy Bag', 54), ('g', 'g', 55), ('KapsulLuna', 'Kapsul Lunak', 56),
                     ('mg', 'mg', 57), ('mL', 'mL', 58), ('Pieces', 'Pieces', 59), ('Prefilledp', 'Prefilled pen', 60),
                     ('PrefilledS', 'Prefilled Syringe', 61), ('Respules', 'Respules', 62),
                     ('Stickpack', 'Stickpack', 63), ('Suppositor', 'Suppositoria', 64),
                     ('Turbuhaler', 'Turbuhaler', 65), ('Units', 'Units', 66),
                     ('Vial-Ampul', 'Vial + Ampul Pelarut', 67), ('Vial-Dropp', 'Vial + Dropper', 68),
                     ('Vial-Prefi', 'Vial + Prefilled Syr', 69), ('Vial-VialP', 'Vial +  Vial Pelarut', 70))
             AS v(kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_aturan_pakai WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_aturan_pakai (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.nama, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Sebelum Makan', 1),
                     ('Setelah Makan', 2),
                     ('Pemakaian Luar', 3),
                     ('Jika Diperlukan', 4),
                     ('Saat Makan', 5)) AS v(nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_resep_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_resep(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_resep AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_resep_saat_dipasang();

SELECT public.sim_isi_acuan_resep(i.tenant_id)
FROM public.core_module_installations i
WHERE i.module_id = 'healthcare' AND i.status = 'installed';

-- 7. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"procedures","label":"Tindakan","href":"/healthcare/clinical/procedures","section":"Klinis","permission":"healthcare.procedure.read"},
                                {"id":"procedure-groups","label":"Kelompok tindakan","href":"/healthcare/clinical/procedure-groups","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"drugs","label":"Obat","href":"/healthcare/clinical/drugs","section":"Klinis","permission":"healthcare.drug.read"},
                                {"id":"drug-units","label":"Satuan obat","href":"/healthcare/clinical/drug-units","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"dosage-forms","label":"Bentuk sediaan","href":"/healthcare/clinical/dosage-forms","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"usage-instructions","label":"Aturan pakai","href":"/healthcare/clinical/usage-instructions","section":"Klinis","permission":"healthcare.diagnosis-reference.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
