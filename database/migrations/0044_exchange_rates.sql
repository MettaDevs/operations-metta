-- Kurs mata uang asing per tenant (src/foundation/currency/), padanan Currency Exchange Rate BC dan riwayat kurs sistem
-- lama (TBJ_HisCurrency dan TBJ_HisCurrencyDetail di back office, dibaca front office lewat Vw_HisCurrency).
--
-- Satu baris per mata uang per tanggal berlaku: kurs adalah nilai satu satuan mata uang itu dalam mata uang lokal tenant
-- (Rate sistem lama, misalnya 1 USD = 16.250 rupiah). Kurs untuk satu tanggal adalah baris dengan tanggal berlaku terakhir
-- yang tidak lewat dari tanggal itu (Starting Date BC). Sistem lama menyalin semua kurs ke baris harian baru
-- (CekHisCurrency); di sini satu baris berlaku sampai baris berikutnya, jadi tidak ada salinan harian.
--
-- Mata uangnya wajib sudah disetel di Sys Admin › Mata uang (currency_precisions), karena jumlah dalam mata uang itu
-- dibulatkan dengan presisinya. Mata uang lokal tidak punya baris: kursnya selalu 1. Baris dihapus lunak; pembayaran
-- menyalin kurs yang dipakainya, jadi menghapus kurs tidak mengubah pembayaran yang sudah ada.

CREATE TABLE public.tbj_his_currency (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    currency_code character(3) NOT NULL,
    tanggal_berlaku date NOT NULL,
    kurs numeric(19,6) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT tbj_his_currency_pkey PRIMARY KEY (id),
    CONSTRAINT tbj_his_currency_kurs_check CHECK (kurs > 0),
    CONSTRAINT tbj_his_currency_currency_foreign FOREIGN KEY (tenant_id, currency_code)
        REFERENCES public.currency_precisions(tenant_id, currency_code) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tbj_his_currency_tanggal_unique
    ON public.tbj_his_currency USING btree (tenant_id, currency_code, tanggal_berlaku) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.tbj_his_currency
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.tbj_his_currency
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.tbj_his_currency
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'tbj_his_currency', 'Kurs', 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'tbj_his_currency');
