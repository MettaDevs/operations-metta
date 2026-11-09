# InlineLookup

Field untuk memilih record lain dengan mencari langsung di field; hasilnya tampil sebagai tabel yang dimuat bertahap saat digulir.

## Kapan dipakai

- Setiap referensi ke record (kategori, vendor, unit organisasi, akun). Select biasa hanya untuk enum pendek.
- Pilihan banyak memakai varian multi-lookup; daftar acuan terbatas yang kedua sisinya perlu terlihat memakai TransferList.

## Alur memilih

1. Field menampilkan label record yang sudah dipilih. Label itu diputuskan per resource: nama atau deskripsi yang paling mudah dikenali; kode hanya bila kode memang identitas kerja (misalnya nomor akun). Bila nama ambigu, gabungkan dengan pembeda yang relevan.
2. Membuka field langsung meminta batch pertama, tanpa jeda.
3. Mengetik mengubah **query sementara**, terpisah dari nilai terpilih. Pencarian berjalan setelah jeda 250ms; permintaan lama dibatalkan.
4. Popup menampilkan tabel dengan kolom, urutan, dan resize kolom yang sama seperti DataTable. Header tetap terlihat; batch berikutnya dimuat saat digulir. Tidak ada nomor halaman.
5. Panah dan Enter memilih baris tersorot; klik baris juga memilih.
6. Menghapus teks, membatalkan pencarian, atau menutup popup **tidak** mengosongkan pilihan; label record terpilih dipulihkan. Tidak ada tombol X atau aksi kosongkan. Nilai awal boleh kosong, tetapi pilihan hanya diganti dengan record lain secara eksplisit.

## Aksi di popup

Aksi duduk di kaki popup, di atas garis `border`: **Baru** (ActionButton) di kiri; **Detail** dan **Daftar lengkap** (tombol ghost kecil, tanpa ikon) di kanan.

| Aksi | Muncul bila | Perilaku |
| --- | --- | --- |
| **Detail** | Resource punya detail dan pengguna boleh membacanya | Membuka record sasaran baca saja. Sasaran = baris tersorot yang sah, lalu nilai terpilih. Tanpa sasaran tampil nonaktif. Hak melihat tidak memberi hak mengubah. |
| **Daftar lengkap** | Pemilih lengkap tersedia dan pengguna boleh memilih | Membuka pemilih berkolom lebih banyak dengan kandidat sementara; **Pilih** mengisi field, **Batal**/Escape mempertahankan nilai lama. "Lengkap" berarti semua yang boleh dipilih, bukan seluruh database. |
| **Baru** | Ada alur create milik resource, izin create, dan scope sudah diketahui | Setelah tersimpan, record lengkap dari respons langsung dipilih tanpa pencarian ulang. Membatalkan pemilih tidak membatalkan record yang sudah tersimpan. |

Setiap aksi punya syarat sendiri; jangan menyalin izin dari aksi lain atau menampilkan aksi tanpa fungsi.

## Keadaan

- Memuat: "Memuat pilihan…". Gagal: pesan gagal tetap terlihat dengan "Coba lagi". Akhir: berhenti memuat.
- Hasil disimpan paling lama 30 detik pada field itu saja, bukan cache lintas tenant. Perubahan scope, perubahan sumber, serta Baru atau Detail yang mengubah master membatalkannya.
- Popup dan Daftar lengkap berbagi hasil, query, dan cursor; membuka Daftar lengkap tidak mengulang batch pertama.

## Tata letak

- Field mengisi lebar kolom form; label di dalam field seperti Input.
- Popup boleh lebih lebar dari field agar kolom terbaca: sejajar field, dibatasi ruang viewport, dan bisa digulir menyamping.
- Di dalam kartu, dialog, atau sheet, popup dirender ke wadah lapisan tersebut supaya pilihannya bisa diklik. Escape menutup popup lebih dulu; dialog induk tetap terbuka.

## Kontrak sumber data (server)

- Permintaan: `query`, `cursor`, dan sinyal pembatalan. Jawaban: `items` dan `nextCursor`.
- Setiap batch menerapkan tenant, perusahaan, unit organisasi, induk/dependensi, dan izin yang sama.
- Urutan cursor unik dan stabil (pembeda `id`); relasi dimuat sekaligus.
- Jangan mengambil seluruh master lalu memotongnya di klien.
