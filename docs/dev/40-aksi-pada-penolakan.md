# Aksi pada penolakan

Halaman ini untuk developer Core dan module yang menulis penolakan Simpan atau tindakan lain. Penolakan yang jalan keluarnya ada di record lain membawa tombol yang membuka record itu. Polanya ErrorInfo Business Central: `AddNavigationAction` beserta `PageNo` dan `RecordId` (Show-it). Contoh di BCApps ada di `src/Layers/W1/BaseApp/Integration/Dataverse/CDSConnectionSetup.Table.al`.

Contoh pertama di repo ini adalah kunci kasir. Apoteker yang merangkap kasir meretur obat, lalu Simpan ditolak "Data ini sudah melakukan Pembayaran diKasir!". Kotak error menampilkan tombol `Buka pembayaran <nomor>`. Tombol itu membuka form pembayaran kasir sebagai jendela di atas form retur, dan isian retur tetap ada. Di jendela itu ia memilih Batal Pembayaran, atau Nota Kredit bila Clerk sudah End. Layar kasir sendiri yang memutuskan pilihan itu. Sesudah jendela ditutup, ia menekan Simpan retur lagi.

## Bentuk di body penolakan

Body 422 mendapat field `actions` di samping `message` dan `errors`. Field ini hanya ada bila daftarnya berisi.

```json
{
    "message": "Data ini sudah melakukan Pembayaran diKasir!",
    "errors": { "_form": ["Data ini sudah melakukan Pembayaran diKasir!"] },
    "actions": [
        {
            "kind": "open",
            "label": "Buka pembayaran KSR-2611-0007",
            "page": "core.payment",
            "recordId": "<id dokumen sumber tagihan>"
        }
    ]
}
```

- Schema-nya `errorActionSchema` di `src/platform/error-action/index.ts`. Berkas itu hanya meng-import zod, jadi server dan peramban memakai schema yang sama.
- `page` adalah kunci record, bukan URL. Daftar kunci yang sah ada di `record-pages.generated.ts` di folder yang sama. Berkas itu ditulis `scripts/generate-client.ts` dari setiap `defineRecordPage`. Kunci yang salah ketik di server gagal typecheck, dan berkas yang tertinggal ditolak `bun run check:generated`.
- `kind` membedakan jenis aksi. Saat ini hanya ada `open` (Show-it). Fix-it, padanan `AddAction` di BC, kelak menjadi anggota union berikutnya. Fix-it tidak pernah dipakai untuk tindakan yang memindahkan uang, misalnya batal pembayaran atau nota kredit, karena tindakan itu butuh konfirmasinya sendiri di layarnya.
- `ApiError` di `src/platform/shell/api.ts` mem-parse `actions` saat jawaban tiba. Aksi yang tidak dikenal peramban, misalnya kunci dari server yang lebih baru, dibuang semuanya. Pesannya tetap tampil.
- Body ini hanya dibaca layar repo ini, jadi tidak punya berkas kontrak (bagian Kontrak di `AGENTS.md`).

## Izin menentukan tombol atau nomor

Kunci record sama dengan securable halamannya. Membuka `core.payment` butuh `core.payment.read`. Server menyertakan aksi hanya bila pengguna yang ditolak memegang izin itu, dari app mana pun, lewat `Workspace.holds`. Pengguna yang tidak memegangnya tetap mendapat penolakan yang sama. Bedanya, pesannya ditambah kalimat yang menyebut nomor dokumennya: "Data ini sudah melakukan Pembayaran diKasir! Minta kasir membatalkan pembayaran KSR-2611-0007."

Pemeriksaan itu ada di satu tempat, `refuse` di `src/platform/access/refusal.ts`. Pemanggil tidak menyebut kode izin dan tidak menulis cabang izinnya sendiri.

```ts
await refuse(db, viewer, {
    message: chargeLockedMessage,
    open: {
        page: 'core.payment',
        recordId: documentId,
        label: `Buka pembayaran ${number}`,
    },
    otherwise: `Minta kasir membatalkan pembayaran ${number}.`,
});
```

