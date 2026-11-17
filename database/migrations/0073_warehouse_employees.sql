-- Petugas lokasi, pola Warehouse Employee Business Central (tabel 7301): pengguna ditugaskan ke lokasi stok, dengan satu
-- lokasi bawaan per pengguna. Di sistem lama farmasi pusling punya kode dan section sendiri yang ditulis mati; di sini
-- pusling hanya lokasi, dan yang membatasi siapa yang bekerja di sana adalah data ini.
--
-- 1. gd_m_lokasi.khusus_petugas: lokasi yang hanya boleh dilihat dan dikerjakan petugasnya. Bawaannya false, jadi tenant
--    yang tidak menyetel apa pun tetap seperti sebelumnya: setiap pemegang izin dokumen bekerja di semua lokasi. BC
--    memeriksa Warehouse Employee hanya pada dokumen gudang; di sini pemeriksaannya dinyalakan per lokasi, supaya
--    klinik bisa membatasi pusling tanpa harus mendaftarkan petugas di gudang dan farmasi.
-- 2. gd_m_petugas_lokasi: satu baris per pengguna per lokasi. Lokasi milik legal entity, jadi lokasi bawaan juga satu per
--    pengguna per legal entity. Penghapusan lunak, sehingga kedua indeks unik parsial.
-- 3. Penugasan petugas menentukan siapa yang melihat dokumen lokasi, sama dengan hak akses, jadi tabelnya selalu
--    dicatat di log perubahan (daftar coreerp_change_log_always_logged dari 0066 ditambah satu tabel).
--
-- Tidak ada izin baru. Petugas lokasi dikelola pemegang izin lokasi stok, seperti permission set gudang BC yang
-- memegang Location dan Warehouse Employee bersama.

-- 1. Lokasi khusus petugas ------------------------------------------------------------------------------------------

ALTER TABLE public.gd_m_lokasi ADD COLUMN khusus_petugas boolean DEFAULT false NOT NULL;

-- 2. Petugas lokasi -------------------------------------------------------------------------------------------------

CREATE TABLE public.gd_m_petugas_lokasi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    lokasi_id uuid NOT NULL,
    user_id uuid NOT NULL,
    bawaan boolean DEFAULT false NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT gd_m_petugas_lokasi_pkey PRIMARY KEY (id),
    CONSTRAINT gd_m_petugas_lokasi_lokasi_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, lokasi_id)
        REFERENCES public.gd_m_lokasi(tenant_id, legal_entity_id, id) ON DELETE RESTRICT,
    CONSTRAINT gd_m_petugas_lokasi_user_foreign
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX gd_m_petugas_lokasi_unique
    ON public.gd_m_petugas_lokasi USING btree (tenant_id, lokasi_id, user_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX gd_m_petugas_lokasi_bawaan_unique
    ON public.gd_m_petugas_lokasi USING btree (tenant_id, legal_entity_id, user_id)
    WHERE (bawaan AND deleted_at IS NULL);
CREATE INDEX gd_m_petugas_lokasi_user_index
    ON public.gd_m_petugas_lokasi USING btree (tenant_id, user_id) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.gd_m_petugas_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.gd_m_petugas_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.gd_m_petugas_lokasi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 3. Selalu dicatat -------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.coreerp_change_log_always_logged(table_name text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    RETURN table_name IN (
        'change_log_setup_tables', 'change_log_setup_fields', 'roles', 'security_role_children',
        'security_role_duties', 'security_duties', 'security_duty_privileges', 'security_privileges',
        'security_privilege_permissions', 'tenant_memberships', 'role_assignments',
        'role_assignment_data_policy_scopes', 'automatic_role_assignment_rules', 'sod_rules',
        'tenant_app_entitlements', 'data_sharing_policies', 'data_sharing_policy_companies',
        'retention_policy_setups', 'gd_m_petugas_lokasi');

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'gd_m_petugas_lokasi', 'Petugas lokasi', 'none', 'none', 'none',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'gd_m_petugas_lokasi');
