-- Awalan tabel module healthcare mengikuti pola legacy sistem lama (database "kuta 1"): sim_ untuk module ini, lalu
-- m_ untuk master dan tr_ untuk transaksi. Keputusan pemilik produk, 10 November 2026: "untuk nama tabel, di kesehatan
-- ... ganti depannya jadi sim_m untuk master, sim_tr* untuk transaksi, sama seperti kuta 1, dan pola legacy". Module
-- aset memakai pola yang sama (aset_m_, aset_tr_).
--
-- Semua tabel module ini master atau detail master, jadi semuanya menjadi sim_m_. Nama index, constraint, dan function
-- yang membawa kes_ ikut diganti. Trigger tidak membawa awalan, jadi tetap.
--
-- Menyimpang dari aturan N-1 dengan sengaja: mengganti nama tabel membuat kode rilis sebelumnya, yang masih menulis
-- kes_, tidak dapat berjalan di atas skema ini. Diterima karena belum ada pelanggan dan belum ada rilis yang memakai
-- tabel module ini di luar laptop dan lingkungan uji; rilis yang membawa migration ini membawa kodenya sekaligus.
-- Pola expand/contract (view kes_ sementara) tidak dibuat, karena tidak ada pemakai yang perlu dijembatani.

-- Tabel ----------------------------------------------------------------------------------------------------------------

ALTER TABLE public.kes_kebijakan_berbagi_perusahaan RENAME TO sim_m_kebijakan_berbagi_perusahaan;
ALTER TABLE public.kes_tipe_pasien_perilaku RENAME TO sim_m_tipe_pasien_perilaku;
ALTER TABLE public.kes_kebijakan_berbagi RENAME TO sim_m_kebijakan_berbagi;
ALTER TABLE public.kes_pasien_cara_bayar RENAME TO sim_m_pasien_cara_bayar;
ALTER TABLE public.kes_tipe_pasien RENAME TO sim_m_tipe_pasien;
ALTER TABLE public.kes_penjamin RENAME TO sim_m_penjamin;
ALTER TABLE public.kes_pasien RENAME TO sim_m_pasien;

-- Constraint (index milik primary key dan unique constraint ikut berganti nama) ---------------------------------------

ALTER TABLE public.sim_m_kebijakan_berbagi_perusahaan RENAME CONSTRAINT kes_kebijakan_berbagi_perusahaan_kebijakan_foreign TO sim_m_kebijakan_berbagi_perusahaan_kebijakan_foreign;
ALTER TABLE public.sim_m_kebijakan_berbagi_perusahaan RENAME CONSTRAINT kes_kebijakan_berbagi_perusahaan_pkey TO sim_m_kebijakan_berbagi_perusahaan_pkey;
ALTER TABLE public.sim_m_kebijakan_berbagi RENAME CONSTRAINT kes_kebijakan_berbagi_pkey TO sim_m_kebijakan_berbagi_pkey;
ALTER TABLE public.sim_m_kebijakan_berbagi RENAME CONSTRAINT kes_kebijakan_berbagi_tenant_id_id_unique TO sim_m_kebijakan_berbagi_tenant_id_id_unique;
ALTER TABLE public.sim_m_pasien_cara_bayar RENAME CONSTRAINT kes_pasien_cara_bayar_pasien_foreign TO sim_m_pasien_cara_bayar_pasien_foreign;
ALTER TABLE public.sim_m_pasien_cara_bayar RENAME CONSTRAINT kes_pasien_cara_bayar_penjamin_foreign TO sim_m_pasien_cara_bayar_penjamin_foreign;
ALTER TABLE public.sim_m_pasien_cara_bayar RENAME CONSTRAINT kes_pasien_cara_bayar_pkey TO sim_m_pasien_cara_bayar_pkey;
ALTER TABLE public.sim_m_pasien_cara_bayar RENAME CONSTRAINT kes_pasien_cara_bayar_tipe_pasien_foreign TO sim_m_pasien_cara_bayar_tipe_pasien_foreign;
ALTER TABLE public.sim_m_pasien RENAME CONSTRAINT kes_pasien_creation_key_unique TO sim_m_pasien_creation_key_unique;
ALTER TABLE public.sim_m_pasien RENAME CONSTRAINT kes_pasien_pkey TO sim_m_pasien_pkey;
ALTER TABLE public.sim_m_pasien RENAME CONSTRAINT kes_pasien_tenant_id_id_unique TO sim_m_pasien_tenant_id_id_unique;
ALTER TABLE public.sim_m_penjamin RENAME CONSTRAINT kes_penjamin_pkey TO sim_m_penjamin_pkey;
ALTER TABLE public.sim_m_penjamin RENAME CONSTRAINT kes_penjamin_tenant_id_id_unique TO sim_m_penjamin_tenant_id_id_unique;
ALTER TABLE public.sim_m_penjamin RENAME CONSTRAINT kes_penjamin_tipe_pasien_foreign TO sim_m_penjamin_tipe_pasien_foreign;
ALTER TABLE public.sim_m_tipe_pasien_perilaku RENAME CONSTRAINT kes_tipe_pasien_perilaku_pkey TO sim_m_tipe_pasien_perilaku_pkey;
ALTER TABLE public.sim_m_tipe_pasien_perilaku RENAME CONSTRAINT kes_tipe_pasien_perilaku_tipe_pasien_foreign TO sim_m_tipe_pasien_perilaku_tipe_pasien_foreign;
ALTER TABLE public.sim_m_tipe_pasien RENAME CONSTRAINT kes_tipe_pasien_pkey TO sim_m_tipe_pasien_pkey;
ALTER TABLE public.sim_m_tipe_pasien RENAME CONSTRAINT kes_tipe_pasien_tenant_id_id_unique TO sim_m_tipe_pasien_tenant_id_id_unique;

