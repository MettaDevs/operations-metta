-- Kebijakan sharing pasien pindah ke Core (keputusan pemilik produk, 11 November 2026): Sys Admin → Data sharing,
-- pola "Configure cross-company data sharing" F&O. Module ini hanya mendaftarkan jenis datanya dan membaca kebijakan
-- lewat layanan Core (`@core/platform/data-sharing`) saat menghitung pasien yang terlihat.
--
-- 1. Jenis data "Master pasien" (`healthcare.patient`) di katalog Core.
-- 2. Kebijakan lama di sim_m_kebijakan_berbagi dan perusahaannya disalin ke tabel Core dengan id yang sama, termasuk
--    yang sudah diarsipkan, supaya riwayatnya tidak hilang. Aman dijalankan ulang: baris yang sudah ada dilewati.
-- 3. Role yang memegang duty kebijakan lama mendapat duty Core yang setara, supaya tidak ada yang kehilangan akses
--    diam-diam: kelola → core.data-sharing.manage, lihat → core.data-sharing.inquire. Duty, privilege, permission, dan
--    entry point `healthcare.patient-sharing.*` dibiarkan di katalog tanpa menjaga route apa pun; katalog tidak dihapus
--    fisik.
-- 4. Menu "Sharing master pasien" dilepas dari Layanan kesehatan; layarnya kini di Sys Admin.
-- 5. sim_m_kebijakan_berbagi dan sim_m_kebijakan_berbagi_perusahaan menjadi tabel yatim: tidak lagi dibaca atau ditulis,
--    tidak dihapus, dan ditandai lewat COMMENT. Change log-nya berhenti dengan sendirinya karena tidak ada lagi perubahan.

-- 1. Jenis data --------------------------------------------------------------------------------------------------------

INSERT INTO public.data_sharing_types (code, app_id, name, description, created_at, updated_at)
VALUES ('healthcare.patient', 'healthcare', 'Master pasien',
        'Perusahaan yang ikut saling melihat pasien. Kelompok di Hierarki organisasi tetap mempersempit di dalam satu perusahaan.',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- 2. Salin kebijakan lama ---------------------------------------------------------------------------------------------

INSERT INTO public.data_sharing_policies (id, tenant_id, name, data_type_code, is_active, effective_from, created_at,
                                          updated_at, deleted_at, created_by_user_id, updated_by_user_id, version)
SELECT p.id, p.tenant_id, p.nama, 'healthcare.patient', p.aktif, p.berlaku_mulai, p.created_at, p.updated_at,
       p.deleted_at, p.created_by_user_id, p.updated_by_user_id, p.version
FROM public.sim_m_kebijakan_berbagi p
WHERE NOT EXISTS (SELECT 1 FROM public.data_sharing_policies d WHERE d.id = p.id);

INSERT INTO public.data_sharing_policy_companies (id, tenant_id, policy_id, legal_entity_id, created_at, updated_at,
                                                  deleted_at, created_by_user_id, updated_by_user_id, version)
SELECT m.id, m.tenant_id, m.kebijakan_id, m.legal_entity_id, m.created_at, m.updated_at, m.deleted_at,
       m.created_by_user_id, m.updated_by_user_id, m.version
FROM public.sim_m_kebijakan_berbagi_perusahaan m
WHERE NOT EXISTS (SELECT 1 FROM public.data_sharing_policy_companies d WHERE d.id = m.id);

-- 3. Duty yang setara -------------------------------------------------------------------------------------------------

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT DISTINCT r.role_id, CASE r.duty_code WHEN 'healthcare.patient-sharing.manage' THEN 'core.data-sharing.manage'
                                            ELSE 'core.data-sharing.inquire' END
FROM public.security_role_duties r
WHERE r.duty_code IN ('healthcare.patient-sharing.manage', 'healthcare.patient-sharing.inquire')
ON CONFLICT DO NOTHING;

-- 4. Menu -------------------------------------------------------------------------------------------------------------

UPDATE public.apps
SET navigation = '[{"id":"dashboard","label":"Dashboard","icon":"layout-dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/healthcare/dashboard"}]},
    {"id":"patient","label":"Pasien","icon":"users","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patient/patients","permission":"healthcare.patient.read"}]},
    {"id":"coverage","label":"Penjaminan","icon":"shield-plus","items":[
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/coverage/patient-types","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/coverage/guarantors","permission":"healthcare.guarantor.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';

-- 5. Tabel yatim ------------------------------------------------------------------------------------------------------

COMMENT ON TABLE public.sim_m_kebijakan_berbagi IS
    'Yatim sejak healthcare 0008 (11 November 2026): isinya disalin ke data_sharing_policies milik Core. Tidak dibaca atau ditulis lagi.';
COMMENT ON TABLE public.sim_m_kebijakan_berbagi_perusahaan IS
    'Yatim sejak healthcare 0008 (11 November 2026): isinya disalin ke data_sharing_policy_companies milik Core. Tidak dibaca atau ditulis lagi.';
