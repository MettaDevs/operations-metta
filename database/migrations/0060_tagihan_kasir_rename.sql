-- Header tagihan kasir tidak selalu lahir dari kunjungan. Penjualan obat bebas di apotek dibayar kasir tanpa kunjungan,
-- dan nama kunjungan_kasir akan menyesatkan pembaca sepuluh tahun lagi. Keputusan pemilik produk 16 November 2026:
-- header menjadi tagihan_kasir, dengan pola <header> dan <header>_detail yang sama (SIMtrKasir dan SIMtrKasirDetail).
-- Nama lama dari 0039 dan 0042: kunjungan_kasir, kunjungan_kasir_detail, dan kunjungan_kasir_detail_komponen. Isi dan
-- perilakunya tidak berubah. Constraint, index, dan kolom rujukan yang membawa nama lama ikut diganti; trigger
-- bump_row_version dan stamp_audit_actor tidak membawa nama tabel, jadi ikut tabelnya. Kolom kunjungan_id tetap,
-- karena isinya memang kunjungan.

ALTER TABLE public.kunjungan_kasir RENAME TO tagihan_kasir;
ALTER TABLE public.tagihan_kasir RENAME CONSTRAINT kunjungan_kasir_pkey TO tagihan_kasir_pkey;
ALTER TABLE public.tagihan_kasir
    RENAME CONSTRAINT kunjungan_kasir_tenant_id_id_unique TO tagihan_kasir_tenant_id_id_unique;
ALTER TABLE public.tagihan_kasir RENAME CONSTRAINT kunjungan_kasir_kunjungan_unique TO tagihan_kasir_kunjungan_unique;
ALTER TABLE public.tagihan_kasir RENAME CONSTRAINT kunjungan_kasir_status_check TO tagihan_kasir_status_check;
ALTER TABLE public.tagihan_kasir
    RENAME CONSTRAINT kunjungan_kasir_legal_entity_foreign TO tagihan_kasir_legal_entity_foreign;
ALTER INDEX public.kunjungan_kasir_tanggal_index RENAME TO tagihan_kasir_tanggal_index;

ALTER TABLE public.kunjungan_kasir_detail RENAME TO tagihan_kasir_detail;
ALTER TABLE public.tagihan_kasir_detail RENAME CONSTRAINT kunjungan_kasir_detail_pkey TO tagihan_kasir_detail_pkey;
ALTER TABLE public.tagihan_kasir_detail
    RENAME CONSTRAINT kunjungan_kasir_detail_tenant_id_id_unique TO tagihan_kasir_detail_tenant_id_id_unique;
ALTER TABLE public.tagihan_kasir_detail
    RENAME CONSTRAINT kunjungan_kasir_detail_status_check TO tagihan_kasir_detail_status_check;
ALTER TABLE public.tagihan_kasir_detail
    RENAME CONSTRAINT kunjungan_kasir_detail_group_check TO tagihan_kasir_detail_group_check;
ALTER TABLE public.tagihan_kasir_detail
    RENAME CONSTRAINT kunjungan_kasir_detail_legal_entity_foreign TO tagihan_kasir_detail_legal_entity_foreign;
ALTER TABLE public.tagihan_kasir_detail
    RENAME CONSTRAINT kunjungan_kasir_detail_kasir_foreign TO tagihan_kasir_detail_kasir_foreign;
ALTER INDEX public.kunjungan_kasir_detail_sumber_unique RENAME TO tagihan_kasir_detail_sumber_unique;
ALTER INDEX public.kunjungan_kasir_detail_kunjungan_index RENAME TO tagihan_kasir_detail_kunjungan_index;

ALTER TABLE public.kunjungan_kasir_detail_komponen RENAME TO tagihan_kasir_detail_komponen;
ALTER TABLE public.tagihan_kasir_detail_komponen RENAME COLUMN kunjungan_kasir_detail_id TO tagihan_kasir_detail_id;
ALTER TABLE public.tagihan_kasir_detail_komponen
    RENAME CONSTRAINT kunjungan_kasir_detail_komponen_pkey TO tagihan_kasir_detail_komponen_pkey;
ALTER TABLE public.tagihan_kasir_detail_komponen
    RENAME CONSTRAINT kunjungan_kasir_detail_komponen_detail_foreign TO tagihan_kasir_detail_komponen_detail_foreign;
ALTER TABLE public.tagihan_kasir_detail_komponen
    RENAME CONSTRAINT kunjungan_kasir_detail_komponen_komponen_biaya_foreign
        TO tagihan_kasir_detail_komponen_komponen_biaya_foreign;
ALTER INDEX public.kunjungan_kasir_detail_komponen_detail_index RENAME TO tagihan_kasir_detail_komponen_detail_index;
