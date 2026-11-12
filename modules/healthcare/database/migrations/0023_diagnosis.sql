-- Pemeriksaan rawat jalan tahap 2, bagian E2: panel Diagnosa tab "Rekam Medis" poli sistem lama puskesmas
-- (poly/views/form/rekammedis/Diagnosa.php, simpan di helpers/rekammedis_helper.php). Keputusan pemilik produk,
-- 12 November 2026.
--
-- Bedanya dengan sistem lama:
-- - Jenis (PRIMER, SEKUNDER, KOMPLIKASI) dan Kasus (BARU, LAMA) ditulis mati di JavaScript sistem lama. Di sini
--   keduanya data acuan per tenant.
-- - Sebelas penyakit kronis adalah sebelas kolom SIMtrRJPenyakitKronis. Di sini daftarnya data acuan per tenant, dan
--   pemeriksaan menyimpan satu baris per penyakit yang dicentang.
-- - Sistem lama menghapus fisik lalu menyisipkan ulang baris diagnosa setiap Simpan. Di sini baris diubah di tempat
--   atau diberi deleted_at.
-- - ICD-10 (mICD) dibuat kosong. Pemilik produk: "kosongin aja dulu". Kode ditambah lewat Setup atau dari pemeriksaan.
--
-- 1. Katalog izin.
-- 2. Data acuan: sim_m_icd10, sim_m_diagnosa_jenis, sim_m_diagnosa_kasus, sim_m_prognosa, sim_m_penyakit_kronis.
-- 3. Pemeriksaan: sim_tr_pemeriksaan_diagnosa, sim_tr_pemeriksaan.prognosa_id, sim_tr_pemeriksaan_penyakit_kronis.
-- 4. Trigger versi, aktor, dan change log.
-- 5. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya.
-- 6. Menu: Setup → Klinis.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.icd10.form', 'healthcare', 'Layar ICD-10', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc'),
       ('healthcare.diagnosis-reference.form', 'healthcare', 'Layar data acuan diagnosa', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.icd10.read', 'healthcare.icd10.form', 'read', 'Lihat ICD-10'),
             ('healthcare.icd10.create', 'healthcare.icd10.form', 'create', 'Tambah ICD-10'),
             ('healthcare.icd10.update', 'healthcare.icd10.form', 'update', 'Ubah ICD-10'),
             ('healthcare.icd10.delete', 'healthcare.icd10.form', 'delete', 'Hapus ICD-10'),
             ('healthcare.diagnosis-reference.read', 'healthcare.diagnosis-reference.form', 'read',
              'Lihat jenis, kasus, prognosa, dan penyakit kronis'),
             ('healthcare.diagnosis-reference.create', 'healthcare.diagnosis-reference.form', 'create',
              'Tambah jenis, kasus, prognosa, dan penyakit kronis'),
             ('healthcare.diagnosis-reference.update', 'healthcare.diagnosis-reference.form', 'update',
              'Ubah jenis, kasus, prognosa, dan penyakit kronis'),
             ('healthcare.diagnosis-reference.delete', 'healthcare.diagnosis-reference.form', 'delete',
              'Hapus jenis, kasus, prognosa, dan penyakit kronis')) AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.icd10.view', 'Melihat ICD-10'),
             ('healthcare.icd10.register', 'Menambah ICD-10 dari pemeriksaan'),
             ('healthcare.icd10.maintain', 'Memelihara ICD-10'),
             ('healthcare.icd10.retire', 'Menghapus ICD-10'),
             ('healthcare.diagnosis-reference.view', 'Melihat data acuan diagnosa'),
             ('healthcare.diagnosis-reference.maintain', 'Memelihara data acuan diagnosa'),
             ('healthcare.diagnosis-reference.retire', 'Menghapus data acuan diagnosa')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.icd10.view', 'healthcare.icd10.read'),
       ('healthcare.icd10.register', 'healthcare.icd10.read'),
       ('healthcare.icd10.register', 'healthcare.icd10.create'),
       ('healthcare.icd10.maintain', 'healthcare.icd10.read'),
       ('healthcare.icd10.maintain', 'healthcare.icd10.create'),
       ('healthcare.icd10.maintain', 'healthcare.icd10.update'),
       ('healthcare.icd10.retire', 'healthcare.icd10.read'),
       ('healthcare.icd10.retire', 'healthcare.icd10.delete'),
       ('healthcare.diagnosis-reference.view', 'healthcare.diagnosis-reference.read'),
       ('healthcare.diagnosis-reference.maintain', 'healthcare.diagnosis-reference.read'),
       ('healthcare.diagnosis-reference.maintain', 'healthcare.diagnosis-reference.create'),
       ('healthcare.diagnosis-reference.maintain', 'healthcare.diagnosis-reference.update'),
       ('healthcare.diagnosis-reference.retire', 'healthcare.diagnosis-reference.read'),
       ('healthcare.diagnosis-reference.retire', 'healthcare.diagnosis-reference.delete')
