-- Baris biaya dan kunjungan untuk kasir (src/foundation/billing/charge/), padanan hasil GetDetailRincianBiaya dan
-- SIMtrRegistrasi yang dibaca kasir sistem lama. Kasir lama membaca ulang tabel poli, lab, BHP, dan farmasi setiap kali
-- layar dibuka; di sini module mengirim faktanya sebagai event dan Core menyimpannya, karena Core tidak membaca tabel
-- module untuk menulis tagihan.
--
-- 1. kunjungan_kasir: kunjungan yang dikirim module saat selesai (StatusPeriksa = 'CO'), dengan potret pasien, tipe
--    pasien, penjamin, dan section-nya, untuk Daftar Pembayaran. Status `selesai` atau `batal`.
-- 2. rincian_biaya: satu baris per baris biaya sumber (tindakan pemeriksaan, kelak BHP dan obat), dengan kelompok jasa,
--    kategori, jenis biaya, qty, nilai, harga asli, diskon, HExt, dan biaya resep seperti kolom GetDetailRincianBiaya.
--    Status `terbuka` sampai kasir menagihnya. Event pengganti mengganti baris terbuka dokumen sumbernya.
-- 3. rincian_biaya_komponen: nilai per komponen biaya Core, untuk diskon komponen dan posting.
-- 4. kasir_event_diproses: event yang sudah diproses kasir, supaya event yang sama tidak diproses dua kali.

-- 1. Kunjungan kasir ------------------------------------------------------------------------------------------------

CREATE TABLE public.kunjungan_kasir (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    operating_unit_id uuid,
    sumber_module character varying(80) NOT NULL,
    kunjungan_id uuid NOT NULL,
    no_reg character varying(50) NOT NULL,
    tanggal date NOT NULL,
    didaftarkan_pada timestamp(0) without time zone NOT NULL,
    pasien_id uuid NOT NULL,
    pasien_nrm character varying(50) NOT NULL,
    pasien_nama character varying(255) NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    tipe_pasien_nama character varying(100) NOT NULL,
    penjamin_id uuid,
    penjamin_nama character varying(255),
    no_kartu character varying(100),
    section_nama character varying(500) NOT NULL,
    status character varying(10) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kunjungan_kasir_pkey PRIMARY KEY (id),
    CONSTRAINT kunjungan_kasir_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT kunjungan_kasir_kunjungan_unique UNIQUE (tenant_id, sumber_module, kunjungan_id),
    CONSTRAINT kunjungan_kasir_status_check CHECK (status IN ('selesai', 'batal')),
    CONSTRAINT kunjungan_kasir_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX kunjungan_kasir_tanggal_index ON public.kunjungan_kasir USING btree (tenant_id, legal_entity_id, tanggal);

-- 2. Rincian biaya --------------------------------------------------------------------------------------------------

CREATE TABLE public.rincian_biaya (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    legal_entity_id uuid NOT NULL,
    sumber_module character varying(80) NOT NULL,
    sumber_dokumen_id uuid NOT NULL,
    sumber_baris_id uuid NOT NULL,
    kunjungan_id uuid NOT NULL,
    group_biaya character varying(20) NOT NULL,
    kelompok_jasa_id uuid,
    kelompok_jasa_nama character varying(100),
    kelompok_jasa_urutan integer,
    kategori_nama character varying(100),
    jenis_biaya_id uuid NOT NULL,
    jenis_biaya_kode character varying(50) NOT NULL,
    jenis_biaya_nama character varying(255) NOT NULL,
    qty numeric(18,4) NOT NULL,
    nilai numeric(19,4) NOT NULL,
    harga_orig numeric(19,4) NOT NULL,
    disc numeric(9,4) DEFAULT 0 NOT NULL,
    hext numeric(19,4) DEFAULT 0 NOT NULL,
    biaya_resep numeric(19,4) DEFAULT 0 NOT NULL,
    section_id uuid,
    section_nama character varying(100),
    dokter_id uuid,
    dokter_nama character varying(255),
    tanggal date NOT NULL,
    status character varying(10) DEFAULT 'terbuka' NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT rincian_biaya_pkey PRIMARY KEY (id),
    CONSTRAINT rincian_biaya_tenant_id_id_unique UNIQUE (tenant_id, id),
    CONSTRAINT rincian_biaya_status_check CHECK (status IN ('terbuka', 'ditagih')),
    CONSTRAINT rincian_biaya_group_check CHECK (group_biaya IN ('PERAWATAN', 'OBAT', 'BHP', 'MCU')),
    CONSTRAINT rincian_biaya_legal_entity_foreign
        FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES public.organizations(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX rincian_biaya_sumber_unique
    ON public.rincian_biaya USING btree (tenant_id, sumber_module, sumber_baris_id) WHERE (deleted_at IS NULL);
CREATE INDEX rincian_biaya_kunjungan_index
    ON public.rincian_biaya USING btree (tenant_id, kunjungan_id) WHERE (deleted_at IS NULL);

-- 3. Komponen rincian biaya -----------------------------------------------------------------------------------------

CREATE TABLE public.rincian_biaya_komponen (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    rincian_biaya_id uuid NOT NULL,
    komponen_biaya_id uuid NOT NULL,
    nilai numeric(19,4) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    CONSTRAINT rincian_biaya_komponen_pkey PRIMARY KEY (id),
    CONSTRAINT rincian_biaya_komponen_rincian_foreign
        FOREIGN KEY (tenant_id, rincian_biaya_id) REFERENCES public.rincian_biaya(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT rincian_biaya_komponen_komponen_biaya_foreign
        FOREIGN KEY (tenant_id, komponen_biaya_id) REFERENCES public.komponen_biaya(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX rincian_biaya_komponen_rincian_index
    ON public.rincian_biaya_komponen USING btree (tenant_id, rincian_biaya_id) WHERE (deleted_at IS NULL);

-- 4. Event yang sudah diproses --------------------------------------------------------------------------------------

CREATE TABLE public.kasir_event_diproses (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp(0) without time zone NOT NULL,
    CONSTRAINT kasir_event_diproses_pkey PRIMARY KEY (id),
    CONSTRAINT kasir_event_diproses_unique UNIQUE (tenant_id, event_id)
);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kunjungan_kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kunjungan_kasir
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.rincian_biaya
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.rincian_biaya
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.rincian_biaya_komponen
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
