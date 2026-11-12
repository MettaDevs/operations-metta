-- Isi pemeriksaan rawat jalan tahap 2, bagian E1: tab "Rekam Medis" poli sistem lama puskesmas
-- (poly/views/form/rekammedis, simpan di helpers/rekammedis_helper.php), panel Anamnesa sampai Lainnya, tanpa
-- Pemeriksaan gigi dasar. Keputusan pemilik produk, 12 November 2026.
--
-- Bedanya dengan sistem lama:
-- - Sistem lama menyisipkan baris kosong ke sebelas tabel setiap kali Simpan. Di sini satu header per tujuan
--   kunjungan, dan baris panel hanya ditulis bila panel itu berisi. Panel yang dikosongkan diberi deleted_at.
-- - Sistem lama menghapus fisik lalu menyisipkan ulang baris anatomi tubuh. Di sini baris diubah di tempat atau
--   diberi deleted_at.
-- - Pilihan yang ditulis mati di view sistem lama (kesadaran, triage, GCS, ADL, dan seterusnya) menjadi data acuan
--   per tenant di sim_m_pemeriksaan_pilihan. Kolom transaksi menyimpan kode pilihan, sama dengan nilai sistem lama.
-- - Isian wajib periksa fisik ditulis mati di JavaScript sistem lama dan hanya diperiksa di peramban. Di sini daftarnya
--   baris di sim_m_pemeriksaan_wajib dan diperiksa server saat Simpan dan Selesai periksa.
-- - Alergi makanan, udara, dan lainnya disimpan per pasien (sim_m_pasien_alergi), tidak per kunjungan, sehingga
--   terbawa ke kunjungan berikutnya, seperti daftar alergi obat sistem lama (SIMtrRiwayatAlergiObat per NRM).
--
-- 1. Data acuan: sim_m_pemeriksaan_pilihan, sim_m_alergi, sim_m_keadaan_fisik_bagian, sim_m_keadaan_fisik_aspek,
--    sim_m_pemeriksaan_wajib.
-- 2. Alergi pasien: sim_m_pasien_alergi.
-- 3. Pemeriksaan: sim_tr_pemeriksaan (header dan anamnesa) beserta satu tabel per panel.
-- 4. Trigger versi, aktor, dan change log.
-- 5. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya,
--    sama dengan pola 0015 dan 0018.

-- 1. Data acuan ----------------------------------------------------------------------------------------------------

-- Pilihan isian pemeriksaan. kelompok menentukan isian yang memakainya (misalnya kesadaran, triage, gcs_mata),
-- kode adalah nilai yang disimpan (nilai sistem lama), dan warna hanya dipakai triage.
CREATE TABLE public.sim_m_pemeriksaan_pilihan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kelompok character varying(40) NOT NULL,
    kode character varying(40) NOT NULL,
    nama character varying(150) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    warna character varying(20),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_pemeriksaan_pilihan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_pemeriksaan_pilihan_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_pemeriksaan_pilihan_kode_unique
    ON public.sim_m_pemeriksaan_pilihan USING btree (tenant_id, kelompok, kode) WHERE (deleted_at IS NULL);

-- Kode alergi sistem lama (mAlergi Kuta 1), yang juga kode alergi PCare.
CREATE TABLE public.sim_m_alergi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    jenis character varying(20) NOT NULL,
    kode character varying(10) NOT NULL,
    nama character varying(150) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_alergi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_alergi_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_alergi_jenis_check CHECK (jenis IN ('makanan', 'udara', 'obat'))
);
CREATE UNIQUE INDEX sim_m_alergi_kode_unique
    ON public.sim_m_alergi USING btree (tenant_id, jenis, kode) WHERE (deleted_at IS NULL);

