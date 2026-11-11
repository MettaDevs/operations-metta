-- Menu module per folder area (keputusan pemilik produk, 11 November 2026). Katalog aplikasi Shell menampilkan module ini
-- sebagai satu aplikasi bernama apps.name; grup menu di rail sama dengan folder di src/: `dashboard/` (dashboard area ini, halaman
-- pertama dan halaman awal pengguna; tanpa permission, dan tidak membuat area tampil sendirian), `patient/` (pasien
-- dan berbagi pasien), dan `coverage/` (tipe pasien dan penjamin). URL halaman berawalan folder itu; URL lama
-- dialihkan oleh layar.

UPDATE public.apps
SET navigation = '[{"id":"dashboard","label":"Dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/healthcare/dashboard"}]},
    {"id":"patient","label":"Pasien","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patient/patients","permission":"healthcare.patient.read"},
        {"id":"sharing-policies","label":"Berbagi pasien antar perusahaan","href":"/healthcare/patient/sharing-policies","permission":"healthcare.patient-sharing.read"}]},
    {"id":"coverage","label":"Penjaminan","items":[
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/coverage/patient-types","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/coverage/guarantors","permission":"healthcare.guarantor.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';
