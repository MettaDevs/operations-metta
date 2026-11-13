-- Jenis racikan dan bentuk sediaan hasil racikan dari event healthcare.prescription.issued.v1 (dtd, dosage_form), supaya
-- petugas farmasi melihat racikan d.t.d. atau dibagi rata dan bentuk hasilnya di samping baris racikan. Keduanya hanya
-- ada pada kepala racikan. Event sebelum field itu ada tidak membawanya, jadi semua kolom boleh kosong.
--
-- Bentuk sediaan disalin kode dan namanya, karena daftarnya milik module layanan kesehatan dan module ini tidak membaca
-- tabelnya. Panjang kolomnya mengikuti daftar itu (sim_m_bentuk_sediaan).

ALTER TABLE public.far_tr_resep_detail
    ADD COLUMN dtd boolean,
    ADD COLUMN bentuk_sediaan_kode character varying(40),
    ADD COLUMN bentuk_sediaan_nama character varying(150);
