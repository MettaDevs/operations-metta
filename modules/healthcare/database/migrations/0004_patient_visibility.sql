-- Visibilitas pasien mengikuti pola F&O, tipe dan penjamin bawaan, dan sequence NRM per legal entity. Keputusan
-- pemilik produk, 10 November 2026.
--
-- 1. Tipe pasien dan penjamin bawaan: kolom bawaan dengan indeks unik parsial, paling banyak satu tipe bawaan per
--    tenant dan satu penjamin bawaan per tipe pasien.
-- 2. NRM bawaan per legal entity. Unit yang ditempatkan di kelompok berbagi pasien tetap memakai sequence unit kepala
--    kelompoknya; unit lain memakai sequence legal entity. Pasien bernomor legal entity menyimpan nrm_unit_id null.
--    Melonggarkan NOT NULL dan mengganti indeks unik dengan indeks yang juga memuat legal entity hanya melonggarkan.
--    Kode rilis sebelumnya tidak dapat menampilkan pasien bernomor legal entity (ia menggabungkan nrm_unit_id ke
--    organizations); belum ada pelanggan, jadi itu diterima.
-- 3. Kebijakan berbagi pasien antar legal entity (pola cross-company data sharing F&O) beserta katalog izin dan
--    menunya. Satu legal entity hanya ikut satu kebijakan aktif; service yang menjaganya di bawah kunci per tenant.
-- 4. Reference NRM boleh berscope legal entity dan meminta sequence bawaan per legal entity (Core 0014).
-- 5. Sequence NRM hanya untuk tenant yang berhak memakai module ini: sequence yang terlanjur dibuat 0001 untuk tenant
--    tanpa entitlement dihentikan (status stopped), tidak dihapus. Legal entity tenant yang berhak mendapat sequence
--    NRM-nya.

-- 1. Tipe dan penjamin bawaan ---------------------------------------------------------------------------------------

ALTER TABLE public.kes_tipe_pasien ADD COLUMN bawaan boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX kes_tipe_pasien_bawaan_unique
    ON public.kes_tipe_pasien USING btree (tenant_id) WHERE (bawaan AND deleted_at IS NULL);

ALTER TABLE public.kes_penjamin ADD COLUMN bawaan boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX kes_penjamin_bawaan_unique
    ON public.kes_penjamin USING btree (tenant_id, tipe_pasien_id) WHERE (bawaan AND deleted_at IS NULL);

-- 2. NRM per legal entity -------------------------------------------------------------------------------------------

ALTER TABLE public.kes_pasien ALTER COLUMN nrm_unit_id DROP NOT NULL;

-- NRM unik per pemilik nomornya: unit kepala kelompok (kes_pasien_nrm_unique dari 0001; baris bernrm_unit_id null tidak
-- dijaganya), atau legal entity.
CREATE UNIQUE INDEX kes_pasien_nrm_legal_entity_unique
    ON public.kes_pasien USING btree (tenant_id, legal_entity_id, nrm) WHERE (deleted_at IS NULL AND nrm_unit_id IS NULL);

-- Satu orang satu catatan pasien per pemilik nomor di setiap legal entity. Indeks lama tanpa legal entity menolak orang
-- yang sama didaftarkan unit yang sama untuk legal entity lain.
DROP INDEX public.kes_pasien_party_unique;
CREATE UNIQUE INDEX kes_pasien_party_unit_unique
    ON public.kes_pasien USING btree (tenant_id, party_id, legal_entity_id, nrm_unit_id)
    WHERE (deleted_at IS NULL AND nrm_unit_id IS NOT NULL);
CREATE UNIQUE INDEX kes_pasien_party_legal_entity_unique
    ON public.kes_pasien USING btree (tenant_id, party_id, legal_entity_id)
    WHERE (deleted_at IS NULL AND nrm_unit_id IS NULL);
CREATE INDEX kes_pasien_legal_entity_index ON public.kes_pasien USING btree (tenant_id, legal_entity_id);

-- 3. Kebijakan berbagi pasien antar legal entity ---------------------------------------------------------------------

-- Kebijakan berlaku bila aktif dan tanggal berlaku_mulai sudah lewat. Perubahan tercatat lewat log_change, dan legal
-- entity yang dilepas diarsipkan (deleted_at), tidak dihapus.
CREATE TABLE public.kes_kebijakan_berbagi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nama character varying(100) NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    berlaku_mulai date NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_kebijakan_berbagi_pkey PRIMARY KEY (id),
    CONSTRAINT kes_kebijakan_berbagi_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX kes_kebijakan_berbagi_nama_unique
    ON public.kes_kebijakan_berbagi USING btree (tenant_id, lower((nama)::text)) WHERE (deleted_at IS NULL);

