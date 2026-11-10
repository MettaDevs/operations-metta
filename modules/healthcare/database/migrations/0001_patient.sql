-- Master pasien, pondasi pertama layanan kesehatan. Keputusan pemilik produk, 10 November 2026.
--
-- 1. Katalog module: app, entry point, permission, privilege, duty, kebijakan data per unit, peran party pasien dan
--    penjamin, reference nomor rekam medis, tujuan hierarchy "kelompok berbagi pasien", dan nilai acuan golongan
--    darah serta status di Kartu Keluarga. Nama yang tampil di layar datang dari baris ini, bukan dari kode.
-- 2. Tabel module berawalan kes_. Identitas, nomor identitas, alamat, dan kontak pasien milik party Core; tabel di
--    sini hanya memegang data khusus pasien, cara bayar, tipe pasien, dan penjamin.
-- 3. Sequence nomor rekam medis untuk operating unit yang sudah ada. Unit baru mendapatkannya dari Core saat dibuat
--    (default_per_operating_unit, Core 0012).
--
-- Tidak ada baris yang dihapus fisik: semua tabel membawa deleted_at, dan indeks unik kode bisnis parsial.

-- 1. Katalog -------------------------------------------------------------------------------------------------------

INSERT INTO public.apps (id, name, version, status, database_name, description, created_at, updated_at)
VALUES ('healthcare', 'Layanan kesehatan', '0.1.0', 'active', NULL,
        'Pasien, cara bayar, dan pelayanan klinik.', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.patient.form', 'healthcare', 'Layar pasien', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.api', 'healthcare', 'Pendaftaran dan perubahan pasien', 'api',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-type.form', 'healthcare', 'Layar tipe pasien', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor.form', 'healthcare', 'Layar penjamin', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.patient.read', 'healthcare', 'healthcare.patient.form', 'read', 'Lihat pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.create', 'healthcare', 'healthcare.patient.api', 'create', 'Daftarkan pasien baru',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.update', 'healthcare', 'healthcare.patient.api', 'update', 'Ubah data pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.delete', 'healthcare', 'healthcare.patient.api', 'delete', 'Hapus pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-type.read', 'healthcare', 'healthcare.patient-type.form', 'read', 'Lihat tipe pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-type.update', 'healthcare', 'healthcare.patient-type.form', 'update', 'Ubah tipe pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor.read', 'healthcare', 'healthcare.guarantor.form', 'read', 'Lihat penjamin',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor.update', 'healthcare', 'healthcare.guarantor.form', 'update', 'Ubah penjamin',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.patient.view', 'healthcare', 'Melihat pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.register', 'healthcare', 'Mendaftarkan pasien baru',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.maintain', 'healthcare', 'Memelihara data pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.retire', 'healthcare', 'Menghapus pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-type.view', 'healthcare', 'Melihat tipe pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-type.maintain', 'healthcare', 'Memelihara tipe pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor.view', 'healthcare', 'Melihat penjamin', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor.maintain', 'healthcare', 'Memelihara penjamin',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.patient.view', 'healthcare.patient.read'),
       ('healthcare.patient.register', 'healthcare.patient.read'),
       ('healthcare.patient.register', 'healthcare.patient.create'),
       ('healthcare.patient.maintain', 'healthcare.patient.read'),
       ('healthcare.patient.maintain', 'healthcare.patient.update'),
       ('healthcare.patient.retire', 'healthcare.patient.read'),
       ('healthcare.patient.retire', 'healthcare.patient.delete'),
       ('healthcare.patient-type.view', 'healthcare.patient-type.read'),
       ('healthcare.patient-type.maintain', 'healthcare.patient-type.read'),
       ('healthcare.patient-type.maintain', 'healthcare.patient-type.update'),
       ('healthcare.guarantor.view', 'healthcare.guarantor.read'),
       ('healthcare.guarantor.maintain', 'healthcare.guarantor.read'),
       ('healthcare.guarantor.maintain', 'healthcare.guarantor.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.patient.inquire', 'healthcare', 'Lihat pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient.manage', 'healthcare', 'Kelola pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.payment-setup.inquire', 'healthcare', 'Lihat tipe pasien dan penjamin',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.payment-setup.manage', 'healthcare', 'Kelola tipe pasien dan penjamin',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.patient.inquire', 'healthcare.patient.view'),
       ('healthcare.patient.manage', 'healthcare.patient.register'),
       ('healthcare.patient.manage', 'healthcare.patient.maintain'),
       ('healthcare.patient.manage', 'healthcare.patient.retire'),
       ('healthcare.payment-setup.inquire', 'healthcare.patient-type.view'),
       ('healthcare.payment-setup.inquire', 'healthcare.guarantor.view'),
       ('healthcare.payment-setup.manage', 'healthcare.patient-type.maintain'),
       ('healthcare.payment-setup.manage', 'healthcare.guarantor.maintain')
ON CONFLICT DO NOTHING;

-- Pasien dibatasi per unit kerja: role dengan duty pasien diberikan untuk unit tertentu (beserta turunannya di
-- hierarchy), dan pasien terlihat bila unit pendaftarnya sekelompok berbagi dengan unit itu. Tipe pasien dan penjamin
-- adalah master tenant, jadi tidak dilindungi kebijakan ini.
INSERT INTO public.app_data_policies (code, app_id, name, protected_permissions, requires_legal_entity,
                                      requires_operating_unit, allows_descendants, created_at, updated_at)
VALUES ('healthcare.patient-unit', 'healthcare', 'Akses pasien menurut unit kerja',
        '["healthcare.patient.read","healthcare.patient.create","healthcare.patient.update","healthcare.patient.delete"]',
        false, true, true, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.party_roles (code, name, owning_app_id, view_permission_code, sort_order, created_at, updated_at)
VALUES ('healthcare.patient', 'Pasien', 'healthcare', 'healthcare.patient.read', 60,
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.guarantor', 'Penjamin', 'healthcare', 'healthcare.guarantor.read', 70,
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- Nomor rekam medis: satu sequence per operating unit, dipakai unit pemilik kelompok berbagi pasien. Format bawaan
-- sama dengan sistem lama, enam digit berkelompok dua (00.00.01); admin bebas mengubahnya di Nomor dokumen.
INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_operating_unit,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('019a6f3c-8a00-7000-8000-000000000001', 'healthcare', 'healthcare.medical-record-number',
        'Nomor rekam medis (NRM)', '["operating_unit"]', NULL,
        '{"minimum_number":1,"maximum_number":999999,"segments":[{"type":"number","length":6,"mask":"##.##.##"}]}',
        true, true, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.hierarchy_purposes (id, code, name, description, created_at, updated_at)
VALUES ('019a6f3c-8a00-7000-8000-000000000002', 'healthcare.patient-sharing', 'Kelompok berbagi pasien',
        'Unit kerja teratas di setiap cabang beserta unit di bawahnya memakai data pasien dan nomor rekam medis yang sama.',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.party_reference_values (category, code, name)
VALUES ('blood_type', 'A', 'A'),
       ('blood_type', 'B', 'B'),
       ('blood_type', 'AB', 'AB'),
       ('blood_type', 'O', 'O'),
       ('blood_type', 'A-', 'A-'),
       ('blood_type', 'A+', 'A+'),
       ('blood_type', 'B-', 'B-'),
       ('blood_type', 'B+', 'B+'),
       ('blood_type', 'AB-', 'AB-'),
       ('blood_type', 'AB+', 'AB+'),
       ('blood_type', 'O+', 'O+'),
       ('blood_type', 'O-', 'O-'),
       ('family_status', 'head', 'Kepala keluarga'),
       ('family_status', 'husband', 'Suami'),
       ('family_status', 'wife', 'Istri'),
       ('family_status', 'child', 'Anak'),
       ('family_status', 'child_in_law', 'Menantu'),
       ('family_status', 'grandchild', 'Cucu'),
       ('family_status', 'parent', 'Orang tua'),
       ('family_status', 'parent_in_law', 'Mertua'),
       ('family_status', 'household_helper', 'Pembantu'),
       ('family_status', 'sibling', 'Saudara kandung'),
       ('family_status', 'guardian', 'Wali'),
       ('family_status', 'other', 'Lainnya')
ON CONFLICT (category, code) DO NOTHING;

-- 2. Tabel ---------------------------------------------------------------------------------------------------------

-- Tipe pasien (JenisKerjasama sistem lama), misalnya Umum, BPJS, Asuransi, Perusahaan. Isinya diisi tenant.
-- memakai_penjamin menampilkan isian penjamin dan nomor kartu, seperti form lama yang hanya memunculkannya untuk tipe
-- berpenjamin.
CREATE TABLE public.kes_tipe_pasien (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    memakai_penjamin boolean DEFAULT false NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_tipe_pasien_pkey PRIMARY KEY (id),
    CONSTRAINT kes_tipe_pasien_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX kes_tipe_pasien_kode_unique
    ON public.kes_tipe_pasien USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

-- Penjamin: party organisasi berperan penjamin, untuk satu tipe pasien (SIMdCustomerKerjasama sistem lama).
CREATE TABLE public.kes_penjamin (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_penjamin_pkey PRIMARY KEY (id),
    CONSTRAINT kes_penjamin_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT kes_penjamin_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.kes_tipe_pasien(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX kes_penjamin_party_tipe_unique
    ON public.kes_penjamin USING btree (tenant_id, party_id, tipe_pasien_id) WHERE (deleted_at IS NULL);

-- Peran pasien. Kepemilikan (party, perusahaan, unit pendaftar, dan unit pemilik nomor) ditulis sekali saat
-- didaftarkan dan tidak pernah berubah; kelompok berbagi dihitung saat dibaca dari hierarchy, tidak disimpan di sini.
CREATE TABLE public.kes_pasien (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    org_unit_id uuid NOT NULL,
    nrm_unit_id uuid NOT NULL,
    nrm character varying(50) NOT NULL,
    creation_key character varying(160) NOT NULL,
    nrm_lama character varying(50),
    no_dokumen_rm character varying(50),
    golongan_darah character varying(40),
    status_keluarga character varying(40),
    instansi character varying(50),
    nama_ayah character varying(50),
    nama_ibu character varying(50),
    nik_ibu character varying(16),
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_pasien_pkey PRIMARY KEY (id),
    CONSTRAINT kes_pasien_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT kes_pasien_creation_key_unique UNIQUE (tenant_id, creation_key)
);
-- Nomor rekam medis unik per unit pemilik nomornya, sama dengan scope sequence-nya.
CREATE UNIQUE INDEX kes_pasien_nrm_unique
    ON public.kes_pasien USING btree (tenant_id, nrm_unit_id, nrm) WHERE (deleted_at IS NULL);
-- Satu orang satu catatan pasien per unit pemilik nomor.
CREATE UNIQUE INDEX kes_pasien_party_unique
    ON public.kes_pasien USING btree (tenant_id, party_id, nrm_unit_id) WHERE (deleted_at IS NULL);
CREATE INDEX kes_pasien_org_unit_index ON public.kes_pasien USING btree (tenant_id, org_unit_id);

-- Cara bayar pasien: tipe pasien, penjamin, nomor kartu, dan kelas. Satu pasien boleh punya beberapa, satu di
-- antaranya utama. Harga dan tarif bukan bagian tabel ini.
CREATE TABLE public.kes_pasien_cara_bayar (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pasien_id uuid NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    penjamin_id uuid,
    nomor_kartu character varying(50),
    kelas character varying(50),
    utama boolean DEFAULT false NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_pasien_cara_bayar_pkey PRIMARY KEY (id),
    CONSTRAINT kes_pasien_cara_bayar_pasien_foreign
        FOREIGN KEY (tenant_id, pasien_id) REFERENCES public.kes_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kes_pasien_cara_bayar_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.kes_tipe_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kes_pasien_cara_bayar_penjamin_foreign
        FOREIGN KEY (tenant_id, penjamin_id) REFERENCES public.kes_penjamin(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX kes_pasien_cara_bayar_utama_unique
    ON public.kes_pasien_cara_bayar USING btree (tenant_id, pasien_id) WHERE (utama AND deleted_at IS NULL);
CREATE INDEX kes_pasien_cara_bayar_pasien_index ON public.kes_pasien_cara_bayar USING btree (tenant_id, pasien_id);
CREATE INDEX kes_pasien_cara_bayar_nomor_kartu_index
    ON public.kes_pasien_cara_bayar USING btree (tenant_id, nomor_kartu) WHERE (deleted_at IS NULL);

-- Kepemilikan pasien tidak berubah, juga lewat SQL di luar module.
CREATE FUNCTION public.kes_pasien_pemilik_tetap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
        OR NEW.party_id IS DISTINCT FROM OLD.party_id
        OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
        OR NEW.org_unit_id IS DISTINCT FROM OLD.org_unit_id
        OR NEW.nrm_unit_id IS DISTINCT FROM OLD.nrm_unit_id
        OR NEW.nrm IS DISTINCT FROM OLD.nrm THEN
        RAISE EXCEPTION 'Kepemilikan dan nomor rekam medis pasien tidak dapat diubah.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pemilik_tetap BEFORE UPDATE ON public.kes_pasien
    FOR EACH ROW EXECUTE FUNCTION public.kes_pasien_pemilik_tetap();

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_tipe_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_penjamin
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_pasien_cara_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_tipe_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_penjamin
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_pasien_cara_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_tipe_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_penjamin
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_pasien
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_pasien_cara_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 3. Sequence nomor rekam medis untuk unit yang sudah ada -------------------------------------------------------------

-- Setelan sama dengan yang dibuat NumberSequences.createUnitDefaults untuk unit baru: bawaan skill
-- number-sequence-design ditimpa default_settings reference.
INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, operating_unit_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), u.tenant_id, r.id, 'operating_unit', u.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 999999,
       '[{"type":"number","length":6,"mask":"##.##.##"}]'::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.operating_units u
JOIN public.organizations o ON o.id = u.organization_id AND o.tenant_id = u.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'healthcare.medical-record-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = u.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'operating_unit' AND s.operating_unit_id = u.organization_id);
