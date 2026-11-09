# ButtonGroup

Deretan tombol yang menempel menjadi satu kesatuan, misalnya tombol utama bersama tombol pilihan turunannya.

- Anak menempel tanpa jarak: radius hanya di ujung luar, border di sambungan dihapus. Orientasi horizontal atau vertikal. Kelompok di dalam kelompok berjarak `space-2`.
- Pemisah: garis 1px `input` setinggi kelompok.
- Teks penanda di dalam kelompok: latar `muted`, border, `radius-md`, padding horizontal `space-4`, 14px weight 500, `shadow-xs`.
- Tombol yang difokuskan dinaikkan ke atas tetangganya supaya cincin fokus tidak terpotong.
- Dipakai di satu layar. Perintah record tetap di bar perintah, bukan di ButtonGroup.
