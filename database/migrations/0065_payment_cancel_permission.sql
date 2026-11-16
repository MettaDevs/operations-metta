-- Batal pembayaran dan nota kredit tanpa penyetuju. Keputusan pemilik produk 16 November 2026: batal pembayaran adalah
-- izin sendiri, dan semua login lewat SSO, jadi tidak ada persetujuan yang bergantung pada kata sandi. 0050 memindah
-- ListApprove sistem lama apa adanya: penyetuju mengetik username dan password-nya di modal Batal. Kini pengguna yang
-- sedang masuk sendiri yang memegang izin core.payment.cancel. Alasan, siapa yang membatalkan, dan kapan tetap
-- dicatat (alasan_batal, dibatalkan_oleh_user_id, tgl_batal; nota_kredit.alasan, user_id, jam).
--
-- 1. Kode izin, privilege, dan duty tidak berubah, karena kode itulah yang tercatat di role tenant. Hanya namanya yang
--    berganti dari "menyetujui" menjadi "membatalkan".
-- 2. Bawaannya boleh: setiap role yang memegang duty menerima pembayaran kasir (core.payment.operate) mendapat duty batal
--    pembayaran. Role pemilik sudah mendapatnya sejak 0050.
-- 3. Kolom penyetuju dibuang. Isinya hanya data uji coba, karena belum ada klinik yang memakai kasir ini.

-- 1. Nama izin ------------------------------------------------------------------------------------------------------

UPDATE public.permissions
SET name = 'Batalkan pembayaran kasir', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.payment.cancel';

UPDATE public.security_privileges
SET name = 'Membatalkan pembayaran kasir', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.payment-cancel.approve';

UPDATE public.security_duties
SET name = 'Membatalkan pembayaran kasir', updated_at = now() AT TIME ZONE 'utc'
WHERE code = 'core.payment-cancel.approve';

-- 2. Pemegang kasir boleh membatalkan ----------------------------------------------------------------------------------

INSERT INTO public.security_role_duties (role_id, duty_code)
SELECT DISTINCT d.role_id, 'core.payment-cancel.approve'
FROM public.security_role_duties d
JOIN public.roles r ON r.id = d.role_id
WHERE d.duty_code = 'core.payment.operate' AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- 3. Kolom penyetuju --------------------------------------------------------------------------------------------------

ALTER TABLE public.kasir DROP COLUMN penyetuju_batal_user_id;
ALTER TABLE public.nota_kredit DROP COLUMN penyetuju_user_id;
