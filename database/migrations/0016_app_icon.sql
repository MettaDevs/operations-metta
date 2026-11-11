-- Ikon aplikasi di katalog aplikasi Shell (keputusan pemilik produk, 11 November 2026). Diisi module lewat
-- migration-nya sendiri, seperti nama dan menunya, supaya Core tidak menulis nama module mana pun. Isinya nama ikon
-- lucide dalam ejaan resminya (`heart-pulse`). Shell hanya mengenal daftar ikon yang ia bawa
-- (src/platform/shell/navigation-icons.ts); nama yang tidak dikenal, atau kolom yang kosong, memakai ikon bawaan.
--
-- Kolom di `apps`, bukan field di `apps.navigation`: navigation berisi larik grup menu, jadi ikon aplikasi tidak punya
-- tempat di sana tanpa mengubah bentuknya. Ikon grup menu tetap di dalam navigation, di setiap grup (`icon`).
ALTER TABLE public.apps ADD COLUMN icon character varying(64);
