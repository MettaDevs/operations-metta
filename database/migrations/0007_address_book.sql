-- Buku alamat pindah dari CoreERP, dengan tambahan dari keputusan pemilik produk 9 November 2026: party mengikuti
-- Global address book F&O, isian identitas form pasien legacy menjadi milik party, dan party tanpa nomor.
--
-- 1. Data acuan yang di CoreERP ditulis migration, bukan skema, sehingga tidak ada di 0001: jenis party
--    (2026_08_24_100000_create_party_types_table, namanya dari 2026_10_14_190100_seed_party_directory_reference_data),
--    nilai acuan dan jenis hubungan (2026_10_14_190100), dan kegunaan alamat
--    (2026_09_29_130000_share_locations_between_parties). Baris yang sudah ada tidak ditimpa.
-- 2. Tambahan data acuan: agama dan pendidikan sebagai nilai acuan party, kegunaan alamat KTP dan Domisili, dan jenis
--    hubungan orang tua/anak, pasangan, anggota KK, dan bekerja di.
-- 3. Katalog keamanan: kelompok `access` dan `vendor` CoreERP (2026_09_25_120100_register_core_security_catalog),
--    karena peran pengguna dan vendor dijaga izin lihatnya; ditambah izin melihat nomor identitas utuh dan alamat
--    privat.
-- 4. Registri peran party (party_roles): satu baris per peran, dengan module pemiliknya dan izin yang membuat party
--    berperan itu terlihat. Peran Core diisi di sini; peran module, misalnya pasien, didaftarkan migration module.
-- 5. Isian party baru: warga negara, tempat lahir, agama, pendidikan, dan pekerjaan (master per tenant).
-- 6. Nomor identitas (party_identifications): NIK unik per tenant di antara baris yang belum dihapus, No. KK boleh
--    sama karena sekeluarga berbagi satu KK.
-- 7. Alamat: penanda privat pada tautan party ke tempat, dan rujukan dusun/banjar pada alamat pos.
-- 8. Cek data ganda cara Business Central: setelan Search Hit % per tenant, baris search string, search string per
--    party, dan pasangan yang ditandai bukan ganda.
--
-- Nama kolom baru mengikuti tabelnya yang sudah berbahasa Inggris.

-- 1. Data acuan CoreERP --------------------------------------------------------------------------------------------

