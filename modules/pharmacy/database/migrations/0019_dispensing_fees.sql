-- Biaya racik dan biaya resep sebagai baris tagihan dari data, bukan setelan farmasi bernilai tetap. Sistem lama
-- menyimpan satu nilai per database di SetupAwal (BiayaRacikObat, BiayaResepObat): Seroja dan Kuta 1 racik 15000 resep
-- 0, Adapotek racik 10000 resep 2000. Di sini nilainya baris setelan per legal entity, boleh dipersempit ke lokasi stok
-- dan kelompok harga, dan tanpa baris yang cocok biayanya 0 (tidak ditagih). Tidak ada nominal di kode.
--
-- 1. far_m_biaya_pelayanan: nilai biaya racik atau biaya resep. Lokasi kosong berarti semua lokasi legal entity itu,
--    kelompok harga kosong berarti semua kelompok harga. Baris yang paling khusus menang: kelompok harga yang cocok
--    lebih dulu, lalu lokasi yang cocok. Karyawan sistem lama (biaya resep 0) cukup menjadi baris bernilai 0 untuk
--    kelompok harga karyawan. Satu baris hidup per kombinasi.
-- 2. bill_farmasi.tanpa_resep: "Tanpa Resep" sistem lama (WithoutPrescription), penjualan tanpa resep dokter tidak
--    dikenai biaya resep. Resep dari dokter selalu false.
-- 3. bill_farmasi_biaya: biaya yang dibekukan saat Siapkan resep atau Simpan dan bayar penjualan obat bebas, seperti
--    harga obat. Satu baris biaya racik per racikan (Qty 1, tidak dikali jumlah racikan atau komponennya) dan satu baris
--    biaya resep per baris obat bukan racikan (tidak dikali jumlah). Biaya bernilai 0 dan penyerahan yang termasuk
--    jasa tidak membuat baris. Biaya resep mengikuti baris obatnya: obat yang habis diretur tidak lagi ditagih biaya
--    resepnya. Biaya racik tetap ditagih sesudah retur, karena racikan tidak pernah diretur di sistem lama.
-- 4. Katalog izin dan menu: setelan ini masuk duty setelan farmasi yang sudah ada.
-- 5. Trigger versi, aktor, dan log perubahan (didaftarkan mati, pola 0016).

-- 1. Setelan biaya ---------------------------------------------------------------------------------------------------

CREATE TABLE public.far_m_biaya_pelayanan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    jenis character varying(10) NOT NULL,
    lokasi_id uuid,
    kelompok_harga_id uuid,
    nilai numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_biaya_pelayanan_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_biaya_pelayanan_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_biaya_pelayanan_jenis_check CHECK (jenis IN ('racik', 'resep')),
    CONSTRAINT far_m_biaya_pelayanan_nilai_check CHECK (nilai >= 0),
    CONSTRAINT far_m_biaya_pelayanan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_biaya_pelayanan_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_m_biaya_pelayanan_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_biaya_pelayanan_kunci_unique
    ON public.far_m_biaya_pelayanan USING btree (tenant_id, legal_entity_id, jenis, lokasi_id, kelompok_harga_id)
    NULLS NOT DISTINCT WHERE (deleted_at IS NULL);

-- 2. Tanpa resep -----------------------------------------------------------------------------------------------------

ALTER TABLE public.bill_farmasi
    ADD COLUMN tanpa_resep boolean DEFAULT false NOT NULL;

-- 3. Biaya yang dibekukan --------------------------------------------------------------------------------------------

CREATE TABLE public.bill_farmasi_biaya (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    bill_farmasi_id uuid NOT NULL,
    jenis character varying(10) NOT NULL,
    bill_farmasi_detail_id uuid,
    racikan_ke integer,
    biaya_pelayanan_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT bill_farmasi_biaya_pkey PRIMARY KEY (id),
    CONSTRAINT bill_farmasi_biaya_bentuk_check CHECK (
        (jenis = 'resep' AND bill_farmasi_detail_id IS NOT NULL AND racikan_ke IS NULL)
        OR (jenis = 'racik' AND racikan_ke IS NOT NULL AND bill_farmasi_detail_id IS NULL)),
    CONSTRAINT bill_farmasi_biaya_nilai_check CHECK (nilai > 0),
    CONSTRAINT bill_farmasi_biaya_bill_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, bill_farmasi_id)
        REFERENCES public.bill_farmasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_biaya_detail_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, bill_farmasi_detail_id)
        REFERENCES public.bill_farmasi_detail(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT bill_farmasi_biaya_setelan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, biaya_pelayanan_id)
        REFERENCES public.far_m_biaya_pelayanan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX bill_farmasi_biaya_resep_unique
    ON public.bill_farmasi_biaya USING btree (tenant_id, bill_farmasi_id, bill_farmasi_detail_id)
    WHERE (deleted_at IS NULL AND jenis = 'resep');
CREATE UNIQUE INDEX bill_farmasi_biaya_racik_unique
    ON public.bill_farmasi_biaya USING btree (tenant_id, bill_farmasi_id, racikan_ke)
    WHERE (deleted_at IS NULL AND jenis = 'racik');

-- 4. Katalog izin dan menu -------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('pharmacy.dispensing-fee.form', 'pharmacy', 'Layar biaya racik dan resep', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', 'pharmacy.dispensing-fee.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing-fee.read', 'read', 'Lihat biaya racik dan resep'),
             ('pharmacy.dispensing-fee.update', 'update', 'Ubah biaya racik dan resep')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing-fee.view', 'Melihat biaya racik dan resep'),
             ('pharmacy.dispensing-fee.maintain', 'Memelihara biaya racik dan resep')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.dispensing-fee.view', 'pharmacy.dispensing-fee.read'),
       ('pharmacy.dispensing-fee.maintain', 'pharmacy.dispensing-fee.read'),
       ('pharmacy.dispensing-fee.maintain', 'pharmacy.dispensing-fee.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.setup.inquire', 'pharmacy.dispensing-fee.view'),
       ('pharmacy.setup.manage', 'pharmacy.dispensing-fee.maintain')
ON CONFLICT DO NOTHING;

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) e
                                             WHERE e->>'id' = 'dispensing-fees')
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || '[
                            {"id":"dispensing-fees","label":"Biaya racik dan resep","href":"/pharmacy/dispensing/dispensing-fees","section":"Pelayanan resep","permission":"pharmacy.dispensing-fee.read"}]'::jsonb)
                        ELSE g
                   END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';

-- 5. Trigger dan log perubahan ---------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['far_m_biaya_pelayanan', 'bill_farmasi_biaya']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END $$;

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.name, t.caption, 'none', 'none', 'none', now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('far_m_biaya_pelayanan', 'Biaya racik dan resep'),
             ('bill_farmasi_biaya', 'Biaya racik dan resep penyerahan')) AS t(name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.name);
