-- Penerima obat saat Serahkan. Keputusan pemilik produk: setiap nilai yang kelak dikirim ke SATUSEHAT dicatat di tabel
-- sendiri saat kejadiannya, dan MedicationDispense dibaca dari realisasi obat di farmasi (bill_farmasi dan
-- bill_farmasi_detail).
--
-- Sistem lama tidak mencatat siapa yang menerima obat: BILLFarmasi tidak punya kolom untuk itu. Kolom ini ditambahkan
-- untuk SATUSEHAT dengan gaya sistem lama:
-- - diterima_pasien: true bila pasien sendiri yang menerima obat, false bila orang lain.
-- - nama_penerima: nama orang lain itu, terisi tepat bila diterima_pasien false.
-- Serahkan mewajibkan keduanya. Penyerahan sebelum migration ini tetap kosong, karena penerimanya memang tidak
-- diketahui dan tidak diisi tebakan.
--
-- Pemetaan ke MedicationDispense SATUSEHAT (FHIR R4):
-- - receiver: Patient resep bila diterima_pasien true, nama_penerima sebagai display bila false.
-- - whenPrepared dan whenHandedOver: disiapkan_pada dan diserahkan_pada (0002).
-- - performer: apoteker_user_id (Pharmacy_id sistem lama, terisi di semua penyerahan Kuta 1). Serahkan selalu
--   mengisinya: apoteker pilihan petugas, yang sudah tercatat, atau pengguna yang menyerahkan. Asisten
--   (asisten_user_id) dan penyerah (diserahkan_oleh_user_id) juga pengguna. Seperti pengukur tanda vital (healthcare
--   0039), nakes-nya didapat lewat sim_m_nakes.user_id, lalu party_id, lalu NIK di party_identifications. Module ini
--   tidak membaca sim_m_nakes, jadi pembaca SATUSEHAT di Core yang kelak menyambungkannya.
-- - substitution: selalu tidak diganti. BILLFarmasi sistem lama tidak mencatat penggantian obat, dan penyerahan di sini
--   tidak bisa mengganti obat: barang_id baris penyerahan selalu obat resep, karena isian penyerahan tidak punya field
--   barang. Karena itu tidak ada kolom penggantian.

ALTER TABLE public.bill_farmasi
    ADD COLUMN diterima_pasien boolean,
    ADD COLUMN nama_penerima character varying(150),
    ADD CONSTRAINT bill_farmasi_penerima_check
        CHECK ((nama_penerima IS NOT NULL) = (diterima_pasien IS FALSE));
