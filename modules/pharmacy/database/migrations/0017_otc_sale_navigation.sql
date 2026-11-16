-- Menu layar penjualan obat bebas: loket di grup Pelayanan resep, setelan lokasinya di Setup bersama Lokasi layanan
-- resep. Entri yang sudah ada tidak ditambah dua kali.

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
                {"id":"otc-sale","label":"Penjualan obat bebas","href":"/pharmacy/dispensing/otc-sale","permission":"pharmacy.otc-sale.read"}]'::jsonb),
            ('setup', '[
                {"id":"otc-sale-locations","label":"Lokasi penjualan obat bebas","href":"/pharmacy/dispensing/otc-sale-locations","section":"Pelayanan resep","permission":"pharmacy.otc-sale-location.read"}]'::jsonb)
        ) AS added(group_id, items) ON added.group_id = g->>'id'),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';
