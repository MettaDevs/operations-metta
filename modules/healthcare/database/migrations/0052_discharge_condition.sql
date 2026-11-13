-- Keadaan pasien saat pulang dari poli, sumber Condition "Meninggalkan Faskes" SATUSEHAT (kode klinisnya SNOMED, menyusul).
-- Status pasien (sim_m_status_pulang, 0026) adalah cara pasien meninggalkan poli, bukan keadaan klinisnya.
--
-- Sistem lama mencatat Keadaan Pulang hanya di form KIA (SIMtrKunjunganANC, SIMtrKunjunganNifas, SimTrPersalinan,
-- KeadaanPulang), sebagai pilihan yang ditulis mati di view: Stabil, Tidak Stabil, Perbaikan, Pulang Paksa, Dirujuk,
-- Meninggal < 48 Jam, Meninggal > 48 Jam, Lain-lain. Form Status Pasien rawat jalan (statuspasien_helper.php) tidak
-- punya isian ini. Di sini ia menjadi isian panel Status Pasien setiap poli, dan pilihannya data acuan per tenant seperti
-- status pasien. Pilihan yang sudah dicatat panel itu tidak diulang: Dirujuk adalah status Rujuk Eksternal, dan
-- Meninggal < 48 Jam atau > 48 Jam adalah status Meninggal beserta waktunya. Pulang Paksa tidak dibawa, karena ia cara
-- pulang dan status pasien rawat jalan sistem lama tidak memilikinya. Tenant menambah pilihan di Setup → Klinis.
--
-- 1. Data acuan sim_m_keadaan_pulang.
-- 2. Kolom keadaan pulang di sim_tr_registrasi_tujuan.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya.
-- 5. Menu: Setup → Klinis → Keadaan pulang.

-- 1. Data acuan ----------------------------------------------------------------------------------------------------

-- Bentuknya sama dengan daftar pendek klinis lain (0025), karena diatur layar yang sama.
CREATE TABLE public.sim_m_keadaan_pulang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(40) NOT NULL,
    nama character varying(150) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_keadaan_pulang_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_keadaan_pulang_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_keadaan_pulang_kode_unique
    ON public.sim_m_keadaan_pulang USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- 2. Keadaan pulang di tujuan kunjungan ----------------------------------------------------------------------------

-- Opsional, tidak bergantung pada status pasien, dan tidak dikosongkan rujuk internal.
ALTER TABLE public.sim_tr_registrasi_tujuan
    ADD COLUMN keadaan_pulang_id uuid,
    ADD CONSTRAINT sim_tr_registrasi_tujuan_keadaan_pulang_foreign
        FOREIGN KEY (tenant_id, keadaan_pulang_id) REFERENCES public.sim_m_keadaan_pulang(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_tr_registrasi_tujuan_keadaan_pulang_index
    ON public.sim_tr_registrasi_tujuan USING btree (tenant_id, keadaan_pulang_id) WHERE (keadaan_pulang_id IS NOT NULL);

-- 3. Trigger -------------------------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_keadaan_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_keadaan_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_keadaan_pulang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_m_keadaan_pulang', 'Keadaan pulang', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_m_keadaan_pulang');

-- 4. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant: pilihan Keadaan Pulang form KIA sistem lama yang belum dicatat status pasien, dengan nilai
-- sistem lama sebagai kode. Diisi hanya bila tenant belum punya baris sama sekali, termasuk yang sudah dihapus.
CREATE FUNCTION public.sim_isi_keadaan_pulang(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_keadaan_pulang WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_keadaan_pulang (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('Stabil', 'Stabil', 1),
                     ('Tidak Stabil', 'Tidak Stabil', 2),
                     ('Perbaikan', 'Perbaikan', 3),
                     ('Lain-lain', 'Lain-lain', 4)) AS v(kode, nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_keadaan_pulang_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_keadaan_pulang(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_keadaan_pulang AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_keadaan_pulang_saat_dipasang();

SELECT public.sim_isi_keadaan_pulang(i.tenant_id)
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
                                {"id":"discharge-conditions","label":"Keadaan pulang","href":"/healthcare/clinical/discharge-conditions","section":"Klinis","permission":"healthcare.diagnosis-reference.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
