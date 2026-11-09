# InputOTP

Kotak kode sekali pakai, satu kotak per digit, untuk verifikasi dua langkah.

- Kotak 36 × 36px yang saling menempel; `radius-md` hanya di ujung kelompok; border `input`, `shadow-xs`, 14px. Tema gelap: latar `input` 30%.
- Kotak aktif: border `ring` dan cincin 3px; kursor berkedip dengan siklus 1 detik.
- Kelompok bisa dipisah tanda pemisah.
- Menempelkan kode mengisi semua kotak; Backspace mundur satu kotak. Tidak valid: border `destructive`.
- Dipakai di 3 layar keamanan akun.
