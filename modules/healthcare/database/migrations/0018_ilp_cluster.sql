-- Klaster dan siklus hidup Integrasi Layanan Primer (ILP) puskesmas: setiap pendaftaran kunjungan mencatat klaster,
-- siklus hidup, dan status hamil pasien. Keputusan pemilik produk, 12 November 2026: semuanya data acuan di database,
-- bukan aturan di kode. Sistem lama menulisnya di kode (Registrations.php: SEC018 menjadi Klaster 4, perempuan hamil
-- atau di bawah 18 tahun Klaster 2, 18 tahun ke atas Klaster 3, selain itu Klaster 5) dan menghitung ulang siklus hidup
-- di layar poli.
--
-- 1. Katalog izin: permission, privilege, dan duty "Lihat klaster dan siklus hidup" serta "Kelola klaster dan siklus
--    hidup". Role pemilik tenant yang sudah memasang module ini mendapat duty kelola; tenant yang memasang sesudahnya
--    mendapatkannya dari installModule.
-- 2. sim_m_klaster: lima klaster ILP Kemenkes per tenant.
-- 3. sim_m_siklus_hidup: aturan yang memilih siklus hidup (dan klasternya) dari jenis kelamin, umur, dan status hamil
--    pasien. Umur disimpan dalam bulan genap, lihat catatan di tabel.
-- 4. sim_m_section_klaster: klaster yang dilayani section. Section tanpa baris melayani semua klaster.
-- 5. sim_tr_registrasi: status hamil, siklus hidup, dan klaster kunjungan.
-- 6. Data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya, sama
--    dengan pola data acuan pendaftaran di 0015.
-- 7. Change log dan menu: rail Setup mendapat bagian Klinis (folder `clinical/`) berisi Klaster dan Siklus hidup.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.cluster.form', 'healthcare', 'Layar klaster', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.life-cycle.form', 'healthcare', 'Layar siklus hidup', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.cluster.read', 'healthcare.cluster.form', 'read', 'Lihat klaster'),
             ('healthcare.cluster.create', 'healthcare.cluster.form', 'create', 'Tambah klaster'),
             ('healthcare.cluster.update', 'healthcare.cluster.form', 'update', 'Ubah klaster'),
             ('healthcare.cluster.delete', 'healthcare.cluster.form', 'delete', 'Hapus klaster'),
             ('healthcare.life-cycle.read', 'healthcare.life-cycle.form', 'read', 'Lihat siklus hidup'),
             ('healthcare.life-cycle.create', 'healthcare.life-cycle.form', 'create', 'Tambah siklus hidup'),
             ('healthcare.life-cycle.update', 'healthcare.life-cycle.form', 'update', 'Ubah siklus hidup'),
             ('healthcare.life-cycle.delete', 'healthcare.life-cycle.form', 'delete', 'Hapus siklus hidup'))
     AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'healthcare', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.cluster.view', 'Melihat klaster'),
             ('healthcare.cluster.maintain', 'Memelihara klaster'),
             ('healthcare.cluster.retire', 'Menghapus klaster'),
             ('healthcare.life-cycle.view', 'Melihat siklus hidup'),
             ('healthcare.life-cycle.maintain', 'Memelihara siklus hidup'),
             ('healthcare.life-cycle.retire', 'Menghapus siklus hidup')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.cluster.view', 'healthcare.cluster.read'),
       ('healthcare.cluster.maintain', 'healthcare.cluster.read'),
       ('healthcare.cluster.maintain', 'healthcare.cluster.create'),
       ('healthcare.cluster.maintain', 'healthcare.cluster.update'),
       ('healthcare.cluster.retire', 'healthcare.cluster.read'),
       ('healthcare.cluster.retire', 'healthcare.cluster.delete'),
       ('healthcare.life-cycle.view', 'healthcare.life-cycle.read'),
       ('healthcare.life-cycle.maintain', 'healthcare.life-cycle.read'),
       ('healthcare.life-cycle.maintain', 'healthcare.life-cycle.create'),
       ('healthcare.life-cycle.maintain', 'healthcare.life-cycle.update'),
       ('healthcare.life-cycle.retire', 'healthcare.life-cycle.read'),
       ('healthcare.life-cycle.retire', 'healthcare.life-cycle.delete')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.clinical-setup.inquire', 'healthcare', 'Lihat klaster dan siklus hidup',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.clinical-setup.manage', 'healthcare', 'Kelola klaster dan siklus hidup',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.clinical-setup.inquire', 'healthcare.cluster.view'),
       ('healthcare.clinical-setup.inquire', 'healthcare.life-cycle.view'),
       ('healthcare.clinical-setup.manage', 'healthcare.cluster.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.cluster.retire'),
       ('healthcare.clinical-setup.manage', 'healthcare.life-cycle.maintain'),
       ('healthcare.clinical-setup.manage', 'healthcare.life-cycle.retire')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'healthcare.clinical-setup.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- 2. Klaster -------------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_klaster (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(10) NOT NULL,
    nama character varying(150) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_klaster_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_klaster_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_klaster_kode_unique
    ON public.sim_m_klaster USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- 3. Siklus hidup --------------------------------------------------------------------------------------------------

