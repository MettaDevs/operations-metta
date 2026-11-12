-- Pemeriksaan rawat jalan tahap 2, bagian E4: panel Status Pasien poli sistem lama puskesmas
-- (poly/views/form/statuspasien/index.php, simpan di helpers/statuspasien_helper.php), rujuk internal ke poli lain pada
-- kunjungan yang sama, CPPT, dan cetak rekam medis. Keputusan pemilik produk, 12 November 2026.
--
-- Bedanya dengan sistem lama:
-- - Pilihan status ditulis mati di view sistem lama (RawatJalan, TindakLanjutRI, RujukInternal, RujukEksternal,
--   Meninggal). Di sini barisnya data acuan per tenant (sim_m_status_pulang) dengan kode nilai sistem lama. Isian
--   tambahan setiap status adalah perilaku dari katalog di kode (discharge.behaviors.ts), dipasang lewat kolom perilaku.
-- - Rawat Inap tersembunyi di view sistem lama (TindakLanjutRIBox hidden), jadi barisnya diisi nonaktif. Tenant yang
--   melayani rawat inap mengaktifkannya di Setup → Klinis → Status pasien.
-- - Pilihan < 48 Jam dan > 48 Jam menjadi baris sim_m_pemeriksaan_pilihan kelompok waktu_meninggal, dengan kode sistem
--   lama (MeninggalSblm48, MeninggalStl48).
-- - Sistem lama menyimpan status saat pilihan berubah (autosave 2 detik). Di sini status ikut Simpan rekam medis.
-- - Rujuk eksternal sementara teks bebas (faskes tujuan, poli atau spesialis, alasan). Pencarian faskes BPJS, TACC, dan
--   pemetaan KdStatusPulang ke PCare (JenisKerjasamaID == 9 ditulis mati) menyusul bersama bridging BPJS.
-- - Rujuk internal menunjuk tujuan asalnya (asal_tujuan_id), bukan hanya section asal (SectionAsalID), sehingga dua
--   rujukan dari poli yang sama tidak bisa tertukar. Catatan rujukan disimpan di tujuan baru dan menjadi keluhan utama
--   awal pemeriksaannya, seperti sistem lama yang menulis Catatan ke KeluhanUtama SIMtrRJ baru.
--
-- 1. Data acuan sim_m_status_pulang.
-- 2. Kolom status pasien dan rujukan di sim_tr_registrasi_tujuan.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya.
-- 5. Menu: Setup → Klinis → Status pasien.

-- 1. Data acuan ----------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_status_pulang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(40) NOT NULL,
    nama character varying(150) NOT NULL,
    perilaku character varying(30),
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_status_pulang_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_status_pulang_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_status_pulang_kode_unique ON public.sim_m_status_pulang USING btree (tenant_id, lower((kode)::text))
    WHERE (deleted_at IS NULL);

-- 2. Status pasien di tujuan kunjungan -----------------------------------------------------------------------------

ALTER TABLE public.sim_tr_registrasi_tujuan
    ADD COLUMN status_pulang_id uuid,
    ADD COLUMN kontrol_ulang boolean,
    ADD COLUMN tanggal_kontrol date,
    ADD COLUMN dokter_konsul_id uuid,
    ADD COLUMN rujuk_eksternal_tujuan character varying(200),
    ADD COLUMN rujuk_eksternal_poli character varying(150),
    ADD COLUMN rujuk_eksternal_alasan character varying(1000),
    ADD COLUMN waktu_meninggal character varying(40),
    ADD COLUMN tanggal_meninggal date,
    ADD COLUMN jam_meninggal time(0) without time zone,
    ADD COLUMN asal_tujuan_id uuid,
    ADD COLUMN catatan_rujukan character varying(1000),
    ADD CONSTRAINT sim_tr_registrasi_tujuan_status_pulang_foreign
        FOREIGN KEY (tenant_id, status_pulang_id) REFERENCES public.sim_m_status_pulang(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_registrasi_tujuan_dokter_konsul_foreign
        FOREIGN KEY (tenant_id, dokter_konsul_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_registrasi_tujuan_asal_foreign
        FOREIGN KEY (tenant_id, asal_tujuan_id) REFERENCES public.sim_tr_registrasi_tujuan(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_tr_registrasi_tujuan_status_pulang_index
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, status_pulang_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_registrasi_tujuan_asal_index
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, asal_tujuan_id) WHERE (deleted_at IS NULL);

-- 3. Trigger -------------------------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_status_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_status_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_status_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_m_status_pulang', 'Status pasien', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_m_status_pulang');

-- 4. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant dari view sistem lama: lima status pasien dalam urutannya, dengan kode nilai yang disimpan
-- sistem lama, dan pilihan waktu meninggal. Setiap tabel diisi hanya bila tenant belum punya baris sama sekali, termasuk
-- yang sudah dihapus.
CREATE FUNCTION public.sim_isi_acuan_status_pulang(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_status_pulang WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_status_pulang (id, tenant_id, kode, nama, perilaku, urutan, aktif, created_at,
                                                updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.perilaku, v.urutan, v.aktif, now() AT TIME ZONE 'utc',
               now() AT TIME ZONE 'utc'
        FROM (VALUES ('RawatJalan', 'Rawat Jalan', 'rawat_jalan', 1, true),
                     ('TindakLanjutRI', 'Rawat Inap', 'rawat_inap', 2, false),
                     ('RujukInternal', 'Rujuk Internal', 'rujuk_internal', 3, true),
                     ('RujukEksternal', 'Rujuk Eksternal', 'rujuk_eksternal', 4, true),
                     ('Meninggal', 'Meninggal', 'meninggal', 5, true)) AS v(kode, nama, perilaku, urutan, aktif);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_pemeriksaan_pilihan
                   WHERE tenant_id = p_tenant AND kelompok = 'waktu_meninggal') THEN
        INSERT INTO public.sim_m_pemeriksaan_pilihan (id, tenant_id, kelompok, kode, nama, urutan, created_at,
                                                      updated_at)
        SELECT gen_random_uuid(), p_tenant, 'waktu_meninggal', v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc',
               now() AT TIME ZONE 'utc'
        FROM (VALUES ('MeninggalSblm48', '< 48 Jam', 1),
                     ('MeninggalStl48', '> 48 Jam', 2)) AS v(kode, nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_status_pulang_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_status_pulang(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_status_pulang AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_status_pulang_saat_dipasang();

SELECT public.sim_isi_acuan_status_pulang(i.tenant_id)
FROM public.core_module_installations i
WHERE i.module_id = 'healthcare' AND i.status = 'installed';

-- 5. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"discharge-statuses","label":"Status pasien","href":"/healthcare/clinical/discharge-statuses","section":"Klinis","permission":"healthcare.diagnosis-reference.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
