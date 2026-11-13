-- Pembayaran kasir (src/foundation/billing/payment/), padanan SIMtrKasir, SIMtrKasirDetail, dan
-- SIMtrKasirDetailGroupJasa. Seperti sistem lama, satu Simpan adalah tagihan sekaligus pembayaran kunjungan.
--
-- 1. kasir: nomor bukti dari number sequence (sistem lama memakai MAX + 1 tanpa kunci), kunjungan, clerk kasir yang
--    menerimanya (sistem lama hanya mencocokkan user dan jam), Nilai, NilaiOrig, diskon, biaya tambahan kartu, uang
--    diterima, kembalian, dan status `diposting` atau `batal`. Paling banyak satu pembayaran diposting per kunjungan.
-- 2. kasir_detail: satu baris per jenis bayar yang dipakai dengan nilai bukan nol (sistem lama menulis setiap jenis
--    bayar aktif, termasuk yang nol), dengan merchan, referensi, biaya tambahan, dan pihaknya.
-- 3. kasir_detail_group_jasa: Nilai dan NilaiOrig per kelompok jasa.
-- 4. kunjungan_kasir_detail.kasir_id: pembayaran yang menagih baris itu.
-- 5. Reference nomor bukti per legal entity, dibuat untuk legal entity yang sudah ada dan otomatis untuk yang baru.
-- 6. Mata uang asing. Ini perilaku baru, bukan port 1:1: SIMtrKasir dan SIMtrKasirDetail tidak punya kolom mata uang atau
--    kurs. Polanya tender type Currency di Commerce F&O dan dokumen BC yang menyimpan jumlah valuta dan jumlah lokal:
--    - jenis_bayar.mata_uang: jenis bayar yang hanya menerima satu mata uang asing, misalnya tunai valuta. Kosong berarti
--      mata uang lokal. Tunai aktif kini satu per mata uang, dan penampung sisa selalu mata uang lokal;
--    - kasir_detail.mata_uang, nilai_valuta, kurs, dan kurs_bawaan: jumlah dalam mata uang jenis bayarnya, kurs yang
--      dipakai, dan kurs dari Sys Admin › Kurs untuk tanggal pembayaran. nilai tetap jumlah dalam mata uang lokal, yaitu
--      nilai_valuta x kurs dibulatkan ke presisi jumlah mata uang lokal. Kurs yang berbeda dari kurs_bawaan hanya bisa
--      diisi pemegang izin ubah kurs, jadi perubahannya tercatat di baris itu bersama pembuatnya. Tagihan dan kembalian
--      selalu mata uang lokal. Laba/rugi selisih kurs menunggu finance; semua angkanya tersimpan di sini.
-- 7. Katalog izin ubah kurs pembayaran. Role pemilik tenant yang sudah ada mendapatnya.

-- 1. Kasir ----------------------------------------------------------------------------------------------------------

