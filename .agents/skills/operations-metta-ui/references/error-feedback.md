# Pesan error yang membantu pengguna melanjutkan pekerjaan

Gunakan saat merancang kegagalan form, upload, dan proses beberapa record. Pedoman ini dipelajari dari source BCApps dan Microsoft Learn pada 21 Oktober 2026 untuk CoreERP. Pesan di bawah adalah contoh adaptasi, bukan salinan pesan resmi BC. Pemilik produk menyetujui penerapan pola header dan field pada 21 Oktober 2026. Contoh perilakunya ada di playground CoreERP (`/ui-playground#form-errors`); repo ini belum punya playground. Jangan menyatakan suatu halaman sudah memakai SDK sebelum memeriksa implementasinya.

## Tulis dari fakta yang dimiliki proses

- Judul menyebut apa yang salah. Isi menjelaskan penyebab yang diketahui, dampak pada pekerjaan, lalu langkah berikutnya. Hindari judul kosong seperti "Oops" atau "Terjadi kesalahan" jika kegagalan spesifik diketahui.
- Pakai istilah yang pengguna lihat pada layar. Nama field, baris, ukuran aktual, dan batas berasal dari data atau konfigurasi, bukan nama perusahaan/module yang ditulis mati. Tampilkan angka yang membantu memperbaiki masalah, misalnya ukuran berkas dan batas upload.
- "Belum tersimpan", "tidak ada data yang berubah", dan "sudah disimpan" adalah pernyataan hasil. Pakai hanya jika batas transaksi dan jawaban server membuktikannya. HTTP status atau koneksi putus saja tidak membuktikan hasil commit.
- Setiap tombol menyebut akibat klik, misalnya "Perbaiki jumlah", "Lihat pengaturan", atau "Pilih berkas lain". "Coba lagi" hanya tepat jika mengulang dapat menyelesaikan kegagalan dan aman terhadap duplikasi. Validasi yang belum diperbaiki tidak membutuhkan retry generik.
- Jika penyebab belum diketahui, katakan batas pengetahuan itu. Jangan mengarang penyebab, solusi otomatis, waktu pemulihan, nomor referensi dukungan, atau jaminan draft pulih setelah login/refresh.
- Detail teknis tetap pada laporan server. Bedakan kode jenis masalah yang stabil dengan nomor referensi kejadian untuk menemukan laporan tertentu. Nomor hanya ditampilkan bila benar-benar terhubung ke laporan. SQL, stack trace, `tenant_id`, dan nama exception tidak menjadi pesan layar bisnis.

## Tempatkan pada pekerjaan yang gagal

- Untuk form, ringkasan menetap di bawah header/baris aksi form aktif. Field bermasalah juga mendapat pesan melalui `FormControl.error`, `aria-invalid`, dan hubungan `aria-describedby`. Toast sudut layar tidak cukup sebagai satu-satunya tanda Simpan gagal.
- Ringkasan membaca state error yang sama dengan field. Identitas error rincian mencakup baris dan field yang benar. Klik masalah membuka tab/bagian yang tertutup, menggulir container form, lalu memfokuskan kontrol sesudah render.
- Fokuskan ringkasan saat submit ditolak dan umumkan pesan secara aksesibel. Jangan memindahkan fokus pada setiap ketikan atau mengandalkan warna saja.
- Isolasi state per form/record. Popup anak tidak mengganti error atau draft induk. Memperbaiki satu field tidak menghapus error lain. Bersihkan error yang telah tervalidasi atau setelah operasi terkait berhasil.
- Pertahankan isian selama pemulihan. Muat ulang karena konflik perlu menjelaskan dampaknya dan memberi cara meninjau atau menyalin perubahan lebih dulu jika draft akan dibuang. Jangan menjanjikan penyimpanan draft permanen yang tidak diimplementasikan.

## Pilih tindakan yang bisa menyelesaikan masalah

Komponen bersama di CoreERP adalah `FormErrorSummary`, `createSaveFeedback`, dan `focusFeedbackField` dari `form-feedback`. Pakai versi `@operations-metta/ui/form-feedback` bila sudah ada di `packages/ui`. `RecordActionBar` menerima slot `feedback` di bawah tombol. Pada `PageDialog`, letakkan ringkasan di bawah toolbar dan di luar body yang bergulir. Jangan menambahkan engine toast pengganti atau state error global.

Pisahkan state umpan balik untuk setiap form atau popup, gunakan identitas record sebagai scope saat record dapat berganti tanpa unmount, dan destructure hasil hook agar referensi DOM tidak dibaca sebagai objek state saat render. Hubungkan field melalui `name` atau `data-error-field` yang persis sama dengan key validasi. Untuk section yang belum mounted, pemilik form membuka section sebelum memanggil `focusFeedbackField`. Jangan menjanjikan navigasi field tanpa target yang nyata.

