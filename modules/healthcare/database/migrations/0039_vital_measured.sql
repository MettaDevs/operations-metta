-- Waktu ukur dan pengukur tanda vital di Periksa fisik. Keputusan pemilik produk, 13 November 2026: waktu ukur yang kelak
-- dikirim ke SATUSEHAT (Observation.effectiveDateTime dan performer) diambil dari data pemeriksaan sendiri, seperti
-- tabel pecahan SIMtrRJ sistem lama.
--
-- Sistem lama menyimpan tanda vital di SIMtrEMRVitalSigns, satu baris per NoReg: dibuat saat pendaftaran (tinggi dan
-- berat, CreatedAt dan CreatedBy petugas daftar) lalu ditimpa setiap Simpan rekam medis poli (UpdatedAt dan UpdatedBy).
-- Jadi waktu ukur tanda vital poli di sistem lama adalah UpdatedAt, dan pengukurnya pengguna UpdatedBy. Di Kuta 1, 2.611
-- dari 2.669 baris terakhir yang punya pemeriksaan mencatat UpdatedAt di dalam atau sesudah masa periksa SIMtrRJ.
--
-- Di sini:
-- - diukur_pada dan diukur_oleh (pengguna) di sim_tr_pemeriksaan_fisik, diisi saat baris dibuat dan saat salah satu
--   nilainya berubah. Bedanya dengan UpdatedAt sistem lama, dan disengaja: Simpan yang tidak mengubah nilai Periksa
--   fisik, misalnya saat dokter menambah diagnosa, tidak menggeser waktu ukur.
-- - Tinggi dan berat saat pendaftaran tetap di sim_tr_registrasi (didaftarkan_pada, created_by_user_id), seperti baris
--   awal SIMtrEMRVitalSigns.
-- - Pengukur dicatat sebagai pengguna, seperti CreatedBy/UpdatedBy sistem lama. Nakes-nya didapat lewat
--   sim_m_nakes.user_id.

ALTER TABLE public.sim_tr_pemeriksaan_fisik
    ADD COLUMN diukur_pada timestamp(0) without time zone,
    ADD COLUMN diukur_oleh uuid;

UPDATE public.sim_tr_pemeriksaan_fisik
SET diukur_pada = coalesce(updated_at, created_at, now() AT TIME ZONE 'utc'),
    diukur_oleh = coalesce(updated_by_user_id, created_by_user_id);

ALTER TABLE public.sim_tr_pemeriksaan_fisik ALTER COLUMN diukur_pada SET NOT NULL;