-- Legal entity yang ikut satu kebijakan.
CREATE TABLE public.kes_kebijakan_berbagi_perusahaan (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kebijakan_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_kebijakan_berbagi_perusahaan_pkey PRIMARY KEY (id),
    CONSTRAINT kes_kebijakan_berbagi_perusahaan_kebijakan_foreign
        FOREIGN KEY (tenant_id, kebijakan_id) REFERENCES public.kes_kebijakan_berbagi(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX kes_kebijakan_berbagi_perusahaan_unique
    ON public.kes_kebijakan_berbagi_perusahaan USING btree (tenant_id, kebijakan_id, legal_entity_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX kes_kebijakan_berbagi_perusahaan_legal_entity_index
    ON public.kes_kebijakan_berbagi_perusahaan USING btree (tenant_id, legal_entity_id);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_kebijakan_berbagi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_kebijakan_berbagi_perusahaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_kebijakan_berbagi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_kebijakan_berbagi_perusahaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_kebijakan_berbagi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_kebijakan_berbagi_perusahaan
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- Change log mencatat setiap perubahan kebijakan untuk semua tenant, karena kebijakan ini menentukan siapa melihat data
-- pasien. Tenant tidak perlu menyalakannya sendiri di setup change log.
INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('kes_kebijakan_berbagi', 'Kebijakan berbagi pasien'),
             ('kes_kebijakan_berbagi_perusahaan', 'Perusahaan dalam kebijakan berbagi pasien')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);

-- Katalog izin layar kebijakan berbagi. Master tenant, jadi tidak dilindungi kebijakan data per unit.
INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.patient-sharing.form', 'healthcare', 'Layar kebijakan berbagi pasien', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.patient-sharing.read', 'healthcare', 'healthcare.patient-sharing.form', 'read',
        'Lihat kebijakan berbagi pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-sharing.update', 'healthcare', 'healthcare.patient-sharing.form', 'update',
        'Ubah kebijakan berbagi pasien', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.patient-sharing.view', 'healthcare', 'Melihat kebijakan berbagi pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-sharing.maintain', 'healthcare', 'Memelihara kebijakan berbagi pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.patient-sharing.view', 'healthcare.patient-sharing.read'),
       ('healthcare.patient-sharing.maintain', 'healthcare.patient-sharing.read'),
       ('healthcare.patient-sharing.maintain', 'healthcare.patient-sharing.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.patient-sharing.inquire', 'healthcare', 'Lihat kebijakan berbagi pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.patient-sharing.manage', 'healthcare', 'Kelola kebijakan berbagi pasien',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.patient-sharing.inquire', 'healthcare.patient-sharing.view'),
       ('healthcare.patient-sharing.manage', 'healthcare.patient-sharing.maintain')
ON CONFLICT DO NOTHING;

UPDATE public.apps
SET navigation = '[{"id":"healthcare-patients","label":"Pasien","items":[
        {"id":"patients","label":"Pasien","href":"/healthcare/patients","permission":"healthcare.patient.read"},
        {"id":"patient-types","label":"Tipe pasien","href":"/healthcare/patient-types","permission":"healthcare.patient-type.read"},
        {"id":"guarantors","label":"Penjamin","href":"/healthcare/guarantors","permission":"healthcare.guarantor.read"},
        {"id":"sharing-policies","label":"Berbagi pasien antar perusahaan","href":"/healthcare/sharing-policies","permission":"healthcare.patient-sharing.read"}]}]'::jsonb,
    updated_at = now() AT TIME ZONE 'utc'
WHERE id = 'healthcare';

-- 4. Reference NRM ----------------------------------------------------------------------------------------------------

UPDATE public.app_number_sequence_references
SET allowed_scopes = '["legal_entity","operating_unit"]',
    default_per_legal_entity = true,
    updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'healthcare.medical-record-number';

-- 5. Sequence NRM hanya untuk tenant yang berhak ----------------------------------------------------------------------

UPDATE public.tenant_number_sequences s
SET status = 'stopped', updated_at = now() AT TIME ZONE 'utc'
FROM public.app_number_sequence_references r
WHERE r.id = s.reference_id AND r.code = 'healthcare.medical-record-number' AND s.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
                  WHERE e.tenant_id = s.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                    AND (e.ends_at IS NULL OR e.ends_at > current_timestamp));

-- Setelan sama dengan yang dibuat NumberSequences.createLegalEntityDefaults.
INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, legal_entity_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), l.tenant_id, r.id, 'legal_entity', l.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 999999,
       '[{"type":"number","length":6,"mask":"##.##.##"}]'::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'healthcare.medical-record-number'
  AND EXISTS (SELECT 1 FROM public.tenant_app_entitlements e
              WHERE e.tenant_id = l.tenant_id AND e.app_id = r.app_id AND e.status = 'active'
                AND (e.ends_at IS NULL OR e.ends_at > current_timestamp))
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);