Kegagalan validasi (422) berbeda dari kegagalan HTTP lain dan dari koneksi putus. Tangani ketiganya secara terpisah per form: validasi ke field dan header, kegagalan HTTP ke header tanpa membuka modal bawaan library, koneksi putus sebagai hasil yang belum diketahui. Jangan menyimpulkan hasil simpan ketika jawaban belum diterima.

BC menyebut perbaikan satu langkah dengan nilai benar yang diketahui sebagai **Fix-it**. Gunakan hanya bila kondisi masih berlaku, pengguna berhak, dan perubahan aman; validasi ulang di server saat tindakan dijalankan. Jangan menebak nilai bisnis. Perbaikan tetap melalui layanan pemilik data.

**Show-it** membawa pengguna ke field, record, atau pengaturan yang perlu diperbaiki. Target dan izin harus benar-benar tersedia. Pengguna tanpa hak mengubah pengaturan mendapat penjelasan siapa yang perlu membantu, bukan tombol yang pasti ditolak. Membuka layar izin tidak memberi izin dan mengganti tombol bukan pengganti otorisasi server.

Dalam playground, tombol boleh menyimulasikan tindakan pada state lokal dengan penanda simulasi yang jelas. Di halaman bisnis, tombol harus menjalankan jalur yang nyata. Salin nomor referensi menyalin nilai sebenarnya; buka pengaturan membuka tempat yang sesuai; retry proses mengulang unit yang memang belum berhasil.

## Keputusan interaksi yang disetujui

- **Tidak ada dialog bawaan browser.** Jangan memanggil `alert`, `confirm`, `prompt`, atau `reportValidity()`, termasuk melalui alias. Konfirmasi memakai `useConfirmation`/`useRecordTransition` dari SDK. Input alasan memakai Dialog SDK dengan validasi header dan field. Jangan memakai Promise konfirmasi sebagai kondisi boolean tanpa `await`; perpindahan record memakai callback `request` supaya Batal menghentikan tindakan.
- Native `<form>` memakai `noValidate`; pertahankan validasi aplikasi dan server. Hubungkan `useFormValidation` melalui header atau hook form: isian tidak valid menghentikan submit, tampil pada header dan field, lalu diperiksa ulang saat diperbaiki tanpa mengambil fokus setiap ketikan. Untuk tombol yang mengirim tanpa native submit, baca `getFormValidationErrors` sebelum mengirim dan tampilkan hasil pada header serta field. Jangan menyalakan bubble browser atau hanya `return` tanpa pesan. Jangan memasang popup `beforeunload` atau mengklaim SDK dapat menampilkan dialog khusus saat tab browser ditutup.
- `bun run check:ui` (`scripts/check-ui.ts`, berjalan di CI) menolak `alert`, `confirm`, dan `prompt` bawaan browser, `reportValidity()`, `<form>` tanpa `noValidate`, dan `returnValue` untuk popup keluar halaman. Ia pindahan `scripts/check-browser-dialogs.mjs` CoreERP.

- **Salin detail bantuan langsung menyalin**, lalu menampilkan status singkat "Rincian sudah disalin" di dekat tombol. Jangan membuka popup untuk konfirmasi salin. Jika clipboard gagal, tampilkan pesan gagal dan teks yang bisa dipilih untuk disalin manual pada tempat yang sama; jangan mengklaim berhasil.
- **Pemulihan koneksi terputus di luar cakupan SDK.** Jangan menambah engine pemeriksaan hasil simpan, retry jaringan, atau popup jaringan bersama. Pemilik proses tetap bertanggung jawab menjelaskan ketidakpastian hasil bila informasi itu diperlukan; pengecualian ini tidak mengizinkan klaim bahwa transaksi pasti batal atau retry write tanpa jaminan idempotency.

## Contoh skenario yang disetujui

Sesuaikan pesan dengan hasil operasi sebenarnya. Placeholder `{...}` berasal dari fakta proses, bukan nilai tetap.

