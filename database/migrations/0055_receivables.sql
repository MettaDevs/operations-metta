-- Piutang kasir dan Pembayaran Hutang (src/foundation/billing/receivable-payment/), irisan 12 spesifikasi kasir. Layar
-- dan isiannya port 1:1 Outstanding_payment sistem lama; pencatatannya pola BC, yaitu entri piutang terbuka dengan sisa
-- yang dilunasi sebagian atau penuh (Cust. Ledger Entry, Remaining Amount), bukan flag OutStanding, Lunas, dan Cair di
-- SIMtrKasir ditambah kartu outSTandingKartu yang ditulis trigger.
--
-- 1. piutang: satu entri per baris kasir_detail bernilai lebih dari 0 yang jenis bayarnya berperilaku `penjamin` atau
--    `piutang`, ditulis di transaksi Simpan pembayaran, termasuk pembayaran otomatis (BPJS yang lunas otomatis adalah
--    piutang ke penjaminnya). Pihaknya dipotret saat bayar: pasien kunjungan, penjamin kunjungan (pasien bila
--    kunjungannya tanpa penjamin), atau pihak buku alamat yang dipilih kasir. sisa berkurang oleh pelunasan; status
--    `lunas` tepat saat sisa 0, dan `batal` saat pembayarannya dibatalkan.
-- 2. pembayaran_outstanding (SIMtrPembayaranOutStanding): satu pelunasan, satu jenis bayar tunai atau non tunai seperti
--    form lama (Tunai atau Kartu Kredit dengan merchan, No Kartu, dan Add Charge %), di clerk kasir yang menerimanya.
--    Pelunasan adalah uang di laci, jadi Clerk End menghitungnya bersama pembayaran.
-- 3. Reference nomor bukti per legal entity, PBO- lalu delapan angka (sistem lama yymmdd/PBO/######).
--
-- Belum ada event untuk pelunasan dan batalnya, karena finance belum ada di repo ini. Saat finance dibangun, pelunasan
-- diterbitkan sebagai fakta tersendiri, sama dengan billing.invoice.posted.v1 untuk pembayaran.

-- 1. Piutang --------------------------------------------------------------------------------------------------------

ALTER TABLE public.kasir_detail
    ADD CONSTRAINT kasir_detail_tenant_id_id_unique UNIQUE (tenant_id, id);

CREATE TABLE public.piutang (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    kasir_id uuid NOT NULL,
    kasir_detail_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    pihak_jenis character varying(10) NOT NULL,
    pihak_id uuid,
    pihak_nama character varying(255) NOT NULL,
    nilai numeric(19,4) NOT NULL,
    sisa numeric(19,4) NOT NULL,
    status character varying(10) DEFAULT 'terbuka' NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT piutang_pkey PRIMARY KEY (id),
    CONSTRAINT piutang_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT piutang_kasir_detail_unique UNIQUE (tenant_id, kasir_detail_id),
    CONSTRAINT piutang_pihak_jenis_check CHECK (pihak_jenis IN ('pasien', 'penjamin', 'pihak')),
    CONSTRAINT piutang_status_check CHECK (status IN ('terbuka', 'lunas', 'batal')),
    CONSTRAINT piutang_sisa_check CHECK (nilai > 0 AND sisa >= 0 AND sisa <= nilai),
    CONSTRAINT piutang_lunas_check CHECK (status = 'batal' OR ((status = 'lunas') = (sisa = 0))),
    CONSTRAINT piutang_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT piutang_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT piutang_kasir_detail_foreign
        FOREIGN KEY (tenant_id, kasir_detail_id) REFERENCES public.kasir_detail(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT piutang_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX piutang_kasir_index ON public.piutang USING btree (tenant_id, kasir_id);
CREATE INDEX piutang_terbuka_index
    ON public.piutang USING btree (tenant_id, legal_entity_id) WHERE (status = 'terbuka');

-- 2. Pembayaran hutang ----------------------------------------------------------------------------------------------

CREATE TABLE public.pembayaran_outstanding (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    no_bukti character varying(50) NOT NULL,
    tanggal date NOT NULL,
    jam timestamp(0) without time zone NOT NULL,
    piutang_id uuid NOT NULL,
    clerk_id uuid NOT NULL,
    user_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    merchan_id uuid,
    referensi character varying(100),
    biaya_tambahan_persen numeric(9,4) DEFAULT 0 NOT NULL,
    biaya_tambahan numeric(19,4) DEFAULT 0 NOT NULL,
    status character varying(10) DEFAULT 'diposting' NOT NULL,
    tgl_batal timestamp(0) without time zone,
    alasan_batal character varying(200),
    dibatalkan_oleh_user_id uuid,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT pembayaran_outstanding_pkey PRIMARY KEY (id),
    CONSTRAINT pembayaran_outstanding_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT pembayaran_outstanding_no_bukti_unique UNIQUE (tenant_id, no_bukti),
    CONSTRAINT pembayaran_outstanding_nilai_check CHECK (nilai > 0 AND biaya_tambahan >= 0),
    CONSTRAINT pembayaran_outstanding_status_check CHECK (status IN ('diposting', 'batal')),
    CONSTRAINT pembayaran_outstanding_batal_check CHECK (
        (status = 'diposting' AND tgl_batal IS NULL AND alasan_batal IS NULL)
        OR (status = 'batal' AND tgl_batal IS NOT NULL AND alasan_batal IS NOT NULL)),
    CONSTRAINT pembayaran_outstanding_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT pembayaran_outstanding_piutang_foreign
        FOREIGN KEY (tenant_id, piutang_id) REFERENCES public.piutang(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT pembayaran_outstanding_clerk_foreign
        FOREIGN KEY (tenant_id, clerk_id) REFERENCES public.clerk(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT pembayaran_outstanding_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT pembayaran_outstanding_merchan_foreign
        FOREIGN KEY (tenant_id, merchan_id) REFERENCES public.merchan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT pembayaran_outstanding_dibatalkan_oleh_foreign
        FOREIGN KEY (dibatalkan_oleh_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE INDEX pembayaran_outstanding_piutang_index
    ON public.pembayaran_outstanding USING btree (tenant_id, piutang_id);
CREATE INDEX pembayaran_outstanding_clerk_index
    ON public.pembayaran_outstanding USING btree (tenant_id, clerk_id);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.piutang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.piutang
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.pembayaran_outstanding
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.pembayaran_outstanding
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.pembayaran_outstanding
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'pembayaran_outstanding', 'Pembayaran hutang', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'pembayaran_outstanding');

-- 3. Reference nomor bukti ------------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d4c0-0000-7000-8000-00000000b002', 'core', 'core.receivable-payment-number',
        'Nomor bukti pembayaran hutang', '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"PBO-"},{"type":"number","length":8}]}',
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
WHERE r.code = 'core.receivable-payment-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);
