-- Menu module di Shell. Core membaca apps.navigation setiap module dan menyaringnya dengan permission tiap entri,
-- sama dengan menu Core, jadi label menu datang dari baris ini, bukan dari kode Core.

UPDATE public.apps
SET navigation = '[{"id":"healthcare-patients","label":"Pasien","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patients","permission":"healthcare.patient.read"},
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/patient-types","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/guarantors","permission":"healthcare.guarantor.read"}]}]'::jsonb,
    has_ui = true,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';