ON CONFLICT DO NOTHING;

-- Setup klinis memelihara semuanya. Pemeriksa membaca ICD-10 untuk memilih diagnosa, dan yang boleh memeriksa juga
-- boleh menambah kode baru dari baris diagnosa, karena daftar ICD-10 dimulai kosong. Role yang sudah memegang duty itu
-- ikut membawanya, jadi tidak ada role yang perlu diubah.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.clinical-setup.inquire', 'healthcare.icd10.view'),
       ('healthcare.clinical-setup.inquire', 'healthcare.diagnosis-reference.view'),
       ('healthcare.clinical-setup.manage', 'healthcare.icd10.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.icd10.retire'),
       ('healthcare.clinical-setup.manage', 'healthcare.diagnosis-reference.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.diagnosis-reference.retire'),
       ('healthcare.examination.inquire', 'healthcare.icd10.view'),
       ('healthcare.examination.manage', 'healthcare.icd10.register')
ON CONFLICT DO NOTHING;

UPDATE public.security_duties
SET name = CASE code WHEN 'healthcare.clinical-setup.inquire' THEN 'Lihat setup klinis'
                     ELSE 'Kelola setup klinis' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.clinical-setup.inquire', 'healthcare.clinical-setup.manage');

-- 2. Data acuan ----------------------------------------------------------------------------------------------------

