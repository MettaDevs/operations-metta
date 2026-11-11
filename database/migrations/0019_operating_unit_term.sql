-- Jenis party `operating_unit` ditulis "Operating unit" di layar, bukan "Unit operasional", sejalan dengan istilah
-- Microsoft yang sudah dipakai di menu Organisasi dan dengan "Legal entity" dari 0018 (keputusan pemilik produk,
-- 11 November 2026: "ya ganti").
UPDATE public.party_types
SET name = 'Operating unit', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'operating_unit' AND name = 'Unit operasional';
