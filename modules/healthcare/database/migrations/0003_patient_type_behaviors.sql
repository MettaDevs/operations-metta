-- Perilaku tipe pasien. Arah rancangan pemilik produk, 10 November 2026: kode tidak pernah bertanya "apakah ini
-- BPJS?", tetapi "apakah perilaku X aktif untuk tipe pasien ini?".
--
-- Katalog perilaku ada di kode (patient-type.behaviors.ts) dan diimplementasikan sekali. Tipe pasien menyalakan
-- perilaku lewat satu baris per perilaku di tabel ini, berkunci kode perilaku. Perilaku baru kelak (cek kepesertaan,
-- mode tagihan, wajib rujukan, dan seterusnya) cukup menjadi kode baru di katalog; tabel dan data pasien tidak
-- berubah.
--
-- kes_tipe_pasien.memakai_penjamin dari 0001 dibiarkan dan tetap ditulis sama dengan perilaku requires_guarantor,
-- supaya kode rilis sebelumnya tetap benar di atas skema ini. Ia dibuang di rilis sesudah tidak ada kode yang
-- membacanya.

CREATE TABLE public.kes_tipe_pasien_perilaku (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tipe_pasien_id uuid NOT NULL,
    perilaku character varying(60) NOT NULL,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    deleted_at timestamp(0) without time zone,
    created_by_user_id uuid,
    updated_by_user_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT kes_tipe_pasien_perilaku_pkey PRIMARY KEY (id),
    CONSTRAINT kes_tipe_pasien_perilaku_tipe_pasien_foreign
        FOREIGN KEY (tenant_id, tipe_pasien_id) REFERENCES public.kes_tipe_pasien(tenant_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX kes_tipe_pasien_perilaku_unique
    ON public.kes_tipe_pasien_perilaku USING btree (tenant_id, tipe_pasien_id, perilaku) WHERE (deleted_at IS NULL);

CREATE TRIGGER bump_row_version BEFORE UPDATE ON public.kes_tipe_pasien_perilaku
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_bump_row_version();
CREATE TRIGGER stamp_audit_actor BEFORE INSERT OR UPDATE ON public.kes_tipe_pasien_perilaku
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_stamp_audit_actor();
CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.kes_tipe_pasien_perilaku
    FOR EACH ROW EXECUTE FUNCTION public.coreerp_log_change();

-- Tipe yang sudah memakai penjamin: form lama memunculkan Perusahaan dan No. asuransi bersamaan.
INSERT INTO public.kes_tipe_pasien_perilaku (id, tenant_id, tipe_pasien_id, perilaku, created_at, updated_at)
SELECT gen_random_uuid(), t.tenant_id, t.id, b.perilaku, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
FROM public.kes_tipe_pasien t
CROSS JOIN (VALUES ('requires_guarantor'), ('requires_card_number')) AS b(perilaku)
WHERE t.memakai_penjamin AND t.deleted_at IS NULL;
