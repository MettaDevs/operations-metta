-- Komponen biaya (src/foundation/pricing/): bagian yang menyusun satu tarif, padanan SIMmKomponenBiaya sistem lama.
-- Tarif tindakan sama dengan jumlah nilai komponennya (SIMdListHargaDetail). Puskesmas Kuta 1 membagi 1.175 tarif
-- menjadi jasa sarana dan jasa pelayanan; Penta memakai satu komponen (DT76 Pelayanan) di hampir semua tarif; Seroja
-- memakai satu komponen per tarif sebagai kategori pendapatan. Business Central dan F&O tidak membagi satu harga ke
-- komponen, jadi tidak ada padanannya di sana. Kolom akun dan tujuan posting sistem lama (KelompokAkun, PostinganKe,
-- akun HPP) menyusul bersama posting kasir ke finance.
--
-- 1. Tabel komponen_biaya. Kode pendek diketik pengguna, urutan menentukan urutan isian komponen di kartu tarif.
-- 2. Trigger versi, aktor, dan change log.
-- 3. Satu komponen bawaan per tenant, supaya tarif bisa diisi tanpa setup tambahan: untuk tenant yang sudah ada lewat
--    migration ini, untuk tenant baru lewat trigger saat tenant lahir. Tenant yang sudah punya komponen, termasuk yang
--    sudah dihapus, tidak diisi lagi. Kode dan namanya mengikuti komponen yang dipakai hampir semua tarif Penta dan
--    separuh tarif Kuta (DT76 Pelayanan); tenant bebas mengganti nama atau menambah komponen lain.
-- 4. Katalog izin, di duty setelan harga yang lahir di 0032.

-- 1. Komponen biaya ------------------------------------------------------------------------------------------------

CREATE TABLE public.komponen_biaya (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    urutan smallint DEFAULT 0 NOT NULL,
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT komponen_biaya_pkey PRIMARY KEY (id),
    CONSTRAINT komponen_biaya_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT komponen_biaya_urutan_check CHECK (urutan >= 0)
);
CREATE UNIQUE INDEX komponen_biaya_kode_unique
    ON public.komponen_biaya USING btree (tenant_id, kode) WHERE (deleted_at IS NULL);

-- 2. Trigger versi, aktor, dan change log ----------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.komponen_biaya
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.komponen_biaya
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.komponen_biaya
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'komponen_biaya', 'Komponen biaya', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'komponen_biaya');

-- 3. Komponen bawaan per tenant --------------------------------------------------------------------------------------

CREATE FUNCTION public.komponen_biaya_isi_acuan(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.komponen_biaya WHERE tenant_id = p_tenant) THEN
        INSERT INTO public.komponen_biaya (id, tenant_id, kode, nama, urutan, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant, 'PELAYANAN', 'Pelayanan', 1, now() AT TIME ZONE 'utc',
                now() AT TIME ZONE 'utc');
    END IF;
END;
$$;

CREATE FUNCTION public.komponen_biaya_isi_acuan_saat_tenant_lahir() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.komponen_biaya_isi_acuan(NEW.id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER komponen_biaya_isi_acuan AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION public.komponen_biaya_isi_acuan_saat_tenant_lahir();

SELECT public.komponen_biaya_isi_acuan(t.id) FROM public.tenants t;

-- 4. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.charge-component.form', 'core', 'Layar komponen biaya', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.charge-component.form', p.level, p.name, now() AT TIME ZONE 'utc',
       now() AT TIME ZONE 'utc'
FROM (VALUES ('core.charge-component.read', 'read', 'Lihat komponen biaya'),
             ('core.charge-component.update', 'update', 'Ubah komponen biaya')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.charge-component.view', 'Melihat komponen biaya'),
             ('core.charge-component.maintain', 'Memelihara komponen biaya')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.charge-component.view', 'core.charge-component.read'),
       ('core.charge-component.maintain', 'core.charge-component.read'),
       ('core.charge-component.maintain', 'core.charge-component.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.pricing-setup.inquire', 'core.charge-component.view'),
       ('core.pricing-setup.manage', 'core.charge-component.maintain')
ON CONFLICT DO NOTHING;
