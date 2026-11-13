-- Kolom kode SATUSEHAT di master layanan kesehatan, supaya kode resource yang dikirim kelak dipetakan sekali per baris
-- master, bukan per transaksi. Semua opsional dan dimulai kosong; diisi kemudian oleh tenant atau pemetaan berbantuan.
-- Sistem lama tidak punya kolom kode standar di master mana pun di bawah ini. Belum ada layar yang mengisinya.
--
-- Katalog nasional tidak ikut dibawa sebagai data acuan: daftar bentuk sediaan Kemkes besar dan bisa bertambah, dan
-- daftar HL7 di bawah dipetakan dari pilihan tenant, bukan dipilih langsung oleh pengguna.

-- Bentuk sediaan obat: Medication.form, CodeSystem Kemkes medication-form
-- (http://terminology.kemkes.go.id/CodeSystem/medication-form), misalnya BS066 Tablet dan BS019 Kapsul.
ALTER TABLE public.sim_m_bentuk_sediaan ADD COLUMN kode_kemkes character varying(20);
COMMENT ON COLUMN public.sim_m_bentuk_sediaan.kode_kemkes IS
    'Kode medication-form Kemkes untuk Medication.form SATUSEHAT, misalnya BS066.';

-- Status pasien: Encounter.hospitalization.dischargeDisposition, HL7 discharge-disposition
-- (http://terminology.hl7.org/CodeSystem/discharge-disposition), misalnya home, other-hcf, exp.
ALTER TABLE public.sim_m_status_pulang ADD COLUMN kode_satusehat character varying(40);
COMMENT ON COLUMN public.sim_m_status_pulang.kode_satusehat IS
    'Kode HL7 discharge-disposition untuk Encounter.hospitalization.dischargeDisposition SATUSEHAT.';

-- Aturan pakai: MedicationRequest.dosageInstruction.timing.repeat.when, HL7 v3-TimingEvent
-- (http://terminology.hl7.org/CodeSystem/v3-TimingEvent), misalnya AC sebelum makan, PC sesudah makan, C saat makan.
-- Pilihan yang bukan waktu pemakaian (Jika Diperlukan, Pemakaian Luar) dibiarkan kosong.
ALTER TABLE public.sim_m_aturan_pakai ADD COLUMN kode_satusehat character varying(40);
COMMENT ON COLUMN public.sim_m_aturan_pakai.kode_satusehat IS
    'Kode HL7 v3-TimingEvent untuk timing.repeat.when SATUSEHAT; kosong bila aturan pakai bukan waktu pemakaian.';

-- Tipe pasien: Coverage.type, HL7 v3-ActCode (http://terminology.hl7.org/CodeSystem/v3-ActCode), misalnya PUBLICPOL
-- untuk BPJS Kesehatan.
ALTER TABLE public.sim_m_tipe_pasien ADD COLUMN kode_satusehat character varying(40);
COMMENT ON COLUMN public.sim_m_tipe_pasien.kode_satusehat IS
    'Kode HL7 v3-ActCode untuk Coverage.type SATUSEHAT, misalnya PUBLICPOL.';
