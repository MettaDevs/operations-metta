-- Tarif Biaya Tindakan pemeriksaan (SIMtrRJTransaksi.Tarif dan SIMtrRJTransaksiDetail). Arahan pemilik produk
-- 13 November 2026: jasa dan semua turunannya mengikuti sistem lama 1:1, termasuk angkanya. Sistem lama menghitung tarif
-- sekali, saat tindakan dipilih di lookup (rekammedis/lookup/services.php, Harga_Baru baris pencarian tarif), dan tidak
-- pernah menghitungnya ulang; di sini server menghitungnya saat baris pertama kali disimpan dengan pencarian tarif yang
-- sama (procedure-price.lookup.ts), lalu nilainya dibekukan. Mengubah tarif sesudahnya tidak mengubah pemeriksaan yang
-- sudah disimpan. Kasir kelak membaca tarif dan komponennya dari sini.
--
-- 1. sim_tr_pemeriksaan_tindakan:
--    tarif: harga yang dipakai, Harga Baru untuk tarif umum atau Harga Baru BPJS untuk tarif BPJS. Tanpa tarif berarti
--    0, seperti sistem lama: SIMtrRJTransaksi.Tarif NOT NULL, dan Tarif kosong dari peramban tersimpan 0 (15.485 dari
--    21.056 baris Kuta 1).
--    jenis_tarif: kode tarif jasa tipe pasien kunjungan saat tarif dicari (procedureTariffs). Kodenya membedakan tarif
--    umum dari tarif BPJS, dan tipe pasien bisa diubah sesudahnya.
--    kelompok_harga_id: kelompok harga yang dicari tarifnya, kosong untuk tarif jasa none.
--    tindakan_harga_id: baris harga yang terpilih, kosong bila tanpa tarif. Sistem lama menyimpan ListHargaID baris mana
--    pun milik jasa itu (rekammedis_helper.php:375); di sini baris yang dipilih pencarian tarif.
--    Baris yang sudah ada sebelum migration ini tidak pernah dicari tarifnya, jadi mendapat tarif 0 dan jenis none,
--    sama dengan baris tanpa tarif. Tidak ada yang diisi ulang.
-- 2. sim_tr_pemeriksaan_tindakan_komponen: salinan komponen baris harga terpilih, satu baris per komponen biaya, dengan
--    nilai yang dipakai jenis tarifnya (Harga Baru dan Persen Insentif, atau Harga Baru BPJS dan Insentif HC seperti
--    GetDetailKomponenTarifJKN). Sistem lama hanya menulis satu baris berisi komponen pertama dengan seluruh tarif
--    (rekammedis_helper.php:409-437). Ikut dihapus lunak bersama barisnya.
-- 3. Trigger versi, aktor, dan change log.

-- 1. Tarif baris tindakan ----------------------------------------------------------------------------------------

ALTER TABLE public.sim_tr_pemeriksaan_tindakan
    ADD COLUMN tarif numeric(19,4) DEFAULT 0 NOT NULL,
    ADD COLUMN jenis_tarif character varying(30) DEFAULT 'none' NOT NULL,
    ADD COLUMN kelompok_harga_id uuid,
    ADD COLUMN tindakan_harga_id uuid,
    ADD CONSTRAINT sim_tr_pemeriksaan_tindakan_tenant_id_id_unique UNIQUE (tenant_id, id),
    ADD CONSTRAINT sim_tr_pemeriksaan_tindakan_jenis_tarif_check
        CHECK (jenis_tarif IN ('none', 'general', 'general_own_group', 'bpjs', 'bpjs_matching_only')),
    ADD CONSTRAINT sim_tr_pemeriksaan_tindakan_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_pemeriksaan_tindakan_tindakan_harga_foreign
        FOREIGN KEY (tenant_id, tindakan_harga_id) REFERENCES public.sim_m_tindakan_harga(tenant_id, id)
        ON DELETE RESTRICT;
ALTER TABLE public.sim_tr_pemeriksaan_tindakan
    ALTER COLUMN tarif DROP DEFAULT,
    ALTER COLUMN jenis_tarif DROP DEFAULT;
CREATE INDEX sim_tr_pemeriksaan_tindakan_kelompok_harga_index
    ON public.sim_tr_pemeriksaan_tindakan USING btree (tenant_id, kelompok_harga_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_pemeriksaan_tindakan_tindakan_harga_index
    ON public.sim_tr_pemeriksaan_tindakan USING btree (tenant_id, tindakan_harga_id) WHERE (deleted_at IS NULL);

-- 2. Komponen tarif baris tindakan -------------------------------------------------------------------------------

CREATE TABLE public.sim_tr_pemeriksaan_tindakan_komponen (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    pemeriksaan_tindakan_id uuid NOT NULL,
    komponen_biaya_id uuid NOT NULL,
    qty numeric(18,4) NOT NULL,
    harga_awal numeric(19,4) NOT NULL,
    persen_pajak_titipan numeric(9,4) NOT NULL,
    persen_insentif numeric(9,4) NOT NULL,
    include_insentif boolean NOT NULL,
    harga numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_tr_pemeriksaan_tindakan_komponen_pkey PRIMARY KEY (id),
    CONSTRAINT sim_tr_pemeriksaan_tindakan_komponen_tindakan_foreign
        FOREIGN KEY (tenant_id, pemeriksaan_tindakan_id) REFERENCES public.sim_tr_pemeriksaan_tindakan(tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT sim_tr_pemeriksaan_tindakan_komponen_komponen_biaya_foreign
        FOREIGN KEY (tenant_id, komponen_biaya_id) REFERENCES public.komponen_biaya(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_tr_pemeriksaan_tindakan_komponen_unique
    ON public.sim_tr_pemeriksaan_tindakan_komponen USING btree (tenant_id, pemeriksaan_tindakan_id, komponen_biaya_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX sim_tr_pemeriksaan_tindakan_komponen_komponen_biaya_index
    ON public.sim_tr_pemeriksaan_tindakan_komponen USING btree (tenant_id, komponen_biaya_id)
    WHERE (deleted_at IS NULL);

-- 3. Trigger -----------------------------------------------------------------------------------------------------

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_tr_pemeriksaan_tindakan_komponen
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_tr_pemeriksaan_tindakan_komponen
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_tr_pemeriksaan_tindakan_komponen
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, 'sim_tr_pemeriksaan_tindakan_komponen', 'Komponen tarif tindakan pemeriksaan', 'all',
       'all', 'all', now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = 'sim_tr_pemeriksaan_tindakan_komponen');
