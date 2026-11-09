# Empty

Keadaan kosong yang menjelaskan apa yang belum ada dan tindakan yang tersedia; tidak pernah dipakai untuk menutupi keadaan memuat, gagal, atau tidak berizin.

## Anatomi (blok berdiri sendiri)

- Wadah: garis putus-putus `border`, radius `radius-lg`, padding `space-6` (`space-12` mulai `breakpoint-md`), jarak `space-6`, rata tengah.
- Media opsional: kotak 40px berlatar `muted` dengan ikon 24px.
- Judul `empty-title`; deskripsi 14px `muted-foreground`, tautan bergaris bawah.
- Isi: tombol tindakan yang benar-benar tersedia bagi pengguna.

Bagian rincian di dalam kartu cukup memakai satu kalimat dan tindakannya, tanpa blok besar: "Belum ada alamat. Pilih Baru untuk mengisi."

## Bedakan keadaannya

| Keadaan | Yang dilihat pengguna |
| --- | --- |
| Draft belum punya rincian | Pesan kosong singkat dan aksi untuk mengisi, sesuai izin |
| Record tersimpan memang tanpa rincian | Pesan kosong; aksi hanya untuk yang boleh mengubah |
| Data sedang dimuat | Status memuat, bukan pesan kosong |
| Pemuatan gagal | Pesan gagal dan "Coba lagi"; jangan menyimpulkan data tidak ada |
| Tidak punya izin | Sembunyikan bagian, atau jelaskan batas akses; jangan menampilkan data kosong palsu |
| Tidak berlaku untuk pilihan saat ini | Sembunyikan, atau sebut pilihan yang membuatnya berlaku |
| Baru ada setelah proses bisnis | Sebut pemicunya: nomor diisi saat disimpan, hasil penyusutan ada setelah proses penyusutan |

## Aturan

- Label tindakan dalam kalimat sama dengan tombol yang benar-benar tampil (Baru atau Tambah).
- Jangan menulis "simpan dahulu" untuk rincian biasa; rincian bisa diisi sebagai draft sebelum record pertama disimpan.
