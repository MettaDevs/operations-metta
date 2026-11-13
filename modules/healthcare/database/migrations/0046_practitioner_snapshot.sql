-- Nakes pelaku dicatat saat kejadiannya, di samping pengguna yang sudah dicatat. SATUSEHAT menunjuk Practitioner, bukan
-- akun: Observation.performer untuk tanda vital, AllergyIntolerance.recorder untuk alergi, dan
-- MedicationDispense.performer untuk penyerahan obat. Sebelumnya ketiganya hanya dicatat sebagai pengguna (diukur_oleh
-- 0039, dicatat_oleh 0044, apoteker dan asisten di bill_farmasi farmasi), dan nakes-nya dicari lewat sim_m_nakes.user_id
-- saat dikirim. Tautan akun ke nakes bisa diubah sesudahnya, sehingga catatan lama diam-diam menunjuk nakes lain dan tidak
-- bisa direkonstruksi. Kolom pengguna tetap ada sebagai aktor audit.
--
-- Nakes milik pengguna adalah satu-satunya nakes aktif yang tertaut ke akun itu (sim_nakes_milik_pengguna). Akun tanpa
-- tautan, atau yang tertaut ke lebih dari satu nakes aktif, tidak punya nakes yang pasti, jadi kolomnya kosong. Fungsi
-- yang sama dipakai kode saat kejadian dan pengisian awal di bawah.
--
-- Penyerahan obat milik module farmasi, dan module itu tidak membaca sim_m_nakes. Nakes apoteker dan asisten dicatat di
-- resep module ini (sim_tr_resep) saat pharmacy.prescription.dispensed.v1 diterima, di transaksi yang sama dengan
-- Serahkan, dari pengguna apoteker dan asisten di event itu. Apotek yang berdiri tanpa module ini tidak punya data nakes
-- sama sekali, jadi tidak ada yang bisa dicatat di sana.
--
-- Pengisian awal memakai tautan akun ke nakes hari ini, bukan saat kejadian, karena tautan saat itu tidak tersimpan.
-- Nakes penyerahan diisi dari event dispensed yang tercatat di outbox_events.
--
-- 1. Fungsi nakes milik pengguna.
-- 2. Kolom nakes pelaku.
-- 3. Pengisian awal.

-- 1. Nakes milik pengguna ------------------------------------------------------------------------------------------

CREATE FUNCTION public.sim_nakes_milik_pengguna(p_tenant uuid, p_user uuid) RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(n.id))[1] END
    FROM public.sim_m_nakes n
    WHERE n.tenant_id = p_tenant AND n.user_id = p_user AND n.aktif AND n.deleted_at IS NULL
$$;

-- 2. Kolom ---------------------------------------------------------------------------------------------------------

ALTER TABLE public.sim_tr_pemeriksaan_fisik
    ADD COLUMN diukur_oleh_nakes_id uuid,
    ADD CONSTRAINT sim_tr_pemeriksaan_fisik_diukur_oleh_nakes_foreign
        FOREIGN KEY (tenant_id, diukur_oleh_nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public.sim_m_pasien_alergi
    ADD COLUMN dicatat_oleh_nakes_id uuid,
    ADD CONSTRAINT sim_m_pasien_alergi_dicatat_oleh_nakes_foreign
        FOREIGN KEY (tenant_id, dicatat_oleh_nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT;

-- apoteker_nakes_id: apoteker yang menyerahkan (BILLFarmasi.Pharmacy_id sistem lama). asisten_apoteker_nakes_id: asisten
-- yang menyiapkan (Pharmacy_assistant_id).
ALTER TABLE public.sim_tr_resep
    ADD COLUMN apoteker_nakes_id uuid,
    ADD COLUMN asisten_apoteker_nakes_id uuid,
    ADD CONSTRAINT sim_tr_resep_apoteker_nakes_foreign
        FOREIGN KEY (tenant_id, apoteker_nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT sim_tr_resep_asisten_apoteker_nakes_foreign
        FOREIGN KEY (tenant_id, asisten_apoteker_nakes_id) REFERENCES public.sim_m_nakes(tenant_id, id)
        ON DELETE RESTRICT;

-- 3. Pengisian awal ------------------------------------------------------------------------------------------------

UPDATE public.sim_tr_pemeriksaan_fisik
SET diukur_oleh_nakes_id = public.sim_nakes_milik_pengguna(tenant_id, diukur_oleh)
WHERE diukur_oleh IS NOT NULL;

UPDATE public.sim_m_pasien_alergi
SET dicatat_oleh_nakes_id = public.sim_nakes_milik_pengguna(tenant_id, dicatat_oleh)
WHERE dicatat_oleh IS NOT NULL;

UPDATE public.sim_tr_resep r
SET apoteker_nakes_id = public.sim_nakes_milik_pengguna(r.tenant_id, (e.payload -> 'pharmacist' ->> 'id')::uuid),
    asisten_apoteker_nakes_id = public.sim_nakes_milik_pengguna(r.tenant_id, (e.payload -> 'assistant' ->> 'id')::uuid)
FROM public.outbox_events e
WHERE e.tenant_id = r.tenant_id
  AND e.type = 'pharmacy.prescription.dispensed.v1'
  AND e.payload ->> 'prescription_id' = r.id::text
  AND r.diserahkan_pada IS NOT NULL;
