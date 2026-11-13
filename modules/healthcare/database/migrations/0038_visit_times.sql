-- Waktu kunjungan dan waktu pemeriksaan per poli disimpan di baris kunjungan, seperti sistem lama, bukan hanya di
-- riwayat tindakan antrean. Keputusan pemilik produk, 13 November 2026: data yang kelak dikirim ke SATUSEHAT
-- (Encounter.statusHistory dan period) diambil dari kolom registrasi, dan mekanisme kirimnya bukan bagian dari sini.
--
-- Sumber sistem lama dan padanannya:
-- - SIMtrDataRegPasien.Tanggal + Jam (saat pasien didaftarkan ke satu section, termasuk saat rujuk internal membuat
--   baris baru) -> sim_tr_registrasi_tujuan.didaftarkan_pada.
-- - SIMtrRJ.WaktuMulaiPeriksa dan WaktuSelesaiPeriksa (statuspasien_helper::update_statuspasien) ->
--   sim_tr_registrasi_tujuan.mulai_periksa_pada dan selesai_periksa_pada. Satu SIMtrRJ per NoBukti, dan NoBukti di sini
--   milik tujuan.
-- - SIMtrDataRegPasien.BatalAt dan BatalBy -> sim_tr_registrasi_tujuan.batal_pada dan batal_oleh.
-- - SIMtrRegistrasi.TglReg + JamReg, BatalAt, BatalBy sudah ada (didaftarkan_pada, batal_pada, batal_oleh).
-- - SIMtrRegistrasi.TglKeluar + JamKeluar -> sim_tr_registrasi.selesai_pada, dengan beda yang disengaja: sistem lama
--   mengisinya saat pembayaran kasir (general_payment_helper), sehingga kunjungan yang tidak lewat kasir tidak pernah
--   mendapatkannya, dan jamnya ditulis dengan format 'h:m:s' (jam 12-an dan bulan sebagai menit). Di sini ia diisi saat
--   kunjungan berstatus selesai, yaitu saat poli terakhirnya Selesai periksa.
--
-- Riwayat sim_tr_antrean_panggilan tetap ditulis seperti sebelumnya; kolom ini tidak menggantikannya.
--
-- 1. Kolom waktu di tujuan, diisi dari riwayat antrean dan kunjungan yang sudah ada.
-- 2. Waktu selesai kunjungan.

-- 1. Tujuan --------------------------------------------------------------------------------------------------------

ALTER TABLE public.sim_tr_registrasi_tujuan
    ADD COLUMN didaftarkan_pada timestamp(0) without time zone,
    ADD COLUMN mulai_periksa_pada timestamp(0) without time zone,
    ADD COLUMN selesai_periksa_pada timestamp(0) without time zone,
    ADD COLUMN batal_oleh uuid,
    ADD COLUMN batal_pada timestamp(0) without time zone;

UPDATE public.sim_tr_registrasi_tujuan d
SET didaftarkan_pada = CASE WHEN d.asal_tujuan_id IS NULL THEN r.didaftarkan_pada
                            ELSE coalesce(d.created_at, r.didaftarkan_pada) END,
    mulai_periksa_pada = coalesce(
        (SELECT min(a.dilakukan_pada) FROM public.sim_tr_antrean_panggilan a
         WHERE a.tenant_id = d.tenant_id AND a.tujuan_id = d.id AND a.aksi = 'mulai_periksa'),
        CASE WHEN d.status IN ('diperiksa', 'selesai') THEN d.updated_at END),
    selesai_periksa_pada = CASE WHEN d.status = 'selesai' THEN coalesce(
        (SELECT max(a.dilakukan_pada) FROM public.sim_tr_antrean_panggilan a
         WHERE a.tenant_id = d.tenant_id AND a.tujuan_id = d.id AND a.aksi = 'selesai_periksa'),
        d.updated_at) END,
    batal_oleh = CASE WHEN d.status = 'batal' THEN r.batal_oleh END,
    batal_pada = CASE WHEN d.status = 'batal' THEN coalesce(r.batal_pada, d.updated_at) END
FROM public.sim_tr_registrasi r
WHERE r.tenant_id = d.tenant_id AND r.id = d.registrasi_id;

ALTER TABLE public.sim_tr_registrasi_tujuan
    ALTER COLUMN didaftarkan_pada SET NOT NULL,
    ADD CONSTRAINT sim_tr_registrasi_tujuan_mulai_periksa_check
        CHECK (status NOT IN ('diperiksa', 'selesai') OR mulai_periksa_pada IS NOT NULL),
    ADD CONSTRAINT sim_tr_registrasi_tujuan_selesai_periksa_check
        CHECK ((status = 'selesai') = (selesai_periksa_pada IS NOT NULL)),
    ADD CONSTRAINT sim_tr_registrasi_tujuan_batal_check CHECK ((status = 'batal') = (batal_pada IS NOT NULL));

-- 2. Kunjungan -----------------------------------------------------------------------------------------------------

ALTER TABLE public.sim_tr_registrasi ADD COLUMN selesai_pada timestamp(0) without time zone;

UPDATE public.sim_tr_registrasi r
SET selesai_pada = coalesce(
        (SELECT max(d.selesai_periksa_pada) FROM public.sim_tr_registrasi_tujuan d
         WHERE d.tenant_id = r.tenant_id AND d.registrasi_id = r.id AND d.deleted_at IS NULL),
        r.updated_at)
WHERE r.status = 'selesai';

ALTER TABLE public.sim_tr_registrasi
    ADD CONSTRAINT sim_tr_registrasi_selesai_check CHECK ((status = 'selesai') = (selesai_pada IS NOT NULL));
