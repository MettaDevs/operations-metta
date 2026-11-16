-- Clerk boleh dimatikan per legal entity, bawaannya wajib. Keputusan pemilik produk 16 November 2026, sesuai keputusan 4
-- spesifikasi kasir: Seroja tidak memakai clerk (SIMtrClerk 0 baris), Kuta 1 memakainya. Sistem lama tidak punya
-- setelan ini; cekPasienStatus selalu menolak pembayaran tanpa Start Clerk.
--
-- 1. parameter_kasir: setelan kasir per legal entity, satu baris per legal entity. wajib_clerk bawaannya nyala. Bila
--    mati, pembayaran, pembayaran hutang, dan nota kredit tetap masuk clerk kasir yang sedang berjalan bila ada, dan
--    tanpa clerk bila tidak ada. Pembayaran tanpa clerk dibatalkan kapan saja, seperti General_payment::cancel lama
--    yang tidak memeriksa clerk, dan tidak dihitung di Clerk End mana pun.
-- 2. Pembayaran yang diterima kasir, pembayaran hutang, dan nota kredit boleh tanpa clerk. Sejak 0051 hanya bayar
--    otomatis yang boleh tanpa clerk.
-- 3. Trigger versi, aktor, dan change log.
-- 4. Data acuan per legal entity: baris setelan untuk legal entity yang sudah ada dan lewat trigger untuk legal entity
--    sesudahnya, pola gd_isi_acuan (0024).
-- 5. Katalog izin layar Setelan kasir, di bawah duty setelan kasir yang sudah ada (0037), jadi pemegangnya tidak
--    perlu diberi apa pun.

-- 1. Setelan kasir --------------------------------------------------------------------------------------------------

CREATE TABLE public.parameter_kasir (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    wajib_clerk boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT parameter_kasir_pkey PRIMARY KEY (id),
    CONSTRAINT parameter_kasir_legal_entity_unique UNIQUE (tenant_id, legal_entity_id),
    CONSTRAINT parameter_kasir_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);

-- 2. Pembayaran, pembayaran hutang, dan nota kredit tanpa clerk -----------------------------------------------------

-- Pembayaran yang diterima kasir tetap wajib membawa kasirnya; hanya bayar otomatis yang tanpa kasir.
ALTER TABLE public.kasir
    DROP CONSTRAINT kasir_clerk_check,
    ADD CONSTRAINT kasir_user_check CHECK (otomatis OR user_id IS NOT NULL);
ALTER TABLE public.pembayaran_outstanding ALTER COLUMN clerk_id DROP NOT NULL;
ALTER TABLE public.nota_kredit ALTER COLUMN clerk_id DROP NOT NULL;

-- 3. Trigger versi, aktor, dan change log ---------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.parameter_kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.parameter_kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.parameter_kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'parameter_kasir', 'Setelan kasir', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'parameter_kasir');

-- 4. Data acuan per legal entity ------------------------------------------------------------------------------------

CREATE FUNCTION public.kasir_isi_acuan(p_tenant uuid, p_legal_entity uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO public.parameter_kasir (id, tenant_id, legal_entity_id, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant, p_legal_entity, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
    ON CONFLICT (tenant_id, legal_entity_id) DO NOTHING;
END;
$$;

CREATE FUNCTION public.kasir_isi_acuan_saat_legal_entity_lahir() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM public.kasir_isi_acuan(NEW.tenant_id, NEW.organization_id);
    RETURN NULL;
END;
$$;
CREATE TRIGGER kasir_isi_acuan AFTER INSERT ON public.legal_entities
    FOR EACH ROW EXECUTE FUNCTION public.kasir_isi_acuan_saat_legal_entity_lahir();

SELECT public.kasir_isi_acuan(l.tenant_id, l.organization_id)
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id;

-- 5. Katalog izin ---------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.billing-setup.form', 'core', 'Layar setelan kasir', 'form', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.billing-setup.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.billing-setup.read', 'read', 'Lihat setelan kasir'),
             ('core.billing-setup.update', 'update', 'Ubah setelan kasir')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.billing-setup.view', 'Melihat setelan kasir'),
             ('core.billing-setup.maintain', 'Memelihara setelan kasir')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.billing-setup.view', 'core.billing-setup.read'),
       ('core.billing-setup.maintain', 'core.billing-setup.read'),
       ('core.billing-setup.maintain', 'core.billing-setup.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.billing-setup.inquire', 'core.billing-setup.view'),
       ('core.billing-setup.manage', 'core.billing-setup.maintain')
ON CONFLICT DO NOTHING;