-- Satu baris satu aturan. Kunjungan cocok dengan baris aktif bila jenis kelamin, umur, dan status hamilnya memenuhi;
-- dari yang cocok, prioritas terkecil menang, dan dua pemenang berprioritas sama ditolak sebagai pengaturan yang perlu
-- dibetulkan. Kolom kosong berarti tidak membatasi.
-- - Umur dalam bulan genap pada tanggal kunjungan, dihitung seperti age() PostgreSQL: 7 tahun = 84 bulan, dan anak
--   yang berulang tahun ke-7 hari ini sudah 84 bulan. Satuan bulan tepat di setiap ulang tahun, tidak seperti hari
--   (tahun kabisat), dan masih cukup halus untuk batas balita. umur_maks_bulan tidak termasuk.
-- - jenis_kelamin adalah kode jenis kelamin party Core (party_reference_values kategori gender).
-- - syarat_hamil true hanya untuk pasien hamil, false hanya untuk yang tidak hamil.
CREATE TABLE public.sim_m_siklus_hidup (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    klaster_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    umur_min_bulan smallint DEFAULT 0 NOT NULL,
    umur_maks_bulan smallint,
    jenis_kelamin character varying(200),
    syarat_hamil boolean,
    prioritas smallint DEFAULT 10 NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_siklus_hidup_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_siklus_hidup_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_siklus_hidup_umur_check
        CHECK (umur_min_bulan >= 0 AND (umur_maks_bulan IS NULL OR umur_maks_bulan > umur_min_bulan)),
    CONSTRAINT sim_m_siklus_hidup_prioritas_check CHECK (prioritas >= 0),
    CONSTRAINT sim_m_siklus_hidup_klaster_foreign
        FOREIGN KEY (tenant_id, klaster_id) REFERENCES public.sim_m_klaster(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_siklus_hidup_kode_unique
    ON public.sim_m_siklus_hidup USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- 4. Klaster yang dilayani section ---------------------------------------------------------------------------------

CREATE TABLE public.sim_m_section_klaster (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    section_id uuid NOT NULL,
    klaster_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_section_klaster_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_section_klaster_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_section_klaster_klaster_foreign
        FOREIGN KEY (tenant_id, klaster_id) REFERENCES public.sim_m_klaster(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_section_klaster_unique
    ON public.sim_m_section_klaster USING btree (tenant_id, section_id, klaster_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_section_klaster_klaster_index
    ON public.sim_m_section_klaster USING btree (tenant_id, klaster_id) WHERE (deleted_at IS NULL);

-- 5. Kunjungan -----------------------------------------------------------------------------------------------------

-- Kunjungan sebelum migration ini tidak punya siklus hidup dan klaster; kunjungan baru selalu punya.
ALTER TABLE public.sim_tr_registrasi
    ADD COLUMN status_hamil boolean DEFAULT false NOT NULL,
    ADD COLUMN siklus_hidup_id uuid,
    ADD COLUMN klaster_id uuid,
    ADD CONSTRAINT sim_tr_registrasi_siklus_hidup_foreign
        FOREIGN KEY (tenant_id, siklus_hidup_id) REFERENCES public.sim_m_siklus_hidup(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_registrasi_klaster_foreign
        FOREIGN KEY (tenant_id, klaster_id) REFERENCES public.sim_m_klaster(tenant_id, id) ON DELETE RESTRICT;

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_siklus_hidup
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_section_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_siklus_hidup
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_section_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_siklus_hidup
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_section_klaster
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 6. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan untuk satu tenant: lima klaster ILP Kemenkes dan siklus hidupnya. Setiap tabel diisi hanya bila tenant
-- belum punya baris sama sekali di tabel itu, termasuk yang sudah dihapus, sehingga pemasangan ulang tidak
-- mengembalikan pilihan yang sengaja dihapus tenant. Batas umur dalam bulan: 7 tahun 84, 18 tahun 216, 60 tahun 720.
CREATE FUNCTION public.sim_isi_acuan_ilp(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_klaster WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_klaster (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, k.kode, k.nama, k.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('K1', 'Manajemen', 1),
                     ('K2', 'Kesehatan Ibu dan Anak', 2),
                     ('K3', 'Kesehatan Dewasa dan Lanjut Usia', 3),
                     ('K4', 'Penanggulangan Penyakit Menular dan Kesehatan Lingkungan', 4),
                     ('K5', 'Lintas Klaster', 5)) AS k(kode, nama, urutan);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_siklus_hidup WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_siklus_hidup (id, tenant_id, klaster_id, kode, nama, umur_min_bulan, umur_maks_bulan,
                                               jenis_kelamin, syarat_hamil, prioritas, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, k.id, s.kode, s.nama, s.umur_min, s.umur_maks, s.jenis_kelamin,
               s.syarat_hamil, s.prioritas, s.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('IBU', 'Ibu Hamil, Bersalin dan Nifas', 'K2', 0, NULL::smallint, 'female', true, 1, 1),
                     ('BALITA', 'Balita dan Anak Prasekolah', 'K2', 0, 84::smallint, NULL, NULL::boolean, 10, 2),
                     ('ANAK', 'Anak Usia Sekolah dan Remaja', 'K2', 84, 216::smallint, NULL, NULL::boolean, 10, 3),
                     ('DEWASA', 'Usia Dewasa', 'K3', 216, 720::smallint, NULL, NULL::boolean, 10, 4),
                     ('LANSIA', 'Lanjut Usia', 'K3', 720, NULL::smallint, NULL, NULL::boolean, 10, 5))
             AS s(kode, nama, klaster, umur_min, umur_maks, jenis_kelamin, syarat_hamil, prioritas, urutan)
        JOIN public.sim_m_klaster k ON k.tenant_id = p_tenant AND k.kode = s.klaster AND k.deleted_at IS NULL;
    END IF;
END;
$$;

-- Sama dengan sim_isi_acuan_registrasi di 0015: catatan pemasangan adalah satu-satunya titik yang dilewati setiap jalur
-- pemasangan, sedangkan migration module berjalan sekali per database.
CREATE FUNCTION public.sim_isi_acuan_ilp_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_ilp(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_ilp AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_ilp_saat_dipasang();

SELECT public.sim_isi_acuan_ilp(i.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.core_module_installations
      WHERE module_id = 'healthcare' AND status = 'installed') i;

-- 7. Change log dan menu -------------------------------------------------------------------------------------------

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('sim_m_klaster', 'Klaster'),
             ('sim_m_siklus_hidup', 'Siklus hidup'),
             ('sim_m_section_klaster', 'Klaster section')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- Item ditambahkan ke grup setup tanpa menulis ulang menu; item yang id-nya sudah ada dilewati.
UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"clusters","label":"Klaster","href":"/healthcare/clinical/clusters","section":"Klinis","permission":"healthcare.cluster.read"},
                                {"id":"life-cycles","label":"Siklus hidup","href":"/healthcare/clinical/life-cycles","section":"Klinis","permission":"healthcare.life-cycle.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
