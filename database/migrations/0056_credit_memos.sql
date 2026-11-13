-- Nota kredit kasir (src/foundation/billing/credit-memo/), irisan 13 spesifikasi kasir. Perilaku baru, bukan port 1:1:
-- sistem lama hanya punya Batal. Pembayaran yang clerk-nya masih berjalan tetap dikoreksi dengan Batal; pembayaran yang
-- clerk-nya sudah Clerk End dikoreksi dengan nota kredit penuh (BC Sales Credit Memo lewat CorrectPostedSalesInvoice /
-- Cancel), diposting di clerk kasir yang sedang berjalan, dan uangnya dikembalikan lewat baris pengembalian (BC Refund).
--
-- 1. nota_kredit: satu nota per pembayaran yang dikoreksi, dengan penyetuju dan alasan seperti Batal. Belum ada batal
--    nota kredit, jadi kasir_id unik.
-- 2. nota_kredit_detail: satu baris pengembalian per baris kasir_detail yang jenis bayarnya berperilaku uang diterima
--    (tunai dan non tunai), dengan jumlah lokal, jumlah valuta, dan kurs yang sama dengan saat dibayar. Positif berarti
--    uang keluar dari laci clerk nota itu; tunai lokal negatif bila pembayarannya memberi kembalian rupiah untuk tunai
--    valuta. Baris piutang tidak dikembalikan, piutangnya dibatalkan; baris beban tidak punya uang untuk dikembalikan.
-- 3. kasir.status `dikreditkan`, dengan kolomnya dilebarkan ke 12 karakter. Index unik satu pembayaran `diposting` per
--    kunjungan tidak berubah, jadi kunjungannya bisa dibayar lagi dengan nomor baru.
-- 4. Reference nomor nota kredit per legal entity, NK- lalu delapan angka.

-- 1. Nota kredit ----------------------------------------------------------------------------------------------------

CREATE TABLE public.nota_kredit (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    no_bukti character varying(50) NOT NULL,
    tanggal date NOT NULL,
    jam timestamp(0) without time zone NOT NULL,
    kasir_id uuid NOT NULL,
    clerk_id uuid NOT NULL,
    user_id uuid NOT NULL,
    penyetuju_user_id uuid NOT NULL,
    alasan character varying(200) NOT NULL,
    nilai numeric(19,4) NOT NULL,
    nilai_discount numeric(19,4) DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT nota_kredit_pkey PRIMARY KEY (id),
    CONSTRAINT nota_kredit_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT nota_kredit_no_bukti_unique UNIQUE (tenant_id, no_bukti),
    CONSTRAINT nota_kredit_kasir_unique UNIQUE (tenant_id, kasir_id),
    CONSTRAINT nota_kredit_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_kasir_foreign
        FOREIGN KEY (tenant_id, kasir_id) REFERENCES public.kasir(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_clerk_foreign
        FOREIGN KEY (tenant_id, clerk_id) REFERENCES public.clerk(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_user_foreign
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_penyetuju_foreign
        FOREIGN KEY (penyetuju_user_id) REFERENCES public.users(id) ON DELETE RESTRICT
);
CREATE INDEX nota_kredit_clerk_index ON public.nota_kredit USING btree (tenant_id, clerk_id);

-- 2. Baris pengembalian ---------------------------------------------------------------------------------------------

CREATE TABLE public.nota_kredit_detail (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    nota_kredit_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    mata_uang character(3) NOT NULL,
    nilai_valuta numeric(19,4) NOT NULL,
    kurs numeric(19,6) DEFAULT 1 NOT NULL,
    merchan_id uuid,
    referensi character varying(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT nota_kredit_detail_pkey PRIMARY KEY (id),
    CONSTRAINT nota_kredit_detail_jenis_bayar_unique UNIQUE (nota_kredit_id, jenis_bayar_id),
    CONSTRAINT nota_kredit_detail_kurs_check CHECK (kurs > 0),
    CONSTRAINT nota_kredit_detail_nota_kredit_foreign
        FOREIGN KEY (tenant_id, nota_kredit_id) REFERENCES public.nota_kredit(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_detail_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT nota_kredit_detail_mata_uang_foreign FOREIGN KEY (tenant_id, mata_uang)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT nota_kredit_detail_merchan_foreign
        FOREIGN KEY (tenant_id, merchan_id) REFERENCES public.merchan(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.nota_kredit
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.nota_kredit
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.nota_kredit
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.nota_kredit_detail
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'nota_kredit', 'Nota kredit kasir', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'nota_kredit');

-- 3. Status pembayaran dikreditkan ----------------------------------------------------------------------------------

ALTER TABLE public.kasir ALTER COLUMN status TYPE character varying(12);
ALTER TABLE public.kasir
    DROP CONSTRAINT kasir_status_check,
    DROP CONSTRAINT kasir_batal_check,
    ADD CONSTRAINT kasir_status_check CHECK (status IN ('diposting', 'batal', 'dikreditkan')),
    ADD CONSTRAINT kasir_batal_check CHECK (
        (status IN ('diposting', 'dikreditkan') AND tgl_batal IS NULL AND alasan_batal IS NULL)
        OR (status = 'batal' AND tgl_batal IS NOT NULL AND alasan_batal IS NOT NULL));

-- 4. Reference nomor nota kredit ------------------------------------------------------------------------------------

INSERT INTO public.app_number_sequence_references (id, app_id, code, name, allowed_scopes, default_prefix,
                                                  default_settings, default_per_legal_entity,
                                                  numbers_unique_per_scope, created_at, updated_at)
VALUES ('01a1d4c0-0000-7000-8000-00000000b003', 'core', 'core.credit-memo-number', 'Nomor nota kredit kasir',
        '["legal_entity"]', NULL,
        '{"minimum_number":1,"maximum_number":99999999,"segments":[{"type":"constant","value":"NK-"},{"type":"number","length":8}]}',
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
WHERE r.code = 'core.credit-memo-number'
  AND NOT EXISTS (SELECT 1 FROM public.tenant_number_sequences s
                  WHERE s.tenant_id = l.tenant_id AND s.reference_id = r.id
                    AND s.scope_type = 'legal_entity' AND s.legal_entity_id = l.organization_id);
