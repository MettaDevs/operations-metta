-- Batal resep: resep yang tidak diambil pasien keluar dari antrean farmasi (SIMtrResep.Batal sistem lama, yang dihitung
-- antrean lama sebagai "Tidak Diambil").
--
-- Sistem lama tidak punya tombol untuk ini. Kolom Batal ada, antrean farmasi menghitungnya, dan antrean, E-Resep, serta
-- pemeriksaan kasir menyaring Batal = 0, tetapi tidak ada kode yang mengisinya: Kuta 1 0 dari 13.326 resep, dan 12
-- baris di salinan lain diisi di luar aplikasi. Yang ada di kode adalah hapus resep oleh poli sebelum realisasi ("Resep
-- tidak bisa dihapus, karena sudah realisasi") dan kunci kasir Seroja. Di sini pembatalan milik farmasi, karena resep
-- yang sudah dikirim tidak bisa diubah dokter lagi.
--
-- 1. far_tr_resep: waktu, pengguna, dan alasan batal. Resep yang dibatalkan tetap tercatat (penghapusan lunak berlaku
--    untuk baris yang dihapus, bukan untuk resep yang dibatalkan).
-- 2. Izin pharmacy.prescription.cancel untuk duty apoteker (pharmacy.dispensing.manage), sama dengan Batal siapkan.
--    Role yang sudah memegang duty itu langsung mendapatkannya.

-- 1. Kolom batal ---------------------------------------------------------------------------------------------------

ALTER TABLE public.far_tr_resep
    ADD COLUMN dibatalkan_pada timestamp(0) without time zone,
    ADD COLUMN dibatalkan_oleh_user_id uuid,
    ADD COLUMN alasan_batal character varying(200),
    ADD CONSTRAINT far_tr_resep_batal_check CHECK (dibatalkan_pada IS NULL OR alasan_batal IS NOT NULL);

-- 2. Izin ----------------------------------------------------------------------------------------------------------

INSERT INTO public.permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at)
VALUES ('pharmacy.prescription.cancel', 'pharmacy', 'pharmacy.prescription.form', 'correct', 'Batalkan resep',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privileges (code, app_id, name, created_at, updated_at)
VALUES ('pharmacy.prescription.cancellation', 'pharmacy', 'Membatalkan resep yang tidak diambil',
        now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.security_privilege_permissions (privilege_code, permission_code)
VALUES ('pharmacy.prescription.cancellation', 'pharmacy.prescription.read'),
       ('pharmacy.prescription.cancellation', 'pharmacy.prescription.cancel')
ON CONFLICT DO NOTHING;

INSERT INTO public.security_duty_privileges (duty_code, privilege_code)
VALUES ('pharmacy.dispensing.manage', 'pharmacy.prescription.cancellation')
ON CONFLICT DO NOTHING;

UPDATE public.security_duties
SET name = 'Siapkan, panggil, serahkan, batal siapkan, dan batalkan resep', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'pharmacy.dispensing.manage';
