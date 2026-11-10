-- Number sequence bawaan per legal entity, pasangan default_per_operating_unit dari 0012.
--
-- Reference yang menyalakan default_per_legal_entity mendapat satu sequence berscope legal entity setiap kali legal
-- entity dibuat, dengan setelan dari default_settings-nya (NumberSequences.createLegalEntityDefaults). Sama dengan
-- sequence per unit, ia hanya dibuat untuk tenant yang berhak memakai app pemilik reference: Core selalu, module bila
-- entitlement-nya aktif. Module mendaftarkannya lewat baris reference di migration-nya sendiri, jadi Core tidak menulis
-- nama module mana pun.
--
-- Kolom baru bernilai bawaan false, jadi kode rilis sebelumnya tetap berjalan di atas skema ini.

ALTER TABLE public.app_number_sequence_references
    ADD COLUMN default_per_legal_entity boolean DEFAULT false NOT NULL;
