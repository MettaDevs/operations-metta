-- Pembulatan harga satuan obat per legal entity. Tiga salinan GetHargaObatNew_WithStok sistem lama berbeda di sini:
-- Kuta 1 dan Penta menyimpan round(@HargaObat, 0), yaitu rupiah utuh setengah menjauhi nol, sedangkan Seroja menyimpan
-- @HargaObat money tanpa round, yaitu empat angka di belakang koma. Keputusan pemilik produk 13 November 2026: alur lama
-- dipindah apa adanya lebih dulu, dan beda antar-klinik menjadi setelan, bukan kode. Padanannya di Business Central
-- adalah Unit-Amount Rounding Precision (General Ledger Setup / Currency, per company). Core punya
-- currency_precisions.unit_amount_decimals, tetapi nilai IDR-nya dipakai penerimaan aset untuk kesetaraan CoreERP, jadi
-- farmasi memegang setelannya sendiri.
--
-- 1. Setelan farmasi (far_m_parameter), satu baris per legal entity.
-- 2. Harga satuan baris penyerahan sampai empat angka di belakang koma.
-- 3. Trigger versi, aktor, dan change log, nama izin harga obat, lalu menu.

-- 1. Setelan farmasi -------------------------------------------------------------------------------------------------

-- Baris lahir saat setelan pertama kali disimpan; legal entity tanpa baris memakai nilai bawaan kolomnya.
-- desimal_harga_satuan: banyak angka di belakang koma harga satuan obat. 0 (bawaan) = rupiah utuh seperti Kuta 1 dan
-- Penta, 4 = seperti Seroja.
CREATE TABLE public.far_m_parameter (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    desimal_harga_satuan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_parameter_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_parameter_legal_entity_unique UNIQUE (tenant_id, legal_entity_id),
    CONSTRAINT far_m_parameter_desimal_harga_satuan_check CHECK (desimal_harga_satuan BETWEEN 0 AND 4),
    CONSTRAINT far_m_parameter_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);

-- 2. Harga satuan baris penyerahan -----------------------------------------------------------------------------------

-- Harga yang sudah disalin tetap sama; nilai baris tetap dibulatkan ke sen.
ALTER TABLE public.bill_farmasi_detail ALTER COLUMN harga_satuan TYPE numeric(18,4);

-- 3. Trigger, change log, izin, dan menu -------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.far_m_parameter
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.far_m_parameter
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.far_m_parameter
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'far_m_parameter', 'Setelan farmasi', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'far_m_parameter');

-- Setelan farmasi memakai izin harga obat, jadi namanya ikut menyebutnya di layar role.
UPDATE public.app_entry_points
SET name = 'Layar kelompok grading, grading harga obat, dan setelan farmasi', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'pharmacy.drug-price.form';

UPDATE public.permissions
SET name = CASE code WHEN 'pharmacy.drug-price.read' THEN 'Lihat kelompok grading, grading harga obat, dan setelan farmasi'
                     ELSE 'Ubah kelompok grading, grading harga obat, dan setelan farmasi' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('pharmacy.drug-price.read', 'pharmacy.drug-price.update');

UPDATE public.security_privileges
SET name = CASE code WHEN 'pharmacy.drug-price.view' THEN 'Melihat kelompok grading, grading harga obat, dan setelan farmasi'
                     ELSE 'Memelihara kelompok grading, grading harga obat, dan setelan farmasi' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('pharmacy.drug-price.view', 'pharmacy.drug-price.maintain');

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"pharmacy-setup","label":"Setelan farmasi","href":"/pharmacy/drug/setup","section":"Harga obat","permission":"pharmacy.drug-price.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';
