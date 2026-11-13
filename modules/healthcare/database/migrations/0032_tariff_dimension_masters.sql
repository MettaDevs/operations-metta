-- Master yang menjadi kunci tabel tarif sistem lama (SIMdListHarga) dan isian kartu Jasa yang menunggu masternya sejak
-- 0031. Arahan pemilik produk 13 November 2026: jasa, komponen jasa, dan semua turunannya mengikuti sistem lama lebih
-- dulu, perbaikan sesudahnya.
--
-- 1. Empat daftar pendek berbentuk sama dengan kelompok tindakan (kode, nama, urutan, aktif), diatur di Setup → Klinis:
--    - Kelas (SIMmKelas, Admin → Setup Jasa → Kelas, admin/service/views/class/form.php): KelasID menjadi kode,
--      NamaKelas menjadi nama, Nomor menjadi urutan (layarnya tetap berlabel Nomor).
--    - Kategori operasi (SIMmKategoriOperasi): sistem lama tidak punya layarnya, hanya sumber dropdown
--      (Operation_category_model). Kategori_RL tidak dipindah karena tidak dibaca alur rawat jalan.
--    - Kategori plafon (SIMmKategoriPlafon): tanpa layar di sistem lama, hanya sumber dropdown Kategori Plafon kartu
--      Jasa. Kuncinya nama itu sendiri; di sini kode pendek diketik pengguna. Tipe ("Per Kasus", "Per Tahun") tidak
--      dipindah karena tidak punya layar dan tidak dibaca alur rawat jalan.
--    - Alat penunjang (SIMmAlatPenunjang, Admin → Setup Jasa → Devices, admin/service/views/devices/form.php).
--    Sistem lama membuat kode kelas dan alat otomatis; di sini kodenya pendek dan diketik pengguna, aturan repo untuk
--    master setup kecil. Semuanya dimulai kosong. Baris wildcard sistem lama ('XX' kelas dan dokter, 99 'ALL'
--    spesialis, 1 'ALL' kategori operasi) tidak dibuat, karena di tarif yang menyusul isian kosong berarti "semua".
-- 2. Spesialis dan sub spesialis (SIMmSpesialisasi, SIMmSubSpesialis; layar Admin → Vendor → Specialist,
--    admin/vendor/views/specialist/form.php): kartu Nama dengan baris Sub Spesialis. Tanpa kode, karena sistem lama
--    tidak punya kode spesialis dan kode sub spesialisnya dibuat otomatis tanpa diketik siapa pun. Fungsi tarif
--    GetTarifBiayaNonKerjasama_BUFF mencocokkan nama spesialis dokter dengan baris tarif; di sini cocoknya lewat id,
--    jadi nama spesialis unik per tenant tanpa membedakan huruf besar, dan nama sub spesialis unik di spesialisnya.
-- 3. Katalog izin spesialis, masuk duty nakes yang sudah ada seperti profesi (0022).
-- 4. Spesialis dan sub spesialis nakes (kartu dokter sistem lama: SpesialisID dan SubSpesialisID, keduanya boleh
--    kosong karena tanda bintangnya hanya tampilan). Sub spesialis harus milik spesialis nakes itu; foreign key gabungan
--    menjaganya. Teks spesialisasi lama yang terisi pada nakes yang belum dihapus menjadi spesialis tenantnya (dirapikan
--    spasinya, satu baris untuk nama yang sama tanpa membedakan huruf besar) lalu ditautkan. Kolom spesialisasi lama
--    tetap ada satu rilis karena kode rilis sebelumnya membacanya selama pemutakhiran; kode ini tidak membaca dan tidak
--    menulisnya lagi.
-- 5. Kategori Plafon (KategoriPlafon) dan Menggunakan Alat (KodeMappingAlat) di tindakan, keduanya boleh kosong seperti
--    pilihan "-- None --" kartu Jasa sistem lama.
-- 6. Trigger versi, aktor, dan change log.
-- 7. Menu: Setup → Klinis → Kelas, Kategori operasi, Kategori plafon, Alat penunjang, dengan izin daftar pendek klinis
--    seperti Kelompok tindakan; Setup → Tenaga kesehatan → Spesialis.

-- 1. Daftar pendek -------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_kelas', 'sim_m_kategori_operasi', 'sim_m_kategori_plafon', 'sim_m_alat_penunjang']
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

-- 2. Spesialis dan sub spesialis -----------------------------------------------------------------------------------

