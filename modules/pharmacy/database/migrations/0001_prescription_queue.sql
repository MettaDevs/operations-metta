-- Module farmasi tahap 1: resep dari layanan kesehatan masuk antrean farmasi, lokasi farmasi yang melayaninya diatur di
-- setelan, dan data obat khusus farmasi (golongan, generik, formularium) melekat pada barang persediaan Core.
-- Keputusan pemilik produk, 12-13 November 2026: satu farmasi; farmasi pusling dan farmasi biasa hanya beda lokasi yang
-- dipilih lewat setelan, tidak ada section yang ditulis mati.
--
-- 1. Katalog module: app, entry point, permission, privilege, duty, dan menu. Nama yang tampil di layar datang dari
--    baris ini.
-- 2. Tabel event yang sudah diproses (far_processed_events), untuk penerima event yang idempoten.
-- 3. Golongan obat (far_m_golongan_obat): data acuan per legal entity, bukan daftar di kode. Isi bawaannya lima
--    golongan obat di Indonesia; legal entity boleh menambah, mengubah, dan menghapusnya.
-- 4. Data obat farmasi (far_m_obat): perluasan barang persediaan Core berkunci id barang (pola table extension BC).
-- 5. Lokasi layanan resep (far_m_lokasi_layanan): lokasi stok yang melayani resep dari satu operating unit, dengan
--    baris per section asal yang menimpa baris unit.
-- 6. Antrean resep (far_tr_resep + _detail): potret resep dari event healthcare.prescription.issued.v1. Module ini
--    tidak membaca tabel layanan kesehatan; semua yang diketahuinya tentang resep datang dari event itu.
-- 7. Trigger versi, aktor, dan change log, lalu isi golongan obat untuk tenant yang sudah memasang module ini dan
--    trigger untuk tenant dan legal entity sesudahnya.
--
-- Tidak ada baris yang dihapus fisik: tabel membawa deleted_at, dan indeks unik kode bisnis parsial.

-- 1. Katalog -------------------------------------------------------------------------------------------------------

