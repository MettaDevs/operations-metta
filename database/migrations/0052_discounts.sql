-- Diskon kasir (src/foundation/billing/discount/), irisan 8 spesifikasi kasir: padanan mDiscount dan SIMtrKasirDiscount.
--
-- 1. discount: master diskon per legal entity, seperti jenis_bayar. jenis memilih dasar hitungnya, sama dengan flag
--    mDiscount: `total` (DiskonTotal, dasar = Nilai tagihan), `komponen` (DiskonKomponen, dasar = Qty x nilai komponen
--    biaya itu pada jasa dan dokter yang dipilih), atau `kelompok_jasa` (DiskonGroupJasa, tanpa dasar: nilainya diketik
--    kasir). Kelompok jasa milik layanan kesehatan; Core menyimpan id dan namanya dari baris biaya yang dikirim lewat
--    event, karena Core tidak membaca tabel module.
-- 2. kasir_discount: baris tab Diskon pada pembayaran (SIMtrKasirDiscount): diskon, dokter, jasa, persen, nilai, dan
--    keterangan. kasir.nilai_discount adalah jumlahnya. Sistem lama selalu menyimpan NilaiDiscount 0 karena layar
--    mengirim elemen yang tidak ada; di sini jumlahnya disimpan benar.
-- 3. Katalog izin layar Diskon, di bawah duty setelan kasir yang sudah ada.

CREATE TABLE public.discount (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kode character varying(20) NOT NULL,
    nama character varying(100) NOT NULL,
    jenis character varying(20) NOT NULL,
    komponen_biaya_id uuid,
    kelompok_jasa_id uuid,
    kelompok_jasa_nama character varying(100),
    aktif boolean DEFAULT true NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT discount_pkey PRIMARY KEY (id),
    CONSTRAINT discount_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT discount_jenis_check CHECK (jenis IN ('total', 'komponen', 'kelompok_jasa')),
    CONSTRAINT discount_komponen_check CHECK ((jenis = 'komponen') = (komponen_biaya_id IS NOT NULL)),
    CONSTRAINT discount_kelompok_jasa_check
        CHECK ((jenis = 'kelompok_jasa') = (kelompok_jasa_id IS NOT NULL AND kelompok_jasa_nama IS NOT NULL)),
    CONSTRAINT discount_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT discount_komponen_biaya_foreign
        FOREIGN KEY (tenant_id, komponen_biaya_id) REFERENCES public.komponen_biaya(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX discount_kode_unique
    ON public.discount USING btree (tenant_id, legal_entity_id, kode) WHERE (deleted_at IS NULL);

CREATE TABLE public.kasir_discount (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kasir_id uuid NOT NULL,
    discount_id uuid NOT NULL,
    dokter_id uuid,
    dokter_nama character varying(255),
    jenis_biaya_id uuid,
    jenis_biaya_nama character varying(255),
    persen numeric(9,4) DEFAULT 0 NOT NULL,
    nilai numeric(19,4) NOT NULL,
    keterangan character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kasir_discount_pkey PRIMARY KEY (id),
    CONSTRAINT kasir_discount_nilai_check CHECK (nilai > 0),
    CONSTRAINT kasir_discount_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kasir_discount_discount_foreign
        FOREIGN KEY (tenant_id, discount_id) REFERENCES public.discount(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX kasir_discount_kasir_index ON public.kasir_discount USING btree (tenant_id, kasir_id);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.discount
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.discount
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.discount
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kasir_discount
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kasir_discount
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'discount', 'Diskon', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'discount');

-- 3. Katalog izin ----------------------------------------------------------------------------------------------------

INSERT INTO public.app_entry_points (code, app_id, name, type, created_at, updated_at)
VALUES ('core.discount.form', 'core', 'Layar diskon', 'form', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
SELECT p.code, 'core', 'core.discount.form', p.level, p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.discount.read', 'read', 'Lihat diskon'),
             ('core.discount.update', 'update', 'Ubah diskon')) AS p(code, level, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
SELECT p.code, 'core', p.name, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('core.discount.view', 'Melihat diskon'),
             ('core.discount.maintain', 'Memelihara diskon')) AS p(code, name)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.discount.view', 'core.discount.read'),
       ('core.discount.maintain', 'core.discount.read'),
       ('core.discount.maintain', 'core.discount.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.billing-setup.inquire', 'core.discount.view'),
       ('core.billing-setup.manage', 'core.discount.maintain')
ON CONFLICT DO NOTHING;
