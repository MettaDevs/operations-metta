-- Tabel healthcare yang didaftarkan ke log perubahan tidak lagi dicatat bawaan, pasangan migration Core
-- 0066_change_log_always_logged. Trigger log perubahan tidak membaca baris tanpa tenant lagi; baris itu tinggal daftar
-- tabel beserta captionnya, dan di sini isinya disamakan dengan kenyataan. Migration module berjalan sesudah Core, jadi
-- di database baru baris yang didaftarkan migration module sebelum ini baru ada sesudah migration Core itu berjalan.
UPDATE public.change_log_setup_tables
   SET log_insertion = 'none', log_modification = 'none', log_deletion = 'none',
       updated_at = now() AT TIME ZONE 'utc'
 WHERE tenant_id IS NULL AND table_name LIKE 'sim\_%'
   AND (log_insertion, log_modification, log_deletion) <> ('none', 'none', 'none');