INSERT INTO public.apps (id, name, version, status, database_name, description, has_ui, icon, created_at, updated_at)
VALUES ('pharmacy', 'Farmasi', '0.1.0', 'active', NULL,
        'Antrean resep, penyerahan obat, dan retur obat pasien.', true, 'pill',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
SELECT e.code, 'pharmacy', e.name, 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.prescription.form', 'Layar antrean resep'),
             ('pharmacy.service-location.form', 'Layar lokasi layanan resep'),
             ('pharmacy.drug.form', 'Layar golongan obat dan data obat farmasi')) AS e(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.entry_point, p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.prescription.read', 'pharmacy.prescription.form', 'read', 'Lihat antrean resep'),
             ('pharmacy.service-location.read', 'pharmacy.service-location.form', 'read',
              'Lihat lokasi layanan resep'),
             ('pharmacy.service-location.update', 'pharmacy.service-location.form', 'update',
              'Ubah lokasi layanan resep'),
             ('pharmacy.drug.read', 'pharmacy.drug.form', 'read', 'Lihat golongan obat dan data obat farmasi'),
             ('pharmacy.drug.update', 'pharmacy.drug.form', 'update', 'Ubah golongan obat dan data obat farmasi'))
         AS p(code, entry_point, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'pharmacy', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.prescription.view', 'Melihat antrean resep'),
             ('pharmacy.service-location.view', 'Melihat lokasi layanan resep'),
             ('pharmacy.service-location.maintain', 'Memelihara lokasi layanan resep'),
             ('pharmacy.drug.view', 'Melihat golongan obat dan data obat farmasi'),
             ('pharmacy.drug.maintain', 'Memelihara golongan obat dan data obat farmasi')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.prescription.view', 'pharmacy.prescription.read'),
       ('pharmacy.service-location.view', 'pharmacy.service-location.read'),
       ('pharmacy.service-location.maintain', 'pharmacy.service-location.read'),
       ('pharmacy.service-location.maintain', 'pharmacy.service-location.update'),
       ('pharmacy.drug.view', 'pharmacy.drug.read'),
       ('pharmacy.drug.maintain', 'pharmacy.drug.read'),
       ('pharmacy.drug.maintain', 'pharmacy.drug.update')
ON CONFLICT DO NOTHING;

-- Lihat untuk siapa pun yang perlu memantau antrean; kelola setelan untuk apoteker penanggung jawab. Duty penyerahan
-- (asisten menyiapkan dan memanggil, apoteker menyerahkan) lahir bersama dokumen penyerahan.
INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
SELECT d.code, 'pharmacy', d.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('pharmacy.dispensing.inquire', 'Lihat antrean resep dan penyerahan obat'),
             ('pharmacy.setup.inquire', 'Lihat setelan farmasi dan data obat'),
             ('pharmacy.setup.manage', 'Kelola setelan farmasi dan data obat')) AS d(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.dispensing.inquire', 'pharmacy.prescription.view'),
       ('pharmacy.setup.inquire', 'pharmacy.service-location.view'),
       ('pharmacy.setup.inquire', 'pharmacy.drug.view'),
       ('pharmacy.setup.manage', 'pharmacy.service-location.maintain'),
       ('pharmacy.setup.manage', 'pharmacy.drug.maintain')
ON CONFLICT DO NOTHING;

-- Grup rail sama dengan folder area di src/: `dashboard/`, `dispensing/` (Pelayanan resep), dan Setup yang
-- mengumpulkan halaman pengaturan per domain dengan judul bagian mengikuti foldernya.
UPDATE public.apps
SET navigation = '[{"id":"dashboard","label":"Dashboard","icon":"layout-dashboard","items":[
        {"id":"dashboard","label":"Dashboard","href":"/pharmacy/dashboard"}]},
    {"id":"dispensing","label":"Pelayanan resep","icon":"pill","items":[
        {"id":"prescriptions","label":"Antrean resep","href":"/pharmacy/dispensing/prescriptions","permission":"pharmacy.prescription.read"}]},
    {"id":"setup","label":"Setup","icon":"settings","items":[
        {"id":"service-locations","label":"Lokasi layanan resep","href":"/pharmacy/dispensing/service-locations","section":"Pelayanan resep","permission":"pharmacy.service-location.read"},
        {"id":"drug-classes","label":"Golongan obat","href":"/pharmacy/drug/drug-classes","section":"Obat","permission":"pharmacy.drug.read"},
        {"id":"drugs","label":"Data obat farmasi","href":"/pharmacy/drug/drugs","section":"Obat","permission":"pharmacy.drug.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'pharmacy';

-- 2. Event yang sudah diproses ---------------------------------------------------------------------------------------

CREATE TABLE public.far_processed_events (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT far_processed_events_pkey PRIMARY KEY (id),
    CONSTRAINT far_processed_events_tenant_id_event_id_unique UNIQUE (tenant_id, event_id)
);

-- 3. Golongan obat ---------------------------------------------------------------------------------------------------

CREATE TABLE public.far_m_golongan_obat (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    urutan integer DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_golongan_obat_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_golongan_obat_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_m_golongan_obat_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_golongan_obat_kode_unique
    ON public.far_m_golongan_obat USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

-- 4. Data obat farmasi -----------------------------------------------------------------------------------------------

-- Satu baris per barang yang pernah diberi data farmasi; barang tanpa baris berarti belum digolongkan, bukan generik,
-- dan di luar formularium.
CREATE TABLE public.far_m_obat (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    golongan_obat_id uuid,
    generik boolean DEFAULT false NOT NULL,
    formularium boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_obat_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_obat_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_m_obat_golongan_obat_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, golongan_obat_id)
        REFERENCES public.far_m_golongan_obat(tenant_id, legal_entity_id, id) ON DELETE RESTRICT
);
CREATE INDEX far_m_obat_golongan_obat_index
    ON public.far_m_obat USING btree (tenant_id, golongan_obat_id) WHERE (golongan_obat_id IS NOT NULL);

-- 5. Lokasi layanan resep --------------------------------------------------------------------------------------------

-- Resep dari operating unit itu dilayani lokasi stok ini. section_id kosong berarti bawaan unit; baris ber-section
-- menimpanya untuk resep dari section itu, misalnya resep pusling dilayani lokasi farmasi pusling. section_id adalah id
-- section di layanan kesehatan, dikenal dari resep yang sudah diterima; tidak ada foreign key ke tabel module itu.
CREATE TABLE public.far_m_lokasi_layanan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    section_id uuid,
    lokasi_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_m_lokasi_layanan_pkey PRIMARY KEY (id),
    CONSTRAINT far_m_lokasi_layanan_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_lokasi_layanan_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_m_lokasi_layanan_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_m_lokasi_layanan_unique
    ON public.far_m_lokasi_layanan USING btree (tenant_id, legal_entity_id, operating_unit_id, section_id)
    NULLS NOT DISTINCT WHERE (deleted_at IS NULL);

-- 6. Antrean resep ---------------------------------------------------------------------------------------------------

-- Potret resep saat dikirim dokter. resep_sumber_id adalah id resep di layanan kesehatan; resep yang sama tidak pernah
-- tercatat dua kali. lokasi_id kosong berarti lokasi dari Lokasi layanan resep; terisi berarti dipilih petugas farmasi.
CREATE TABLE public.far_tr_resep (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid NOT NULL,
    event_id uuid NOT NULL,
    resep_sumber_id uuid NOT NULL,
    nomor_resep character varying(60) NOT NULL,
    no_reg character varying(60) NOT NULL,
    diterbitkan_pada timestamp(0) without time zone NOT NULL,
    diterima_pada timestamp(0) without time zone NOT NULL,
    catatan character varying(500),
    pasien_id uuid NOT NULL,
    nrm character varying(60) NOT NULL,
    nama_pasien character varying(200) NOT NULL,
    tanggal_lahir date,
    dokter_id uuid,
    nama_dokter character varying(200),
    section_id uuid NOT NULL,
    nama_section character varying(150) NOT NULL,
    lokasi_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_tr_resep_pkey PRIMARY KEY (id),
    CONSTRAINT far_tr_resep_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_tr_resep_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_tr_resep_operating_unit_foreign
        FOREIGN KEY (tenant_id, operating_unit_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT far_tr_resep_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id) REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX far_tr_resep_sumber_unique
    ON public.far_tr_resep USING btree (tenant_id, resep_sumber_id);
CREATE INDEX far_tr_resep_antrean_index
    ON public.far_tr_resep USING btree (tenant_id, legal_entity_id, diterbitkan_pada) WHERE (deleted_at IS NULL);

-- Baris resep apa adanya: obat tunggal (barang dan jumlah), kepala racikan (tanpa barang, jumlah racikan diminta), dan
-- komponen racikan (barang dan jumlah, nomor racikannya). Jumlah dalam satuan dasar barang.
CREATE TABLE public.far_tr_resep_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    resep_id uuid NOT NULL,
    baris_sumber_id uuid NOT NULL,
    urutan integer NOT NULL,
    barang_id uuid,
    kode_barang character varying(50),
    nama_barang character varying(200),
    racikan_ke integer,
    jumlah numeric(18,4),
    satuan_id uuid,
    kode_satuan character varying(50),
    nama_satuan character varying(200),
    jumlah_permintaan numeric(18,4),
    signa character varying(100),
    aturan_pakai character varying(150),
    keterangan character varying(500),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT far_tr_resep_detail_pkey PRIMARY KEY (id),
    CONSTRAINT far_tr_resep_detail_scope_unique UNIQUE (tenant_id, legal_entity_id, id),
    CONSTRAINT far_tr_resep_detail_resep_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, resep_id) REFERENCES public.far_tr_resep(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_tr_resep_detail_barang_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, barang_id) REFERENCES public.gd_m_barang(tenant_id, legal_entity_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT far_tr_resep_detail_bentuk_check CHECK (barang_id IS NOT NULL OR racikan_ke IS NOT NULL),
    CONSTRAINT far_tr_resep_detail_jumlah_check CHECK (barang_id IS NULL OR jumlah IS NOT NULL)
);
CREATE INDEX far_tr_resep_detail_resep_index
    ON public.far_tr_resep_detail USING btree (tenant_id, resep_id, urutan);

-- 7. Trigger dan data acuan ------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['far_m_golongan_obat', 'far_m_obat', 'far_m_lokasi_layanan', 'far_tr_resep',
                             'far_tr_resep_detail']
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
FROM (VALUES ('far_m_golongan_obat', 'Golongan obat'),
             ('far_m_obat', 'Data obat farmasi'),
             ('far_m_lokasi_layanan', 'Lokasi layanan resep'),
             ('far_tr_resep', 'Resep di farmasi'),
             ('far_tr_resep_detail', 'Baris resep di farmasi')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- Golongan obat bawaan satu legal entity, diisi hanya bila legal entity itu belum punya golongan sama sekali, termasuk
-- yang sudah dihapus, sehingga pengisian ulang tidak mengembalikan golongan yang sengaja dihapus.
CREATE FUNCTION public.far_isi_acuan(p_tenant uuid, p_legal_entity uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.far_m_golongan_obat
                   WHERE tenant_id = p_tenant AND legal_entity_id = p_legal_entity) THEN
        INSERT INTO public.far_m_golongan_obat (id, tenant_id, legal_entity_id, kode, nama, urutan, created_at,
                                                updated_at)
        SELECT gen_random_uuid(), p_tenant, p_legal_entity, v.kode, v.nama, v.urutan, now() AT TIME ZONE 'utc',
               now() AT TIME ZONE 'utc'
        FROM (VALUES ('NARKOTIKA', 'Narkotika', 1),
                     ('PSIKOTROPIKA', 'Psikotropika', 2),
                     ('KERAS', 'Obat keras', 3),
                     ('BEBAS-TERBATAS', 'Obat bebas terbatas', 4),
                     ('BEBAS', 'Obat bebas', 5)) AS v(kode, nama, urutan);
    END IF;
END;
$$;

-- Tenant yang memasang module ini mendapat golongan bawaan untuk setiap legal entity-nya saat catatan pemasangannya
-- ditulis; legal entity yang lahir sesudahnya mendapatkannya saat dibuat, selama module ini terpasang.
CREATE FUNCTION public.far_isi_acuan_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.far_isi_acuan(l.tenant_id, l.organization_id)
    FROM public.legal_entities l
    WHERE l.tenant_id = NEW.tenant_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER far_isi_acuan AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'pharmacy' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.far_isi_acuan_saat_dipasang();

CREATE FUNCTION public.far_isi_acuan_saat_legal_entity_lahir() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.core_module_installations i
               WHERE i.tenant_id = NEW.tenant_id AND i.module_id = 'pharmacy' AND i.status = 'installed') THEN
        PERFORM public.far_isi_acuan(NEW.tenant_id, NEW.organization_id);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER far_isi_acuan AFTER INSERT ON public.legal_entities
    FOR EACH ROW EXECUTE FUNCTION public.far_isi_acuan_saat_legal_entity_lahir();

SELECT public.far_isi_acuan(l.tenant_id, l.organization_id)
FROM public.legal_entities l
JOIN public.core_module_installations i
     ON i.tenant_id = l.tenant_id AND i.module_id = 'pharmacy' AND i.status = 'installed';
