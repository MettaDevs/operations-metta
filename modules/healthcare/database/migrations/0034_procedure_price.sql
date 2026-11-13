-- Tab Detail Harga kartu Jasa sistem lama (Admin → Setup Jasa → Jasa, modules/admin/service/views/form.php, tab
-- pertama sebelum BHP dan Section) dipindah 1:1 ke kartu tindakan. Arahan pemilik produk 13 November 2026: jasa,
-- komponen jasa, dan semua turunannya mengikuti sistem lama lebih dulu, perbaikan sesudahnya.
--
-- 1. Harga tindakan (SIMdListHarga; grid atas dan form views/services/price/form.php). Satu baris satu kombinasi kunci
--    tarif. Kunci yang kosong berarti nilai wildcard sistem lama: kelas 'XX', spesialis 99 'ALL', dokter 'XX' (None),
--    dan kategori operasi 1 'ALL'. Tipe pasien (JenisPasienID) menjadi kelompok harga Core, karena tipe pasien di
--    sini menunjuk kelompok harga (0030). Dokter adalah nakes. Lokasi adalah daftar tetap di kode sistem lama
--    (Price_model::dropdown_static: RJ, UGD, RI, XX), jadi di sini katalog kode procedure-price.options.ts dengan kode
--    yang sama. Uang memakai numeric(19,4) seperti money SQL Server, persen numeric(9,4).
--    Harga Lama, Harga Baru, Harga Lama/Baru HC, dan Harga Lama/Baru BPJS adalah jumlah biasa nilai komponennya
--    (calculate_total_price di views/services/price/table.php, tanpa dikali Qty). Sistem lama menjumlahkannya di
--    peramban, sehingga dua tarif Kuta tersimpan berbeda dengan komponennya; di sini server menjumlahkannya saat
--    simpan.
--    Tidak ada indeks unik atas kombinasi kunci, sama dengan sistem lama.
-- 2. Komponen harga tindakan (SIMdListHargaDetail; grid Detail Komponen Jasa dan form_component.php). Satu komponen
--    biaya sekali per baris harga, kunci utama sistem lama (ListHargaID, KomponenBiayaID). Harga Awal Lama selalu 0
--    karena form sistem lama tidak punya isiannya. Prosentase dan NilaiPersen tidak dipindah: layar sistem lama tidak
--    pernah mengisinya, jadi nilainya selalu bawaan 0. Rekening HPP dan Rekening Lawan HPP (AkunNo, AkunNoLawan)
--    menunggu bagan akun finance.
-- 3. Trigger versi, aktor, dan change log.
--
-- Yang tidak dipindah dari SIMdListHarga karena layar sistem lama tidak menulisnya: SubSpesialisID, HonorDokter,
-- Incentive, Import, MulaiHarga_IKS, TglHargaBaruHC, MappingInHealth, dan HargaIKS_*. Trigger insSIMdListHarga,
-- UpdSIMdListHarga, dan insSIMdListHargaDetail menyalin setiap harga ke tabel IKS (SIMdJenisPasienTarifHarga dan
-- SIMdJenisPasienDetailHarga, jenis pasien 2) yang hanya dibaca jalur kerja sama; jalur rawat jalan tidak membacanya,
-- jadi trigger itu tidak dipindah.
--
-- Menghapus baris berarti mengisi deleted_at; sistem lama menghapus fisik (Service_helper::update_service).

