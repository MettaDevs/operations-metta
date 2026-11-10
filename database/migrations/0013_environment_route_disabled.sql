-- Alamat lingkungan yang dihapus lunak berhenti melayani tanpa barisnya dihapus: disabled_at terisi, dan runtime hanya
-- membaca alamat yang kosong kolom ini. Ditulis worker saat demo kedaluwarsa; memulihkan lingkungan mengosongkannya
-- lagi. Slug tenant tidak pernah dipakai ulang, jadi baris yang nonaktif tidak menghalangi tenant lain.

ALTER TABLE public.environment_routes ADD COLUMN disabled_at timestamp with time zone;
