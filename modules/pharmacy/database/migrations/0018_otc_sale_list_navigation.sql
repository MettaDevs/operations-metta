-- Menu daftar penjualan obat bebas di Pelayanan resep, sesudah loketnya: penjualan yang sudah terjadi, kartunya, dan
-- retur obatnya. Izinnya sama dengan loket (pharmacy.otc-sale.read); retur memakai izin retur resep. Entri yang sudah
-- ada tidak ditambah dua kali.

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN added.items IS NULL THEN g
                        ELSE jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements(added.items) AS entry(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = entry.item->>'id')), '[]'::jsonb))
                   END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)
        LEFT JOIN (VALUES
            ('dispensing', '[
                {"id":"otc-sales","label":"Daftar penjualan","href":"/pharmacy/dispensing/otc-sales","permission":"pharmacy.otc-sale.read"}]'::jsonb)
        ) AS added(group_id, items) ON added.group_id = g->>'id'),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';
