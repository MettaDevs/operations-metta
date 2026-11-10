-- Role dan akses staf pindah dari CoreERP.
--
-- Menghapus role di CoreERP menghapus barisnya secara fisik, beserta penugasan dan susunan role-nya. Di repo ini
-- tidak ada baris yang dihapus fisik, jadi role mendapat deleted_at. Role yang dihapus juga dinonaktifkan, sehingga
-- Workspace berhenti memberi haknya tanpa perubahan apa pun di sana, dan penugasannya ditutup lewat valid_until.
-- Nama role boleh dipakai lagi setelah role lamanya dihapus: indeks unik nama menjadi parsial.

ALTER TABLE public.roles ADD COLUMN deleted_at timestamp(0) without time zone;
ALTER TABLE public.roles DROP CONSTRAINT roles_tenant_id_name_unique;
CREATE UNIQUE INDEX roles_tenant_id_name_unique
    ON public.roles USING btree (tenant_id, name) WHERE (deleted_at IS NULL);
