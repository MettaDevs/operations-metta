-- Jenis bayar per tipe pasien, padanan pembatas layar Pembayaran sistem lama (form/payment.php): isian DIJAMIN BPJS hanya
-- untuk JenisKerjasamaID 9 dan PERUSAHAAN hanya untuk 2, ditulis mati di browser. Di sini pembatas itu data, dan kasir
-- juga memeriksanya di server.
--
-- 1. sim_m_tipe_pasien_jenis_bayar: jenis bayar yang hanya boleh dipakai tipe pasien yang menyebutnya. Jenis bayar yang
--    tidak disebut tipe mana pun berlaku untuk semua tipe. Jenis bayar milik Core (jenis_bayar, per legal entity), dan
--    module boleh menunjuk Core; kasir mendapat daftarnya lewat healthcare.visit.completed.v1, tidak membaca tabel ini.
-- 2. sim_m_tipe_pasien_jenis_bayar_otomatis: jenis bayar yang melunasi seluruh tagihan kunjungan begitu kunjungan selesai,
--    untuk tipe yang menyalakan perilaku settles_automatically. Padanannya bayar otomatis BPJS sistem lama (Kuta di
--    Siapkan farmasi, Seroja di Simpan poli). Spesifikasi kasir menulisnya sebagai satu kolom di sim_m_tipe_pasien, tetapi
--    jenis bayar milik legal entity sedangkan tipe pasien milik tenant, jadi satu tipe butuh satu jenis bayar per legal
--    entity. Paling banyak satu per legal entity dijaga service.

CREATE TABLE public.sim_m_tipe_pasien_jenis_bayar (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.sim_m_tipe_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tipe_pasien_jenis_bayar_unique
    ON public.sim_m_tipe_pasien_jenis_bayar USING btree (tenant_id, tipe_pasien_id, jenis_bayar_id)
    WHERE (deleted_at IS NULL);
CREATE INDEX sim_m_tipe_pasien_jenis_bayar_jenis_bayar_index
    ON public.sim_m_tipe_pasien_jenis_bayar USING btree (tenant_id, jenis_bayar_id) WHERE (deleted_at IS NULL);

CREATE TABLE public.sim_m_tipe_pasien_jenis_bayar_otomatis (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    jenis_bayar_id uuid NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_otomatis_pkey PRIMARY KEY (id),
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_otomatis_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.sim_m_tipe_pasien(tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sim_m_tipe_pasien_jenis_bayar_otomatis_jenis_bayar_foreign
        FOREIGN KEY (tenant_id, jenis_bayar_id) REFERENCES public.jenis_bayar(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sim_m_tipe_pasien_jenis_bayar_otomatis_unique
    ON public.sim_m_tipe_pasien_jenis_bayar_otomatis USING btree (tenant_id, tipe_pasien_id, jenis_bayar_id)
    WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_tipe_pasien_jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_tipe_pasien_jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_tipe_pasien_jenis_bayar
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.sim_m_tipe_pasien_jenis_bayar_otomatis
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.sim_m_tipe_pasien_jenis_bayar_otomatis
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.sim_m_tipe_pasien_jenis_bayar_otomatis
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();
