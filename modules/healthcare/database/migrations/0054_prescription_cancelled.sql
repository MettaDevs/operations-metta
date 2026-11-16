-- E-Resep menampilkan resep yang dibatalkan farmasi karena tidak diambil pasien (SIMtrResep.Batal sistem lama). Module
-- farmasi menerbitkan pharmacy.prescription.cancelled.v1 dengan waktu dan alasannya; module ini mengisi status
-- 'dibatalkan' yang sudah ada sejak 0025, lalu menyalin waktu dan alasan itu ke kolom ini. CPPT sudah menyaring resep
-- yang dibatalkan, seperti rekam medis sistem lama yang menyaring Batal = 0.

ALTER TABLE public.sim_tr_resep
    ADD COLUMN dibatalkan_pada timestamp(0) without time zone,
    ADD COLUMN alasan_batal character varying(200);
