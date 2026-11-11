-- Ikon module dan label "Sharing master pasien" (keputusan pemilik produk, 11 November 2026).
--
-- 1. Ikon module di katalog aplikasi (`apps.icon`, Core 0016) dan ikon setiap grup menu di rail (`icon` di setiap grup
--    `apps.navigation`). Isinya nama ikon lucide; nama yang tidak dikenal Shell memakai ikon bawaan.
-- 2. Kata "berbagi" pada teks layar fitur ini diganti "sharing" ("pokoknya jangan berbagi, pakai Inggris di sana"):
--    menu, tujuan hierarki, katalog izin yang tampil di layar role, dan judul tabel di change log. Nama tabel dan kolom
--    tidak diubah. Migration lama tidak disunting; ini yang menimpanya.

-- 1. Ikon dan menu ---------------------------------------------------------------------------------------------------

UPDATE public.apps
SET icon = 'heart-pulse',
    navigation = '[{"id":"dashboard","label":"Dashboard","icon":"layout-dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/healthcare/dashboard"}]},
    {"id":"patient","label":"Pasien","icon":"users","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patient/patients","permission":"healthcare.patient.read"},
        {"id":"sharing-policies","label":"Sharing master pasien","href":"/healthcare/patient/sharing-policies","permission":"healthcare.patient-sharing.read"}]},
    {"id":"coverage","label":"Penjaminan","icon":"shield-plus","items":[
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/coverage/patient-types","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/coverage/guarantors","permission":"healthcare.guarantor.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';

-- 2. "berbagi" menjadi "sharing" -------------------------------------------------------------------------------------

UPDATE public.hierarchy_purposes
SET name = 'Kelompok sharing pasien', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient-sharing';

UPDATE public.app_entry_points
SET name = replace(name, 'berbagi', 'sharing'), updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.patient-sharing.form';

UPDATE public.permissions
SET name = replace(name, 'berbagi', 'sharing'), updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.patient-sharing.read', 'healthcare.patient-sharing.update');

UPDATE public.security_privileges
SET name = replace(name, 'berbagi', 'sharing'), updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.patient-sharing.view', 'healthcare.patient-sharing.maintain');

UPDATE public.security_duties
SET name = replace(name, 'berbagi', 'sharing'), updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('healthcare.patient-sharing.inquire', 'healthcare.patient-sharing.manage');

UPDATE public.change_log_setup_tables
SET table_caption = replace(table_caption, 'berbagi', 'sharing'), updated_at = now() AT TIME ZONE 'utc'
WHERE tenant_id IS NULL AND table_name IN ('sim_m_kebijakan_berbagi', 'sim_m_kebijakan_berbagi_perusahaan');
