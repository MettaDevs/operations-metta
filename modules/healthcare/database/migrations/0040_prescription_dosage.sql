-- Dosis baris E-Resep dalam bentuk yang dibutuhkan MedicationRequest.dosageInstruction SATUSEHAT: berapa kali sehari
-- (timing.repeat.frequency dengan period 1 hari), dosis sekali pakai beserta satuannya (doseAndRate.doseQuantity), rute
-- pemberian (route), dan lama pemberian dalam hari (dispenseRequest.expectedSupplyDuration). Nilainya diisi dokter di
-- sumbernya saat menulis resep. Keputusan pemilik produk, 13 November 2026.
--
-- Sistem lama (FormEresep.php, eresep_helper.php) hanya menyimpan Dosis sebagai teks bebas ("3x1") dan Dosis2 sebagai
-- aturan pakai; master SIMmDosisObat memecah dosis menjadi Signa1 (kali sehari) dan Signa2 (jumlah sekali pakai). Rute
-- tidak ada di mana pun (INFOKES_RESEP.Route_Administration selalu NULL), begitu juga lama pemberian. Signa, aturan
-- pakai, dan keterangan tetap ada dan tetap opsional.
--
-- Wajibnya lima nilai itu pada obat tunggal dan kepala racikan dijaga service saat resep disimpan, bukan oleh database,
-- karena draf dan resep yang sudah dikirim sebelum migration ini tidak membawanya. Database hanya menjaga nilai yang
-- terisi positif dan komponen racikan tanpa dosis, karena dosis racikan ditulis pada baris racikannya.
--
-- Jumlah baris resep dan jumlah permintaan racikan menjadi numeric(18,4), sama dengan jumlah persediaan Core
-- (src/foundation/inventory/quantity.ts), sehingga aturan desimal jumlah dan dosis datang dari satu tempat.
--
-- 1. Data acuan sim_m_rute_obat.
-- 2. Kolom dosis di sim_tr_resep_detail.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Isi data acuan untuk tenant yang sudah memasang module ini, dan trigger untuk tenant yang memasang sesudahnya.
-- 5. Menu: Setup → Klinis → Rute pemberian obat.

-- 1. Data acuan ----------------------------------------------------------------------------------------------------

-- Bentuknya sama dengan daftar pendek klinis lain (0025), karena diatur layar yang sama. Nama juga unik, supaya dokter
-- tidak melihat dua rute bernama sama.
CREATE TABLE public.sim_m_rute_obat (
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
    CONSTRAINT sim_m_rute_obat_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_rute_obat_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_rute_obat_kode_unique ON public.sim_m_rute_obat USING btree (tenant_id, lower((kode)::text))
    WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX sim_m_rute_obat_nama_unique ON public.sim_m_rute_obat USING btree (tenant_id, lower((nama)::text))
    WHERE (deleted_at IS NULL);

-- 2. Dosis baris resep ---------------------------------------------------------------------------------------------

-- frekuensi: kali sehari (Signa1 SIMmDosisObat). dosis: jumlah sekali pakai dalam dosis_satuan_id (Signa2). lama_hari:
-- lama pemberian.
ALTER TABLE public.sim_tr_resep_detail
    ALTER COLUMN jumlah TYPE numeric(18,4),
    ALTER COLUMN jumlah_permintaan TYPE numeric(18,4),
    ADD COLUMN frekuensi smallint,
    ADD COLUMN dosis numeric(18,4),
    ADD COLUMN dosis_satuan_id uuid,
    ADD COLUMN rute_id uuid,
    ADD COLUMN lama_hari smallint,
    DROP CONSTRAINT sim_tr_resep_detail_komponen_check,
    ADD CONSTRAINT sim_tr_resep_detail_komponen_check CHECK (
        obat_id IS NULL OR racikan_ke IS NULL
        OR (signa IS NULL AND aturan_pakai_id IS NULL AND frekuensi IS NULL AND dosis IS NULL
            AND dosis_satuan_id IS NULL AND rute_id IS NULL AND lama_hari IS NULL)),
    ADD CONSTRAINT sim_tr_resep_detail_dosis_check CHECK (
        (frekuensi IS NULL OR frekuensi > 0) AND (dosis IS NULL OR dosis > 0) AND (lama_hari IS NULL OR lama_hari > 0)),
    ADD CONSTRAINT sim_tr_resep_detail_dosis_satuan_foreign
        FOREIGN KEY (dosis_satuan_id) REFERENCES public.gd_m_satuan(id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_resep_detail_rute_foreign
        FOREIGN KEY (tenant_id, rute_id) REFERENCES public.sim_m_rute_obat(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX sim_tr_resep_detail_rute_index
    ON public.sim_tr_resep_detail USING btree (tenant_id, rute_id) WHERE (deleted_at IS NULL);

-- 3. Trigger -------------------------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_rute_obat
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_rute_obat
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_rute_obat
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_m_rute_obat', 'Rute pemberian obat', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_m_rute_obat');

-- 4. Data acuan ----------------------------------------------------------------------------------------------------

-- Isi bawaan satu tenant: rute pemberian WHO ATC/DDD, sistem kode route yang dipakai contoh MedicationRequest SATUSEHAT
-- (http://www.whocc.no/atc), dengan kode singkatan ATC apa adanya. ATC tidak punya rute topikal; tenant menambah barisnya
-- sendiri di Setup → Klinis. Diisi hanya bila tenant belum punya baris sama sekali, termasuk yang sudah dihapus.
CREATE FUNCTION public.sim_isi_rute_obat(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_rute_obat WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_rute_obat (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        SELECT gen_random_uuid(), p_tenant, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('O', 'Oral', 1),
                     ('P', 'Parenteral', 2),
                     ('R', 'Rektal', 3),
                     ('V', 'Vaginal', 4),
                     ('N', 'Nasal', 5),
                     ('SL', 'Sublingual / bukal', 6),
                     ('TD', 'Transdermal', 7),
                     ('Inhal', 'Inhalasi', 8),
                     ('Instill', 'Instilasi', 9),
                     ('Implant', 'Implan', 10)) AS v(kode, nama, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_rute_obat_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_rute_obat(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_rute_obat AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_rute_obat_saat_dipasang();

SELECT public.sim_isi_rute_obat(i.tenant_id)
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
                                {"id":"medication-routes","label":"Rute pemberian obat","href":"/healthcare/clinical/medication-routes","section":"Klinis","permission":"healthcare.diagnosis-reference.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
