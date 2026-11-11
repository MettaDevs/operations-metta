-- Master tenaga kesehatan (nakes): dokter, dokter gigi, bidan, perawat, dan lainnya. Pendaftaran kunjungan kelak
-- memilih nakes dari yang punya jadwal praktik; master ini lebih dulu (keputusan pemilik produk, 11 November 2026).
--
-- Nakes mengikuti pola pasien: satu orang adalah satu party Core, dan nakes adalah perannya (`healthcare.practitioner`).
-- Nama, NIK, jenis kelamin, dan nomor HP milik party; tabel di sini hanya memegang data khusus nakes.
--
-- 1. Katalog: peran party, entry point, permission, privilege, duty. Role pemilik tenant yang sudah memasang module
--    ini mendapat duty kelola; tenant yang memasang sesudahnya mendapatkannya dari installModule.
-- 2. Tabel sim_m_nakes.
-- 3. Menu: satu entri di rail Setup, bagian "Tenaga kesehatan". Hanya entri ini yang ditambahkan, supaya menu yang
--    ditulis migration lain tidak tertimpa.

-- 1. Katalog -------------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.practitioner.form', 'healthcare', 'Layar tenaga kesehatan', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('healthcare.practitioner.read', 'healthcare', 'healthcare.practitioner.form', 'read',
        'Lihat tenaga kesehatan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practitioner.update', 'healthcare', 'healthcare.practitioner.form', 'update',
        'Ubah tenaga kesehatan', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.practitioner.view', 'healthcare', 'Melihat tenaga kesehatan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practitioner.maintain', 'healthcare', 'Memelihara tenaga kesehatan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.practitioner.view', 'healthcare.practitioner.read'),
       ('healthcare.practitioner.maintain', 'healthcare.practitioner.read'),
       ('healthcare.practitioner.maintain', 'healthcare.practitioner.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.practitioner.inquire', 'healthcare', 'Lihat tenaga kesehatan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.practitioner.manage', 'healthcare', 'Kelola tenaga kesehatan',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.practitioner.inquire', 'healthcare.practitioner.view'),
       ('healthcare.practitioner.manage', 'healthcare.practitioner.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'healthcare.practitioner.manage'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.core_module_installations i
              WHERE i.tenant_id = r.tenant_id AND i.module_id = 'healthcare' AND i.status = 'installed')
ON CONFLICT DO NOTHING;

INSERT INTO public.party_roles (code, name, owning_app_id, view_permission_code, sort_order, created_at, updated_at)
VALUES ('healthcare.practitioner', 'Tenaga kesehatan', 'healthcare', 'healthcare.practitioner.read', 80,
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

-- 2. Tabel ---------------------------------------------------------------------------------------------------------

-- Profesi adalah kode dari katalog di kode module (practitioner.professions.ts). Masa berlaku SIP hanya dicatat; tidak
-- ada aturan yang menolak nakes dengan SIP habis. Akun login (user_id) opsional.
CREATE TABLE public.sim_m_nakes (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    profesi character varying(40) NOT NULL,
    spesialisasi character varying(200),
    no_sip character varying(100),
    sip_berlaku_sampai date,
    kode_dokter_bpjs character varying(50),
    user_id uuid,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_nakes_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_nakes_tenant_id_id_unique UNIQUE (tenant_id, id)
);
-- Satu orang satu catatan nakes per tenant.
CREATE UNIQUE INDEX sim_m_nakes_party_unique
    ON public.sim_m_nakes USING btree (tenant_id, party_id) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_nakes
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_nakes
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_nakes
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- 3. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g.item ->> 'id' = 'setup'
                        THEN jsonb_set(g.item, '{items}', COALESCE(g.item -> 'items', '[]'::jsonb) || '[
                            {"id":"practitioners","label":"Nakes","href":"/healthcare/practitioner/practitioners","section":"Tenaga kesehatan","permission":"healthcare.practitioner.read"}]'::jsonb)
                        ELSE g.item END
                   ORDER BY g.position)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS g(item, position)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare'
  AND NOT EXISTS (SELECT 1
                  FROM jsonb_array_elements(a.navigation) AS g(item),
                       jsonb_array_elements(COALESCE(g.item -> 'items', '[]'::jsonb)) AS i(item)
                  WHERE i.item ->> 'id' = 'practitioners');
