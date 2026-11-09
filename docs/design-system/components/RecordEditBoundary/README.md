# RecordEditBoundary

Pola klik-untuk-mengubah: record dibuka dalam mode baca, lalu mengklik sebuah nilai membawa pengguna ke mode Ubah dengan fokus di field itu.

## Alur

1. Kartu terbuka dalam mode baca. Field ditandai **baca saja**, bukan nonaktif, sehingga tetap bisa difokuskan dan diklik.
2. Pengguna mengklik field atau labelnya, menekan Enter/Space pada field baca saja, atau mengaktifkan judul FastTab.
3. Bila pengguna boleh mengubah, record tidak sedang diubah, dan kartu tidak sedang menyimpan, halaman masuk mode Ubah. Tidak ada yang disimpan pada langkah ini.
4. Setelah tampilan berganti, fokus berpindah ke kontrol yang bisa diisi di field yang tadi diklik, walaupun kontrolnya berubah bentuk (misalnya teks menjadi lookup).
5. Pengguna mengisi, lalu Simpan atau Batal. Batal mengembalikan draft; Simpan memperbarui record tanpa mengubah identitasnya.

## Kontrol tanpa keadaan baca saja

Select, Switch, dan Checkbox dibungkus pemicu transparan: klik pertama hanya mengaktifkan mode Ubah tanpa membuka pilihan atau membalik nilai; label dan kontrol aslinya mendapat fokus sesudahnya. Pemicu itu punya nama aksesibel "Ubah {label}".

## Aturan

- Field yang selalu baca saja (hasil hitung, identitas yang dibuat sistem) tidak memicu mode Ubah.
- Isi popup yang dirender di luar batas kartu tidak memicu mode Ubah induknya.
- Izin melihat tidak sama dengan izin mengubah. Data acuan baca saja dan versi yang sudah terbit tidak menjadi bisa diubah hanya karena memakai tata letak yang sama.
- Halaman memegang keadaan Ubah, validasi, izin, Simpan, dan Batal; pola ini hanya meminta mode Ubah.
