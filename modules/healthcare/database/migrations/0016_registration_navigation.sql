-- Grup rail Pendaftaran (R5): layar Kunjungan, yaitu daftar registrasi dan halaman penuh pendaftaran kunjungan.
-- Grup diletakkan sesudah Pasien dan sebelum Setup, tanpa menulis ulang menu. Menu yang sudah punya grup ini dilewati,
-- jadi migration aman diulang. Keputusan pemilik produk, 11 November 2026.

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(merged.g ORDER BY merged.position)
        FROM (SELECT g, ordinal::numeric AS position
              FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
              UNION ALL
              SELECT '{"id":"registration","label":"Pendaftaran","icon":"clipboard-list","items":[
                          {"id":"visits","label":"Kunjungan","href":"/healthcare/registration/visits","permission":"healthcare.visit.read"}]}'::jsonb,
                     coalesce((SELECT ordinal + 0.5
                               FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
                               WHERE g->>'id' = 'patient'),
                              (SELECT ordinal - 0.5
                               FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
                               WHERE g->>'id' = 'setup'),
                              jsonb_array_length(a.navigation) + 1)) AS merged(g, position)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare'
  AND jsonb_typeof(a.navigation) = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.navigation) existing WHERE existing->>'id' = 'registration');
