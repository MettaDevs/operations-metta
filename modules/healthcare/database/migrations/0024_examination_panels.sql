-- Bagian pemeriksaan per section dan Pemeriksaan Dasar Gigi tab "Rekam Medis" poli sistem lama puskesmas. Keputusan
-- pemilik produk, 12 November 2026.
--
-- Sistem lama memilih panel dari id section yang ditulis mati di view (poly/views/form/rekammedis/index.php):
-- `SectionID == 'SEC002'` mendapat Pemeriksaan Dasar Gigi, section lain mendapat Keadaan Fisik dan Anatomi Tubuh, dan
-- kolom Posisi Gigi baris diagnosa (Diagnosa.php) memakai syarat yang sama. Di sini panel yang tampil diatur di kartu
-- section, satu baris per panel di sim_m_section_panel_pemeriksaan. Katalog panelnya tetap di kode, karena setiap
-- panel adalah layar dan kode simpan sendiri.
--
-- - Section tanpa baris memakai bawaan katalog: semua panel kecuali Pemeriksaan Dasar Gigi, yaitu perilaku sistem lama
--   untuk section bukan gigi. Panel yang belum punya baris di section yang sudah diatur juga memakai bawaannya.
-- - Tidak ada section yang diisi di sini. Nama section tidak dipakai untuk menebak poli gigi; admin mencentang
--   Pemeriksaan dasar gigi pada section gigi miliknya.
-- - Pilihan Pemeriksaan Dasar Gigi ditulis mati di view sistem lama (PemeriksaanGigiDasar.php). Di sini pilihan itu
--   data acuan per tenant di sim_m_pemeriksaan_pilihan, dengan kode = nilai yang disimpan sistem lama
--   (SIMtrRJPemeriksaanGigiDasar), jadi Status Karies menyimpan Plus dan Minus dan menampilkan + dan -.
--
-- 1. sim_m_section_panel_pemeriksaan.
-- 2. sim_tr_pemeriksaan_gigi_dasar dan sim_tr_pemeriksaan_diagnosa.posisi_gigi.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Pilihan Pemeriksaan Dasar Gigi untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang
--    memasang sesudahnya.

-- 1. Bagian pemeriksaan section ---------------------------------------------------------------------------------------

