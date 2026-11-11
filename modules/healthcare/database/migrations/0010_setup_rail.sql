-- Halaman pengaturan module ini dikumpulkan dalam satu rail "Setup", pola grup Setup di menu module F&O (keputusan
-- pemilik produk, 11 November 2026). Di dalamnya halaman dikelompokkan per domain dengan judul bagian dan garis
-- pemisah; judul bagian mengikuti folder domain di kode (`coverage/` = Penjaminan), dan URL tetap berawalan folder itu.
-- Domain pengaturan berikutnya (poli/section, tenaga kesehatan) menambah bagian di rail yang sama.
UPDATE public.apps
SET navigation = '[{"id":"dashboard","label":"Dashboard","icon":"layout-dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/healthcare/dashboard"}]},
    {"id":"patient","label":"Pasien","icon":"users","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patient/patients","permission":"healthcare.patient.read"}]},
    {"id":"setup","label":"Setup","icon":"settings","items":[
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/coverage/patient-types","section":"Penjaminan","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/coverage/guarantors","section":"Penjaminan","permission":"healthcare.guarantor.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';
