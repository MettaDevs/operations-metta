-- Dosis baris resep dari event healthcare.prescription.issued.v1 (frequency_per_day, dose, dose_unit, route,
-- duration_days), supaya petugas farmasi melihat dosis yang ditulis dokter di samping signa. Event sebelum field itu ada
-- tidak membawanya, jadi semua kolom boleh kosong.
--
-- Satuan dosis adalah satuan Core legal entity resep, jadi disimpan sebagai id. Rute disalin kode dan namanya, karena
-- master rute milik module layanan kesehatan dan module ini tidak membaca tabelnya. Panjang kolom rute mengikuti master
-- itu (sim_m_rute_obat).

ALTER TABLE public.far_tr_resep_detail
    ADD COLUMN frekuensi smallint,
    ADD COLUMN dosis numeric(18,4),
    ADD COLUMN dosis_satuan_id uuid,
    ADD COLUMN rute_kode character varying(40),
    ADD COLUMN rute_nama character varying(150),
    ADD COLUMN lama_hari smallint,
    ADD CONSTRAINT far_tr_resep_detail_dosis_satuan_foreign
        FOREIGN KEY (tenant_id, legal_entity_id, dosis_satuan_id)
        REFERENCES public.gd_m_satuan(tenant_id, legal_entity_id, id) ON DELETE RESTRICT;
