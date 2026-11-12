-- Profesi tenaga kesehatan menjadi master per tenant (keputusan pemilik produk, 12 November 2026). Sebelumnya profesi
-- adalah katalog kode di practitioner.professions.ts, dan pemilih Dokter / Tenaga Medis serta Perawat / Bidan /
-- Nutrisionist / Sanitarian di pemeriksaan menulis mati profesi yang boleh dipilih. Sistem lama menyaring kedua pilihan
-- itu dari kategori vendor (option_doctor V-002, V-009, V-004; option_nurse V-003, V-004, V-008), dan V-004 ada di
-- keduanya. Di sini dua centang per profesi:
-- - isi_tenaga_medis: nakes berprofesi ini boleh dipilih sebagai Dokter / Tenaga Medis;
-- - isi_perawat: nakes berprofesi ini boleh dipilih sebagai Perawat / Bidan / Nutrisionist / Sanitarian.
-- Satu profesi boleh mencentang keduanya.
--
-- 1. Katalog izin: permission profesi masuk duty nakes yang sudah ada (lihat dan kelola tenaga kesehatan).
-- 2. sim_m_profesi.
-- 3. Data acuan: tujuh kode katalog lama per tenant, untuk tenant yang sudah memasang module, tenant yang punya baris
--    nakes, dan lewat trigger untuk tenant yang memasang sesudahnya.
-- 4. sim_m_nakes.profesi_id menggantikan kode profesi. Kolom profesi lama tetap ada dan masih ditulis kode profesinya,
--    karena kode rilis sebelumnya membacanya selama pemutakhiran; dibuang di rilis sesudahnya.
-- 5. Menu: Setup → Tenaga kesehatan → Profesi.