-- 1. Harga tindakan ------------------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_tindakan_harga (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tindakan_id uuid NOT NULL,
    kelompok_harga_id uuid NOT NULL,
    kelas_id uuid,
    spesialisasi_id uuid,
    sub_spesialis boolean DEFAULT false NOT NULL,
    nakes_id uuid,
    kategori_operasi_id uuid,
    pasien_ktp boolean DEFAULT true NOT NULL,
    cyto boolean DEFAULT false NOT NULL,
    lokasi character varying(10) DEFAULT 'RJ' NOT NULL,
    insentif_detail numeric(19,4) DEFAULT 0 NOT NULL,
    insentif_komponen numeric(19,4) DEFAULT 0 NOT NULL,
    harga_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_baru numeric(19,4) DEFAULT 0 NOT NULL,
    harga_hc_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_hc_baru numeric(19,4) DEFAULT 0 NOT NULL,
    disc_hc_umum numeric(9,4) DEFAULT 0 NOT NULL,
    tgl_harga_baru date NOT NULL,
    harga_bpjs_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_bpjs numeric(19,4) DEFAULT 0 NOT NULL,
    tgl_harga_baru_bpjs date,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tindakan_harga_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tindakan_harga_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT sim_m_tindakan_harga_lokasi_check CHECK (lokasi IN ('RJ', 'UGD', 'RI', 'XX')),
    CONSTRAINT sim_m_tindakan_harga_tindakan_foreign
        FOREIGN KEY (tenant_id, tindakan_id) REFERENCES public.sim_m_tindakan(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_kelompok_harga_foreign
        FOREIGN KEY (tenant_id, kelompok_harga_id) REFERENCES public.kelompok_harga(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_kelas_foreign
        FOREIGN KEY (tenant_id, kelas_id) REFERENCES public.sim_m_kelas(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_spesialisasi_foreign
        FOREIGN KEY (tenant_id, spesialisasi_id) REFERENCES public.sim_m_spesialisasi(tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_nakes_foreign
        FOREIGN KEY (tenant_id, nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_kategori_operasi_foreign
        FOREIGN KEY (tenant_id, kategori_operasi_id) REFERENCES public.sim_m_kategori_operasi(tenant_id, id)
        ON DELETE RESTRICT
);
CREATE INDEX sim_m_tindakan_harga_tindakan_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, tindakan_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_kelompok_harga_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, kelompok_harga_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_kelas_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, kelas_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_spesialisasi_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, spesialisasi_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_nakes_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, nakes_id) WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_kategori_operasi_index
    ON public.sim_m_tindakan_harga USING btree (tenant_id, kategori_operasi_id) WHERE (deleted_at IS NULL);

-- 2. Komponen harga tindakan ---------------------------------------------------------------------------------------

CREATE TABLE public.sim_m_tindakan_harga_komponen (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tindakan_harga_id uuid NOT NULL,
    komponen_biaya_id uuid NOT NULL,
    qty numeric(18,4) DEFAULT 1 NOT NULL,
    harga_awal numeric(19,4) DEFAULT 0 NOT NULL,
    harga_awal_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_baru numeric(19,4) DEFAULT 0 NOT NULL,
    persen_pajak_titipan numeric(9,4) DEFAULT 0 NOT NULL,
    persen_insentif numeric(9,4) DEFAULT 0 NOT NULL,
    include_insentif boolean DEFAULT false NOT NULL,
    harga_hc_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_hc_baru numeric(19,4) DEFAULT 0 NOT NULL,
    persen_insentif_hc numeric(9,4) DEFAULT 0 NOT NULL,
    harga_bpjs_lama numeric(19,4) DEFAULT 0 NOT NULL,
    harga_bpjs numeric(19,4) DEFAULT 0 NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tindakan_harga_komponen_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tindakan_harga_komponen_harga_foreign
        FOREIGN KEY (tenant_id, tindakan_harga_id) REFERENCES public.sim_m_tindakan_harga(tenant_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT sim_m_tindakan_harga_komponen_komponen_biaya_foreign
        FOREIGN KEY (tenant_id, komponen_biaya_id) REFERENCES public.komponen_biaya(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tindakan_harga_komponen_unique
    ON public.sim_m_tindakan_harga_komponen USING btree (tenant_id, tindakan_harga_id, komponen_biaya_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tindakan_harga_komponen_komponen_biaya_index
    ON public.sim_m_tindakan_harga_komponen USING btree (tenant_id, komponen_biaya_id) WHERE (deleted_at IS NULL);

-- 3. Trigger -------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sim_m_tindakan_harga', 'sim_m_tindakan_harga_komponen']
    LOOP
        EXECUTE format('CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version()', t);
        EXECUTE format('CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor()', t);
        EXECUTE format('CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.%I
                            FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change()', t);
    END LOOP;
END;
$$;

INSERT INTO public.change_log_setup_tables (id, tenant_id, table_name, table_caption, log_insertion, log_modification,
                                            log_deletion, created_at, updated_at)
SELECT gen_random_uuid(), NULL, t.table_name, t.caption, 'all', 'all', 'all',
       now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM (VALUES ('sim_m_tindakan_harga', 'Harga tindakan'),
             ('sim_m_tindakan_harga_komponen', 'Komponen harga tindakan')) AS t(table_name, caption)
WHERE NOT EXISTS (SELECT 1 FROM public.change_log_setup_tables s
                  WHERE s.tenant_id IS NULL AND s.table_name = t.table_name);
