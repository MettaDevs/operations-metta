-- Jenis racikan dan bentuk sediaan hasil racikan pada kepala racikan E-Resep, dalam bentuk yang dibutuhkan Medication
-- SATUSEHAT untuk obat racikan: extension MedicationType (wajib, 1..1) membedakan SD (racikan d.t.d.) dari EP (racikan
-- dibagi rata), dan Medication.form mencatat bentuk sediaan hasilnya. Nilainya diisi dokter di sumbernya saat menulis
-- resep. Keputusan pemilik produk, 14 November 2026.
--
-- Sistem lama klinik (SIMtrResep.Puyer, QtyPuyer, SatuanPuyer) mencatat satuan hasil racikan, dan daftar racikannya
-- (SIMmRacikan) hanya Puyer, Kapsul, dan Salep, jadi bentuk hasil racikan memang dicatat di sana. E-Resep puskesmas
-- (FormEresep.php) hanya menulis Satuan 'RACIKAN' pada kepala racikan. Penanda d.t.d. tidak ada di sistem lama mana pun;
-- ia ditambahkan karena SATUSEHAT membedakan SD dari EP.
--
-- dtd: true untuk racikan d.t.d. (dokter menakar per bungkus), false untuk racikan dibagi rata (dokter menakar seluruh
-- campuran, lalu dibagi sama banyak ke semua bungkus). Makna jumlah komponen tidak berubah untuk keduanya: jumlah x
-- konversi tetap total yang diambil dari stok untuk seluruh racikan, seperti Qty komponen sistem lama yang kebanyakan
-- lebih kecil dari jumlah bungkusnya. Takaran per bungkus adalah jumlah x konversi / jumlah_permintaan.
--
-- Bentuk sediaan memakai daftar pendek klinis sim_m_bentuk_sediaan yang sudah ada (0025), yang juga dipakai kartu obat.
--
-- Wajibnya kedua nilai pada kepala racikan dijaga service saat resep disimpan, bukan oleh database, karena draf dan resep
-- yang sudah dikirim sebelum migration ini tidak membawanya. Database hanya menjaga bahwa obat tunggal dan komponen
-- racikan tidak membawanya.

ALTER TABLE public.sim_tr_resep_detail
    ADD COLUMN dtd boolean,
    ADD COLUMN bentuk_sediaan_id uuid,
    ADD CONSTRAINT sim_tr_resep_detail_jenis_racikan_check CHECK (
        obat_id IS NULL OR (dtd IS NULL AND bentuk_sediaan_id IS NULL)),
    ADD CONSTRAINT sim_tr_resep_detail_bentuk_sediaan_foreign
        FOREIGN KEY (tenant_id, bentuk_sediaan_id) REFERENCES public.sim_m_bentuk_sediaan(tenant_id, id)
        ON DELETE RESTRICT;
CREATE INDEX sim_tr_resep_detail_bentuk_sediaan_index
    ON public.sim_tr_resep_detail USING btree (tenant_id, bentuk_sediaan_id) WHERE (deleted_at IS NULL);
