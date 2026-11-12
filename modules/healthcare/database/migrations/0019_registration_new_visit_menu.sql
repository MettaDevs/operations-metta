-- Grup rail Pendaftaran berisi dua halaman, supaya petugas berpindah cepat antara daftar kunjungan dan form registrasi
-- baru: "Kunjungan" menjadi "Daftar kunjungan", lalu "Registrasi baru" ditambahkan sesudahnya. Hanya grup ini yang
-- diubah; item yang sudah ada tidak ditambah lagi, jadi migration aman diulang. Keputusan pemilik produk,
-- 12 November 2026.

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'registration'
                        THEN jsonb_set(g, '{items}', (
                            SELECT coalesce(jsonb_agg(
                                       CASE WHEN item->>'id' = 'visits'
                                            THEN jsonb_set(item, '{label}', '"Daftar kunjungan"')
                                            ELSE item END
                                       ORDER BY ordinal), '[]'::jsonb)
                            FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) WITH ORDINALITY AS items(item, ordinal))
                            || CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                                 WHERE existing->>'id' = 'visit-new')
                                    THEN '[]'::jsonb
                                    ELSE '[{"id":"visit-new","label":"Registrasi baru","href":"/healthcare/registration/visits/new","permission":"healthcare.visit.create"}]'::jsonb
                               END)
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare'
  AND jsonb_typeof(a.navigation) = 'array';
