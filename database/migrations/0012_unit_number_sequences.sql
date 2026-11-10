-- Number sequence bawaan per operating unit, dan reference yang nomornya unik per nilai scope.
--
-- 1. default_per_operating_unit: reference yang menyalakannya mendapat satu sequence berscope operating unit setiap
--    kali unit dibuat, dengan setelan dari default_settings-nya (NumberSequences.createUnitDefaults). Module
--    mendaftarkannya lewat baris reference di migration-nya sendiri, jadi Core tidak menulis nama module mana pun.
--    Unit yang sudah ada diisi oleh migration module pemilik reference.
-- 2. numbers_unique_per_scope: indeks dokumen reference ini memuat nilai scope-nya (misalnya nomor master yang unik
--    per unit pemilik nomornya). Penolakan format kembar di NumberSequences hanya menjaga reference yang indeks
--    dokumennya sebatas perusahaan; untuk reference ini format yang sama di unit lain tidak membuat nomor kembar.
--
-- Keduanya kolom baru bernilai bawaan false, jadi kode rilis sebelumnya tetap berjalan di atas skema ini.

ALTER TABLE public.app_number_sequence_references
    ADD COLUMN default_per_operating_unit boolean DEFAULT false NOT NULL,
    ADD COLUMN numbers_unique_per_scope boolean DEFAULT false NOT NULL;