| Skenario | Contoh pesan | Tindakan dan syarat |
| --- | --- | --- |
| Banyak isian atau baris salah | "Dokumen belum tersimpan. Periksa {jumlah} isian." Rincian: "Baris {baris}: isi jumlah minimal 1." | "Perbaiki jumlah" menuju field dan baris tepat. Klaim belum tersimpan hanya untuk operasi yang seluruhnya ditolak. |
| Data diubah orang lain | "Data sudah berubah sejak kamu membukanya. Tinjau versi terbaru sebelum menyimpan perubahanmu." | "Tinjau perubahan" membandingkan data; jika hanya ada reload, jelaskan draft yang akan hilang dan izinkan menyalin isian lebih dulu. Jangan menawarkan paksa timpa. |
| Hak akses tidak cukup | "Kamu belum memiliki izin untuk menyimpan dokumen ini. Minta pengelola akses memeriksa izinmu." | "Salin rincian permintaan" hanya menyalin konteks aman. Jangan membuka permintaan akses yang belum ada endpoint-nya. |
| Sesi login berakhir | "Sesi login berakhir. Login kembali untuk melanjutkan." | "Login kembali" memakai jalur login resmi. Jelaskan nasib isian yang sebenarnya; jangan mengklaim draft aman setelah pindah halaman tanpa mekanisme yang terbukti. |
| Pengaturan wajib kosong | "{Pengaturan} belum diisi. Lengkapi sebelum melanjutkan proses ini." | "Lihat pengaturan" bila pengguna berhak; jika tidak, arahkan meminta bantuan pengelola. Kembali ke form mempertahankan draft bila mekanismenya tersedia. |
| Data duplikat | "Referensi {referensi} sudah dipakai. Gunakan referensi lain atau lihat dokumen yang sudah ada." | "Lihat dokumen" hanya bila pembaca berhak dan record benar ditemukan; "Ubah referensi" memfokuskan field. Jangan otomatis memberi nomor baru di luar aturan penomoran. |
| Berkas terlalu besar | "Ukuran berkas {ukuran}. Batas upload {batas}. Pilih berkas yang lebih kecil." | "Pilih berkas lain" membuka pemilih. Batas mengikuti konfigurasi. Klaim belum diunggah hanya jika diketahui pasti. |
| Format berkas tidak didukung | "Berkas ini berformat {format}. Gunakan {format_diizinkan}." | "Pilih berkas lain". Daftar format dari aturan upload, bukan tebakan ekstensi; validasi server tetap berlaku. |
| Proses berhasil sebagian | "{berhasil} dokumen berhasil diproses. {gagal} dokumen belum berhasil. Periksa rincian sebelum mengulang." | "Lihat rincian" memisahkan hasil per record. "Ulangi yang gagal" hanya untuk unit gagal yang hasilnya diketahui dan operasi aman/idempotent; jangan memproses ulang unit sukses. |
| Gangguan sistem | "Dokumen belum dapat disimpan karena gangguan sistem. Hubungi pengelola aplikasi dengan nomor referensi {referensi_kejadian}." | "Salin rincian" menyalin laporan nyata, memberi status singkat tanpa popup, dan mempertahankan isian. Jika commit belum pasti, gunakan pesan hasil belum diketahui. Jangan menjadikan bug internal sebagai validasi 422 agar menghilang dari pemantauan. |

## Dasar dan batas bukti

- [Microsoft Learn: User experience guidelines for errors](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-error-handling-guidelines) menjelaskan isi judul, alasan/perbaikan pada body, dan label tindakan.
- [Microsoft Learn: Actionable errors](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-actionable-errors) membedakan Fix-it dan Show-it, termasuk syarat solusi yang diketahui dan hak pengguna.
- [Microsoft Learn: Notifications](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-notifications-developing) menyebut notification bar di atas halaman aktif, error validasi didahulukan, dan notifikasi subpage masuk ke bar yang sama. Itu tidak berarti setiap error BC ada di header; dialog/daftar juga tersedia.
- Source BC di [BCApps](https://github.com/microsoft/BCApps): `src/Layers/W1/BaseApp/Modules/System/ErrorMessage/ErrorMessageHandler.Codeunit.al`, `InformAboutErrors` dan `ShowNotification`, memilih notifikasi atau daftar error dan menghubungkan tombol Details dengan register serta record. `ErrorMessageManagement.Codeunit.al`, `CollectErrors`, membawa record dan field dari `ErrorInfo`; `BuildActionableErrorInfo` mengisi judul/pesan dan tindakan.
- Contoh perbaikan nyata di BCApps: `src/Apps/W1/ErrorMessagesWithRecommendations/App/src/Implementation/DimensionCodeMustBeBlank.Codeunit.al`, `OnSetErrorMessageProps` dan `OnFixError`. Pemilik kasus menentukan perbaikan; renderer tidak menebaknya dari kalimat.
- BCApps menyediakan source AL; renderer client BC dan seluruh perilaku login/network tidak terbukti dari source itu saja. Panduan ketidakpastian jaringan serta pesan sesi dan hasil parsial adalah adaptasi berdasarkan kontrak operasi CoreERP, bukan klaim template bawaan BC.
- Pelaporan kesalahan CoreERP ada di [`docs/dev/28-pelaporan-kesalahan.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/28-pelaporan-kesalahan.md) dan tetap acuan perilaku sampai pelaporan kesalahan dipindah ke repo ini.