-- Bagian tubuh panel Keadaan fisik dan aspek pemeriksaannya, dengan teks normal yang mengisi aspek saat bagiannya
-- dicentang. jenis_kelamin (kode gender party Core) membatasi bagian ke pasien berjenis kelamin itu.
CREATE TABLE public.sim_m_keadaan_fisik_bagian (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(40) NOT NULL,
    nama character varying(150) NOT NULL,
    jenis_kelamin character varying(40),
    urutan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_keadaan_fisik_bagian_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_keadaan_fisik_bagian_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_keadaan_fisik_bagian_kode_unique
    ON public.sim_m_keadaan_fisik_bagian USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_m_keadaan_fisik_aspek (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    bagian_id uuid NOT NULL,
    kode character varying(60) NOT NULL,
    nama character varying(150) NOT NULL,
    teks_normal text,
    urutan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_keadaan_fisik_aspek_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_keadaan_fisik_aspek_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_keadaan_fisik_aspek_bagian_foreign
        FOREIGN KEY (tenant_id, bagian_id) REFERENCES public.sim_m_keadaan_fisik_bagian(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_keadaan_fisik_aspek_kode_unique
    ON public.sim_m_keadaan_fisik_aspek USING btree (tenant_id, bagian_id, kode) WHERE (deleted_at IS NULL);

-- Isian periksa fisik yang wajib diisi sebelum Simpan dan Selesai periksa. Isian yang boleh diwajibkan adalah katalog
-- di kode (examination-record.fields.ts); labelnya dari katalog itu, pesannya "Field {label} pada periksa fisik
-- harus di isi" seperti sistem lama. Nol dihitung kosong, seperti sistem lama. Menghapus baris (deleted_at)
-- melepas kewajibannya.
CREATE TABLE public.sim_m_pemeriksaan_wajib (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    isian character varying(40) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_pemeriksaan_wajib_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_pemeriksaan_wajib_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_pemeriksaan_wajib_isian_check CHECK (isian IN (
        'consciousness', 'systolic', 'diastolic', 'height', 'weight', 'waist_circumference', 'pulse_rate',
        'respiratory_rate', 'oxygen_saturation', 'temperature'))
);
CREATE UNIQUE INDEX sim_m_pemeriksaan_wajib_isian_unique
    ON public.sim_m_pemeriksaan_wajib USING btree (tenant_id, isian) WHERE (deleted_at IS NULL);

-- 2. Alergi pasien -------------------------------------------------------------------------------------------------

-- Satu baris per pasien, diubah di tempat setiap Simpan pemeriksaan. pemeriksaan_id adalah pemeriksaan yang terakhir
-- mengubahnya.
CREATE TABLE public.sim_m_pasien_alergi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    tidak_ada boolean DEFAULT false NOT NULL,
    alergi_makanan_id uuid,
    alergi_udara_id uuid,
    alergi_lainnya character varying(500),
    pemeriksaan_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_pasien_alergi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_pasien_alergi_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_pasien_alergi_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.sim_m_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_makanan_foreign
        FOREIGN KEY (tenant_id, alergi_makanan_id) REFERENCES public.sim_m_alergi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_pasien_alergi_udara_foreign
        FOREIGN KEY (tenant_id, alergi_udara_id) REFERENCES public.sim_m_alergi(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_pasien_alergi_pasien_unique
    ON public.sim_m_pasien_alergi USING btree (tenant_id, pasien_id) WHERE (deleted_at IS NULL);

-- 3. Pemeriksaan ---------------------------------------------------------------------------------------------------

-- Satu pemeriksaan per tujuan kunjungan, padanan SIMtrRJ. Status pemeriksaan tetap status tujuannya (diperiksa,
-- selesai) di sim_tr_registrasi_tujuan, jadi tidak disalin ke sini. Panel Anamnesa ada di header karena sistem lama
-- juga menyimpannya di SIMtrRJ.
CREATE TABLE public.sim_tr_pemeriksaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tujuan_id uuid NOT NULL,
    registrasi_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    dokter_id uuid,
    perawat_id uuid,
    keluhan_utama text,
    keluhan_tambahan text,
    lama_sakit_tahun smallint,
    lama_sakit_bulan smallint,
    lama_sakit_hari smallint,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_tr_pemeriksaan_lama_sakit_check CHECK (
        coalesce(lama_sakit_tahun, 0) >= 0 AND coalesce(lama_sakit_bulan, 0) >= 0 AND coalesce(lama_sakit_hari, 0) >= 0),
    CONSTRAINT sim_tr_pemeriksaan_tujuan_foreign
        FOREIGN KEY (tenant_id, tujuan_id) REFERENCES public.sim_tr_registrasi_tujuan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_registrasi_foreign
        FOREIGN KEY (tenant_id, registrasi_id) REFERENCES public.sim_tr_registrasi(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.sim_m_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_dokter_foreign
        FOREIGN KEY (tenant_id, dokter_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_perawat_foreign
        FOREIGN KEY (tenant_id, perawat_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_tujuan_unique
    ON public.sim_tr_pemeriksaan USING btree (tenant_id, tujuan_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_pemeriksaan_pasien_index
    ON public.sim_tr_pemeriksaan USING btree (tenant_id, pasien_id) WHERE (deleted_at IS NULL);

-- Riwayat penyakit (SIMtrRJRiwayatPenyakit).
CREATE TABLE public.sim_tr_pemeriksaan_riwayat_penyakit (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    tidak_ada boolean DEFAULT false NOT NULL,
    riwayat_sekarang text,
    riwayat_dahulu text,
    riwayat_keluarga text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_riwayat_penyakit_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_riwayat_penyakit_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_riwayat_penyakit_unique
    ON public.sim_tr_pemeriksaan_riwayat_penyakit USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Status fisik, psikososial, dan ekonomi (SIMtrRJStatusFisikNeurologis). Agama, pekerjaan, status perkawinan, dan
-- jaminan hanya ditampilkan dari pasien dan kunjungan; sistem lama menyalinnya ke sini, di sini tidak.
CREATE TABLE public.sim_tr_pemeriksaan_status_fisik (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    alat_bantu boolean,
    alat_bantu_keterangan character varying(500),
    kendala_komunikasi boolean,
    kendala_komunikasi_keterangan character varying(500),
    merawat_di_rumah boolean,
    merawat_di_rumah_keterangan character varying(500),
    butuh_bantuan boolean,
    butuh_bantuan_keterangan character varying(500),
    ekspresi_emosi character varying(40),
    bahasa character varying(40),
    bahasa_keterangan character varying(500),
    tinggal_dengan character varying(40),
    tinggal_dengan_keterangan character varying(500),
    sosial_ekonomi character varying(40),
    gangguan_jiwa character varying(40),
    status_ekonomi character varying(40),
    hubungan_keluarga character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_status_fisik_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_status_fisik_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_status_fisik_unique
    ON public.sim_tr_pemeriksaan_status_fisik USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Periksa fisik (SIMtrEMRVitalSigns), GCS, dan aktivitas fisik. IMT, MAP, total GCS, dan total aktivitas dihitung
-- saat ditampilkan, tidak disimpan, seperti sistem lama.
CREATE TABLE public.sim_tr_pemeriksaan_fisik (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    kesadaran character varying(40),
    sistole smallint,
    diastole smallint,
    tinggi_badan numeric(5,1),
    cara_ukur_tinggi character varying(40),
    berat_badan numeric(5,1),
    lingkar_perut numeric(5,1),
    detak_nadi smallint,
    nafas smallint,
    saturasi smallint,
    suhu numeric(4,1),
    gcs_mata character varying(40),
    gcs_verbal character varying(40),
    gcs_motorik character varying(40),
    adl_mobilisasi character varying(40),
    adl_toileting character varying(40),
    adl_makan_minum character varying(40),
    adl_mandi character varying(40),
    adl_berpakaian character varying(40),
    detak_jantung character varying(40),
    triage character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_fisik_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_fisik_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_fisik_unique
    ON public.sim_tr_pemeriksaan_fisik USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Asesmen nyeri (SIMtrRJAsesmenNyeri).
CREATE TABLE public.sim_tr_pemeriksaan_nyeri (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    merasakan_nyeri boolean,
    pencetus character varying(500),
    kualitas character varying(40),
    lokasi character varying(500),
    skala smallint,
    waktu character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_nyeri_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_nyeri_skala_check CHECK (skala IS NULL OR skala BETWEEN 0 AND 10),
    CONSTRAINT sim_tr_pemeriksaan_nyeri_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_nyeri_unique
    ON public.sim_tr_pemeriksaan_nyeri USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Risiko jatuh Get Up and Go. Sistem lama menyimpannya di SIMtrRJAsesmenNyeri; hasilnya (jumlah jawaban Ya) dihitung
-- saat ditampilkan, tidak disimpan.
CREATE TABLE public.sim_tr_pemeriksaan_risiko_jatuh (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    cara_berjalan boolean,
    penopang boolean,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_risiko_jatuh_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_risiko_jatuh_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_risiko_jatuh_unique
    ON public.sim_tr_pemeriksaan_risiko_jatuh USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Keadaan fisik (SIMtrRJKeadaanFisik): satu baris per aspek yang diperiksa. Bagian dianggap dicentang bila punya
-- baris aspek.
CREATE TABLE public.sim_tr_pemeriksaan_keadaan_fisik (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    aspek_id uuid NOT NULL,
    hasil text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_keadaan_fisik_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_keadaan_fisik_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_keadaan_fisik_aspek_foreign
        FOREIGN KEY (tenant_id, aspek_id) REFERENCES public.sim_m_keadaan_fisik_aspek(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_keadaan_fisik_unique
    ON public.sim_tr_pemeriksaan_keadaan_fisik USING btree (tenant_id, pemeriksaan_id, aspek_id)
    WHERE (deleted_at IS NULL);

-- Anatomi tubuh (SIMtrRJAnatomiTubuh): bagian tubuh dan keterangannya. Peta tubuh yang diklik belum dibuat, jadi
-- koordinat titik belum disimpan.
CREATE TABLE public.sim_tr_pemeriksaan_anatomi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    urutan smallint NOT NULL,
    bagian_tubuh character varying(200) NOT NULL,
    keterangan text NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_anatomi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_anatomi_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX sim_tr_pemeriksaan_anatomi_pemeriksaan_index
    ON public.sim_tr_pemeriksaan_anatomi USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Lainnya (SIMtrRJLainnya).
CREATE TABLE public.sim_tr_pemeriksaan_lainnya (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    terapi_obat text,
    terapi_non_obat text,
    bmhp text,
    rencana text,
    merokok boolean,
    konsumsi_alkohol boolean,
    kurang_sayur_buah boolean,
    tipe_askep character varying(40),
    edukasi text,
    deskripsi_askep text,
    observasi text,
    keterangan text,
    biopsikososial text,
    tindakan_keperawatan text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_lainnya_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_lainnya_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_lainnya_unique
    ON public.sim_tr_pemeriksaan_lainnya USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- 4. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_pemeriksaan_pilihan', 'sim_m_alergi', 'sim_m_keadaan_fisik_bagian',
                             'sim_m_keadaan_fisik_aspek', 'sim_m_pemeriksaan_wajib', 'sim_m_pasien_alergi',
                             'sim_tr_pemeriksaan', 'sim_tr_pemeriksaan_riwayat_penyakit',
                             'sim_tr_pemeriksaan_status_fisik', 'sim_tr_pemeriksaan_fisik', 'sim_tr_pemeriksaan_nyeri',
                             'sim_tr_pemeriksaan_risiko_jatuh', 'sim_tr_pemeriksaan_keadaan_fisik',
                             'sim_tr_pemeriksaan_anatomi', 'sim_tr_pemeriksaan_lainnya']
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
FROM (VALUES ('sim_m_pemeriksaan_pilihan', 'Pilihan isian pemeriksaan'),
             ('sim_m_alergi', 'Alergi'),
             ('sim_m_keadaan_fisik_bagian', 'Bagian keadaan fisik'),
             ('sim_m_keadaan_fisik_aspek', 'Aspek keadaan fisik'),
             ('sim_m_pemeriksaan_wajib', 'Isian wajib periksa fisik'),
             ('sim_m_pasien_alergi', 'Alergi pasien'),
             ('sim_tr_pemeriksaan', 'Pemeriksaan')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 5. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant, dari view dan database sistem lama. Setiap tabel diisi hanya bila tenant belum punya baris
-- sama sekali di tabel itu, termasuk yang sudah dihapus, sehingga pemasangan ulang tidak mengembalikan pilihan yang
-- sengaja dihapus tenant.
CREATE FUNCTION public.sim_isi_acuan_pemeriksaan(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_pemeriksaan_pilihan WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_pemeriksaan_pilihan (id, tenant_id, kelompok, kode, nama, urutan, warna, created_at,
                                                      updated_at)
        SELECT gen_random_uuid(), p_tenant, p.kelompok, p.kode, p.nama, p.urutan, p.warna,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('ekspresi_emosi', 'Tenang', 'Tenang', 1, NULL),
                     ('ekspresi_emosi', 'Cemas', 'Cemas', 2, NULL),
                     ('ekspresi_emosi', 'Takut', 'Takut', 3, NULL),
                     ('ekspresi_emosi', 'Gelisah', 'Gelisah', 4, NULL),
                     ('ekspresi_emosi', 'Sedih', 'Sedih', 5, NULL),
                     ('ekspresi_emosi', 'Marah', 'Marah', 6, NULL),
                     ('bahasa', 'Indonesia', 'Indonesia', 1, NULL),
                     ('bahasa', 'Daerah', 'Daerah', 2, NULL),
                     ('bahasa', 'Lainnya', 'Lainnya', 3, NULL),
                     ('tinggal_dengan', 'Sendiri', 'Sendiri', 1, NULL),
                     ('tinggal_dengan', 'Suami/Istri', 'Suami/Istri', 2, NULL),
                     ('tinggal_dengan', 'Orangtua', 'Orangtua', 3, NULL),
                     ('tinggal_dengan', 'Lainnya', 'Lainnya', 4, NULL),
                     ('ekonomi', 'Baik', 'Baik', 1, NULL),
                     ('ekonomi', 'Kurang', 'Kurang', 2, NULL),
                     ('ekonomi', 'Cukup', 'Cukup', 3, NULL),
                     ('gangguan_jiwa', 'Ya', 'Ya', 1, NULL),
                     ('gangguan_jiwa', 'TidakAda', 'Tidak Ada', 2, NULL),
                     ('hubungan_keluarga', 'Harmonis', 'Harmonis', 1, NULL),
                     ('hubungan_keluarga', 'Kurang Harmonis', 'Kurang Harmonis', 2, NULL),
                     ('hubungan_keluarga', 'Tidak Harmonis', 'Tidak harmonis', 3, NULL),
                     ('hubungan_keluarga', 'Konflik Besar', 'Konflik besar', 4, NULL),
                     ('kesadaran', 'COMPOS MENTIS', 'COMPOS MENTIS', 1, NULL),
                     ('kesadaran', 'SOMNOLEN', 'SOMNOLEN', 2, NULL),
                     ('kesadaran', 'SOPOR', 'SOPOR', 3, NULL),
                     ('kesadaran', 'COMA', 'COMA', 4, NULL),
                     ('cara_ukur_tinggi', 'Berdiri', 'Berdiri', 1, NULL),
                     ('cara_ukur_tinggi', 'Telentang', 'Telentang', 2, NULL),
                     ('gcs_mata', '1', 'Tidak Ada', 1, NULL),
                     ('gcs_mata', '2', 'Terhadap Nyeri', 2, NULL),
                     ('gcs_mata', '3', 'Terhadap Rangsangan Suara', 3, NULL),
                     ('gcs_mata', '4', 'Spontan', 4, NULL),
                     ('gcs_verbal', '1', 'Tidak Ada Respon', 1, NULL),
                     ('gcs_verbal', '2', 'Suara Tidak Jelas', 2, NULL),
                     ('gcs_verbal', '3', 'Kata-kata Tidak Jelas', 3, NULL),
                     ('gcs_verbal', '4', 'Orientasi Terganggu', 4, NULL),
                     ('gcs_verbal', '5', 'Orientasi Baik', 5, NULL),
                     ('gcs_motorik', '1', 'Tidak Ada Respon', 1, NULL),
                     ('gcs_motorik', '2', 'Ekstensi', 2, NULL),
                     ('gcs_motorik', '3', 'Fleksi Abnormal', 3, NULL),
                     ('gcs_motorik', '4', 'Fleksi Menarik', 4, NULL),
                     ('gcs_motorik', '5', 'Melokalisasi Nyeri', 5, NULL),
                     ('gcs_motorik', '6', 'Mampu Bergerak', 6, NULL),
                     ('aktivitas', '0', 'Mandiri', 1, NULL),
                     ('aktivitas', '1', 'Dibantu Sebagian', 2, NULL),
                     ('aktivitas', '2', 'Perlu Bantuan Orang Lain', 3, NULL),
                     ('aktivitas', '3', 'Perlu Bantuan Orang Lain Dan Alat', 4, NULL),
                     ('aktivitas', '4', 'Tergantung / Tidak Mampu', 5, NULL),
                     ('detak_jantung', 'REGULAR', 'REGULAR', 1, '#7E7E7E'),
                     ('detak_jantung', 'IREGULER', 'IREGULAR', 2, '#000000'),
                     ('triage', 'Gawat Darurat', 'Gawat Darurat', 1, '#F80000'),
                     ('triage', 'Darurat', 'Darurat', 2, '#EEAC4C'),
                     ('triage', 'Tidak Gawat Darurat', 'Tidak Gawat Darurat', 3, '#0F7515'),
                     ('triage', 'Meninggal', 'Meninggal', 4, '#000000'),
                     ('kualitas_nyeri', 'Tekanan', 'Tekanan', 1, NULL),
                     ('kualitas_nyeri', 'Terbakar', 'Terbakar', 2, NULL),
                     ('kualitas_nyeri', 'Melilit', 'Melilit', 3, NULL),
                     ('kualitas_nyeri', 'Tertusuk', 'Tertusuk', 4, NULL),
                     ('kualitas_nyeri', 'Diiris', 'Diiris', 5, NULL),
                     ('kualitas_nyeri', 'Mencengkram', 'Mencengkram', 6, NULL),
                     ('waktu_nyeri', '1', 'Intermiten', 1, NULL),
                     ('waktu_nyeri', '0', 'Hilang Timbul', 2, NULL),
                     ('tipe_askep', 'Text', 'Text', 1, NULL),
                     ('tipe_askep', 'Soap', 'Soap', 2, NULL))
             AS p(kelompok, kode, nama, urutan, warna);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_alergi WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_alergi (id, tenant_id, jenis, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, a.jenis, a.kode, a.nama, a.urutan,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('makanan', '00', 'Tidak Ada', 0),
                     ('makanan', '01', 'Seafood', 1),
                     ('makanan', '02', 'Gandum', 2),
                     ('makanan', '03', 'Susu Sapi', 3),
                     ('makanan', '04', 'Kacang-Kacangan', 4),
                     ('makanan', '05', 'Makanan Lain', 5),
                     ('udara', '00', 'Tidak Ada', 0),
                     ('udara', '01', 'Udara Panas', 1),
                     ('udara', '02', 'Udara Dingin', 2),
                     ('udara', '03', 'Udara Kotor', 3),
                     ('obat', '00', 'Tidak Ada', 0),
                     ('obat', '01', 'Antibiotik', 1),
                     ('obat', '02', 'Antiinflamasi', 2),
                     ('obat', '03', 'Non Steroid', 3),
                     ('obat', '04', 'Aspirin', 4),
                     ('obat', '05', 'Kortikosteroid', 5),
                     ('obat', '06', 'Insulin', 6),
                     ('obat', '07', 'Obat-Obatan Lain', 7)) AS a(jenis, kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_keadaan_fisik_bagian WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_keadaan_fisik_bagian (id, tenant_id, kode, nama, jenis_kelamin, urutan, created_at,
                                                       updated_at)
        SELECT gen_random_uuid(), p_tenant, b.kode, b.nama, b.jenis_kelamin, b.urutan,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('kulit', 'Pemeriksaan Kulit', NULL, 1),
                     ('kuku', 'Pemeriksaan Kuku', NULL, 2),
                     ('kepala', 'Pemeriksaan Kepala', NULL, 3),
                     ('wajah', 'Pemeriksaan Wajah', NULL, 4),
                     ('mata', 'Pemeriksaan Mata', NULL, 5),
                     ('telinga', 'Pemeriksaan Telinga', NULL, 6),
                     ('hidung_sinus', 'Pemeriksaan Hidung dan Sinus', NULL, 7),
                     ('mulut_bibir', 'Pemeriksaan Mulut dan Bibir', NULL, 8),
                     ('leher', 'Pemeriksaan Leher', NULL, 9),
                     ('dada_punggung', 'Pemeriksaan Dada dan Punggung', NULL, 10),
                     ('kardiovaskuler', 'Pemeriksaan Kardiovaskuler', NULL, 11),
                     ('dada_aksila', 'Pemeriksaan Dada dan Aksila', NULL, 12),
                     ('abdomen', 'Pemeriksaan Abdomen Perut', NULL, 13),
                     ('ekstremitas_atas', 'Pemeriksaan Ekstermitas Atas (Bahu, Siku, Tangan)', NULL, 14),
                     ('ekstremitas_bawah',
                      'Pemeriksaan Ekstermitas Bawah (Panggul, Lutut, Pergelangan Kaki dan Telapak Kaki)', NULL, 15),
                     ('genitalia_wanita', 'Pemeriksaan Genitalia Wanita', 'female', 16),
                     ('genitalia_pria', 'Pemeriksaan Genitalia Pria', 'male', 17))
             AS b(kode, nama, jenis_kelamin, urutan);
        INSERT INTO public.sim_m_keadaan_fisik_aspek (id, tenant_id, bagian_id, kode, nama, teks_normal, urutan,
                                                      created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, b.id, a.kode, a.nama, a.teks_normal, a.urutan,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES
            ('kulit', 'inspeksi', 'Inspeksi', 'Normal : kulit tidak ada ikterik/pucat/sianosis', 1),
            ('kulit', 'palpasi', 'Palpasi', 'Normal : lembab, turgor baik/elastic, tidak ada edema', 2),
            ('kuku', 'inspeksi', 'Inspeksi',
             'Normal : bersih, bentuk normal tidak ada tanda-tanda jari tabuh (clubbing finger), tidak ikterik/sianosis', 1),
            ('kuku', 'palpasi', 'Palpasi', 'Normal : aliran darah kuku akan kembali < 3 detik', 2),
            ('kepala', 'inspeksi', 'Inspeksi',
             'Normal : simetris, bersih, tidak ada lesi, tidak menunjukkan tanda-tanda kekurangan gizi(rambut jagung dan kering)', 1),
            ('kepala', 'palpasi', 'Palpasi',
             'Normal : tidak ada penonjolan /pembengkakan, rambut lebat dan kuat/tidak rapuh', 2),
            ('wajah', 'inspeksi', 'Inspeksi',
             'Normal : warna sama dengan bagian tubuh lain,  tidak pucat/ikterik, simetris', 1),
            ('wajah', 'palpasi', 'Palpasi', 'Normal : tidak ada nyeri tekan dan edema', 2),
            ('mata', 'inspeksi', 'Inspeksi',
             'Normal : simetris mata kika, simetris bola mata kika, warna konjungtiva pink, dan sclera berwarna putih', 1),
            ('telinga', 'inspeksi', 'Inspeksi',
             'Normal : bentuk dan posisi simetris kika, integritas kulit bagus, warna sama dengan kulit lain, tidak ada tanda-tanda infeksi, dan alat bantu dengar', 1),
            ('telinga', 'palpasi', 'Palpasi', 'Normal : tidak ada nyeri tekan', 2),
            ('hidung_sinus', 'inspeksi', 'Inspeksi',
             'Normal : simetris kika, warna sama dengan warna kulit lain, tidak ada lesi, tidak ada sumbatan, perdarahan dan tanda-tanda infeksi', 1),
            ('hidung_sinus', 'palpasi_perkusi', 'Palpasi dan Perkusi', 'Normal : tidak ada bengkak dan nyeri tekan', 2),
            ('mulut_bibir', 'struktur_luar', 'Inspeksi dan Palpasi Struktur Luar',
             'Normal : warna mukosa mulut dan bibir pink, lembab, tidak ada lesi dan stomatitis', 1),
            ('mulut_bibir', 'struktur_dalam', 'Inspeksi dan Palpasi Struktur Dalam',
             'Normal : gigi lengkap, tidak ada tanda-tanda gigi berlobang atau kerusakan gigi, tidak ada perdarahan atau radang gusi, lidah simetris, warna pink, langit2 utuh dan tidak ada tanda infeksi', 2),
            ('leher', 'inspeksi_leher', 'Inspeksi Leher',
             'Normal : warna sama dengan kulit lain, integritas kulit baik, bentuk simetris, tidak ada pembesaran kelenjer gondok', 1),
            ('leher', 'arteri_karotis', 'Inspeksi dan Auskultasi Arteri Karotis', 'Normal : arteri karotis terdengar', 2),
            ('leher', 'kelenjer_tiroid', 'Inspeksi dan Palpasi Kelenjer Tiroid',
             'Normal : tidak teraba pembesaran kel.gondok, tidak ada nyeri, tidak ada  pembesaran kel.limfe, tidak ada nyeri', 3),
            ('leher', 'bising_pembuluh_darah', 'Auskultasi (bising pembuluh darah)', 'Normal', 4),
            ('dada_punggung', 'inspeksi', 'Inspeksi',
             'Normal : simetris, bentuk dan postur normal, tidak ada tanda-tanda distress pernapasan, warna kulit sama dengan warna kulit lain, tidak ikterik/sianosis, tidak ada pembengkakan/penonjolan/edema', 1),
            ('dada_punggung', 'palpasi', 'Palpasi',
             'Normal : integritas kulit baik, tidak ada nyeri tekan/massa/tanda-tanda peradangan, ekspansi simetris, taktil vremitus cendrung sebelah kanan lebih teraba jelas', 2),
            ('dada_punggung', 'perkusi', 'Perkusi',
             'Normal : resonan (“dug dug dug”), jika bagian padat lebih daripada bagian udara = pekak (“bleg bleg bleg”), jika bagian udara lebih besar dari bagian padat=hiperesonan (“deng deng deng”), batas jantung=bunyi rensonan----hilang>>redup', 3),
            ('dada_punggung', 'auskultasi', 'Auskultasi',
             'Normal : bunyi napas vesikuler, bronchovesikuler, brochial, tracheal', 4),
            ('kardiovaskuler', 'inspeksi', 'Inspeksi', 'Normal : denyutan aorta teraba', 1),
            ('kardiovaskuler', 'palpasi', 'Palpasi', 'Normal : denyutan aorta teraba', 2),
            ('kardiovaskuler', 'perkusi', 'Perkusi',
             'Normal : batas jantung, tidak lebih dari 4,7,10 cm ke arah kiri dari garis mid sterna, pada RIC 4,5,dan 8 cm ke arah kanan dari garis mid sterna', 3),
            ('kardiovaskuler', 'auskultasi', 'Auskultasi',
             'Normal : terdengar bunyi jantung I/S1 (lub) dan bunyi jantung II/S2 (dub), tidak ada bunyi jantung tambahan (S3 atau S4)', 4),
            ('dada_aksila', 'inspeksi', 'Inspeksi', 'Normal', 1),
            ('dada_aksila', 'palpasi', 'Palpasi', 'Normal', 2),
            ('dada_aksila', 'aksila', 'Inspeksi dan Palpasi Aksila', 'Normal', 3),
            ('abdomen', 'inspeksi', 'Inspeksi',
             'Normal : simetris kika, warna dengan warna kulit lain, tidak ikterik tidak terdapat ostomy, distensi, tonjolan, pelebaran vena, kelainan umbilicus', 1),
            ('abdomen', 'auskultasi', 'Auskultasi',
             'Normal :  suara peristaltic terdengar setiap 5-20x/dtk, terdengar denyutan arteri renalis, arteri iliaka dan aorta', 2),
            ('abdomen', 'perkusi_kuadran', 'Perkusi Semua Kuadran', 'Normal', 3),
            ('abdomen', 'perkusi_hepar', 'Perkusi Hepar', 'Normal', 4),
            ('abdomen', 'perkusi_limfa', 'Perkusi Limfa', 'Normal', 5),
            ('abdomen', 'perkusi_ginjal', 'Perkusi Ginjal', 'Normal', 6),
            ('abdomen', 'palpasi_kuadran', 'Palpasi Semua Kuadran',
             'Normal : tidak teraba penonjolan tidak ada nyeri tekan, tidak ada massa dan penumpukan cairan', 7),
            ('ekstremitas_atas', 'inspeksi_muskuloskeletal', 'Inspeksi Struktur Muskuloskletal',
             'Normal : simetris kika, integritas kulit baik, ROM aktif, kekuatan otot penuh', 1),
            ('ekstremitas_atas', 'palpasi', 'Palpasi', 'Normal : teraba jelas', 2),
            ('ekstremitas_atas', 'tes_refleks', 'Tes Reflex', 'Normal : reflek bisep dan trisep positif', 3),
            ('ekstremitas_bawah', 'inspeksi_muskuloskeletal', 'Inspeksi Struktur Muskuloskletal',
             'Normal : simetris kika, integritas kulit baik, ROM aktif, kekuatan otot penuh', 1),
            ('ekstremitas_bawah', 'palpasi', 'Palpasi', 'Normal : teraba jelas', 2),
            ('ekstremitas_bawah', 'tes_refleks', 'Tes Reflex', 'Normal : reflex patella dan archiles positif', 3),
            ('genitalia_wanita', 'genitalia_eksternal', 'Inspeksi Genitalia Eksternal',
             'Normal : bersih, mukosa lembab, integritas kulit baik, semetris tidak ada edema dan tanda-tanda infeksi (pengeluaran pus /bau)', 1),
            ('genitalia_wanita', 'vagina_servik', 'Inspeksi Vagina dan Servik', 'Normal', 2),
            ('genitalia_wanita', 'vagina_uterus_ovarium', 'Palpasi Vagina, Uterus dan Ovarium', 'Normal', 3),
            ('genitalia_wanita', 'anus_rektum', 'Pemeriksaan Anus dan Rectum',
             'Normal : tidak ada nyeri, tidak terdapat edema /  hemoroid/ polip/ tanda-tanda infeksi dan pendarahan', 4),
            ('genitalia_pria', 'penis', 'Inspeksi dan Palpasi Penis',
             'Normal : integritas kulit baik, tidak ada masa atau pembengkakan, tidak ada pengeluaran pus atau darah', 1),
            ('genitalia_pria', 'skrotum', 'Inspeksi dan Palpasi Skrotum', 'Normal', 2),
            ('genitalia_pria', 'anus_rektum', 'Pemeriksaan Anus dan Rectum',
             'Normal : tidak ada nyeri, tidak terdapat edema /  hemoroid/ polip/ tanda-tanda infeksi dan pendarahan', 3))
             AS a(bagian, kode, nama, teks_normal, urutan)
        JOIN public.sim_m_keadaan_fisik_bagian b
             ON b.tenant_id = p_tenant AND b.kode = a.bagian AND b.deleted_at IS NULL;
    END IF;
    -- Urutan pemeriksaan JavaScript sistem lama (SubmitForm di rekammedis/index.php).
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_pemeriksaan_wajib WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_pemeriksaan_wajib (id, tenant_id, isian, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, w.isian, w.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('pulse_rate', 1),
                     ('respiratory_rate', 2),
                     ('consciousness', 3),
                     ('systolic', 4),
                     ('diastolic', 5),
                     ('height', 6),
                     ('weight', 7),
                     ('waist_circumference', 8)) AS w(isian, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_pemeriksaan_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_pemeriksaan(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_pemeriksaan AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_pemeriksaan_saat_dipasang();

SELECT public.sim_isi_acuan_pemeriksaan(i.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.core_module_installations
      WHERE module_id = 'healthcare' AND status = 'installed') i;
