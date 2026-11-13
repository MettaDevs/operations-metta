-- Presisi rupiah menjadi data untuk setiap tenant: tenant baru mendapat barisnya saat disiapkan, dan tenant lama tanpa
-- baris IDR mendapatnya di sini dengan nilai yang sama, rupiah utuh untuk jumlah dan harga satuan tanpa pembulatan
-- tagihan lagi (localCurrencyPrecision di src/platform/money/). Itulah angka Kuta 1 dan Penta. Tenant yang sudah punya
-- baris IDR, misalnya dari setelan farmasi (pharmacy 0008) atau yang disetel di Sys Admin › Mata uang, tidak disentuh.
-- Bawaan kolom pembulatan tagihan ikut menjadi 0, tidak dibulatkan.

ALTER TABLE public.currency_precisions
    ALTER COLUMN invoice_rounding_precision SET DEFAULT 0;

INSERT INTO public.currency_precisions (id, tenant_id, currency_code, amount_decimals, unit_amount_decimals,
                                        invoice_rounding_precision, invoice_rounding_type, created_at, updated_at)
SELECT gen_random_uuid(), t.id, 'IDR', 0, 0, 0, 'nearest', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.tenants t
ON CONFLICT (tenant_id, currency_code) DO NOTHING;