-- 1. Katalog izin --------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('healthcare.profession.form', 'healthcare', 'Layar profesi', 'form',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'healthcare', 'healthcare.profession.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('healthcare.profession.read', 'read', 'Lihat profesi'),
             ('healthcare.profession.create', 'create', 'Tambah profesi'),
             ('healthcare.profession.update', 'update', 'Ubah profesi'),
             ('healthcare.profession.delete', 'delete', 'Hapus profesi')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('healthcare.profession.view', 'healthcare', 'Melihat profesi', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'),
       ('healthcare.profession.maintain', 'healthcare', 'Memelihara profesi', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc'),
       ('healthcare.profession.retire', 'healthcare', 'Menghapus profesi', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('healthcare.profession.view', 'healthcare.profession.read'),
       ('healthcare.profession.maintain', 'healthcare.profession.read'),
       ('healthcare.profession.maintain', 'healthcare.profession.create'),
       ('healthcare.profession.maintain', 'healthcare.profession.update'),
       ('healthcare.profession.retire', 'healthcare.profession.read'),
       ('healthcare.profession.retire', 'healthcare.profession.delete')
ON CONFLICT DO NOTHING;

-- Duty nakes yang sudah dipegang role ikut membawa profesi, jadi tidak ada role yang perlu diubah.
INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('healthcare.practitioner.inquire', 'healthcare.profession.view'),
       ('healthcare.practitioner.manage', 'healthcare.profession.maintain'),
       ('healthcare.practitioner.manage', 'healthcare.profession.retire')
ON CONFLICT DO NOTHING;

-- 2. Profesi -------------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_profesi (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(40) NOT NULL,
    nama character varying(150) NOT NULL,
    isi_tenaga_medis boolean DEFAULT false NOT NULL,
    isi_perawat boolean DEFAULT false NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_profesi_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_profesi_tenant_id_id_unique UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX sim_m_profesi_kode_unique
    ON public.sim_m_profesi USING btree (tenant_id, lower((kode)::text)) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_profesi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_profesi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_profesi
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_m_profesi', 'Profesi', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_m_profesi');

-- 3. Data acuan ----------------------------------------------------------------------------------------------------

-- Kode katalog lama beserta labelnya. Hanya bila tenant belum punya baris profesi sama sekali, sehingga pemasangan
-- ulang tidak mengembalikan profesi yang sengaja dihapus tenant.
CREATE FUNCTION public.sim_isi_acuan_profesi(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.sim_m_profesi WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.sim_m_profesi (id, tenant_id, kode, nama, isi_tenaga_medis, isi_perawat, urutan, created_at,
                                          updated_at)
        SELECT gen_random_uuid(), p_tenant, p.kode, p.nama, p.tenaga_medis, p.perawat, p.urutan,
               now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
        FROM (VALUES ('dokter', 'Dokter', true, false, 1),
                     ('dokter_gigi', 'Dokter gigi', true, false, 2),
                     ('bidan', 'Bidan', false, true, 3),
                     ('perawat', 'Perawat', false, true, 4),
                     ('apoteker', 'Apoteker', false, false, 5),
                     ('analis', 'Analis', false, false, 6),
                     ('lainnya', 'Lainnya', false, false, 7)) AS p(kode, nama, tenaga_medis, perawat, urutan);
    END IF;
END;
$$;

CREATE FUNCTION public.sim_isi_acuan_profesi_saat_dipasang() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.sim_isi_acuan_profesi(NEW.tenant_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER sim_isi_acuan_profesi AFTER INSERT OR UPDATE OF status ON public.core_module_installations
    FOR EACH ROW WHEN (NEW.module_id = 'healthcare' AND NEW.status = 'installed')
    EXECUTE FUNCTION public.sim_isi_acuan_profesi_saat_dipasang();

SELECT public.sim_isi_acuan_profesi(t.tenant_id)
FROM (SELECT tenant_id FROM public.core_module_installations WHERE module_id = 'healthcare' AND status = 'installed'
      UNION
      SELECT tenant_id FROM public.sim_m_nakes) t;

-- Kode nakes yang tidak ada di katalog lama tidak mungkin ditulis kode sebelumnya, tetapi bila ada (SQL tangan),
-- ia menjadi profesi tenant itu sendiri supaya tidak ada nakes yang kehilangan profesinya.
INSERT INTO public.sim_m_profesi (id, tenant_id, kode, nama, urutan, created_at, updated_at)
SELECT gen_random_uuid(), n.tenant_id, n.profesi, n.profesi, 99, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (SELECT DISTINCT tenant_id, profesi FROM public.sim_m_nakes) n
WHERE NOT EXISTS (SELECT 1 FROM public.sim_m_profesi p
                  WHERE p.tenant_id = n.tenant_id AND lower(p.kode) = lower(n.profesi) AND p.deleted_at IS NULL);

-- 4. Profesi nakes -------------------------------------------------------------------------------------------------

ALTER TABLE public.sim_m_nakes ADD COLUMN profesi_id uuid;
UPDATE public.sim_m_nakes n
SET profesi_id = p.id
FROM public.sim_m_profesi p
WHERE p.tenant_id = n.tenant_id AND lower(p.kode) = lower(n.profesi) AND p.deleted_at IS NULL;
ALTER TABLE public.sim_m_nakes ALTER COLUMN profesi_id SET NOT NULL;
ALTER TABLE public.sim_m_nakes ADD CONSTRAINT sim_m_nakes_profesi_foreign
    FOREIGN KEY (tenant_id, profesi_id) REFERENCES public.sim_m_profesi(tenant_id, id) ON DELETE RESTRICT;
CREATE INDEX sim_m_nakes_profesi_index ON public.sim_m_nakes USING btree (tenant_id, profesi_id)
    WHERE (deleted_at IS NULL);

-- 5. Menu ----------------------------------------------------------------------------------------------------------

UPDATE public.apps a
SET navigation = (
        SELECT jsonb_agg(
                   CASE WHEN g->>'id' = 'setup'
                        THEN jsonb_set(g, '{items}', coalesce(g->'items', '[]'::jsonb) || coalesce((
                            SELECT jsonb_agg(item)
                            FROM jsonb_array_elements('[
                                {"id":"professions","label":"Profesi","href":"/healthcare/practitioner/professions","section":"Tenaga kesehatan","permission":"healthcare.profession.read"}]'::jsonb) AS added(item)
                            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'items', '[]'::jsonb)) existing
                                              WHERE existing->>'id' = added.item->>'id')), '[]'::jsonb))
                        ELSE g END
                   ORDER BY ordinal)
        FROM jsonb_array_elements(a.navigation) WITH ORDINALITY AS groups(g, ordinal)),
    updated_at = now() AT TIME ZONE 'utc'
WHERE a.id = 'healthcare';
