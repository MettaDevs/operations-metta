-- Kode ICD-9-CM pada tindakan, untuk SATUSEHAT: Procedure.code dengan system http://hl7.org/fhir/sid/icd-9-cm.
-- Master Jasa sistem lama (SIMmListJasa, di sini sim_m_tindakan) tidak punya kolom ICD. Kuta 1 hanya punya ICD tindakan
-- per pemeriksaan (SIMtrRM.ICDTindakan dan SIMtrRMTindakan.ICDTindakan), dan kedua tabel itu tanpa baris, jadi kolom
-- ini tambahan untuk SATUSEHAT.
--
-- Boleh kosong: sim_m_tindakan adalah master jasa bertarif, dan tidak setiap jasanya prosedur klinis yang punya kode
-- ICD-9-CM.

ALTER TABLE public.sim_m_tindakan ADD COLUMN kode_icd9cm character varying(10);

COMMENT ON COLUMN public.sim_m_tindakan.kode_icd9cm IS
    'Kode ICD-9-CM volume 3 (SATUSEHAT Procedure.code, system http://hl7.org/fhir/sid/icd-9-cm), misalnya 89.7 atau '
    '96.04; boleh kosong.';