CREATE TABLE public.sim_m_spesialisasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nama character varying(200) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_spesialisasi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_spesialisasi_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_spesialisasi_nama_unique
    ON public.sim_m_spesialisasi USING btree (tenant_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_m_sub_spesialisasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    spesialisasi_id uuid NOT NULL,
    nama character varying(200) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_sub_spesialisasi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_sub_spesialisasi_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_sub_spesialisasi_spesialisasi_id_unique UNIQUE (tenant_id, spesialisasi_id, id),
    CONSTRAINT sim_m_sub_spesialisasi_spesialisasi_foreign
        FOREIGN KEY (tenant_id, spesialisasi_id) REFERENCES public.sim_m_spesialisasi(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_sub_spesialisasi_nama_unique
    ON public.sim_m_sub_spesialisasi USING btree (tenant_id, spesialisasi_id, lower((nama)::text))
    WHERE (deleted_at IS NULL);

-- 3. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.specialty.form', 'healthcare', 'Layar spesialis', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'healthcare', 'healthcare.specialty.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.specialty.read', 'read', 'Lihat spesialis'),
             ('healthcare.specialty.create', 'create', 'Tambah spesialis'),
             ('healthcare.specialty.update', 'update', 'Ubah spesialis'),
             ('healthcare.specialty.delete', 'delete', 'Hapus spesialis')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.specialty.view', 'healthcare', 'Melihat spesialis', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc'),
       ('healthcare.specialty.maintain', 'healthcare', 'Memelihara spesialis', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc'),
       ('healthcare.specialty.retire', 'healthcare', 'Menghapus spesialis', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.specialty.view', 'healthcare.specialty.read'),
       ('healthcare.specialty.maintain', 'healthcare.specialty.read'),
       ('healthcare.specialty.maintain', 'healthcare.specialty.create'),
       ('healthcare.specialty.maintain', 'healthcare.specialty.update'),
       ('healthcare.specialty.retire', 'healthcare.specialty.read'),
       ('healthcare.specialty.retire', 'healthcare.specialty.delete')
ON CONFLICT DO NOTHING;

-- Duty nakes yang sudah dipegang role ikut membawa spesialis, jadi tidak ada role yang perlu diubah.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.practitioner.inquire', 'healthcare.specialty.view'),
       ('healthcare.practitioner.manage', 'healthcare.specialty.maintain'),
       ('healthcare.practitioner.manage', 'healthcare.specialty.retire')
ON CONFLICT DO NOTHING;

-- 4. Spesialis nakes -----------------------------------------------------------------------------------------------

ALTER TABLE public.sim_m_nakes
    ADD COLUMN spesialisasi_id uuid,
    ADD COLUMN sub_spesialisasi_id uuid,
    ADD CONSTRAINT sim_m_nakes_spesialisasi_foreign
        FOREIGN KEY (tenant_id, spesialisasi_id) REFERENCES public.sim_m_spesialisasi(tenant_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT sim_m_nakes_sub_spesialisasi_foreign
        FOREIGN KEY (tenant_id, spesialisasi_id, sub_spesialisasi_id)
        REFERENCES public.sim_m_sub_spesialisasi(tenant_id, spesialisasi_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_m_nakes_sub_spesialisasi_check
        CHECK (sub_spesialisasi_id IS NULL OR spesialisasi_id IS NOT NULL);
CREATE INDEX sim_m_nakes_spesialisasi_index
    ON public.sim_m_nakes USING btree (tenant_id, spesialisasi_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_nakes_sub_spesialisasi_index
    ON public.sim_m_nakes USING btree (tenant_id, sub_spesialisasi_id) WHERE (deleted_at IS NULL);

INSERT INTO public.sim_m_spesialisasi (id, tenant_id, nama, created_at, updated_at)
SELECT gen_random_uuid(), n.tenant_id, min(btrim(n.spesialisasi)), now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.sim_m_nakes n
WHERE n.deleted_at IS NULL AND btrim(coalesce(n.spesialisasi, '')) <> ''
GROUP BY n.tenant_id, lower(btrim(n.spesialisasi));

UPDATE public.sim_m_nakes n
SET spesialisasi_id = s.id
FROM public.sim_m_spesialisasi s
WHERE s.tenant_id = n.tenant_id AND lower(s.nama) = lower(btrim(n.spesialisasi)) AND s.deleted_at IS NULL
  AND n.deleted_at IS NULL;

-- 5. Kategori plafon dan alat di tindakan --------------------------------------------------------------------------

ALTER TABLE public.sim_m_tindakan
    ADD COLUMN kategori_plafon_id uuid,
    ADD COLUMN alat_penunjang_id uuid,
    ADD CONSTRAINT sim_m_tindakan_kategori_plafon_foreign
        FOREIGN KEY (tenant_id, kategori_plafon_id) REFERENCES public.sim_m_kategori_plafon(tenant_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT sim_m_tindakan_alat_penunjang_foreign
        FOREIGN KEY (tenant_id, alat_penunjang_id) REFERENCES public.sim_m_alat_penunjang(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_m_tindakan_kategori_plafon_index
    ON public.sim_m_tindakan USING btree (tenant_id, kategori_plafon_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_alat_penunjang_index
    ON public.sim_m_tindakan USING btree (tenant_id, alat_penunjang_id) WHERE (deleted_at IS NULL);

-- 6. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_kelas', 'sim_m_kategori_operasi', 'sim_m_kategori_plafon', 'sim_m_alat_penunjang',
                             'sim_m_spesialisasi', 'sim_m_sub_spesialisasi']
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
FROM (VALUES ('sim_m_kelas', 'Kelas'),
             ('sim_m_kategori_operasi', 'Kategori operasi'),
             ('sim_m_kategori_plafon', 'Kategori plafon'),
             ('sim_m_alat_penunjang', 'Alat penunjang'),
             ('sim_m_spesialisasi', 'Spesialis'),
             ('sim_m_sub_spesialisasi', 'Sub spesialis')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 7. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"care-classes","label":"Kelas","href":"/healthcare/clinical/care-classes","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"operation-categories","label":"Kategori operasi","href":"/healthcare/clinical/operation-categories","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"benefit-limit-categories","label":"Kategori plafon","href":"/healthcare/clinical/benefit-limit-categories","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"supporting-devices","label":"Alat penunjang","href":"/healthcare/clinical/supporting-devices","section":"Klinis","permission":"healthcare.diagnosis-reference.read"},
                                {"id":"specialties","label":"Spesialis","href":"/healthcare/practitioner/specialties","section":"Tenaga kesehatan","permission":"healthcare.specialty.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
