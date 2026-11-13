-- Baris biaya kasir mengikuti pola header dan baris sistem lama (SIMtrKasir dan SIMtrKasirDetail), keputusan pemilik
-- produk 13 November 2026: kunjungan_kasir adalah header tagihan kunjungan, dan barisnya kunjungan_kasir_detail,
-- dengan akhiran _detail tunggal seperti kasir_detail, clerk_detail, dan sim_tr_resep_detail. Nama lama dari 0039:
-- rincian_biaya dan rincian_biaya_komponen. Isi dan perilakunya tidak berubah; constraint, index, dan kolom rujukan
-- ikut diganti namanya.

ALTER TABLE public.rincian_biaya RENAME TO kunjungan_kasir_detail;
ALTER TABLE public.kunjungan_kasir_detail RENAME CONSTRAINT rincian_biaya_pkey TO kunjungan_kasir_detail_pkey;
ALTER TABLE public.kunjungan_kasir_detail
    RENAME CONSTRAINT rincian_biaya_tenant_id_id_unique TO kunjungan_kasir_detail_tenant_id_id_unique;
ALTER TABLE public.kunjungan_kasir_detail
    RENAME CONSTRAINT rincian_biaya_status_check TO kunjungan_kasir_detail_status_check;
ALTER TABLE public.kunjungan_kasir_detail
    RENAME CONSTRAINT rincian_biaya_group_check TO kunjungan_kasir_detail_group_check;
ALTER TABLE public.kunjungan_kasir_detail
    RENAME CONSTRAINT rincian_biaya_legal_entity_foreign TO kunjungan_kasir_detail_legal_entity_foreign;
ALTER INDEX public.rincian_biaya_sumber_unique RENAME TO kunjungan_kasir_detail_sumber_unique;
ALTER INDEX public.rincian_biaya_kunjungan_index RENAME TO kunjungan_kasir_detail_kunjungan_index;

ALTER TABLE public.rincian_biaya_komponen RENAME TO kunjungan_kasir_detail_komponen;
ALTER TABLE public.kunjungan_kasir_detail_komponen RENAME COLUMN rincian_biaya_id TO kunjungan_kasir_detail_id;
ALTER TABLE public.kunjungan_kasir_detail_komponen
    RENAME CONSTRAINT rincian_biaya_komponen_pkey TO kunjungan_kasir_detail_komponen_pkey;
ALTER TABLE public.kunjungan_kasir_detail_komponen
    RENAME CONSTRAINT rincian_biaya_komponen_rincian_foreign TO kunjungan_kasir_detail_komponen_detail_foreign;
ALTER TABLE public.kunjungan_kasir_detail_komponen
    RENAME CONSTRAINT rincian_biaya_komponen_komponen_biaya_foreign
        TO kunjungan_kasir_detail_komponen_komponen_biaya_foreign;
ALTER INDEX public.rincian_biaya_komponen_rincian_index RENAME TO kunjungan_kasir_detail_komponen_detail_index;
