-- Master section dan ruangan. Section adalah poli atau titik layanan lain di satu operating unit (faskes), padanan
-- SIMmSection sistem lama; ruangan adalah ruang fisik di operating unit itu. Pendaftaran kunjungan kelak memilih
-- section; ruangan tidak dipilih saat pendaftaran dan tidak ditetapkan di jadwal dokter, melainkan dipilih petugas yang
-- memanggil pasien berikutnya. Keputusan pemilik produk, 11 November 2026.
--
-- 1. Katalog izin section dan ruangan: permission read/create/update/delete, privilege lihat/pelihara/hapus, dan duty
--    "Lihat section dan ruangan" dan "Kelola section dan ruangan". Keduanya master setup tenant seperti tipe pasien dan
--    penjamin, jadi tidak dilindungi kebijakan data per unit; unitnya hanya isian.
-- 2. Role pemilik tenant yang sudah memasang module ini mendapat kedua duty, sama dengan yang diberikan installModule
--    kepada tenant yang memasangnya sesudah migration ini.
-- 3. sim_m_section. Jenis section disimpan sebagai kode dari katalog di kode (section.kinds.ts), seperti perilaku tipe
--    pasien; labelnya di kode. Tidak ada kode otomatis: master setup kecil, aturan "kode hanya bila dipakai".
--    kode_no_bukti adalah kode pendek yang diketik pengguna dan kelak menjadi segmen nomor pemeriksaan.
--    Antrean: mode_antrean adalah kode dari katalog di kode (section.queue-modes.ts). `bersama`: satu nomor per section
--    per hari dipakai semua ruangan section, dan ruangan terikat saat ruangan memanggil pasien, seperti sistem lama
--    (satu antrean Poli Umum untuk L1R1..L2R2). `per_jadwal`: satu nomor per sesi praktik atau jadwal dokter.
--    awalan_antrean adalah awalan pendek nomor, misalnya "A" menjadi A-012. Nomor antrean mulai lagi setiap hari;
--    belum ada yang menerbitkan nomor, pendaftaran kunjungan yang kelak melakukannya.
-- 4. sim_m_ruangan: ruang fisik per operating unit, kode unik per unit selama belum dihapus.
-- 5. sim_m_section_ruangan: ruangan yang melayani section. Banyak ke banyak, karena satu ruang fisik bisa melayani
--    "Poli Umum" dan "Poli Umum Sore" yang sengaja dipisah supaya laporan bisa menyaringnya. Section dan ruangannya
--    harus di operating unit yang sama; service yang menjaganya.
-- 6. Menu: rail Setup mendapat bagian Pelayanan (folder `service/`) berisi Section dan Ruangan.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.section.form', 'healthcare', 'Layar section', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.form', 'healthcare', 'Layar ruangan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.section.read', 'healthcare', 'healthcare.section.form', 'read', 'Lihat section',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.section.create', 'healthcare', 'healthcare.section.form', 'create', 'Tambah section',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.section.update', 'healthcare', 'healthcare.section.form', 'update', 'Ubah section',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.section.delete', 'healthcare', 'healthcare.section.form', 'delete', 'Hapus section',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.read', 'healthcare', 'healthcare.room.form', 'read', 'Lihat ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.create', 'healthcare', 'healthcare.room.form', 'create', 'Tambah ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.update', 'healthcare', 'healthcare.room.form', 'update', 'Ubah ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.delete', 'healthcare', 'healthcare.room.form', 'delete', 'Hapus ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.section.view', 'healthcare', 'Melihat section', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.section.maintain', 'healthcare', 'Menambah dan memelihara section',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.section.retire', 'healthcare', 'Menghapus section', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.view', 'healthcare', 'Melihat ruangan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.maintain', 'healthcare', 'Menambah dan memelihara ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.room.retire', 'healthcare', 'Menghapus ruangan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.section.view', 'healthcare.section.read'),
       ('healthcare.section.maintain', 'healthcare.section.read'),
       ('healthcare.section.maintain', 'healthcare.section.create'),
       ('healthcare.section.maintain', 'healthcare.section.update'),
       ('healthcare.section.retire', 'healthcare.section.read'),
       ('healthcare.section.retire', 'healthcare.section.delete'),
       ('healthcare.room.view', 'healthcare.room.read'),
       ('healthcare.room.maintain', 'healthcare.room.read'),
       ('healthcare.room.maintain', 'healthcare.room.create'),
       ('healthcare.room.maintain', 'healthcare.room.update'),
       ('healthcare.room.retire', 'healthcare.room.read'),
       ('healthcare.room.retire', 'healthcare.room.delete')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.service-setup.inquire', 'healthcare', 'Lihat section dan ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.service-setup.manage', 'healthcare', 'Kelola section dan ruangan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.service-setup.inquire', 'healthcare.section.view'),
       ('healthcare.service-setup.inquire', 'healthcare.room.view'),
       ('healthcare.service-setup.manage', 'healthcare.section.maintain'),
       ('healthcare.service-setup.manage', 'healthcare.section.retire'),
       ('healthcare.service-setup.manage', 'healthcare.room.maintain'),
       ('healthcare.service-setup.manage', 'healthcare.room.retire')
