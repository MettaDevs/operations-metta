---
name: actionable-errors
description: Menambahkan tombol jalan keluar pada penolakan (pola ErrorInfo Business Central, Show-it), yaitu tombol di kotak error yang membuka record penyebab penolakan sebagai jendela di atas form, misalnya "Buka pembayaran KSR-…" saat retur ditolak karena sudah dibayar di kasir. Pakai saat menulis penolakan Simpan atau tindakan yang menyebut dokumen lain, saat menambah halaman yang boleh dibuka dari kotak error, saat memasang tombol itu di layar yang ditolak, atau saat mempertimbangkan Fix-it.
---

# Aksi pada penolakan

Desain lengkap dan alasannya ada di [`docs/dev/40-aksi-pada-penolakan.md`](../../../docs/dev/40-aksi-pada-penolakan.md). Skill ini langkah kerjanya.

## Kapan dipakai

Pakai bila penolakan menyebut dokumen lain yang harus diubah lebih dulu, dan pengguna bisa mengubahnya sendiri bila ia punya izin. Contohnya pembayaran yang harus dibatalkan sebelum retur atau Biaya Tindakan diubah.

Jangan dipakai untuk:

- kesalahan isian di form yang sama, karena ringkasan error sudah memfokuskan isiannya;
- penolakan tanpa record penyebab yang jelas;
- tindakan yang dijalankan otomatis dari tombol (Fix-it), selama Fix-it belum dibangun. Bila kelak dibangun, Fix-it tidak pernah dipakai untuk tindakan yang memindahkan uang, misalnya batal pembayaran, nota kredit, atau bayar. Tindakan itu butuh konfirmasinya sendiri di layarnya.

## Di server

1. Tolak lewat `refuse(db, viewer, { message, open: { page, recordId, label }, otherwise })` dari `@core/platform/access/index.ts`. `viewer` adalah `Workspace` service.
2. `label` menyebut tindakan dan nomornya, misalnya `Buka pembayaran ${number}`. `otherwise` menyebut nomor yang sama untuk pengguna tanpa izin, misalnya `Minta kasir membatalkan pembayaran ${number}.`
3. Jangan menyebut kode izin. `refuse` memeriksa `<page>.read`, karena kunci record sama dengan securable halamannya.
4. Jangan memanggil `validation(errors, actions)` dengan aksi buatan sendiri, karena pemeriksaan izinnya terlewat.
5. Jangan menangkap penolakan lalu menulis ulang pesannya, karena aksinya ikut hilang. Kirim pesan khusus sebagai data ke fungsi yang menolak, seperti `lockChargeForChange(db, workspace, { documentId, message })`.
6. Penolakan tidak menempel ke field. `refuse` selalu menulis `_form`, karena tidak ada isian yang salah; field akan membuat kotak error meminta pengguna memperbaiki isian.
7. Test perilakunya lewat route: pengguna yang berhak mendapat `actions`, dan pengguna yang tidak berhak mendapat nomor di pesan tanpa `actions`. Contohnya ada di `modules/pharmacy/test/dispensing/dispensing-return/dispensing-return.otc-sale.test.ts`.

## Halaman tujuan baru

1. Pisahkan isi halaman menjadi komponen `({ id }: { id: string }) => ReactNode` yang tidak membaca params route. Halaman memanggilnya dengan id dari route.
2. Export `record = defineRecordPage({ key: '<app>.<resource>', title, component })` di `.page.tsx` yang sama. Kuncinya teks literal dan sama dengan permission baca yang dijaga API halaman itu.
3. Jalankan `bun scripts/generate-client.ts`. Perintah ini menulis ulang `src/client.tsx` dan `src/platform/error-action/record-pages.generated.ts`. Commit keduanya.
4. Periksa tampilannya di dalam jendela. Select dan combobox di dalamnya tetap butuh `portalContainer` (skill `operations-metta-ui`).

## Di layar yang ditolak

Tambah satu state, kosongkan sebelum Simpan, isi dari `caught.actions` saat ditolak, dan teruskan ke `FormErrorHeader`:

```tsx
const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>([]);
setErrors(caught.errors);
setErrorActions(caught.actions);
<FormErrorHeader
    errors={errors}
    errorActions={errorActions}
    message={message}
    operation="Retur belum disimpan"
/>;
```

- Jangan membuka record sendiri dari form itu. `RecordDialogs` milik layout aplikasi yang membukanya, supaya Simpan di record tujuan tidak ikut menyimpan form asal.
- Sesudah jendela ditutup tidak ada Simpan otomatis. Isian tetap ada, dan pengguna menekan Simpan lagi.
- `FormErrorHeader` di dalam `Dialog` modal (bukan `PageDialog`) membuka jendela di belakang modal itu. Uji dulu di aplikasi sebelum memasangnya di sana.

## Pemakai saat ini

Semua penolakan "sudah dibayar" datang dari `lockChargeForChange` di `src/foundation/billing/payment/payment.service.ts`. Tombolnya terpasang di:

- retur obat dan Batal retur, untuk resep dan penjualan obat bebas (`dispensing-returns.tsx`);
- Siapkan dan batal penyiapan di kartu penyerahan (`dispensing-card.tsx`);
- Ubah harga sesudah Siapkan, di jendela Ubah harga (`dispensing-price-card.tsx`);
- Simpan pemeriksaan yang mengubah Biaya Tindakan (`examination.page.tsx`).

Penolakan "hanya untuk petugasnya" datang dari `requireLocationAccess` di `src/foundation/inventory/warehouse-employee/location-access.ts`. Tombolnya membuka daftar petugas lokasi itu (`core.inventory-location`), tempat pengelola lokasi stok menambahkan pengguna yang ditolak. Ia dipakai dokumen persediaan, penerimaan, retur ke vendor, dan semua tindakan resep farmasi.

Batal resep, batal registrasi, dan rujuk internal juga ditolak lewat kunci itu, tetapi layarnya belum memasang tombol, jadi hanya pesannya yang tampil. Batal resep dan batal registrasi memakai `Dialog` modal, dan jendela yang dibuka dari dalamnya belum diuji.

## Bukti

Jalankan resep `resep-retur-buka-pembayaran` di `.agents/skills/verify-operations-metta/features/resep-farmasi.md`. Simpan screenshot tiap langkah.
