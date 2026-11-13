-- Desimal harga satuan obat pindah dari setelan farmasi (far_m_parameter, 0006) ke presisi harga satuan mata uang Core
-- (currency_precisions.unit_amount_decimals, mata uang lokal IDR), satu sumber pembulatan uang dan harga untuk kasir,
-- farmasi, aset, dan finance. Permintaan pemilik produk 13 November 2026.
--
-- 1. Nilai yang sudah disimpan disalin ke presisi IDR tenant itu. Presisi mata uang per tenant, sedangkan setelan
--    farmasi per legal entity; bila legal entity satu tenant berbeda, nilai terbesar dipakai supaya harga tidak dibulatkan
--    lebih kasar dari sebelumnya. Tenant tanpa baris IDR mendapatnya dengan presisi jumlah dua angka di belakang koma,
--    bawaan sebelumnya, atau sama dengan presisi harga satuan bila lebih kasar, karena currency_precisions menuntut
--    harga satuan tidak lebih kasar dari jumlah (Kuta 1: keduanya rupiah utuh).
-- 2. Menu Setelan farmasi dicabut. far_m_parameter ditinggalkan sebagai tabel yatim, karena tidak ada baris yang
--    dihapus fisik; tidak ada kode yang membacanya lagi.
-- 3. Nama izin harga obat tidak lagi menyebut setelan farmasi.

INSERT INTO public.currency_precisions (id, tenant_id, currency_code, amount_decimals, unit_amount_decimals, created_at,
                                        updated_at)
SELECT gen_random_uuid(), p.tenant_id, 'IDR', least(2, max(p.desimal_harga_satuan)), max(p.desimal_harga_satuan), now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM public.far_m_parameter p
GROUP BY p.tenant_id
ON CONFLICT (tenant_id, currency_code) DO UPDATE
    SET unit_amount_decimals = EXCLUDED.unit_amount_decimals,
        amount_decimals = least(currency_precisions.amount_decimals, EXCLUDED.unit_amount_decimals),
        updated_at = EXCLUDED.updated_at;

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce((
                            SELECT jsonb_agg(item ORDER BY position)
                            FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) WITH ORDINALITY AS i(item, position)
                            WHERE item->>'id' <> 'pharmacy-setup'), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';

UPDATE public.permissions
SET name = CASE code WHEN 'pharmacy.drug-price.read' THEN 'Lihat kelompok grading dan grading harga obat'
                     ELSE 'Ubah kelompok grading dan grading harga obat' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('pharmacy.drug-price.read', 'pharmacy.drug-price.update');

UPDATE public.security_privileges
SET name = CASE code WHEN 'pharmacy.drug-price.view' THEN 'Melihat kelompok grading dan grading harga obat'
                     ELSE 'Memelihara kelompok grading dan grading harga obat' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('pharmacy.drug-price.view', 'pharmacy.drug-price.maintain');