ON CONFLICT DO NOTHING;

-- 2. Duty untuk role pemilik --------------------------------------------------------------------------------------

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('healthcare.service-setup.inquire'), ('healthcare.service-setup.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

-- 3. Section -------------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_section (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    nama character varying(100) NOT NULL,
    jenis character varying(30) NOT NULL,
    kode_no_bukti character varying(10),
    kode_poli_bpjs character varying(20),
    mode_antrean character varying(30) DEFAULT 'bersama' NOT NULL,
    awalan_antrean character varying(5),
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_section_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_section_tenant_id_id_unique UNIQUE (tenant_id, id)
);
-- Nama section unik per operating unit; section yang dihapus melepas namanya.
CREATE UNIQUE INDEX sim_m_section_nama_unique
    ON public.sim_m_section USING btree (tenant_id, operating_unit_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

-- 4. Ruangan -------------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_ruangan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    lantai character varying(50),
    nama character varying(100) NOT NULL,
    nama_tampilan character varying(100),
    urutan integer DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_ruangan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_ruangan_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_ruangan_kode_unique
    ON public.sim_m_ruangan USING btree (tenant_id, operating_unit_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- 5. Ruangan section -----------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_section_ruangan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    section_id uuid NOT NULL,
    ruangan_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_section_ruangan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_section_ruangan_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_section_ruangan_ruangan_foreign
        FOREIGN KEY (tenant_id, ruangan_id) REFERENCES public.sim_m_ruangan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_section_ruangan_unique
    ON public.sim_m_section_ruangan USING btree (tenant_id, section_id, ruangan_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_section_ruangan_ruangan_index
    ON public.sim_m_section_ruangan USING btree (tenant_id, ruangan_id) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_section
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_section_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_section
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_section_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_section
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_section_ruangan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 6. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps
SET navigation = '[{"id":"dashboard","label":"Dashboard","icon":"layout-dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/healthcare/dashboard"}]},
    {"id":"patient","label":"Pasien","icon":"users","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patient/patients","permission":"healthcare.patient.read"}]},
    {"id":"setup","label":"Setup","icon":"settings","items":[
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/coverage/patient-types","section":"Penjaminan","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/coverage/guarantors","section":"Penjaminan","permission":"healthcare.guarantor.read"},
        {"id":"sections","label":"Section","href":"/healthcare/service/sections","section":"Pelayanan","permission":"healthcare.section.read"},
        {"id":"rooms","label":"Ruangan","href":"/healthcare/service/rooms","section":"Pelayanan","permission":"healthcare.room.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';