INSERT INTO public.party_types (code, name, created_at, updated_at)
VALUES ('person', 'Perorangan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('organization', 'Organisasi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('legal_entity', 'Entitas legal', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('team', 'Tim', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('operating_unit', 'Unit operasional', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.party_reference_values (category, code, name)
VALUES ('gender', 'female', 'Perempuan'),
       ('gender', 'male', 'Laki-laki'),
       ('gender', 'unspecified', 'Tidak disebutkan'),
       ('marital_status', 'single', 'Belum menikah'),
       ('marital_status', 'married', 'Menikah'),
       ('marital_status', 'divorced', 'Cerai'),
       ('marital_status', 'widowed', 'Pasangan meninggal'),
       ('abc_code', 'A', 'A'),
       ('abc_code', 'B', 'B'),
       ('abc_code', 'C', 'C'),
       ('language', 'id', 'Bahasa Indonesia'),
       ('language', 'en', 'English')
ON CONFLICT (category, code) DO NOTHING;

INSERT INTO public.party_relationship_types (code, name, inverse_name, from_type, to_type)
VALUES ('contact', 'Kontak dari', 'Memiliki kontak', 'person', 'organization'),
       ('subsidiary', 'Anak perusahaan dari', 'Induk perusahaan dari', 'organization', 'organization'),
       ('branch', 'Cabang dari', 'Memiliki cabang', 'organization', 'organization')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.location_purposes (code, name, sort_order, created_at, updated_at)
VALUES ('business', 'Kantor / usaha', 10, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('delivery', 'Pengiriman', 20, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('invoice', 'Penagihan', 30, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('payment', 'Pembayaran', 40, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('home', 'Rumah', 50, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- 2. Data acuan baru -----------------------------------------------------------------------------------------------

-- Agama dan pendidikan memakai kategori yang dipakai Dukcapil pada KTP dan KK.
INSERT INTO public.party_reference_values (category, code, name)
VALUES ('religion', 'islam', 'Islam'),
       ('religion', 'protestant', 'Kristen'),
       ('religion', 'catholic', 'Katolik'),
       ('religion', 'hindu', 'Hindu'),
       ('religion', 'buddhist', 'Buddha'),
       ('religion', 'confucian', 'Khonghucu'),
       ('religion', 'belief', 'Kepercayaan terhadap Tuhan YME'),
       ('education', 'none', 'Tidak/belum sekolah'),
       ('education', 'primary_incomplete', 'Belum tamat SD/sederajat'),
       ('education', 'primary', 'Tamat SD/sederajat'),
       ('education', 'junior_secondary', 'SLTP/sederajat'),
       ('education', 'senior_secondary', 'SLTA/sederajat'),
       ('education', 'diploma_1_2', 'Diploma I/II'),
       ('education', 'diploma_3', 'Akademi/Diploma III/Sarjana Muda'),
       ('education', 'bachelor', 'Diploma IV/Strata I'),
       ('education', 'master', 'Strata II'),
       ('education', 'doctorate', 'Strata III')
ON CONFLICT (category, code) DO NOTHING;

INSERT INTO public.location_purposes (code, name, sort_order, created_at, updated_at)
VALUES ('identity_card', 'KTP', 60, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('domicile', 'Domisili', 70, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Hubungan berarah dari pihak pertama ke pihak kedua. Status di KK dicatat sebagai anggota KK dari kepala
-- keluarganya, dan instansi sebagai tempat bekerja.
INSERT INTO public.party_relationship_types (code, name, inverse_name, from_type, to_type)
VALUES ('parent', 'Orang tua dari', 'Anak dari', 'person', 'person'),
       ('spouse', 'Pasangan dari', 'Pasangan dari', 'person', 'person'),
       ('family_card_member', 'Anggota KK dari', 'Kepala keluarga dari', 'person', 'person'),
       ('employed_by', 'Bekerja di', 'Tempat bekerja dari', 'person', 'organization')
ON CONFLICT (code) DO NOTHING;

-- 3. Katalog keamanan ----------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.access.form', 'core', 'Layar akses dan keamanan', 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.form', 'core', 'Layar vendor', 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.party-identification.form', 'core', 'Nomor identitas pihak', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.private-location.form', 'core', 'Alamat privat pihak', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.access.read', 'core', 'core.access.form', 'read', 'Lihat akses',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.access.update', 'core', 'core.access.form', 'update', 'Ubah akses',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.read', 'core', 'core.vendor.form', 'read', 'Lihat vendor',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.update', 'core', 'core.vendor.form', 'update', 'Ubah vendor',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.party-identification.read', 'core', 'core.party-identification.form', 'read',
        'Lihat nomor identitas utuh', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.private-location.read', 'core', 'core.private-location.form', 'read', 'Lihat alamat privat',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.access.view', 'core', 'Melihat akses', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.access.maintain', 'core', 'Memelihara akses', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.view', 'core', 'Melihat vendor', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.maintain', 'core', 'Memelihara vendor', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.party-identification.view', 'core', 'Melihat nomor identitas utuh',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.private-location.view', 'core', 'Melihat alamat privat',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.access.view', 'core.access.read'),
       ('core.access.maintain', 'core.access.read'),
       ('core.access.maintain', 'core.access.update'),
       ('core.vendor.view', 'core.vendor.read'),
       ('core.vendor.maintain', 'core.vendor.read'),
       ('core.vendor.maintain', 'core.vendor.update'),
       ('core.party-identification.view', 'core.party-identification.read'),
       ('core.private-location.view', 'core.private-location.read')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.access.inquire', 'core', 'Lihat akses', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.access.manage', 'core', 'Kelola akses', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.inquire', 'core', 'Lihat vendor', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.vendor.manage', 'core', 'Kelola vendor', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.party-identification.inquire', 'core', 'Lihat nomor identitas utuh',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('core.private-location.inquire', 'core', 'Lihat alamat privat',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.access.inquire', 'core.access.view'),
       ('core.access.manage', 'core.access.maintain'),
       ('core.vendor.inquire', 'core.vendor.view'),
       ('core.vendor.manage', 'core.vendor.maintain'),
       ('core.party-identification.inquire', 'core.party-identification.view'),
       ('core.private-location.inquire', 'core.private-location.view')
ON CONFLICT DO NOTHING;

-- 4. Registri peran ------------------------------------------------------------------------------------------------

-- Party berperan hanya terlihat bagi pemegang izin lihat salah satu perannya. Pelanggan, pegawai, dan kontak belum
-- punya layar sendiri, jadi izin lihatnya izin buku alamat.
CREATE TABLE public.party_roles (
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    owning_app_id character varying(80) NOT NULL,
    view_permission_code character varying(160) NOT NULL,
    sort_order smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT party_roles_pkey PRIMARY KEY (code),
    CONSTRAINT party_roles_owning_app_id_foreign FOREIGN KEY (owning_app_id) REFERENCES public.apps(id),
    CONSTRAINT party_roles_view_permission_code_foreign
        FOREIGN KEY (view_permission_code) REFERENCES public.permissions(code)
);

INSERT INTO public.party_roles (code, name, owning_app_id, view_permission_code, sort_order, created_at, updated_at)
VALUES ('customer', 'Pelanggan', 'core', 'core.organization.read', 10, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('vendor', 'Vendor', 'core', 'core.vendor.read', 20, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('worker', 'Pegawai', 'core', 'core.organization.read', 30, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('user', 'Pengguna', 'core', 'core.access.read', 40, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('contact', 'Kontak', 'core', 'core.organization.read', 50, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.party_role_registrations
    ADD CONSTRAINT party_role_registrations_role_code_foreign FOREIGN KEY (role_code) REFERENCES public.party_roles(code);
CREATE INDEX party_role_registrations_party_id_index ON public.party_role_registrations USING btree (party_id);

-- 5. Isian party baru ----------------------------------------------------------------------------------------------

CREATE TABLE public.occupations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT occupations_pkey PRIMARY KEY (id),
    CONSTRAINT occupations_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX occupations_name_unique
    ON public.occupations USING btree (tenant_id, lower((name)::text)) WHERE (deleted_at IS NULL);

ALTER TABLE public.parties
    ADD COLUMN nationality_country_code character(2),
    ADD COLUMN birth_place character varying(120),
    ADD COLUMN religion character varying(30),
    ADD COLUMN education character varying(30),
    ADD COLUMN occupation_id uuid,
    ADD CONSTRAINT parties_nationality_country_code_foreign
        FOREIGN KEY (nationality_country_code) REFERENCES public.country_regions(code) ON DELETE RESTRICT,
    ADD CONSTRAINT parties_tenant_id_occupation_id_foreign
        FOREIGN KEY (tenant_id, occupation_id) REFERENCES public.occupations(tenant_id, id) ON DELETE RESTRICT;

-- 6. Nomor identitas -----------------------------------------------------------------------------------------------

-- data_sensitivity memakai klasifikasi Data Sensitivity Business Central. Nomor berklasifikasi sensitive
-- disamarkan bagi yang tidak memegang izin Lihat nomor identitas utuh.
CREATE TABLE public.party_identification_types (
    code character varying(30) NOT NULL,
    name character varying(60) NOT NULL,
    number_pattern character varying(120),
    data_sensitivity character varying(30) NOT NULL,
    sort_order smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    CONSTRAINT party_identification_types_pkey PRIMARY KEY (code),
    CONSTRAINT party_identification_types_sensitivity
        CHECK (data_sensitivity IN ('sensitive', 'personal', 'normal'))
);

INSERT INTO public.party_identification_types (code, name, number_pattern, data_sensitivity, sort_order, created_at, updated_at)
VALUES ('nik', 'NIK', '^[0-9]{16}$', 'sensitive', 10, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('family_card', 'No. KK', '^[0-9]{16}$', 'sensitive', 20, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('passport', 'Paspor', '^[A-Z0-9]{5,20}$', 'personal', 30, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.party_identifications (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    type_code character varying(30) NOT NULL,
    number character varying(40) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT party_identifications_pkey PRIMARY KEY (id),
    CONSTRAINT party_identifications_tenant_id_party_id_foreign
        FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT party_identifications_type_code_foreign
        FOREIGN KEY (type_code) REFERENCES public.party_identification_types(code)
);
-- Satu nomor per jenis per party, dan satu NIK per tenant.
CREATE UNIQUE INDEX party_identifications_one_per_type
    ON public.party_identifications USING btree (party_id, type_code) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX party_identifications_nik_unique
    ON public.party_identifications USING btree (tenant_id, number) WHERE (type_code = 'nik' AND deleted_at IS NULL);
CREATE INDEX party_identifications_tenant_id_type_code_number_index
    ON public.party_identifications USING btree (tenant_id, type_code, number) WHERE (deleted_at IS NULL);

-- 7. Alamat --------------------------------------------------------------------------------------------------------

ALTER TABLE public.party_locations ADD COLUMN is_private boolean DEFAULT false NOT NULL;

ALTER TABLE public.postal_addresses
    ADD COLUMN group_of_houses_id uuid,
    ADD COLUMN group_of_houses character varying(200),
    ADD CONSTRAINT postal_addresses_group_of_houses_id_foreign
        FOREIGN KEY (group_of_houses_id) REFERENCES public.ref_group_of_houses(id) ON DELETE RESTRICT;

-- 8. Cek data ganda ------------------------------------------------------------------------------------------------

-- Search Hit % per tenant (field Marketing Setup."Search Hit %" BC). Tanpa baris, bawaannya 60.
CREATE TABLE public.party_duplicate_settings (
    tenant_id uuid NOT NULL,
    search_hit_percent smallint NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT party_duplicate_settings_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT party_duplicate_settings_percent CHECK (search_hit_percent BETWEEN 1 AND 100)
);

-- Baris search string (tabel Duplicate Search String Setup BC): isian, bagian depan atau belakang, dan panjangnya.
CREATE TABLE public.party_duplicate_search_setups (
    field_code character varying(30) NOT NULL,
    part character varying(10) NOT NULL,
    length smallint NOT NULL,
    CONSTRAINT party_duplicate_search_setups_pkey PRIMARY KEY (field_code, part),
    CONSTRAINT party_duplicate_search_setups_part CHECK (part IN ('first', 'last')),
    CONSTRAINT party_duplicate_search_setups_length CHECK (length BETWEEN 2 AND 10)
);

INSERT INTO public.party_duplicate_search_setups (field_code, part, length)
VALUES ('name', 'first', 5),
       ('name', 'last', 5),
       ('birth_date', 'first', 5),
       ('birth_date', 'last', 5),
       ('phone', 'first', 5),
       ('phone', 'last', 5)
ON CONFLICT DO NOTHING;

-- Search string setiap party orang (tabel Cont. Duplicate Search String BC), ditulis ulang setiap kali nama,
-- tanggal lahir, atau telepon party berubah. Satu baris per baris setup, diperbarui di tempat.
CREATE TABLE public.party_duplicate_search_strings (
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    field_code character varying(30) NOT NULL,
    part character varying(10) NOT NULL,
    search_string character varying(10),
    CONSTRAINT party_duplicate_search_strings_pkey PRIMARY KEY (party_id, field_code, part),
    CONSTRAINT party_duplicate_search_strings_tenant_id_party_id_foreign
        FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX party_duplicate_search_strings_lookup
    ON public.party_duplicate_search_strings USING btree (tenant_id, field_code, part, search_string);

-- Pasangan yang ditandai bukan ganda (field Separate Contacts tabel Contact Duplicate BC). Pasangan disimpan dengan
-- id terkecil lebih dulu, supaya satu pasangan tetap satu baris.
CREATE TABLE public.party_separations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    other_party_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT party_separations_pkey PRIMARY KEY (id),
    CONSTRAINT party_separations_order CHECK (party_id < other_party_id),
    CONSTRAINT party_separations_tenant_id_party_id_foreign
        FOREIGN KEY (tenant_id, party_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT party_separations_tenant_id_other_party_id_foreign
        FOREIGN KEY (tenant_id, other_party_id) REFERENCES public.parties(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX party_separations_pair_unique
    ON public.party_separations USING btree (tenant_id, party_id, other_party_id) WHERE (deleted_at IS NULL);

-- Tabel tenant baru mendapat trigger yang sama dengan tabel tenant CoreERP: versi baris, actor audit, dan log
-- perubahan.
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.occupations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_identifications
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_duplicate_settings
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.party_separations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.occupations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_identifications
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_duplicate_settings
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.party_separations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.occupations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_identifications
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_duplicate_settings
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change('tenant_id');
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.party_separations
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
