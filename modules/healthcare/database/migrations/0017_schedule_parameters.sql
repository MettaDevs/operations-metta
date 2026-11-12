-- Parameter jadwal praktik per tenant, pola halaman "parameters" F&O: generate jadwal dari template berjalan sendiri,
-- tidak menunggu orang menekan Generate jadwal (keputusan pemilik produk, 12 November 2026). Repo ini belum punya
-- penjadwal per tenant, jadi generate otomatis dijalankan saat jadwal dibaca: layar Jadwal praktik dan data form
-- pendaftaran kunjungan. Tombol Generate jadwal tetap ada.
--
-- 1. sim_m_parameter_jadwal: setelan. Tanpa baris, bawaannya generate otomatis aktif untuk 7 hari.
-- 2. sim_tr_jadwal_generate: catatan generate otomatis terakhir, supaya pembacaan berikutnya tidak mengulang pekerjaan.
--    Dipisah dari setelan supaya catatan mesin tidak menaikkan versi dan pengubah setelan.
-- 3. Menu: rail Setup, bagian Pelayanan, mendapat Parameter jadwal.

-- 1. Setelan --------------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_parameter_jadwal (
    tenant_id uuid NOT NULL,
    generate_otomatis boolean NOT NULL,
    horizon_hari smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_parameter_jadwal_pkey PRIMARY KEY (tenant_id),
    -- 92 hari sama dengan rentang terpanjang satu kali generate.
    CONSTRAINT sim_m_parameter_jadwal_horizon_check CHECK (horizon_hari BETWEEN 1 AND 92)
);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_parameter_jadwal
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_parameter_jadwal
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();

-- 2. Catatan generate otomatis --------------------------------------------------------------------------------------

-- tanggal_sampai: tanggal terakhir yang sudah digenerate. sidik_master: jumlah baris ditambah jumlah versi template,
-- sesi, nakes, dan section saat generate. Setiap tambah dan ubah (termasuk hapus lunak) menaikkan angka itu, jadi
-- angka yang berbeda berarti master berubah dan jadwal perlu disusun ulang.
CREATE TABLE public.sim_tr_jadwal_generate (
    tenant_id uuid NOT NULL,
    tanggal_sampai date NOT NULL,
    sidik_master bigint NOT NULL,
    updated_at timestamp(0) without time zone,
    CONSTRAINT sim_tr_jadwal_generate_pkey PRIMARY KEY (tenant_id)
);

-- 3. Menu -----------------------------------------------------------------------------------------------------------

-- Item ditambahkan ke grup setup tanpa menulis ulang menu; item yang id-nya sudah ada dilewati.
UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"schedule-parameters","label":"Parameter jadwal","href":"/healthcare/service/schedule-parameters","section":"Pelayanan","permission":"healthcare.practice-schedule.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
