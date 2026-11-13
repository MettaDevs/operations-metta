-- "Tidak Ada" di daftar alergen menjadi data: sim_m_alergi.tidak_ada menandai baris yang berarti pasien tidak punya
-- alergi jenis itu, jadi baris itu bukan alergen dan tidak ditawarkan di daftar Alergi pasien. Sebelumnya layanan
-- kesehatan mengenalinya dari kode PCare 00 yang ditulis di kode program.
--
-- Sistem lama (mAlergi) tidak punya penanda: setiap jenis (Makanan, Udara, Obat) punya baris kode 00 "Tidak Ada", dan
-- kode itulah yang dipakai di sini untuk menandai baris yang sudah ada.
--
-- 1. Kolom tidak_ada, diisi untuk baris kode 00.
-- 2. Tenant yang memasang module sesudah ini: sim_isi_acuan_pemeriksaan (0021) mengisi baris kode 00 tanpa penanda,
--    jadi penandanya diisi sesudahnya saat dipasang.

-- 1. Kolom ---------------------------------------------------------------------------------------------------------

ALTER TABLE public.sim_m_alergi ADD COLUMN tidak_ada boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN public.sim_m_alergi.tidak_ada IS
    'Baris ini berarti pasien tidak punya alergi jenis ini, bukan alergen. Tidak ditawarkan di daftar alergi pasien.';

UPDATE public.sim_m_alergi SET tidak_ada = true WHERE kode = '00';

-- 2. Tenant yang memasang sesudah ini ------------------------------------------------------------------------------

CREATE FUNCTION public.sim_isi_alergi_tidak_ada(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE public.sim_m_alergi SET tidak_ada = true
    WHERE tenant_id = p_tenant AND kode = '00' AND NOT tidak_ada;
END;
$$;

CREATE FUNCTION public.sim_isi_alergi_tidak_ada_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_alergi_tidak_ada(NEW.tenant_id);
    RETURN NULL;
END;
$$;
-- PostgreSQL menjalankan trigger sejenis menurut urutan nama. Nama ini harus sesudah sim_isi_acuan_pemeriksaan, karena
-- fungsi itu yang mengisi baris alerginya.
CREATE TRIGGER sim_isi_acuan_pemeriksaan_tidak_ada AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_alergi_tidak_ada_saat_dipasang();