-- Satu baris per panel yang diatur untuk section. panel_kode adalah kode katalog panel di kode
-- (medical-record.panels.ts); aktif menentukan panel itu tampil dan diisi di pemeriksaan section ini.
CREATE TABLE public.sim_m_section_panel_pemeriksaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    section_id uuid NOT NULL,
    panel_kode character varying(40) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_section_panel_pemeriksaan_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_section_panel_pemeriksaan_section_foreign
        FOREIGN KEY (tenant_id, section_id) REFERENCES public.sim_m_section(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_section_panel_pemeriksaan_unique
    ON public.sim_m_section_panel_pemeriksaan USING btree (tenant_id, section_id, panel_kode)
    WHERE (deleted_at IS NULL);

-- 2. Pemeriksaan Dasar Gigi ------------------------------------------------------------------------------------------

-- Pemeriksaan Dasar Gigi (SIMtrRJPemeriksaanGigiDasar), satu baris per pemeriksaan, hanya bila panelnya berisi. Setiap
-- kolom menyimpan kode pilihan sim_m_pemeriksaan_pilihan kelompok gigi_<kolom>.
CREATE TABLE public.sim_tr_pemeriksaan_gigi_dasar (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_id uuid NOT NULL,
    bengkak character varying(40),
    konsistensi character varying(40),
    warna_kulit character varying(40),
    suhu_kulit character varying(40),
    goyang character varying(40),
    warna_gusi character varying(40),
    karies_gigi character varying(40),
    pembengkakan character varying(40),
    perkusi character varying(40),
    druk character varying(40),
    palpasi character varying(40),
    status_karies character varying(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_gigi_dasar_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_gigi_dasar_pemeriksaan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_id) REFERENCES public.sim_tr_pemeriksaan(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_gigi_dasar_unique
    ON public.sim_tr_pemeriksaan_gigi_dasar USING btree (tenant_id, pemeriksaan_id) WHERE (deleted_at IS NULL);

-- Posisi Gigi baris diagnosa (SIMtrRJDiagnosaAwal.PosisiGigi, varchar(50)), diisi hanya di section yang memakai
-- Pemeriksaan Dasar Gigi.
ALTER TABLE public.sim_tr_pemeriksaan_diagnosa ADD COLUMN posisi_gigi character varying(50);

-- 3. Trigger ---------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_section_panel_pemeriksaan', 'sim_tr_pemeriksaan_gigi_dasar']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END;
$$;

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_m_section_panel_pemeriksaan', 'Bagian pemeriksaan section', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_m_section_panel_pemeriksaan');

-- 4. Pilihan Pemeriksaan Dasar Gigi ----------------------------------------------------------------------------------

-- Isi bawaan satu tenant dari PemeriksaanGigiDasar.php, dalam urutan aslinya. Diisi hanya bila tenant belum punya
-- pilihan kelompok gigi_ sama sekali, termasuk yang sudah dihapus.
CREATE FUNCTION public.sim_isi_acuan_pemeriksaan_gigi(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_pemeriksaan_pilihan
                   WHERE tenant_id = p_tenant AND kelompok LIKE 'gigi\_%') THEN
        INSERT INTO public.sim_m_pemeriksaan_pilihan (id, tenant_id, kelompok, kode, nama, urutan, created_at,
                                                      updated_at)
        SELECT gen_random_uuid(), p_tenant, p.kelompok, p.kode, p.nama, p.urutan,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('gigi_bengkak', 'Ya', 'Ya', 1),
                     ('gigi_bengkak', 'Tidak', 'Tidak', 2),
                     ('gigi_konsistensi', 'Lunak', 'Lunak', 1),
                     ('gigi_konsistensi', 'Kenyal', 'Kenyal', 2),
                     ('gigi_konsistensi', 'Keras', 'Keras', 3),
                     ('gigi_warna_kulit', 'Normal', 'Normal', 1),
                     ('gigi_warna_kulit', 'Kemerahan', 'Kemerahan', 2),
                     ('gigi_warna_kulit', 'Merah Kebiruan', 'Merah Kebiruan', 3),
                     ('gigi_suhu_kulit', 'Panas', 'Panas', 1),
                     ('gigi_suhu_kulit', 'Tidak', 'Tidak', 2),
                     ('gigi_goyang', 'Ya', 'Ya', 1),
                     ('gigi_goyang', 'Tidak', 'Tidak', 2),
                     ('gigi_warna_gusi', 'Normal', 'Normal', 1),
                     ('gigi_warna_gusi', 'Kemerahan', 'Kemerahan', 2),
                     ('gigi_warna_gusi', 'Merah Kebiruan', 'Merah Kebiruan', 3),
                     ('gigi_karies', 'Insisal', 'Insisal', 1),
                     ('gigi_karies', 'Mesial', 'Mesial', 2),
                     ('gigi_karies', 'Distal', 'Distal', 3),
                     ('gigi_karies', 'Oklusal', 'Oklusal', 4),
                     ('gigi_karies', 'Disto Oklusal', 'Disto Oklusal', 5),
                     ('gigi_karies', 'Mesio Oklusal', 'Mesio Oklusal', 6),
                     ('gigi_karies', 'Bukal', 'Bukal', 7),
                     ('gigi_karies', 'Disto Bukal', 'Disto Bukal', 8),
                     ('gigi_karies', 'Mesio Bukal', 'Mesio Bukal', 9),
                     ('gigi_karies', 'Bukal Oklusal', 'Bukal Oklusal', 10),
                     ('gigi_karies', 'Labial', 'Labial', 11),
                     ('gigi_karies', 'Palatal', 'Palatal', 12),
                     ('gigi_karies', 'Disto Palatal', 'Disto Palatal', 13),
                     ('gigi_karies', 'Mesio Palatal', 'Mesio Palatal', 14),
                     ('gigi_karies', 'Lingual', 'Lingual', 15),
                     ('gigi_karies', 'Mod', 'Mod', 16),
                     ('gigi_pembengkakan', 'Ada', 'Ada', 1),
                     ('gigi_pembengkakan', 'Tidak', 'Tidak', 2),
                     ('gigi_perkusi', 'Sakit', 'Sakit', 1),
                     ('gigi_perkusi', 'Tidak', 'Tidak', 2),
                     ('gigi_druk', 'Sakit', 'Sakit', 1),
                     ('gigi_druk', 'Tidak', 'Tidak', 2),
                     ('gigi_palpasi', 'Sakit', 'Sakit', 1),
                     ('gigi_palpasi', 'Tidak', 'Tidak', 2),
                     ('gigi_status_karies', 'Plus', '+', 1),
                     ('gigi_status_karies', 'Minus', '-', 2)) AS p(kelompok, kode, nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_pemeriksaan_gigi_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_pemeriksaan_gigi(NEW.tenant_id);
    RETURN NULL;
END;
$$;
-- PostgreSQL menjalankan trigger sejenis menurut urutan nama. Nama ini harus sesudah sim_isi_acuan_pemeriksaan, karena
-- fungsi itu hanya mengisi pilihan pemeriksaan bila tenant belum punya pilihan apa pun.
CREATE TRIGGER sim_isi_acuan_pemeriksaan_gigi AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_pemeriksaan_gigi_saat_dipasang();

SELECT public.sim_isi_acuan_pemeriksaan_gigi(i.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.core_module_installations
      WHERE module_id = 'healthcare' AND status = 'installed') i;