CREATE TABLE public.kasir (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    no_bukti character varying(50) NOT NULL,
    tanggal date NOT NULL,
    jam timestamp(0) without time zone NOT NULL,
    sumber_module character varying(80) NOT NULL,
    kunjungan_id uuid NOT NULL,
    clerk_id uuid NOT NULL,
    user_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    nilai_orig numeric(19,4) NOT NULL,
    nilai_discount numeric(19,4) DEFAULT 0 NOT NULL,
    biaya_tambahan numeric(19,4) DEFAULT 0 NOT NULL,
    jumlah_bayar numeric(19,4) DEFAULT 0 NOT NULL,
    nilai_kembalian numeric(19,4) DEFAULT 0 NOT NULL,
    status character varying(10) DEFAULT 'diposting' NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kasir_pkey PRIMARY KEY (id),
    CONSTRAINT kasir_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT kasir_no_bukti_unique UNIQUE (tenant_id, no_bukti),
    CONSTRAINT kasir_status_check CHECK (status IN ('diposting', 'batal')),
    CONSTRAINT kasir_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kasir_clerk_foreign
        FOREIGN KEY (tenant_id, clerk_id) REFERENCES public.clerk(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX kasir_kunjungan_diposting_unique
    ON public.kasir USING btree (tenant_id, sumber_module, kunjungan_id) WHERE (status = 'diposting');
CREATE INDEX kasir_clerk_index ON public.kasir USING btree (tenant_id, clerk_id);

-- 2. Kasir detail ---------------------------------------------------------------------------------------------------

CREATE TABLE public.kasir_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kasir_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    merchan_id uuid,
    referensi character varying(100),
    biaya_tambahan_persen numeric(9,4) DEFAULT 0 NOT NULL,
    biaya_tambahan numeric(19,4) DEFAULT 0 NOT NULL,
    pihak_id uuid,
    mata_uang character(3) NOT NULL,
    nilai_valuta numeric(19,4) NOT NULL,
    kurs numeric(19,6) DEFAULT 1 NOT NULL,
    kurs_bawaan numeric(19,6) DEFAULT 1 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT kasir_detail_pkey PRIMARY KEY (id),
    CONSTRAINT kasir_detail_jenis_bayar_unique UNIQUE (kasir_id, jenis_bayar_id),
    CONSTRAINT kasir_detail_kurs_check CHECK (kurs > 0 AND kurs_bawaan > 0),
    CONSTRAINT kasir_detail_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT kasir_detail_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kasir_detail_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT kasir_detail_merchan_foreign
        FOREIGN KEY (tenant_id, merchan_id) REFERENCES public.merchan(tenant_id, id) ON DELETE RESTRICT
);

-- 3. Kasir per kelompok jasa ----------------------------------------------------------------------------------------

CREATE TABLE public.kasir_detail_group_jasa (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    kasir_id uuid NOT NULL,
    kelompok_jasa_id uuid,
    kelompok_jasa_nama character varying(100),
    nilai numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT kasir_detail_group_jasa_pkey PRIMARY KEY (id),
    CONSTRAINT kasir_detail_group_jasa_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT
);

-- 4. Baris biaya yang ditagih ---------------------------------------------------------------------------------------

ALTER TABLE public.kunjungan_kasir_detail
    ADD COLUMN kasir_id uuid,
    ADD CONSTRAINT kunjungan_kasir_detail_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT;

-- 5. Reference nomor bukti ------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d4c0-0000-7000-8000-00000000b001', 'core', 'core.payment-number', 'Nomor bukti pembayaran kasir',
        '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"KSR-"},{"type":"number","length":8}]}',
        true, false, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenant_number_sequences (
    id, tenant_id, reference_id, scope_type, legal_entity_id, status, is_continuous, allow_automatic, allow_manual,
    allow_lower_number, allow_higher_number, reset_period, preallocation_enabled, preallocation_quantity,
    minimum_number, maximum_number, segments, created_at, updated_at)
SELECT gen_random_uuid(), l.tenant_id, r.id, 'legal_entity', l.organization_id, 'active', false, true, false,
       false, false, 'never', true, 20, 1, 99999999,
       (r.default_settings -> 'segments')::json, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.legal_entities l
JOIN public.organizations o ON o.id = l.organization_id AND o.tenant_id = l.tenant_id
CROSS JOIN public.app_number_sequence_references r
WHERE r.code = 'core.payment-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);

-- 6. Mata uang asing -------------------------------------------------------------------------------------------------

ALTER TABLE public.jenis_bayar
    ADD COLUMN mata_uang character(3),
    ADD CONSTRAINT jenis_bayar_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT jenis_bayar_sisa_lokal_check CHECK (NOT menampung_sisa OR mata_uang IS NULL);
DROP INDEX public.jenis_bayar_tunai_unique;
CREATE UNIQUE INDEX jenis_bayar_tunai_unique
    ON public.jenis_bayar USING btree (tenant_id, legal_entity_id, (coalesce(mata_uang, '')))
    WHERE (perilaku = 'tunai' AND aktif AND deleted_at IS NULL);

-- 7. Izin ubah kurs pembayaran ---------------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('core.payment-rate.update', 'core', 'core.payment.form', 'update', 'Ubah kurs di pembayaran kasir',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('core.payment-rate.maintain', 'core', 'Mengubah kurs di pembayaran kasir', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('core.payment-rate.maintain', 'core.payment-rate.update')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duties (code, app_id, name, created_at, updated_at)
VALUES ('core.payment-rate.operate', 'core', 'Mengubah kurs di pembayaran kasir', now() AT TIME ZONE 'utc',
        now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('core.payment-rate.operate', 'core.payment-rate.maintain')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT r.id, 'core.payment-rate.operate'
FROM public.roles r
WHERE r.is_owner AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kasir_detail
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kasir_detail_group_jasa
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
