-- Kartu Jasa sistem lama (Admin → Setup Jasa → Jasa, modules/admin/service/views/form.php) dipindah 1:1: isian header
-- kartu itu, Kategori jasa di bawah Kelompok jasa, dan tab Detail Section. Arahan pemilik produk 13 November 2026: jasa,
-- komponen jasa, dan semua turunannya mengikuti sistem lama lebih dulu, perbaikan sesudahnya.
--
-- 1. Kategori tindakan (SIMmKategoriBiaya, layar Kategori jasa): kode, nama, nama internasional, dan kelompok, seperti
--    form kategori sistem lama. Dipakai 49 kategori di Kuta, 30 di Seroja, dan 53 di Penta. Sistem lama membuat kode
--    otomatis (gen_category_code, KB046); di sini kodenya pendek dan diketik pengguna, aturan repo untuk master setup
--    kecil.
-- 2. Isian header kartu Jasa di tindakan, urutan form sistem lama: nama internasional (JasaNameEnglish), kategori
--    (KategoriJasaID), Cost RS persen dan rupiah, kelompok posting (KelompokPostingan), sumber insentif
--    (ModelInsentif), poliklinik (PoliKlinik), lalu centang status: paket jasa, klinik reproduksi, tarif manual, hari
--    rawat inap, MCU, auto system, KSO, variabel kategori operasi, variabel cyto, harus dengan dokter, dan menggunakan
--    alat penunjang. Pilihan kelompok posting, sumber insentif, dan poliklinik adalah daftar tetap di kode sistem lama
--    (Service_model::dropdown_static), jadi di sini juga katalog kode (procedure.options.ts) dengan kode yang sama, dan
--    nilai bawaannya nilai yang terisi di semua jasa Kuta (GROUP JASA, NONE). Kartu Jasa sistem lama menyaring pilihan
--    kategori menurut kelompok yang dipilih (dropdown_html kategori per GroupJasaID), jadi kategori tindakan harus milik
--    kelompok tindakannya. Kategori plafon dan alat yang dipakai menunggu masternya.
-- 3. Section tindakan (SIMmListJasaSection): tindakan ini ditawarkan di section itu. Pilihan Biaya Tindakan di
--    pemeriksaan hanya menampilkan tindakan section pemeriksaan, kecuali Tampil semua dicentang
--    (common/controllers/Services.php::datatable_charge_collection).
-- 4. Tindakan yang sudah ada ditawarkan di semua section tenantnya, supaya pilihan Biaya Tindakan yang sampai sekarang
--    menampilkan semua tindakan tidak tiba-tiba kosong. Di Kuta pun semua jasa punya minimal satu section.
-- 5. Trigger versi, aktor, dan change log.
-- 6. Menu: Setup → Klinis → Kategori tindakan, dengan izin tindakan, karena kategori bagian dari setup tindakan.
--
-- sim_m_tindakan_kelompok.urutan (SIMmGroupJasa.NoUrut, urutan kwitansi) sudah ada sejak 0025 dan diatur di layar
-- Kelompok tindakan.

-- 1. Kategori tindakan ---------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_tindakan_kategori (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kelompok_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(150) NOT NULL,
    nama_internasional character varying(150),
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tindakan_kategori_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tindakan_kategori_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_tindakan_kategori_kelompok_foreign
        FOREIGN KEY (tenant_id, kelompok_id) REFERENCES public.sim_m_tindakan_kelompok(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tindakan_kategori_kode_unique
    ON public.sim_m_tindakan_kategori USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_kategori_kelompok_index
    ON public.sim_m_tindakan_kategori USING btree (tenant_id, kelompok_id) WHERE (deleted_at IS NULL);

-- 2. Isian header kartu Jasa di tindakan ---------------------------------------------------------------------------

ALTER TABLE public.sim_m_tindakan
    ADD COLUMN nama_internasional character varying(200),
    ADD COLUMN kategori_id uuid,
    ADD COLUMN cost_rs_persen numeric(5,2) DEFAULT 0 NOT NULL,
    ADD COLUMN cost_rs_rupiah numeric(18,2) DEFAULT 0 NOT NULL,
    ADD COLUMN kelompok_posting character varying(20) DEFAULT 'GROUP JASA' NOT NULL,
    ADD COLUMN sumber_insentif character varying(20) DEFAULT 'NONE' NOT NULL,
    ADD COLUMN poliklinik character varying(20) DEFAULT 'NONE' NOT NULL,
    ADD COLUMN paket boolean DEFAULT false NOT NULL,
    ADD COLUMN klinik_reproduksi boolean DEFAULT false NOT NULL,
    ADD COLUMN tarif_manual boolean DEFAULT false NOT NULL,
    ADD COLUMN hari_rawat_inap boolean DEFAULT false NOT NULL,
    ADD COLUMN mcu boolean DEFAULT false NOT NULL,
    ADD COLUMN auto_system boolean DEFAULT false NOT NULL,
    ADD COLUMN kso boolean DEFAULT false NOT NULL,
    ADD COLUMN variabel_kategori_operasi boolean DEFAULT false NOT NULL,
    ADD COLUMN variabel_cyto boolean DEFAULT false NOT NULL,
    ADD COLUMN harus_dengan_dokter boolean DEFAULT false NOT NULL,
    ADD COLUMN menggunakan_alat boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT sim_m_tindakan_cost_rs_check CHECK (cost_rs_persen >= 0 AND cost_rs_rupiah >= 0),
    ADD CONSTRAINT sim_m_tindakan_kategori_foreign
        FOREIGN KEY (tenant_id, kategori_id) REFERENCES public.sim_m_tindakan_kategori(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_m_tindakan_kategori_index
    ON public.sim_m_tindakan USING btree (tenant_id, kategori_id) WHERE (deleted_at IS NULL);

-- 3. Section tindakan ----------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_tindakan_section (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tindakan_id uuid NOT NULL,
    section_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tindakan_section_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tindakan_section_tindakan_foreign
        FOREIGN KEY (tenant_id, tindakan_id) REFERENCES public.sim_m_tindakan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_section_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tindakan_section_unique
    ON public.sim_m_tindakan_section USING btree (tenant_id, tindakan_id, section_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_section_section_index
    ON public.sim_m_tindakan_section USING btree (tenant_id, section_id) WHERE (deleted_at IS NULL);

-- 4. Tindakan yang sudah ada ditawarkan di semua section ------------------------------------------------------------

INSERT INTO public.sim_m_tindakan_section (id, tenant_id, tindakan_id, section_id, created_at, updated_at)
SELECT gen_random_uuid(), t.tenant_id, t.id, s.id, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.sim_m_tindakan t
JOIN public.sim_m_section s ON s.tenant_id = t.tenant_id AND s.deleted_at IS NULL
WHERE t.deleted_at IS NULL;

-- 5. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_tindakan_kategori', 'sim_m_tindakan_section']
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
FROM (VALUES ('sim_m_tindakan_kategori', 'Kategori tindakan'),
             ('sim_m_tindakan_section', 'Section tindakan')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"procedure-categories","label":"Kategori tindakan","href":"/healthcare/clinical/procedure-categories","section":"Klinis","permission":"healthcare.procedure.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
