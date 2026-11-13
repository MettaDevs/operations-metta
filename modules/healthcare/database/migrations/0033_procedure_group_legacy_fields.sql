-- Kelompok tindakan mendapat isian form Group Jasa sistem lama (Admin → Setup Jasa → Group Jasa,
-- modules/admin/service/views/group/form.php). Arahan pemilik produk 13 November 2026: jasa, komponen jasa, dan semua
-- turunannya mengikuti sistem lama lebih dulu, perbaikan sesudahnya.
--
-- 1. Nama internasional (NamaInternational) dan Kelompok Perawatan (KelompokPerawatan), urutan form sistem lama sesudah
--    Nama. Kelompok Perawatan adalah daftar tetap di kode sistem lama (Group_model::dropdown_static: ALL "All",
--    RJ "Rawat Jalan", RI "Rawat Inap"), jadi di sini katalog kode procedure-group.options.ts dengan kode yang sama.
--    Bawaannya ALL, nilai bawaan form baru sistem lama dan nilai 37 dari 40 kelompok Kuta; kelompok yang sudah ada
--    mendapat ALL.
--    Akun Rawat Jalan, Rawat Inap, Rawat Darurat, On Call, dan No MA form itu belum dibawa, karena repo ini belum punya
--    bagan akun; alasan yang sama dengan akun komponen biaya yang ditunda #126. NoUrut sudah ada sebagai urutan sejak
--    0025.
-- 2. Menu Kelompok tindakan memakai izin tindakan, karena kelompok bagian dari setup tindakan seperti kategori tindakan
--    (0031). Endpointnya pindah dari daftar pendek klinis ke /procedure-groups.

-- 1. Isian form Group Jasa -----------------------------------------------------------------------------------------

ALTER TABLE public.sim_m_tindakan_kelompok
    ADD COLUMN nama_internasional character varying(200),
    ADD COLUMN kelompok_perawatan character varying(10) DEFAULT 'ALL' NOT NULL,
    ADD CONSTRAINT sim_m_tindakan_kelompok_kelompok_perawatan_check CHECK (kelompok_perawatan IN ('ALL', 'RJ', 'RI'));

-- 2. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce((
                            SELECT jsonb_agg(
                                       CASE WHEN item->>'id' = 'procedure-groups'
                                            THEN jsonb_set(item, '{permission}', '"healthcare.procedure.read"')
                                            ELSE item END
                                       ORDER BY position)
                            FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) WITH ORDINALITY AS items(item, position)),
                            '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare'
  AND jsonb_typeof(a.navigation) = 'array';
