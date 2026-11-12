-- Obat menjadi barang Core (rencana farmasi + persediaan, langkah 6a, keputusan 13 November 2026). sim_m_obat tetap
-- milik module ini sebagai perluasan barang Core, pola table extension BC: sim_m_obat.id = gd_m_barang.id, dan baris ini
-- hanya memegang yang dibutuhkan layanan kesehatan secara klinis (bentuk sediaan, boleh diresepkan). Kode, nama, satuan
-- dasar, satuan kemasan, pelacakan, dan blokir milik barang Core. FK baris resep dan alergi obat tetap ke sim_m_obat,
-- yang id-nya kini sama dengan id barang.
--
-- Core 0028 sudah menyalin obat dan satuan obat E3 ke gd_m_barang dan gd_m_satuan dengan id yang sama, di legal entity
-- yang kunjungannya paling banyak di tenant itu. Migration ini:
-- 1. sim_m_obat mengikuti legal entity barangnya, lalu FK (tenant_id, legal_entity_id, id) ke gd_m_barang. aktif menjadi
--    boleh_diresepkan, supaya tidak tertukar dengan blokir barang. Kolom kembar kode, nama, dan satuan_id dibuang
--    karena isinya sudah ada di barang.
-- 2. Obat milik tenant yang tidak punya legal entity sama sekali tidak bisa menjadi barang. Barisnya diberi deleted_at
--    dan legal entity-nya tetap kosong; barisnya tidak dihapus fisik, supaya baris lain yang mungkin merujuknya tetap
--    sah. Tenant seperti itu tidak punya pasien maupun kunjungan, jadi hanya data uji yang berada di keadaan ini. CHECK
--    menjaga bahwa obat tanpa barang hanya ada sebagai baris terhapus.
-- 3. sim_m_satuan_obat tidak dipakai lagi dan ditinggal yatim, seperti tabel lama lain yang tidak dihapus. Pengisian
--    satuan obat bawaan saat module dipasang berhenti; satuan dikelola di layar Satuan persediaan Core per legal entity.
-- 4. Menu Satuan obat dibuang dari Setup → Klinis.

-- 1 dan 2. Perluasan barang ----------------------------------------------------------------------------------------

ALTER TABLE public.sim_m_obat ADD COLUMN legal_entity_id uuid;

UPDATE public.sim_m_obat o
SET legal_entity_id = b.legal_entity_id
FROM public.gd_m_barang b
WHERE b.tenant_id = o.tenant_id AND b.id = o.id;

UPDATE public.sim_m_obat
SET deleted_at = coalesce(deleted_at, now() AT TIME ZONE 'utc'), updated_at = now() AT TIME ZONE 'utc'
WHERE legal_entity_id IS NULL;

DROP INDEX public.sim_m_obat_kode_unique;
DROP INDEX public.sim_m_obat_satuan_index;
ALTER TABLE public.sim_m_obat
    DROP CONSTRAINT sim_m_obat_satuan_foreign,
    DROP COLUMN kode,
    DROP COLUMN nama,
    DROP COLUMN satuan_id,
    ADD CONSTRAINT sim_m_obat_barang_check CHECK (legal_entity_id IS NOT NULL OR deleted_at IS NOT NULL),
    ADD CONSTRAINT sim_m_obat_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT;
ALTER TABLE public.sim_m_obat RENAME COLUMN aktif TO boleh_diresepkan;

-- Pilihan obat E-Resep: obat legal entity kunjungan yang boleh diresepkan.
CREATE INDEX sim_m_obat_legal_entity_index
    ON public.sim_m_obat USING btree (tenant_id, legal_entity_id) WHERE (deleted_at IS NULL);

-- 3. Satuan obat ---------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sim_isi_acuan_resep(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_aturan_pakai WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_aturan_pakai (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.nama, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Sebelum Makan', 1),
                     ('Setelah Makan', 2),
                     ('Pemakaian Luar', 3),
                     ('Jika Diperlukan', 4),
                     ('Saat Makan', 5)) AS v(nama, urutan);
    END IF;
END;
$$;

-- 4. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce((
                            SELECT jsonb_agg(item ORDER BY position)
                            FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) WITH ORDINALITY AS items(item, position)
                            WHERE item->>'id' <> 'drug-units'), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
