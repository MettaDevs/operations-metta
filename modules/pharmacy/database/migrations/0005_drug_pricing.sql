-- Harga obat, makna GetHargaObatNew_WithStok sistem lama (klinik Seroja dan Penta, Kuta 1 memakai rumus yang sama):
-- harga = harga dasar barang x (1 + % naik / 100), dengan % naik dari grading harga obat untuk kelompok harga pembeli,
-- kelompok grading obat, dan rentang harga dasar. Harga dasar per satuan dasar milik barang Core
-- (gd_m_barang.harga_dasar). Keputusan pemilik produk 13 November 2026 (opsi 8.3 A): grading tinggal di module ini,
-- harga dihitung dan disalin ke baris penyerahan saat disiapkan, dan kasir tidak menghitung ulang. Tidak dibawa sebagai
-- kode: dimensi KTP (lokal dan asing adalah kelompok harga), TipePelayanan, kontrak penjamin, HargaObatDigunakan,
-- BPJS + Fornas tanpa kenaikan (cukup baris grading 0 %), dan diskon karyawan; semuanya bergantung pada id yang ditulis
-- mati di sistem lama.
--
-- 1. Katalog izin: kelompok grading dan grading harga obat, bagian duty setelan farmasi.
-- 2. Kelompok grading (far_m_kelompok_grading, SIMmKelompokGrading sistem lama) dan kelompok grading di data obat.
-- 3. Grading harga obat (far_m_grading_harga, SIMmGradingHargaObat sistem lama).
-- 4. Kelompok harga pembeli di resep, disalin dari event healthcare.prescription.issued.v1.
-- 5. Harga di baris penyerahan, ditulis saat disiapkan.
-- 6. Trigger versi, aktor, dan change log, lalu menu.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('pharmacy.drug-price.form', 'pharmacy', 'Layar kelompok grading dan grading harga obat', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', 'pharmacy.drug-price.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.drug-price.read', 'read', 'Lihat kelompok grading dan grading harga obat'),
             ('pharmacy.drug-price.update', 'update', 'Ubah kelompok grading dan grading harga obat'))
         AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.drug-price.view', 'Melihat kelompok grading dan grading harga obat'),
             ('pharmacy.drug-price.maintain', 'Memelihara kelompok grading dan grading harga obat')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.drug-price.view', 'pharmacy.drug-price.read'),
       ('pharmacy.drug-price.maintain', 'pharmacy.drug-price.read'),
       ('pharmacy.drug-price.maintain', 'pharmacy.drug-price.update')
ON CONFLICT DO NOTHING;

-- Role yang sudah memegang duty setelan farmasi ikut mendapat privilege barunya lewat duty itu.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.setup.inquire', 'pharmacy.drug-price.view'),
       ('pharmacy.setup.manage', 'pharmacy.drug-price.maintain')
ON CONFLICT DO NOTHING;

UPDATE public.security_duties
SET name = CASE code WHEN 'pharmacy.setup.inquire' THEN 'Lihat setelan farmasi, data obat, dan harga obat'
                     ELSE 'Kelola setelan farmasi, data obat, dan harga obat' END,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code IN ('pharmacy.setup.inquire', 'pharmacy.setup.manage');

-- 2. Kelompok grading ----------------------------------------------------------------------------------------------

