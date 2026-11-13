-- Kode SATUSEHAT satuan, untuk Quantity yang dikirim SATUSEHAT: dosis dan jumlah obat (MedicationRequest,
-- MedicationDispense) dan kekuatan obat. Satuan bentuk obat memakai HL7 v3-orderableDrugForm (TAB, CAP), satuan ukur
-- memakai UCUM (mg, mL), jadi sistem kodenya ikut disimpan, seperti Quantity.system di FHIR.
--
-- Opsional dan dimulai kosong; diisi kemudian per satuan legal entity. Sistem lama (mSatuan) tidak punya kolom kode
-- standar. Belum ada layar yang mengisinya.

ALTER TABLE public.gd_m_satuan
    ADD COLUMN kode_satusehat character varying(40),
    ADD COLUMN sistem_kode_satusehat character varying(100),
    ADD CONSTRAINT gd_m_satuan_kode_satusehat_check CHECK (
        (kode_satusehat IS NULL) = (sistem_kode_satusehat IS NULL)),
    ADD CONSTRAINT gd_m_satuan_sistem_kode_satusehat_check CHECK (
        sistem_kode_satusehat IN ('http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm',
                                  'http://unitsofmeasure.org'));
COMMENT ON COLUMN public.gd_m_satuan.kode_satusehat IS
    'Kode satuan untuk SATUSEHAT dalam sistem_kode_satusehat, misalnya TAB atau mg.';
COMMENT ON COLUMN public.gd_m_satuan.sistem_kode_satusehat IS
    'HL7 v3-orderableDrugForm untuk satuan bentuk obat, UCUM untuk satuan ukur.';