-- Kode ICD-10 (mICD). Dimulai kosong.
CREATE TABLE public.sim_m_icd10 (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(250) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_icd10_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_icd10_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_icd10_kode_unique
    ON public.sim_m_icd10 USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- Empat daftar pendek berbentuk sama: jenis diagnosa, kasus diagnosa, prognosa (mPrognosa), dan penyakit kronis.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_diagnosa_jenis', 'sim_m_diagnosa_kasus', 'sim_m_prognosa', 'sim_m_penyakit_kronis']
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

-- 3. Pemeriksaan ---------------------------------------------------------------------------------------------------

-- Diagnosa (SIMtrRJDiagnosaAwal). Satu kode ICD-10 sekali per pemeriksaan, seperti kunci NOBukti + KodeICD sistem
-- lama. Posisi gigi menunggu Pemeriksaan gigi dasar.
CREATE TABLE public.sim_tr_pemeriksaan_diagnosa (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    urutan smallint NOT NULL,
    icd10_id uuid NOT NULL,
    jenis_id uuid NOT NULL,
    kasus_id uuid NOT NULL,
    dokter_id uuid,
    perawat_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_icd10_foreign
        FOREIGN KEY (tenant_id, icd10_id) REFERENCES public.sim_m_icd10(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_jenis_foreign
        FOREIGN KEY (tenant_id, jenis_id) REFERENCES public.sim_m_diagnosa_jenis(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_kasus_foreign
        FOREIGN KEY (tenant_id, kasus_id) REFERENCES public.sim_m_diagnosa_kasus(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_dokter_foreign
        FOREIGN KEY (tenant_id, dokter_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_diagnosa_perawat_foreign
        FOREIGN KEY (tenant_id, perawat_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_diagnosa_icd10_unique
    ON public.sim_tr_pemeriksaan_diagnosa USING btree (tenant_id, pemeriksaan_id, icd10_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_pemeriksaan_diagnosa_icd10_index
    ON public.sim_tr_pemeriksaan_diagnosa USING btree (tenant_id, icd10_id) WHERE (deleted_at IS NULL);

-- Prognosa (SIMtrRJ.Prognosa).
ALTER TABLE public.sim_tr_pemeriksaan ADD COLUMN prognosa_id uuid;
ALTER TABLE public.sim_tr_pemeriksaan ADD CONSTRAINT sim_tr_pemeriksaan_prognosa_foreign
    FOREIGN KEY (tenant_id, prognosa_id) REFERENCES public.sim_m_prognosa(tenant_id, id) ON DELETE RESTRICT;

-- Tandai penyakit kronis (SIMtrRJPenyakitKronis, per kunjungan): satu baris per penyakit yang dicentang.
CREATE TABLE public.sim_tr_pemeriksaan_penyakit_kronis (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    penyakit_kronis_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_penyakit_kronis_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_penyakit_kronis_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_penyakit_kronis_penyakit_foreign
        FOREIGN KEY (tenant_id, penyakit_kronis_id) REFERENCES public.sim_m_penyakit_kronis(tenant_id, id)
            ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_penyakit_kronis_unique
    ON public.sim_tr_pemeriksaan_penyakit_kronis USING btree (tenant_id, pemeriksaan_id, penyakit_kronis_id)
    WHERE (deleted_at IS NULL);

-- 4. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_icd10', 'sim_m_diagnosa_jenis', 'sim_m_diagnosa_kasus', 'sim_m_prognosa',
                             'sim_m_penyakit_kronis', 'sim_tr_pemeriksaan_diagnosa',
                             'sim_tr_pemeriksaan_penyakit_kronis']
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
FROM (VALUES ('sim_m_icd10', 'ICD-10'),
             ('sim_m_diagnosa_jenis', 'Jenis diagnosa'),
             ('sim_m_diagnosa_kasus', 'Kasus diagnosa'),
             ('sim_m_prognosa', 'Prognosa'),
             ('sim_m_penyakit_kronis', 'Penyakit kronis'),
             ('sim_tr_pemeriksaan_diagnosa', 'Diagnosa pemeriksaan')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 5. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant dari sistem lama. Jenis dan kasus dari pilihan di Diagnosa.php (kode = nilai yang disimpan
-- SIMtrRJDiagnosaAwal), prognosa dari mPrognosa, penyakit kronis dari kolom SIMtrRJPenyakitKronis dengan label di
-- Diagnosa.php dalam urutan tampilnya. Setiap tabel diisi hanya bila tenant belum punya baris sama sekali di tabel
-- itu, termasuk yang sudah dihapus, sehingga pemasangan ulang tidak mengembalikan baris yang sengaja dihapus tenant.
CREATE FUNCTION public.sim_isi_acuan_diagnosa(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_diagnosa_jenis WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_diagnosa_jenis (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('PRIMER', 'Primer', 1),
                     ('SEKUNDER', 'Sekunder', 2),
                     ('KOMPLIKASI', 'Komplikasi', 3)) AS v(kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_diagnosa_kasus WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_diagnosa_kasus (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('BARU', 'Baru', 1),
                     ('LAMA', 'Lama', 2)) AS v(kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_prognosa WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_prognosa (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('01', 'Sanam (Sembuh)', 1),
                     ('02', 'Bonam (Baik)', 2),
                     ('03', 'Malam (Buruk/Jelek)', 3),
                     ('04', 'Dubia ad Sanam/Bolam (Tidak tentu/Ragu-ragu, cenderung Sembuh/Baik)', 4),
                     ('05', 'Dubia ad Malam (Tidak tentu/Ragu-ragu, cenderung Buruk/Jelek)', 5)) AS v(kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_penyakit_kronis WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_penyakit_kronis (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('DiabetusMilitus', 'Diabetus Militus', 1),
                     ('Epilepsi', 'Epilepsi', 2),
                     ('Hipertensi', 'Hipertensi', 3),
                     ('PenyakitAutoImun', 'Penyakit Autoimun', 4),
                     ('PenyakitJantungKronis', 'Penyakit Jantung Kronis', 5),
                     ('Stroke', 'Stroke', 6),
                     ('Dislipidemia', 'Dislipidemia', 7),
                     ('GangguanJiwaKronis', 'Gangguan Jiwa Kronis', 8),
                     ('Kanker', 'Kanker', 9),
                     ('PenyakitGinjalKronis', 'Penyakit Ginjal Kronis', 10),
                     ('PenyakitParuKronis', 'Penyakit Paru Kronis', 11)) AS v(kode, nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_diagnosa_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_diagnosa(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_diagnosa AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_diagnosa_saat_dipasang();

SELECT public.sim_isi_acuan_diagnosa(i.tenant_id)
FROM public.core_module_installations i
WHERE i.module_id = 'healthcare' AND i.status = 'installed';

-- 6. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"icd10","label":"ICD-10","href":"/healthcare/clinical/icd10","section":"Klinis","permission":"healthcare.icd10.read"},
                                {"id":"diagnosis-types","label":"Jenis diagnosa","href":"/healthcare/clinical/diagnosis-types","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"diagnosis-cases","label":"Kasus diagnosa","href":"/healthcare/clinical/diagnosis-cases","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"prognoses","label":"Prognosa","href":"/healthcare/clinical/prognoses","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"chronic-diseases","label":"Penyakit kronis","href":"/healthcare/clinical/chronic-diseases","section":"Klinis","permission":"healthcare.diagnosis-reference.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
