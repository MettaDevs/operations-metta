-- Pemeriksaan rawat jalan tahap 1: antrean poli dan pemanggilan pasien. Satu antrean per section per hari; ruangan
-- dipilih di tempat memanggil, jadi ruangan yang lebih dulu memanggil mendapat pasien berikutnya ke ruangannya.
-- Ruangan tidak dipilih saat pendaftaran dan tidak ditetapkan di jadwal. Keputusan pemilik produk, 12 November 2026.
--
-- Sistem lama tidak mengunci antar-ruangan, tidak menyimpan keadaan panggilan (hanya mengirim ke layar TV lewat
-- websocket), dan statusnya tersebar. Di sini:
-- - Keadaan tujuan sekarang tetap di sim_tr_registrasi_tujuan: status, ruangan, dan posisi antrean.
-- - Setiap tindakan antrean dicatat satu baris di sim_tr_antrean_panggilan (panggil, panggil ulang, lewati, tidak
--   datang, mulai periksa, selesai periksa) beserta ruangan, orang, dan waktunya. Riwayat ini data operasional,
--   misalnya untuk layar antrean dan lama tunggu, jadi tidak bergantung pada setelan change log tenant.
--
-- 1. Katalog izin: permission read/manage, privilege lihat/panggil dan periksa, duty "Lihat antrean pemeriksaan" dan
--    "Panggil dan periksa pasien". Role pemilik tenant yang sudah memasang module ini mendapat keduanya. Permission
--    ikut dilindungi kebijakan data per unit, karena kunjungan milik satu operating unit.
-- 2. Status tujuan tidak_datang dan posisi antrean.
-- 3. Riwayat tindakan antrean.
-- 4. Grup rail Pemeriksaan sesudah Pendaftaran.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.examination.form', 'healthcare', 'Layar antrean dan pemeriksaan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.examination.read', 'healthcare', 'healthcare.examination.form', 'read', 'Lihat antrean pemeriksaan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.examination.manage', 'healthcare', 'healthcare.examination.form', 'update',
        'Panggil dan periksa pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.examination.view', 'healthcare', 'Melihat antrean pemeriksaan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.examination.perform', 'healthcare', 'Memanggil dan memeriksa pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.examination.view', 'healthcare.examination.read'),
       ('healthcare.examination.perform', 'healthcare.examination.read'),
       ('healthcare.examination.perform', 'healthcare.examination.manage')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.examination.inquire', 'healthcare', 'Lihat antrean pemeriksaan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.examination.manage', 'healthcare', 'Panggil dan periksa pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.examination.inquire', 'healthcare.examination.view'),
       ('healthcare.examination.manage', 'healthcare.examination.perform')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, d.code
FROM public.roles r
CROSS JOIN (VALUES ('healthcare.examination.inquire'), ('healthcare.examination.manage')) AS d(code)
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

UPDATE public.app_data_policies
SET protected_permissions = (
        SELECT json_agg(code ORDER BY code)
        FROM (SELECT jsonb_array_elements_text(protected_permissions::jsonb) AS code
              UNION
              SELECT unnest(ARRAY['healthcare.examination.read', 'healthcare.examination.manage'])) codes),
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient-unit';

-- 2. Status dan posisi tujuan --------------------------------------------------------------------------------------

-- tidak_datang: dipanggil tetapi tidak datang. Panggil berikutnya tidak memilihnya lagi; bila pasien datang
-- belakangan, petugas memulai pemeriksaannya langsung dari daftar.
ALTER TABLE public.sim_tr_registrasi_tujuan DROP CONSTRAINT sim_tr_registrasi_tujuan_status_check;
ALTER TABLE public.sim_tr_registrasi_tujuan ADD CONSTRAINT sim_tr_registrasi_tujuan_status_check
    CHECK (status IN ('menunggu', 'dipanggil', 'diperiksa', 'selesai', 'tidak_datang', 'batal'));

-- Posisi antrean. Kosong berarti nomor antreannya sendiri. Lewati mengisinya dengan posisi terbesar di section dan
-- tanggal itu ditambah satu: nomornya tetap, tetapi ia dipanggil sesudah pasien yang sedang menunggu saat itu.
ALTER TABLE public.sim_tr_registrasi_tujuan ADD COLUMN posisi_antrean integer;

CREATE INDEX sim_tr_registrasi_tujuan_antrean_index
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, section_id, status) WHERE (deleted_at IS NULL);

-- 3. Riwayat tindakan antrean --------------------------------------------------------------------------------------

-- Satu baris per tindakan, ditulis di transaksi tindakan itu dan tidak pernah diubah atau dihapus, sama dengan
-- penghitung antrean, jadi tidak membawa deleted_at maupun version.
CREATE TABLE public.sim_tr_antrean_panggilan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tujuan_id uuid NOT NULL,
    ruangan_id uuid,
    aksi character varying(20) NOT NULL,
    dilakukan_oleh uuid NOT NULL,
    dilakukan_pada timestamp(0) without time zone NOT NULL,
    CONSTRAINT sim_tr_antrean_panggilan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_antrean_panggilan_aksi_check
        CHECK (aksi IN ('panggil', 'panggil_ulang', 'lewati', 'tidak_datang', 'mulai_periksa', 'selesai_periksa')),
    CONSTRAINT sim_tr_antrean_panggilan_tujuan_foreign
        FOREIGN KEY (tenant_id, tujuan_id) REFERENCES public.sim_tr_registrasi_tujuan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_tr_antrean_panggilan_ruangan_foreign
        FOREIGN KEY (tenant_id, ruangan_id) REFERENCES public.sim_m_ruangan(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX sim_tr_antrean_panggilan_tujuan_index
    ON public.sim_tr_antrean_panggilan USING btree (tenant_id, tujuan_id, dilakukan_pada);

-- 4. Menu ----------------------------------------------------------------------------------------------------------

-- Grup diletakkan sesudah Pendaftaran tanpa menulis ulang menu. Menu yang sudah punya grup ini dilewati, jadi
-- migration aman diulang.
UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(merged.g ORDER BY merged.position)
        FROM (SELECT g, ordinal::numeric AS position
              FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
              UNION ALL
              SELECT '{"id":"examination","label":"Pemeriksaan","icon":"stethoscope","items":[
                          {"id":"queue","label":"Antrean poli","href":"/healthcare/examination/queue","permission":"healthcare.examination.read"}]}'::jsonb,
                     coalesce((SELECT ordinal + 0.5
                               FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
                               WHERE g->>'id' = 'registration'),
                              (SELECT ordinal - 0.5
                               FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
                               WHERE g->>'id' = 'setup'),
                              jsonb_array_length(a.navigation) + 1)) AS merged(g, position)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare'
  AND jsonb_typeof(a.navigation) = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.navigation) existing WHERE existing->>'id' = 'examination');