-- Index -------------------------------------------------------------------------------------------------------------

ALTER INDEX public.kes_kebijakan_berbagi_nama_unique RENAME TO sim_m_kebijakan_berbagi_nama_unique;
ALTER INDEX public.kes_kebijakan_berbagi_perusahaan_legal_entity_index RENAME TO sim_m_kebijakan_berbagi_perusahaan_legal_entity_index;
ALTER INDEX public.kes_kebijakan_berbagi_perusahaan_unique RENAME TO sim_m_kebijakan_berbagi_perusahaan_unique;
ALTER INDEX public.kes_pasien_cara_bayar_nomor_kartu_index RENAME TO sim_m_pasien_cara_bayar_nomor_kartu_index;
ALTER INDEX public.kes_pasien_cara_bayar_pasien_index RENAME TO sim_m_pasien_cara_bayar_pasien_index;
ALTER INDEX public.kes_pasien_cara_bayar_utama_unique RENAME TO sim_m_pasien_cara_bayar_utama_unique;
ALTER INDEX public.kes_pasien_legal_entity_index RENAME TO sim_m_pasien_legal_entity_index;
ALTER INDEX public.kes_pasien_nrm_legal_entity_unique RENAME TO sim_m_pasien_nrm_legal_entity_unique;
ALTER INDEX public.kes_pasien_nrm_unique RENAME TO sim_m_pasien_nrm_unique;
ALTER INDEX public.kes_pasien_org_unit_index RENAME TO sim_m_pasien_org_unit_index;
ALTER INDEX public.kes_pasien_party_legal_entity_unique RENAME TO sim_m_pasien_party_legal_entity_unique;
ALTER INDEX public.kes_pasien_party_unit_unique RENAME TO sim_m_pasien_party_unit_unique;
ALTER INDEX public.kes_penjamin_bawaan_unique RENAME TO sim_m_penjamin_bawaan_unique;
ALTER INDEX public.kes_penjamin_party_tipe_unique RENAME TO sim_m_penjamin_party_tipe_unique;
ALTER INDEX public.kes_tipe_pasien_bawaan_unique RENAME TO sim_m_tipe_pasien_bawaan_unique;
ALTER INDEX public.kes_tipe_pasien_kode_unique RENAME TO sim_m_tipe_pasien_kode_unique;
ALTER INDEX public.kes_tipe_pasien_perilaku_unique RENAME TO sim_m_tipe_pasien_perilaku_unique;

-- Function trigger kepemilikan pasien. Isinya tidak menyebut nama tabel, jadi cukup diganti namanya.
ALTER FUNCTION public.kes_pasien_pemilik_tetap() RENAME TO sim_m_pasien_pemilik_tetap;

-- Setup change log mencatat tabel lewat namanya.
UPDATE public.change_log_setup_tables
SET table_name = 'sim_m_' || substr(table_name, 5), updated_at = now() AT TIME ZONE 'utc'
WHERE table_name IN ('kes_kebijakan_berbagi', 'kes_kebijakan_berbagi_perusahaan');