- `viewer` cukup `tenantId` dan `holds`, jadi `Workspace` milik service mana pun bisa dipakai langsung.
- Penolakan selalu ditulis di `errors._form`, tidak pernah di field. Tidak ada isian yang salah, jadi kotak error memakai judul tindakan layar itu (misalnya "Retur belum disimpan"), lalu alasan dan tombolnya. Penolakan yang menempel ke field tampil sebagai "Periksa 1 isian yang perlu diperbaiki", padahal memperbaiki isian tidak menyelesaikannya.
- `otherwise` wajib diisi dan wajib menyebut nomor dokumennya, supaya pengguna tanpa izin tahu apa yang harus ia minta dan kepada siapa.
- `validation(errors, actions)` di `src/platform/http/` menerima aksi hanya dari `refuse`. Jangan memanggilnya dengan aksi dari tempat lain, karena pemeriksaan izinnya akan terlewat.
- Penolakan yang ditangkap lalu ditulis ulang membuang aksinya. Pesan khusus pemanggil dikirim sebagai data. Contohnya `lockChargeForChange(db, workspace, { documentId, message: paidMessage })` di farmasi.

## Halaman tujuan

Halaman yang bisa dibuka dari penolakan meng-export `record` di `.page.tsx`-nya, di samping `page`:

```tsx
export const record = defineRecordPage({
    key: 'core.payment',
    title: 'Pembayaran',
    component: PaymentRecord,
});
```

- `component` menerima `{ id }` dan tidak membaca params route, karena ia juga tampil di luar route-nya. Halamannya sendiri tinggal `<PaymentRecord id={route.useParams().visitId} />`. Contohnya `src/foundation/billing/invoice/payment.page.tsx`.
- `src/client.tsx` merakit kunci dan komponennya menjadi `recordPages`, lalu menyerahkannya ke `startClient`. Satu kunci hanya boleh dimiliki satu halaman, dan generator menolak duplikatnya.
- Bentuk kunci `<app>.<resource>` harus sama dengan permission baca yang dijaga API halaman itu.

## Di layar

`RecordDialogs` di `src/platform/shell/record-dialogs.tsx` dipasang layout aplikasi. Ia memegang tumpukan record yang dibuka dari kotak error dan menggambar masing-masing sebagai `PageDialog` di atas layar sekarang.

- Dialog tidak tinggal di pohon form yang ditolak. Submit di dalam portal React ikut naik ke form asal, sehingga Simpan di form pembayaran akan ikut menyimpan retur.
- Menutup dialog tidak menyimpan, tidak memuat ulang, dan tidak mengubah apa pun di layar asal. Pengguna menekan Simpan lagi sendiri.
- Record yang gagal dimuat, misalnya karena izinnya dicabut sesudah tombolnya tampil, menampilkan pesannya di dalam dialog itu saja.
- Di luar layout aplikasi, misalnya halaman login, tombolnya tidak tampil.

Halaman yang ditolak memasang aksinya dengan satu state tambahan:

```tsx
const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>([]);
// sebelum Simpan: setErrors({}); setErrorActions([]);
// saat 422: setErrors(caught.errors); setErrorActions(caught.actions);
<FormErrorHeader
    errors={errors}
    errorActions={errorActions}
    message={message}
    operation="Retur belum disimpan"
/>;
```

Tombolnya digambar `FormErrorHeader` sebagai tombol biasa di kotak error, jadi bisa dicapai lewat Tab dan dijalankan dengan Enter atau Spasi.

Halaman yang belum memasangnya tetap menampilkan pesannya, tetapi tanpa tombol. Pemasangannya dibuat per halaman, bukan otomatis untuk semua halaman, karena penolakan beraksi hanya datang dari pemanggil `refuse`. Daftar pemakainya ada di skill `actionable-errors`.

## Test

- Server: `modules/pharmacy/test/dispensing/dispensing-return/dispensing-return.otc-sale.test.ts` memeriksa bahwa penolakan membawa aksi untuk pengguna yang boleh membaca pembayaran, dan membawa nomor pembayarannya untuk yang tidak boleh.
- Layar: `test/platform/shell/record-dialogs.test.ts` menjalankan skenario jsdom `test/support/record-dialogs.scenario.ts`. Skenario itu memeriksa bahwa tombol membuka record, Simpan di record itu tidak menyimpan form asal, dan menutupnya mempertahankan isian.
- Aplikasi asli: resep `resep-retur-buka-pembayaran` di skill `verify-operations-metta`, berkas `features/resep-farmasi.md`.
