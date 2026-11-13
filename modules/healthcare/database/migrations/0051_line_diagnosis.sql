-- Diagnosa di balik setiap baris resep dan tindakan, untuk MedicationRequest.reasonReference dan
-- Procedure.reasonReference SATUSEHAT (keduanya menunjuk Condition, yaitu baris diagnosa pemeriksaan). Tanpa tautan ini,
-- pasien dengan beberapa diagnosa hanya bisa dikirim dengan diagnosa primer sebagai alasan setiap baris.
--
-- Sistem lama tidak menautkan baris resep atau tindakan ke diagnosa: SIMtrResepDetail, SIMtrResep, dan SIMtrRJTransaksi
-- tidak punya kolom ICD atau diagnosa, dan layar E-Resep serta Biaya Tindakan tidak menampilkannya. Diagnosa kunjungan
-- ada di tabelnya sendiri (SIMtrRJDiagnosaAwal). Tabel kirim INFOKES_RESEP dan INFOKES_TINDAKAN juga tanpa diagnosa.
-- Kolom ini tambahan untuk SATUSEHAT, boleh kosong, dan tidak tampil di layar.
--
-- Baris yang ditunjuk adalah salah satu diagnosa pemeriksaan yang sama; service yang menjaganya, karena baris resep
-- tidak membawa pemeriksaan_id. Komponen racikan tidak membawa diagnosa: alasannya ada di baris racikannya, seperti
-- dosis.

ALTER TABLE public.sim_tr_pemeriksaan_diagnosa
    ADD CONSTRAINT sim_tr_pemeriksaan_diagnosa_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE public.sim_tr_resep_detail
    ADD COLUMN diagnosa_id uuid,
    ADD CONSTRAINT sim_tr_resep_detail_diagnosa_foreign
        FOREIGN KEY (tenant_id, diagnosa_id) REFERENCES public.sim_tr_pemeriksaan_diagnosa(tenant_id, id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_resep_detail_diagnosa_check CHECK (
        diagnosa_id IS NULL OR obat_id IS NULL OR racikan_ke IS NULL);
CREATE INDEX sim_tr_resep_detail_diagnosa_index
    ON public.sim_tr_resep_detail USING btree (tenant_id, diagnosa_id) WHERE (diagnosa_id IS NOT NULL);

ALTER TABLE public.sim_tr_pemeriksaan_tindakan
    ADD COLUMN diagnosa_id uuid,
    ADD CONSTRAINT sim_tr_pemeriksaan_tindakan_diagnosa_foreign
        FOREIGN KEY (tenant_id, diagnosa_id) REFERENCES public.sim_tr_pemeriksaan_diagnosa(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_tr_pemeriksaan_tindakan_diagnosa_index
    ON public.sim_tr_pemeriksaan_tindakan USING btree (tenant_id, diagnosa_id) WHERE (diagnosa_id IS NOT NULL);