-- Pengelompokan obat untuk grading harga, misalnya INJEKSI atau OBAT ORAL. Kelompok XX sistem lama adalah kelompok
-- biasa: 701 obat Seroja memegangnya dan baris grading XX hanya berlaku untuk mereka. Kelompok nonaktif tidak bisa
-- dipilih lagi di data obat, tetapi obat yang sudah memegangnya tetap dihargai menurut barisnya.
CREATE TABLE public.far_m_kelompok_grading (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    nama character varying(100) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_kelompok_grading_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_kelompok_grading_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_kelompok_grading_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_kelompok_grading_nama_unique
    ON public.far_m_kelompok_grading USING btree (tenant_id, legal_entity_id, lower(nama)) WHERE (deleted_at IS NULL);

-- Kosong berarti obat tanpa kelompok, coalesce(KelompokGrading, 'ALL') sistem lama: hanya baris grading untuk semua
-- barang yang berlaku untuknya.
ALTER TABLE public.far_m_obat
    ADD COLUMN kelompok_grading_id uuid,
    ADD CONSTRAINT far_m_obat_kelompok_grading_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, kelompok_grading_id)
        REFERENCES public.far_m_kelompok_grading(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
CREATE INDEX far_m_obat_kelompok_grading_index
    ON public.far_m_obat USING btree (tenant_id, kelompok_grading_id) WHERE (kelompok_grading_id IS NOT NULL);

-- 3. Grading harga obat ----------------------------------------------------------------------------------------------

-- % naik dan % diskon untuk satu kelompok harga, satu kelompok grading (kosong berarti semua barang, baris 'ALL'
-- sistem lama), dan rentang harga dasar per satuan dasar (harga_dari sampai harga_sampai, keduanya termasuk), berlaku
-- mulai tanggalnya. Harga obat memakai baris kelompok grading obat itu lebih dulu, lalu baris semua barang, lalu 0 %;
-- di antara baris yang cocok, berlaku_mulai terakhir yang sudah lewat. Layanan menolak rentang yang bertumpuk dengan
-- baris hidup lain berkunci sama (kelompok harga, kelompok grading, berlaku_mulai). Foreign key ke kelompok_harga juga
-- membuat Core menolak menghapus kelompok harga selama barisnya hidup (refuseWhileReferenced).
CREATE TABLE public.far_m_grading_harga (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kelompok_harga_id uuid NOT NULL,
    kelompok_grading_id uuid,
    harga_dari numeric(18,4) NOT NULL,
    harga_sampai numeric(18,4) NOT NULL,
    persen_naik numeric(7,4) NOT NULL,
    persen_diskon numeric(7,4) DEFAULT 0 NOT NULL,
    berlaku_mulai date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_grading_harga_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_grading_harga_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_grading_harga_rentang_check CHECK (harga_dari >= 0 AND harga_dari <= harga_sampai),
    CONSTRAINT far_m_grading_harga_naik_check CHECK (persen_naik >= 0),
    CONSTRAINT far_m_grading_harga_diskon_check CHECK (persen_diskon >= 0 AND persen_diskon <= 100),
    CONSTRAINT far_m_grading_harga_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_grading_harga_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_grading_harga_kelompok_grading_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, kelompok_grading_id)
        REFERENCES public.far_m_kelompok_grading(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX far_m_grading_harga_kelompok_harga_index
    ON public.far_m_grading_harga USING btree (tenant_id, legal_entity_id, kelompok_harga_id, berlaku_mulai)
    WHERE (deleted_at IS NULL);
CREATE INDEX far_m_grading_harga_kelompok_grading_index
    ON public.far_m_grading_harga USING btree (tenant_id, kelompok_grading_id)
    WHERE (kelompok_grading_id IS NOT NULL AND deleted_at IS NULL);

-- 4. Kelompok harga pembeli di resep ---------------------------------------------------------------------------------

-- Kelompok harga tipe pasien kunjungan saat resep dikirim, dari field price_group event resep. Kosong berarti resep
-- dari pesan yang belum membawanya atau tipe pasien tanpa kelompok harga: obatnya dihargai harga dasar (0 %). Potret,
-- seperti pasien dan dokter resep, jadi tanpa foreign key: resep lama tidak menahan kelompok harga dihapus.
ALTER TABLE public.far_tr_resep ADD COLUMN kelompok_harga_id uuid;

-- 5. Harga di baris penyerahan -------------------------------------------------------------------------------------

-- Ditulis saat disiapkan dan tidak berubah sesudahnya, juga bila grading atau harga dasar diubah: harga_dasar per
-- satuan dasar saat itu, baris grading yang dipakai (kosong bila tidak ada, 0 %), % naik, harga_satuan per satuan baris
-- (harga dasar x (1 + % naik / 100) x konversi, dibulatkan ke rupiah sesudah dikali konversi), dan % diskon. Nilai
-- baris = jumlah x harga_satuan x (100 - persen_diskon) / 100. Baris draf belum berharga; baris penyerahan yang sudah
-- disiapkan sebelum migration ini diisi 0.
ALTER TABLE public.bill_farmasi_detail
    ADD COLUMN harga_dasar numeric(18,4),
    ADD COLUMN grading_harga_id uuid,
    ADD COLUMN persen_naik numeric(7,4),
    ADD COLUMN harga_satuan numeric(18,2),
    ADD COLUMN persen_diskon numeric(7,4);

UPDATE public.bill_farmasi_detail d
SET harga_dasar = 0, persen_naik = 0, harga_satuan = 0, persen_diskon = 0
FROM public.bill_farmasi h
WHERE h.tenant_id = d.tenant_id AND h.id = d.bill_farmasi_id AND h.status <> 'draf';

ALTER TABLE public.bill_farmasi_detail
    ADD CONSTRAINT bill_farmasi_detail_harga_check CHECK (
        (harga_dasar IS NULL AND grading_harga_id IS NULL AND persen_naik IS NULL AND harga_satuan IS NULL
         AND persen_diskon IS NULL)
        OR (harga_dasar IS NOT NULL AND persen_naik IS NOT NULL AND harga_satuan IS NOT NULL
            AND persen_diskon IS NOT NULL AND harga_dasar >= 0 AND persen_naik >= 0 AND harga_satuan >= 0
            AND persen_diskon >= 0 AND persen_diskon <= 100)),
    ADD CONSTRAINT bill_farmasi_detail_grading_harga_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, grading_harga_id)
        REFERENCES public.far_m_grading_harga(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;

-- 6. Trigger, change log, dan menu ---------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['far_m_kelompok_grading', 'far_m_grading_harga']
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
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('far_m_kelompok_grading', 'Kelompok grading obat'),
             ('far_m_grading_harga', 'Grading harga obat')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"grading-groups","label":"Kelompok grading","href":"/pharmacy/drug/grading-groups","section":"Harga obat","permission":"pharmacy.drug-price.read"},
                                {"id":"drug-prices","label":"Grading harga obat","href":"/pharmacy/drug/drug-prices","section":"Harga obat","permission":"pharmacy.drug-price.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'pharmacy';
