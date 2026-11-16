# Workflow persetujuan

> **Status di repo ini:** belum dipindah. Tidak ada kode workflow, layar konfigurasi, inbox, atau event keputusan. Yang sudah ada adalah tabel `workflow_*` dari skema CoreERP di `database/migrations/0001_coreerp_baseline.sql`, dan belum ada kode yang membacanya. Acuan perilaku: [`docs/dev/21-visual-workflow-engine.md`](https://github.com/MettaDevs/coreERP/blob/main/docs/dev/21-visual-workflow-engine.md) dan `apps/core/app/Foundation/Workflow/` di [repo CoreERP](https://github.com/MettaDevs/coreERP).

## Keputusan engine

Pemilik produk memilih [`bpmn-engine`](https://github.com/paed01/bpmn-engine) yang berjalan di dalam proses Bun pada 10 November 2026. Temporal dan Flowable ditolak. Temporal menulis alur sebagai kode, sedangkan yang diinginkan adalah model BPMN yang dijalankan engine. Flowable butuh proses Java tersendiri dengan memori besar untuk setiap lingkungan, dan biaya itu berlipat sejumlah lingkungan SaaS.

Engine di dalam proses berarti langkah alur dan tulisan bisnisnya dapat berada dalam satu transaksi database, sama seperti penerbitan nomor. Keputusan ini memilih engine. Ia bukan bukti bahwa dependency-nya sudah terpasang atau bahwa aturan di bawah sudah berjalan.

Bagian yang tidak disediakan `bpmn-engine` dan harus dibangun sendiri sebelum dipakai klien, antara lain inbox tugas beserta penugasannya, penjadwal timer, definisi alur per tenant beserta versinya, riwayat, dan pemeriksaan ekspresi kondisi.

## Aturan desain yang tetap berlaku

Aturan berikut datang dari workflow persetujuan CoreERP dan tidak terikat stack. Pemindahan wajib mempertahankannya.

### Module tidak menyimpan penyetuju

Module hanya tahu bahwa dokumennya butuh persetujuan, lalu mengirim konteks keputusan. Siapa yang menyetujui, berapa langkahnya, dan batas nilai yang memicu langkah tambahan adalah konfigurasi admin tenant di Core. Module tidak membangun mesin persetujuan atau antrean tugas sendiri.

### Tipe workflow dinyatakan pemiliknya

Setiap tipe workflow punya:

- `code` berawalan id pemiliknya, misalnya `asset-management.`;
- `name` yang dipahami admin bisnis;
- skema konteks keputusan, yaitu field yang dikirim module saat mengajukan. Field di skema itu yang boleh dipakai sebagai syarat cabang di konfigurasi.

Di CoreERP tipe workflow dinyatakan di manifest `app.yaml`. Repo ini tidak punya manifest. Reference number sequence didaftarkan module lewat migration-nya sendiri, tetapi tempat pendaftaran tipe workflow belum diputuskan.

### Pengajuan berada di dalam transaksi dokumen

Pengajuan, dokumen, dan nomornya disimpan dalam satu transaksi, jadi dokumen yang gagal disimpan tidak meninggalkan pengajuan. Pengajuan membawa kunci idempoten. Kunci yang sama mengembalikan instance yang sama. Alurnya di CoreERP dirinci di [alur data, bagian Workflow persetujuan](../design-system/03-alur-data.md#6-workflow-persetujuan).

### Keputusan sampai ke module sebagai event

Keputusan bisa datang beberapa menit sampai beberapa hari kemudian. Module menyimpan id instance sejak mengajukan, lalu menerima keputusannya sebagai event. Di CoreERP event itu `core.workflow.decision.v2` dengan nilai keputusan `approved`, `rejected`, atau `cancelled`. Di repo ini event antar-bagian runtime diterbitkan `publishEvent` dan diterima `onEvent` dari `src/platform/events/`, dengan aturan penerima idempoten di `AGENTS.md`, bagian *Event antar module*. Status final dicatat sekali, supaya event keputusan tidak terbit dua kali.

### Inbox persetujuan terpusat

Pengguna tidak memeriksa module satu per satu untuk tahu persetujuan yang tertahan. Core menyediakan satu inbox berisi tugas yang ditugaskan ke pengguna itu atau ke role-nya, lintas module, dengan aksi setuju, tolak, dan delegasi. Membuka tautan tugas tidak pernah sama dengan menyetujui, dan tidak ada persetujuan lewat GET.

### Penerima ditentukan konfigurasi

Penerima tugas diatur di konfigurasi, misalnya pengguna tertentu, pemegang role, atau rantai organisasi ke atas. Penerima harus punya izin atas dokumennya dan berada dalam lingkup unitnya. Bila tidak ada penerima yang sah, instance langsung ditolak, bukan menggantung.

### Pengaju menyetujui sendiri: dilarang saat penugasan

Bawaannya mengikuti Dynamics 365: pengaju boleh menyetujui, kecuali tenant melarang. Larangan itu ditegakkan saat tugas ditugaskan, bukan saat keputusan diambil. Bila ditegakkan saat keputusan, tugas yang jatuh ke pengajunya sendiri menjadi jalan buntu yang tidak bisa disetujui siapa pun. Persetujuan oleh pengaju sendiri, bila diizinkan, selalu tercatat di riwayat.

### Parameter workflow tenant

- Setiap perubahan parameter tercatat di jejak audit, dan pelakunya parameter wajib pada perintah penyimpanannya. Perubahan yang tidak mengubah nilai tidak dicatat.
- Tipe nilai ditegakkan saat dibaca, bukan hanya saat ditulis. Pesan penolakannya menyebut nama parameter dan tipe yang dijanjikan.

## Yang tidak dipindah

- Manifest `app.yaml`, endpoint `internal/v1/workflows/instances`, dan klien HTTP `WorkflowClient` untuk app di luar runtime. Bentuk app berkontainer sudah dibuang di CoreERP sebelum repo ini lahir.
- Pemberitahuan email lewat API SSO CoreERP. Cara pemberitahuan di repo ini belum diputuskan.
- Kode Laravel dan layar Inertia di tabel *Di mana kodenya* halaman CoreERP.

## Lihat juga

- [Number sequence](14-number-sequences.md): nomor dokumen yang diterbitkan dalam transaksi yang sama dengan pengajuan
- [Alur data CoreERP](../design-system/03-alur-data.md): tabel `workflow_*` dan langkah pengajuan sampai keputusan
