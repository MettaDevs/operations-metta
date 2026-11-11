-- Jadwal praktik nakes per section. Pendaftaran kunjungan kelak menawarkan nakes yang punya jadwal praktik di section
-- itu pada hari itu; tidak ada tabel penugasan nakes ke section terpisah (keputusan pemilik produk, 11 November 2026).
--
-- Bentuknya mengikuti sistem lama (template mingguan SIMtrDokterJagaDefault, jadwal bertanggal SIMtrDokterJagaDetail,
-- sesi SIMmWaktuPraktek, prosedur GenerateJadwalDokterMingguan) dengan pola F&O "Compose working times": template
-- mingguan disusun menjadi baris bertanggal, dan penyusunan aman diulang. Yang sengaja berbeda dari sistem lama:
-- - Batal mengisi status dan alasan, tidak menghapus baris.
-- - Nakes pengganti disimpan di baris bertanggal dan dipakai pendaftaran.
-- - Kapasitas angka, bukan teks. NULL berarti tanpa batas; angka yang diisi paling kecil 1.
-- - Sesi yang lewat tengah malam (20:00 sampai 08:00) mencatat tanggal selesainya sendiri (berakhir_tanggal).
-- - Penyusunan ulang memperbarui baris yang belum disentuh, sehingga perubahan template sampai ke hari bertanggal.
-- - Hari libur datang dari kalender Core yang dipasang di template, bukan dari tabel libur module.
--
-- 1. Katalog izin: permission read/create/update/delete, privilege lihat/pelihara/hapus, duty "Lihat jadwal praktik"
--    dan "Kelola jadwal praktik". Role pemilik tenant yang sudah memasang module ini mendapat keduanya; tenant yang
--    memasangnya sesudah migration ini mendapatkannya dari installModule.
-- 2. sim_m_sesi_praktik: sesi praktik, misalnya Pagi 08:00-12:00. Master setup kecil tanpa kode.
-- 3. sim_m_jadwal_template: template mingguan per nakes, section, hari, dan sesi. hari 1..7 = Senin..Minggu (ISO);
--    hari 8 = template hari libur, dipakai hanya pada tanggal yang ditutup kalender template itu.
-- 4. sim_tr_jadwal_praktik: jadwal bertanggal hasil penyusunan, tambahan manual, atau kelak impor BPJS.
-- 5. Change log untuk ketiga tabel.
-- 6. Menu: rail Setup, bagian Pelayanan, mendapat Sesi praktik, Template jadwal, dan Jadwal praktik.
--
-- Kuota per tipe pasien (QuotaAntrian dan QuotaAntrianBPJS sistem lama) belum dibuat: belum ada pendaftaran yang
-- membacanya. Ia menyusul bersama pendaftaran kunjungan.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.practice-schedule.form', 'healthcare', 'Layar jadwal praktik', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.practice-schedule.read', 'healthcare', 'healthcare.practice-schedule.form', 'read',
        'Lihat jadwal praktik', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.create', 'healthcare', 'healthcare.practice-schedule.form', 'create',
        'Tambah jadwal praktik', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.update', 'healthcare', 'healthcare.practice-schedule.form', 'update',
        'Ubah jadwal praktik', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.delete', 'healthcare', 'healthcare.practice-schedule.form', 'delete',
        'Hapus jadwal praktik', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.practice-schedule.view', 'healthcare', 'Melihat jadwal praktik',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.maintain', 'healthcare', 'Menyusun dan memelihara jadwal praktik',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.retire', 'healthcare', 'Menghapus sesi dan template jadwal praktik',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.practice-schedule.view', 'healthcare.practice-schedule.read'),
       ('healthcare.practice-schedule.maintain', 'healthcare.practice-schedule.read'),
       ('healthcare.practice-schedule.maintain', 'healthcare.practice-schedule.create'),
       ('healthcare.practice-schedule.maintain', 'healthcare.practice-schedule.update'),
       ('healthcare.practice-schedule.retire', 'healthcare.practice-schedule.read'),
       ('healthcare.practice-schedule.retire', 'healthcare.practice-schedule.delete')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.practice-schedule.inquire', 'healthcare', 'Lihat jadwal praktik',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practice-schedule.manage', 'healthcare', 'Kelola jadwal praktik',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.practice-schedule.inquire', 'healthcare.practice-schedule.view'),
       ('healthcare.practice-schedule.manage', 'healthcare.practice-schedule.maintain'),
       ('healthcare.practice-schedule.manage', 'healthcare.practice-schedule.retire')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('healthcare.practice-schedule.inquire'), ('healthcare.practice-schedule.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- 2. Sesi praktik --------------------------------------------------------------------------------------------------

-- lewat_tengah_malam dihitung dari jamnya: selesai pada atau sebelum jam mulai berarti selesai besok, sehingga
-- 08:00-08:00 adalah jaga 24 jam.
CREATE TABLE public.sim_m_sesi_praktik (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nama character varying(50) NOT NULL,
    jam_mulai time(0) without time zone NOT NULL,
    jam_selesai time(0) without time zone NOT NULL,
    lewat_tengah_malam boolean GENERATED ALWAYS AS (jam_selesai <= jam_mulai) STORED,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_sesi_praktik_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_sesi_praktik_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_sesi_praktik_nama_unique
    ON public.sim_m_sesi_praktik USING btree (tenant_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

-- 3. Template jadwal -----------------------------------------------------------------------------------------------

-- calendar_id menunjuk kalender Core (working_time_calendars) tanpa foreign key, sama seperti kolom unit di section:
-- module tidak mengikat tabelnya ke tabel Core. Service memeriksa kalendernya milik tenant yang sama.
CREATE TABLE public.sim_m_jadwal_template (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nakes_id uuid NOT NULL,
    section_id uuid NOT NULL,
    hari smallint NOT NULL,
    sesi_id uuid NOT NULL,
    kapasitas integer,
    calendar_id uuid,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_jadwal_template_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_jadwal_template_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_jadwal_template_hari_check CHECK (hari BETWEEN 1 AND 8),
    CONSTRAINT sim_m_jadwal_template_kapasitas_check CHECK (kapasitas IS NULL OR kapasitas > 0),
    CONSTRAINT sim_m_jadwal_template_libur_check CHECK (hari < 8 OR calendar_id IS NOT NULL),
    CONSTRAINT sim_m_jadwal_template_berlaku_check CHECK (berlaku_sampai IS NULL OR berlaku_sampai >= berlaku_mulai),
    CONSTRAINT sim_m_jadwal_template_nakes_foreign
        FOREIGN KEY (tenant_id, nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_jadwal_template_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_jadwal_template_sesi_foreign
        FOREIGN KEY (tenant_id, sesi_id) REFERENCES public.sim_m_sesi_praktik(tenant_id, id) ON DELETE RESTRICT
);
-- Satu template aktif per nakes, section, hari, dan sesi.
CREATE UNIQUE INDEX sim_m_jadwal_template_unique
    ON public.sim_m_jadwal_template USING btree (tenant_id, nakes_id, section_id, hari, sesi_id)
    WHERE (deleted_at IS NULL AND aktif);
CREATE INDEX sim_m_jadwal_template_section_index
    ON public.sim_m_jadwal_template USING btree (tenant_id, section_id) WHERE (deleted_at IS NULL);

-- 4. Jadwal praktik bertanggal -------------------------------------------------------------------------------------

-- Jam dan kapasitas disalin dari sesi dan template, supaya jadwal yang sudah dipakai pendaftaran tidak berubah diam-diam
-- ketika master diubah. Penyusunan hanya menulis ulang baris dari template yang belum disentuh: diubah_manual false
-- dan jumlah_terdaftar 0. jumlah_terdaftar kelak dinaikkan pendaftaran kunjungan.
CREATE TABLE public.sim_tr_jadwal_praktik (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tanggal date NOT NULL,
    nakes_id uuid NOT NULL,
    section_id uuid NOT NULL,
    sesi_id uuid NOT NULL,
    jam_mulai time(0) without time zone NOT NULL,
    jam_selesai time(0) without time zone NOT NULL,
    berakhir_tanggal date NOT NULL,
    kapasitas integer,
    sumber character varying(20) NOT NULL,
    template_id uuid,
    status character varying(20) DEFAULT 'terjadwal' NOT NULL,
    alasan_batal character varying(200),
    nakes_pengganti_id uuid,
    jumlah_terdaftar integer DEFAULT 0 NOT NULL,
    diubah_manual boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_jadwal_praktik_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_jadwal_praktik_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_tr_jadwal_praktik_sumber_check CHECK (sumber IN ('template', 'manual', 'impor_bpjs')),
    CONSTRAINT sim_tr_jadwal_praktik_status_check CHECK (status IN ('terjadwal', 'batal')),
    CONSTRAINT sim_tr_jadwal_praktik_kapasitas_check CHECK (kapasitas IS NULL OR kapasitas > 0),
    CONSTRAINT sim_tr_jadwal_praktik_terdaftar_check CHECK (jumlah_terdaftar >= 0),
    CONSTRAINT sim_tr_jadwal_praktik_berakhir_check CHECK (berakhir_tanggal BETWEEN tanggal AND tanggal + 1),
    CONSTRAINT sim_tr_jadwal_praktik_pengganti_check CHECK (nakes_pengganti_id IS NULL OR nakes_pengganti_id <> nakes_id),
    CONSTRAINT sim_tr_jadwal_praktik_nakes_foreign
        FOREIGN KEY (tenant_id, nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_jadwal_praktik_pengganti_foreign
        FOREIGN KEY (tenant_id, nakes_pengganti_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_jadwal_praktik_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_jadwal_praktik_sesi_foreign
        FOREIGN KEY (tenant_id, sesi_id) REFERENCES public.sim_m_sesi_praktik(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_jadwal_praktik_template_foreign
        FOREIGN KEY (tenant_id, template_id) REFERENCES public.sim_m_jadwal_template(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_jadwal_praktik_unique
    ON public.sim_tr_jadwal_praktik USING btree (tenant_id, nakes_id, section_id, tanggal, sesi_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_jadwal_praktik_section_tanggal_index
    ON public.sim_tr_jadwal_praktik USING btree (tenant_id, section_id, tanggal) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_sesi_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_jadwal_template
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_jadwal_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_sesi_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_jadwal_template
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_jadwal_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_sesi_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_jadwal_template
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_jadwal_praktik
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 5. Change log ----------------------------------------------------------------------------------------------------

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('sim_m_sesi_praktik', 'Sesi praktik'),
             ('sim_m_jadwal_template', 'Template jadwal praktik'),
             ('sim_tr_jadwal_praktik', 'Jadwal praktik')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- 6. Menu ----------------------------------------------------------------------------------------------------------

-- Item ditambahkan ke grup setup tanpa menulis ulang menu; item yang id-nya sudah ada dilewati.
UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item ORDER BY position)
                            FROM jsonb_array_elements('[
                                {"id":"practice-sessions","label":"Sesi praktik","href":"/healthcare/service/practice-sessions","section":"Pelayanan","permission":"healthcare.practice-schedule.read"},
                                {"id":"schedule-templates","label":"Template jadwal","href":"/healthcare/service/schedule-templates","section":"Pelayanan","permission":"healthcare.practice-schedule.read"},
                                {"id":"practice-schedules","label":"Jadwal praktik","href":"/healthcare/service/practice-schedules","section":"Pelayanan","permission":"healthcare.practice-schedule.read"}]'::jsonb)
                                 WITH ORDINALITY AS added(item, position)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
