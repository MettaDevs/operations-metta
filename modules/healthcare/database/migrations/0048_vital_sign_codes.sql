-- Kode LOINC dan satuan UCUM tanda vital untuk SATUSEHAT Observation, dicatat sebagai komentar kolom. Keduanya standar
-- nasional yang tetap, jadi tidak perlu tabel (setiap tabel module membawa tenant_id) dan tidak perlu konstanta
-- TypeScript (belum ada kode yang membacanya). Pemetaannya dari koleksi Postman SATUSEHAT P1, folder "04. Hasil
-- Pemeriksaan Fisik". Saturasi dan lingkar perut tidak ada di koleksi itu; kodenya inferensi dari profil vital signs
-- HL7 dan ditandai begitu di komentarnya.
--
-- Satuan setiap kolom sama dengan yang ditulis di layar (Sistole mm/Hg, Suhu °C, Detak nadi x / menit, dan seterusnya).
-- Detak nadi memakai {beats}/min seperti P1; koleksi P0 memakai /min. Kesadaran tidak bersatuan, karena nilainya
-- jawaban berkode (SNOMED CT menyusul).
--
-- Bentuk setiap komentar: "SATUSEHAT Observation: LOINC <kode> <nama>; satuan UCUM <satuan>", atau "; tanpa satuan"
-- di bagian keduanya, lalu catatan bila ada.

COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.kesadaran IS
    'SATUSEHAT Observation: LOINC 67775-7 Level of consciousness; tanpa satuan, nilainya jawaban berkode';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.sistole IS
    'SATUSEHAT Observation: LOINC 8480-6 Systolic blood pressure; satuan UCUM mm[Hg]';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.diastole IS
    'SATUSEHAT Observation: LOINC 8462-4 Diastolic blood pressure; satuan UCUM mm[Hg]';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.tinggi_badan IS
    'SATUSEHAT Observation: LOINC 8302-2 Body height; satuan UCUM cm';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.berat_badan IS
    'SATUSEHAT Observation: LOINC 29463-7 Body weight; satuan UCUM kg';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.lingkar_perut IS
    'SATUSEHAT Observation: LOINC 8280-0 Waist Circumference at umbilicus by Tape measure; satuan UCUM cm; '
    'inferensi dari profil vital signs HL7';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.detak_nadi IS
    'SATUSEHAT Observation: LOINC 8867-4 Heart rate; satuan UCUM {beats}/min';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.nafas IS
    'SATUSEHAT Observation: LOINC 9279-1 Respiratory rate; satuan UCUM /min';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.saturasi IS
    'SATUSEHAT Observation: LOINC 59408-5 Oxygen saturation in Arterial blood by Pulse oximetry; satuan UCUM %; '
    'inferensi dari profil vital signs HL7';
COMMENT ON COLUMN public.sim_tr_pemeriksaan_fisik.suhu IS
    'SATUSEHAT Observation: LOINC 8310-5 Body temperature; satuan UCUM Cel';

-- Tinggi dan berat badan yang dicatat saat pendaftaran, nilai awal periksa fisik.
COMMENT ON COLUMN public.sim_tr_registrasi.tinggi_badan IS
    'SATUSEHAT Observation: LOINC 8302-2 Body height; satuan UCUM cm';
COMMENT ON COLUMN public.sim_tr_registrasi.berat_badan IS
    'SATUSEHAT Observation: LOINC 29463-7 Body weight; satuan UCUM kg';
