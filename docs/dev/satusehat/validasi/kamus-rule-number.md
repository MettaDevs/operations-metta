# Indeks Rule Number validasi SATUSEHAT

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Kamus Rule Number Validasi](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/kamus-validasi/) (disunting 2026-01-22)

[Indeks SATUSEHAT](../README.md) · [Validasi dan error](README.md) · [Penanganan error](respons-dan-error.md) · [Monitoring dan aduan](../operasional/monitoring-dan-aduan.md)

Snapshot 16 November 2026 dari worksheet `V2.0` Kamus Rule Number Kemenkes. Kolom nomor mengikuti ekspor XLSX. Tampilan CSV mengosongkan empat sel teks, termasuk satu pasangan Rule Number. Tabel lokal memuat nomor, path, versi baris, lokasi di sumber dan jenis pemeriksaan untuk pencarian cepat. Deskripsi panjang serta contoh nilai tetap dirujuk lewat baris sumber. Jenis pemeriksaan untuk field diringkas dari kolom terminologi, sehingga gunakan issue dan konteks resource untuk mendeteksi kasus spesifik. [Halaman Kamus](https://satusehat.kemkes.go.id/platform/docs/id/api-catalogue/validasi/kamus-validasi/) · [Worksheet sumber](https://docs.google.com/spreadsheets/d/1vnYFL2Ho1lICEgWmE2HFwkbEgiRvw1uaYBBW8NvwzjI/edit?gid=0#gid=0)

Cocokkan Rule Number bersama `OperationOutcome.issue[].expression` atau path dalam pesan. Snapshot memiliki nomor yang dipakai di lebih dari satu path dan beberapa baris yang berulang. Baris disimpan dalam urutan sumber dengan nomor baris worksheet. Sel kosong atau berisi catatan editorial ditulis —. Jika sumber menyebut dua nomor pada satu path, keduanya dipertahankan. Aturan dapat berubah menurut versi, jenis integrasi dan environment. HTTP status dan `issue.code` berasal dari balikan aktual.

## Aturan yang memengaruhi penanganan umum

| Rule Number | Kategori | Tindakan |
| --- | --- | --- |
| `20002` | Duplikasi | Cari resource yang sama dari identifier, scope, dan jenis resource. Gunakan ID yang sudah disimpan bila cocok. |
| `20003` | Scope klien | Periksa izin read/write per jenis resource pada akun dan environment yang benar. |
| `20004` | Kelas akses | Cocokkan tipe fasilitas atau kelas akses yang ditugaskan dengan operasi dan resource. |
| `20005` | Pembacaan payload | Periksa encoding dan apakah body dapat dibaca sebagai JSON yang sesuai media type. |
| `20006` | Struktur JSON | Periksa sintaks dan struktur payload pada operasi yang dipanggil. |
| `20007` | Resource hilang | Cocokkan ID dan tipe resource, serta environment pemilik data. |
| `20008` | Tipe payload | Periksa tipe field dan bentuk resource terhadap profil aktif. |
| `20009` | Identitas klien | Pastikan client id tersedia di konfigurasi untuk operasi yang menggunakannya. |
| `20010` | Kunci publik klien | Periksa status pendaftaran kunci dan scope pada operasi yang membutuhkan kunci. |
| `20011` | Bundle bertumpuk | Cek tipe Bundle dan susunan entry yang diizinkan pada alur tersebut. |
| `20012` | Entry ditolak karena error sebelumnya | Cari dan perbaiki error pertama pada Bundle atau langkah pendahulu, lalu rekonsiliasi hasil per entry. |
| `20013` | Resource tidak valid karena error sebelumnya | Cari error pertama sebelum memperbaiki resource turunan atau melakukan retry. |
| `20014` | Operasi Everything | Pakai operasi yang diterbitkan untuk tipe resource dan scope aplikasi. |
| `20015` | Field Patient terbatas di portal | Batasi field perubahan menurut kanal dan hak yang diberikan. Verifikasi aturan perubahan pasien yang berlaku. |
| `20016` | Hak perubahan Patient | Periksa Organization dan peran yang diizinkan memperbarui Patient. |
| `20017` | Format fullUrl | Periksa bentuk URN UUID pada entry transaksi dan reference yang menggunakannya. |
| `20018` | Prefiks fullUrl | Cocokkan prefiks urn:uuid pada transaksi yang mewajibkannya. |
| `20019` | UUID tidak valid | Validasi UUID sebelum mengisi fullUrl dan reference terkait. |
| `20020` | fullUrl ganda | Pastikan setiap entry memakai fullUrl unik dan referensi menunjuk entri yang dimaksud. |
| `20021` | fullUrl kosong | Isi fullUrl pada entry yang memerlukannya dan periksa referensi antar-entry. |
| `10124` | Referensi wajib | Isi Encounter.serviceProvider dengan Organization yang sesuai scope dan telah dipetakan. |

## Cara memakai kategori field

| Kategori | Tindakan yang dapat dilakukan dari Metta |
| --- | --- |
| Elemen wajib | Cek fakta klinis, parent field dan skenario. Isi field yang berlaku dengan sumber yang sah. |
| Referensi | Periksa target, ID balikan, environment serta scope Organization. Selesaikan dependensi sebelum kirim ulang. |
| Terminologi atau system | Cocokkan nilai code dan system sebagai pasangan. Periksa kamus dan pilihan coding dari profil penggunaan. |
| Tanggal, waktu atau periode | Periksa tipe, zona waktu, interval dan aturan kronologi yang diterapkan use case. |
| Tipe nilai | Cocokkan tipe JSON, pilihan value[x], kardinalitas dan satuan. |
| Nama atau bentuk elemen, struktur resource | Periksa profil, case elemen dan bentuk object/array. |
| Aturan spesifik | Cocokkan path dan issue dengan panduan resource atau modul. Baris sumber menyimpan syarat yang lebih rinci. |

## Lookup berdasarkan nomor atau path

| Rule Number | Path sumber | Kategori pemeriksaan | Petunjuk target, tipe atau system | Versi baris | Baris |
| --- | --- | --- | --- | --- | ---: |
| `20002` | — | Duplikasi | — | v1.1 | 2 |
| `20003` | — | Scope klien | — | v1.1 | 3 |
| `20004` | — | Kelas akses | — | v1.1 | 4 |
| `20005` | — | Pembacaan payload | — | v1.1 | 5 |
| `20006` | — | Struktur JSON | — | v1.1 | 6 |
| `20007` | — | Resource hilang | — | v1.1 | 7 |
| `20008` | — | Tipe payload | — | v1.1 | 8 |
| `20009` | — | Identitas klien | — | v1.1 | 9 |
| `20010` | — | Kunci publik klien | — | v1.1 | 10 |
| `20011` | — | Bundle bertumpuk | — | v1.1 | 11 |
| `20012` | — | Entry ditolak karena error sebelumnya | — | v1.1 | 12 |
| `20013` | — | Resource tidak valid karena error sebelumnya | — | v1.1 | 13 |
| `20014` | — | Operasi Everything | — | v1.1 | 14 |
| `20015` | — | Field Patient terbatas di portal | — | v1.1 | 15 |
| `20016` | — | Hak perubahan Patient | — | v1.1 | 16 |
| `20017` | — | Format fullUrl | — | v1.1 | 17 |
| `20018` | — | Prefiks fullUrl | — | v1.1 | 18 |
| `20019` | — | UUID tidak valid | — | v1.1 | 19 |
| `20020` | — | fullUrl ganda | — | v1.1 | 20 |
| `20021` | — | fullUrl kosong | — | v1.1 | 21 |
| `10228` | `Account.coverage` | Elemen wajib | — | v1.0 | 22 |
| `10228` | `Account.coverage.coverage` | Referensi | `Coverage` | v2.0 | 23 |
| `10777` | `Account.guarantor.party` | Referensi | — | v2.0 | 24 |
| `10225` | `Account.name` | Elemen wajib | — | v1.0 | 25 |
| `10229` | `Account.owner` | Elemen wajib | — | v1.0 | 26 |
| `10229` | `Account.owner` | Referensi | `Organization` | v2.0 | 27 |
| `10289` | `Account.servicePeriod.end` | Elemen wajib | — | v1.0 | 28 |
| `10227` | `Account.servicePeriod.start` | Elemen wajib | — | v1.0 | 29 |
| `10226` | `Account.subject` | Referensi | `Patient` | v2.0 | 30 |
| `10075` | `AllergyIntolerance.category` | Terminologi atau system | `http://hl7.org/fhir/allergy-intolerance-category` | v1.0 | 31 |
| `10076` | `AllergyIntolerance.clinicalStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical` | v1.0 | 32 |
| `10078` | `AllergyIntolerance.code` | Terminologi atau system | — | v1.0 | 33 |
| `10078` | `AllergyIntolerance.code` | Elemen wajib | — | v1.0 | 34 |
| `10077` | `AllergyIntolerance.criticality` | Terminologi atau system | `http://hl7.org/fhir/allergy-intolerance-criticality` | v1.0 | 35 |
| `10374` | `AllergyIntolerance.encounter` | Aturan spesifik | — | v1.0 | 36 |
| `10443` | `AllergyIntolerance.identifier` | Terminologi atau system | — | v1.0 | 37 |
| `10147` | `AllergyIntolerance.patient` | Elemen wajib | — | v1.0 | 38 |
| `10358` | `AllergyIntolerance.recordedDate` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 39 |
| `10375` | `AllergyIntolerance.recorder` | Referensi | `Practitioner` | v1.0 | 40 |
| `10079` | `AllergyIntolerance.verificationStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/allergyintolerance-verification` | v1.0 | 41 |
| `10382` | `CarePlan.author` | Referensi | — | v1.0 | 42 |
| `10330` | `CarePlan.category` | Terminologi atau system | — | v1.0 | 43 |
| `10324` | `CarePlan.created` | Aturan spesifik | — | v1.0 | 44 |
| `10328` | `CarePlan.description` | Aturan spesifik | — | v1.0 | 45 |
| `10381` | `CarePlan.encounter` | Aturan spesifik | — | v1.0 | 46 |
| `10116` | `CarePlan.intent` | Terminologi atau system | `http://hl7.org/fhir/ValueSet/care-plan-intent` | v1.0 | 47 |
| `10116` | `CarePlan.intent` | Terminologi atau system | `http://hl7.org/fhir/request-intent` | v2.0 | 48 |
| `10115` | `CarePlan.status` | Terminologi atau system | `http://hl7.org/fhir/ValueSet/request-status` | v1.0 | 49 |
| `10115` | `CarePlan.status` | Terminologi atau system | `http://hl7.org/fhir/request-status` | v2.0 | 50 |
| `10380` | `CarePlan.subject` | Referensi | — | v1.0 | 51 |
| `10329` | `CarePlan.title` | Aturan spesifik | — | v1.0 | 52 |
| `10222` | `ChargeItem.account` | Referensi | `Account` | v2.0 | 53 |
| `10218` | `ChargeItem.context` | Referensi | `Encounter` | v2.0 | 54 |
| `10785` | `ChargeItem.performer.actor` | Referensi | — | v2.0 | 55 |
| `10681` | `ChargeItem.performer.function` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 56 |
| `10681` | `ChargeItem.performer.function` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 57 |
| `10217` | `ChargeItem.subject` | Referensi | `Patient` | v2.0 | 58 |
| `10246` | `Claim.enterer` | Referensi | `Practitioner` | v2.0 | 59 |
| `10253` | `Claim.facility` | Referensi | `Location` | v2.0 | 60 |
| `10264` | `Claim.insurance.coverage` | Referensi | `Coverage` | v2.0 | 61 |
| `10247` | `Claim.insurer` | Referensi | `Organization` | v2.0 | 62 |
| `10619` | `Claim.item.productOrService` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/kptl` | v2.0 | 63 |
| `10619` | `Claim.item.productOrService` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v2.0 | 64 |
| `10243` | `Claim.patient` | Referensi | `Patient` | v2.0 | 65 |
| `10252` | `Claim.payee.party` | Referensi | `Organization` | v2.0 | 66 |
| `10248` | `Claim.provider` | Referensi | `Organization` | v2.0 | 67 |
| `10810` | `Claim.supportingInfo.valueReference` | Referensi | — | v2.0 | 68 |
| `10266` | `Claim.total.currency` | Terminologi atau system | — | v2.0 | 69 |
| `10266` | `Claim.total.value` | Tipe nilai | `decimal` | v2.0 | 70 |
| `10284` | `ClaimResponse.adjudication.amount.currency` | Terminologi atau system | — | v2.0 | 71 |
| `10284` | `ClaimResponse.adjudication.amount.value` | Tipe nilai | `decimal` | v2.0 | 72 |
| `10283` | `ClaimResponse.adjudication.category` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 73 |
| `10284` | `ClaimResponse.adjudication.reason` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 74 |
| `10514` | `ClaimResponse.identifier` | Terminologi atau system | — | v2.0 | 75 |
| `10514` | `ClaimResponse.identifier` | Terminologi atau system | — | v2.0 | 76 |
| `10276` | `ClaimResponse.insurer` | Referensi | `Organization` | v2.0 | 77 |
| `10779` | `ClaimResponse.item.adjudication.amount.currency` | Terminologi atau system | — | v2.0 | 78 |
| `10779` | `ClaimResponse.item.adjudication.amount.value` | Tipe nilai | `decimal` | v2.0 | 79 |
| `10778` | `ClaimResponse.item.adjudication.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/adjudication` | v2.0 | 80 |
| `10274` | `ClaimResponse.patient` | Referensi | `Patient` | v2.0 | 81 |
| `10278` | `ClaimResponse.request` | Referensi | `Claim` | v2.0 | 82 |
| `10277` | `ClaimResponse.requestor` | Referensi | `Organization` | v2.0 | 83 |
| `10272` | `ClaimResponse.subType` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 84 |
| `10286` | `ClaimResponse.total.currency` | Terminologi atau system | — | v2.0 | 85 |
| `10286` | `ClaimResponse.total.value` | Tipe nilai | `decimal` | v2.0 | 86 |
| `10420` | `ClinicalImpression.assessor` | Referensi | — | v1.0 | 87 |
| `10845` | `ClinicalImpression.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 88 |
| `10845` | `ClinicalImpression.code` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 89 |
| `10419` | `ClinicalImpression.date` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 90 |
| `10417` | `ClinicalImpression.effectiveDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 91 |
| `10149` | `ClinicalImpression.encounter` | Elemen wajib | — | v1.0 | 92 |
| `10149` | `ClinicalImpression.encounter` | Referensi | `Encounter` | v2.0 | 93 |
| `10082` | `ClinicalImpression.finding.itemCodeableConcept` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 94 |
| `10423` | `ClinicalImpression.finding.itemReference` | Referensi | — | v1.0 | 95 |
| `10418` | `ClinicalImpression.identifier` | Terminologi atau system | — | v1.0 | 96 |
| `10081` | `ClinicalImpression.investigation.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 97 |
| `10422` | `ClinicalImpression.investigation.item` | Referensi | — | v1.0 | 98 |
| `10421` | `ClinicalImpression.problem` | Referensi | — | v1.0 | 99 |
| `10083` | `ClinicalImpression.prognosisCodeableConcept` | Terminologi atau system | — | v1.0 | 100 |
| `10729` | `ClinicalImpression.prognosisReference` | Referensi | `RiskAssessment` | v2.0 | 101 |
| `10080` | `ClinicalImpression.status` | Terminologi atau system | `http://hl7.org/fhir/event-status` | v1.0 | 102 |
| `10148` | `ClinicalImpression.subject` | Elemen wajib | — | v1.0 | 103 |
| `10148` | `ClinicalImpression.subject` | Referensi | `Patient` | v2.0 | 104 |
| `10663` | `Composition.attester.party` | Referensi | `Practitioner` | v2.0 | 105 |
| `10133` | `Composition.author` | Elemen wajib | — | v1.0 | 106 |
| `10022` | `Composition.category` | Terminologi atau system | `http://loinc.org` | v1.0 | 107 |
| `10132` | `Composition.date` | Elemen wajib | — | v1.0 | 108 |
| `10670` | `Composition.event.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 109 |
| `10673` | `Composition.event.detail.reference` | Referensi | `Practitioner` | v2.0 | 110 |
| `10672` | `Composition.event.period.end` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 111 |
| `10671` | `Composition.event.period.start` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 112 |
| `10464` | `Composition.identifier` | Terminologi atau system | — | v2.0 | 113 |
| `10023` | `Composition.section.code` | Terminologi atau system | `http://loinc.org` | v1.0 | 114 |
| `10677` | `Composition.section.entry` | Referensi | `Location` | v2.0 | 115 |
| `10677` | `Composition.section.entry` | Referensi | `Observation` | v2.0 | 116 |
| `10677` | `Composition.section.entry` | Referensi | `QuestionnaireResponse` | v2.0 | 117 |
| `10677` | `Composition.section.entry` | Referensi | — | v2.0 | 118 |
| `10666` | `Composition.section.focus` | Referensi | `Patient` | v2.0 | 119 |
| `10666` | `Composition.section.focus` | Referensi | — | v2.0 | 120 |
| `10853` | `Composition.section.X.code.coding` | Terminologi atau system | `http://loinc.org` | v2.0 | 121 |
| `10853` | `Composition.section.X.code.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 122 |
| `10853` | `Composition.section.X.code.coding` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/composition-section` | v2.0 | 123 |
| `10677` | `Composition.section.X.entry` | Referensi | — | v2.0 | 124 |
| `10854` | `Composition.section.X.text.status` | Terminologi atau system | `http://hl7.org/fhir/narrative-status` | v2.0 | 125 |
| `10020` | `Composition.status` | Terminologi atau system | `http://hl7.org/fhir/composition-status` | v1.0 | 126 |
| `10131` | `Composition.subject` | Elemen wajib | — | v1.0 | 127 |
| `10134` | `Composition.title` | Elemen wajib | — | v1.0 | 128 |
| — | `Composition.type` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/composition-type` | v1.0 | 129 |
| `10021` | `Composition.type.coding` | Terminologi atau system | `http://loinc.org` | v1.0 | 130 |
| `10409` | `Condition.bodySite` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/clinical-term` | v1.0 | 131 |
| `10007` | `Condition.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/condition-category` | v1.0 | 132 |
| `10007` | `Condition.category` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 133 |
| `10006` | `Condition.clinicalStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/condition-clinical` | v1.0 | 134 |
| `10003` | `Condition.code` | Terminologi atau system | — | v1.0 | 135 |
| `10126` | `Condition.encounter` | Elemen wajib | — | v1.0 | 136 |
| `10410` | `Condition.evidence.code` | Terminologi atau system | — | v1.0 | 137 |
| `10444` | `Condition.identifier` | Terminologi atau system | — | v1.0 | 138 |
| `10844` | `Condition.onsetAge.code` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 139 |
| `10843` | `Condition.onsetAge.value` | Tipe nilai | `decimal` | v2.0 | 140 |
| `10402` | `Condition.onsetDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 141 |
| `10842` | `Condition.onsetPeriod.end` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 142 |
| `10841` | `Condition.onsetPeriod.start` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 143 |
| `10403` | `Condition.recordedDate` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 144 |
| `10678` | `Condition.recorder` | Referensi | `Practitioner` | v2.0 | 145 |
| `10825` | `Condition.stage.assessment` | Referensi | — | v2.0 | 146 |
| `10411` | `Condition.stage.summary` | Terminologi atau system | — | v1.0 | 147 |
| `10412` | `Condition.stage.type` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 148 |
| `10125` | `Condition.subject` | Elemen wajib | — | v1.0 | 149 |
| `10170` | `Condition.verificationStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/condition-ver-status` | v1.0 | 150 |
| — | `Coverage.identifier` | Terminologi atau system | `https://sys-ids.kemkes.go.id/insurance` | v2.0 | 151 |
| `10900` | `Coverage.payor.display` | Elemen wajib | — | v2.0 | 152 |
| `10212` | `CoverageEligibilityResponse.insurance.coverage` | Referensi | `Coverage` | v2.0 | 153 |
| `10776` | `CoverageEligibilityResponse.insurance.item.benefit.allowedMoney.currency` | Terminologi atau system | — | v2.0 | 154 |
| `10776` | `CoverageEligibilityResponse.insurance.item.benefit.allowedMoney.value` | Tipe nilai | `decimal` | v2.0 | 155 |
| `10775` | `CoverageEligibilityResponse.insurance.item.benefit.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/benefit-type` | v2.0 | 156 |
| `10208` | `CoverageEligibilityResponse.request` | Referensi | `CoverageEligibilityRequest` | v2.0 | 157 |
| `10387` | `DiagnosticReport.basedOn` | Aturan spesifik | — | v1.0 | 158 |
| `10073` | `DiagnosticReport.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v2-0074` | v1.0 | 159 |
| `10071` | `DiagnosticReport.code` | Terminologi atau system | — | v1.0 | 160 |
| — | `DiagnosticReport.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/examination` | v1.0 | 161 |
| `10074` | `DiagnosticReport.conclusionCode` | Terminologi atau system | — | v1.0 | 162 |
| `10379` | `DiagnosticReport.effectiveDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 163 |
| `10145` | `DiagnosticReport.encounter` | Elemen wajib | — | v1.0 | 164 |
| `10432` | `DiagnosticReport.identifier` | Referensi | — | v1.0 | 165 |
| `10359` | `DiagnosticReport.issued` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 166 |
| `10384` | `DiagnosticReport.performer` | Aturan spesifik | — | v1.0 | 167 |
| `10385` | `DiagnosticReport.result` | Aturan spesifik | — | v1.0 | 168 |
| `10386` | `DiagnosticReport.specimen` | Aturan spesifik | — | v1.0 | 169 |
| `10072` | `DiagnosticReport.status` | Terminologi atau system | `http://hl7.org/fhir/diagnostic-report-status` | v1.0 | 170 |
| `10144` | `DiagnosticReport.subject` | Elemen wajib | — | v1.0 | 171 |
| `10502` | `DocumentReference.date` | Elemen wajib | — | v2.0 | 172 |
| `10304` | `Encounter.classHistory.class` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-ActCode` | v1.0 | 173 |
| `10303` | `Encounter.classHistory.period.end` | Tanggal, waktu atau periode | `datetime` | v1.0 | 174 |
| `10302` | `Encounter.classHistory.period.start` | Tanggal, waktu atau periode | `datetime` | v1.0 | 175 |
| `10317` | `Encounter.diagnosis.use` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/diagnosis-role` | v1.0 | 176 |
| `10430` | `Encounter.episodeOfCare` | Referensi | — | v1.0 | 177 |
| `10319` | `Encounter.hospitalization.admitSource` | Terminologi atau system | — | v1.0 | 178 |
| `10319` | `Encounter.hospitalization.admitSource.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 179 |
| `10320` | `Encounter.hospitalization.dietPreference` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/diet` | v1.0 | 180 |
| `10318` | `Encounter.hospitalization.dischargeDisposition` | Terminologi atau system | — | v1.0 | 181 |
| `10321` | `Encounter.hospitalization.reAdmission` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v2-0092` | v1.0 | 182 |
| `10322` | `Encounter.hospitalization.specialArrangement` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/encounter-special-arrangements` | v1.0 | 183 |
| `10117` | `Encounter.identifier` | Terminologi atau system | — | v1.0 | 184 |
| `10117` | `Encounter.identifier` | Elemen wajib | — | v1.0 | 185 |
| `10117` | `Encounter.identifier.system` | Terminologi atau system | — | v2.0 | 186 |
| `10117` | `Encounter.identifier.system` | Terminologi atau system | — | v2.0 | 187 |
| `10840` | `Encounter.length.code` | Terminologi atau system | — | v2.0 | 188 |
| `10839` | `Encounter.length.value` | Tipe nilai | `decimal` | v2.0 | 189 |
| `10165` | `Encounter.location.extension:serviceClass.upgradeClassIndicator` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/locationUpgradeClass` | v1.0 | 190 |
| `10164` | `Encounter.location.extension:serviceClass.value.valueCodeableConcept.coding.system` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass` | v1.0 | 191 |
| `10120` | `Encounter.location.location` | Elemen wajib | — | v1.0 | 192 |
| `10291` | `Encounter.location.period.end` | Tanggal, waktu atau periode | `datetime` | v1.0 | 193 |
| `10290` | `Encounter.location.period.start` | Tanggal, waktu atau periode | `datetime` | v1.0 | 194 |
| `10325` | `Encounter.location.status` | Terminologi atau system | `http://hl7.org/fhir/encounter-location-status` | v1.0 | 195 |
| `10336` | `Encounter.participant` | Aturan spesifik | — | v1.0 | 196 |
| `10119` | `Encounter.participant.individual` | Elemen wajib | — | v1.0 | 197 |
| `10301` | `Encounter.participant.period.end` | Tanggal, waktu atau periode | `datetime` | v1.0 | 198 |
| `10121` | `Encounter.period` | Aturan spesifik | — | v2.0 | 199 |
| `10173` | `Encounter.period.end` | Aturan spesifik | — | v1.0 | 200 |
| `10123` | `Encounter.period.start` | Elemen wajib | — | v1.0 | 201 |
| `10328` | `Encounter.priority` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-ActPriority` | v1.0 | 202 |
| `10326` | `Encounter.reasonCode` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 203 |
| `10782` | `Encounter.reasonCode.coding` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 204 |
| `10782` | `Encounter.reasonCode.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 205 |
| `10124` | `Encounter.serviceProvider` | Referensi wajib | — | v1.0 | 206 |
| `10327` | `Encounter.serviceType` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/service-type` | v1.0 | 207 |
| `10121` | `Encounter.status` | Elemen wajib | — | v1.0 | 208 |
| `10122` | `Encounter.statusHistory` | Elemen wajib | — | v1.0 | 209 |
| `10118` | `Encounter.subject` | Elemen wajib | — | v1.0 | 210 |
| `10111` | `EpisodeOfCare.diagnosis.role` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/diagnosis-role` | v1.0 | 211 |
| `10458` | `EpisodeOfCare.identifier` | Terminologi atau system | — | v1.0 | 212 |
| `10408` | `EpisodeOfCare.managingOrganization` | Referensi | — | v1.0 | 213 |
| `10157` | `EpisodeOfCare.patient` | Elemen wajib | — | v1.0 | 214 |
| `10407` | `EpisodeOfCare.period.end` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 215 |
| `10406` | `EpisodeOfCare.period.start` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 216 |
| `10109` | `EpisodeOfCare.status` | Terminologi atau system | `http://hl7.org/fhir/episode-of-care-status` | v1.0 | 217 |
| `10405` | `EpisodeOfCare.statusHistory.period.end` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 218 |
| `10404` | `EpisodeOfCare.statusHistory.period.start` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 219 |
| `10110` | `EpisodeOfCare.type` | Terminologi atau system | — | v1.0 | 220 |
| `10110` | `EpisodeOfCare.type` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 221 |
| `10707` | `FamilyMemberHistory.condition.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 222 |
| `10709` | `FamilyMemberHistory.condition.contributedToDeath` | Tipe nilai | `boolean` | v2.0 | 223 |
| `10695` | `FamilyMemberHistory.condition.onsetAge` | Aturan spesifik | — | v2.0 | 224 |
| `10697` | `FamilyMemberHistory.condition.onsetPeriod.end` | Tanggal, waktu atau periode | `period` | v2.0 | 225 |
| `10696` | `FamilyMemberHistory.condition.onsetPeriod.start` | Tanggal, waktu atau periode | `period` | v2.0 | 226 |
| `10699` | `FamilyMemberHistory.condition.onsetRange.high.value` | Tipe nilai | `decimal` | v2.0 | 227 |
| `10698` | `FamilyMemberHistory.condition.onsetRange.low.value` | Tipe nilai | `decimal` | v2.0 | 228 |
| `10700` | `FamilyMemberHistory.condition.onsetString` | Tipe nilai | `string` | v2.0 | 229 |
| `10708` | `FamilyMemberHistory.condition.outcome` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 230 |
| `10702` | `FamilyMemberHistory.deceasedAge` | Aturan spesifik | — | v2.0 | 231 |
| `10701` | `FamilyMemberHistory.deceasedBoolean` | Tipe nilai | `boolean` | v2.0 | 232 |
| `10705` | `FamilyMemberHistory.deceasedDate` | Tanggal, waktu atau periode | `date` | v2.0 | 233 |
| `10704` | `FamilyMemberHistory.deceasedRange.high.value` | Tipe nilai | `decimal` | v2.0 | 234 |
| `10703` | `FamilyMemberHistory.deceasedRange.low.value` | Tipe nilai | `decimal` | v2.0 | 235 |
| `10706` | `FamilyMemberHistory.deceasedString` | Tipe nilai | `string` | v2.0 | 236 |
| `10158` | `FamilyMemberHistory.patient` | Elemen wajib | — | v1.0 | 237 |
| `10158` | `FamilyMemberHistory.patient` | Referensi | `Patient` | v2.0 | 238 |
| `10114` | `FamilyMemberHistory.relationship` | Terminologi atau system | — | v1.0 | 239 |
| `10113` | `FamilyMemberHistory.status` | Terminologi atau system | `http://hl7.org/fhir/codesystem-history-status.html` | v1.0 | 240 |
| `10731` | `Goal.achievementStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/goal-achievement` | v2.0 | 241 |
| `10826` | `Goal.addresses` | Referensi | — | v2.0 | 242 |
| `10732` | `Goal.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/goal-category` | v2.0 | 243 |
| `10733` | `Goal.description` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 244 |
| `10751` | `Goal.expressedBy` | Referensi | `Practitioner` | v2.0 | 245 |
| `10730` | `Goal.lifecycleStatus` | Terminologi atau system | `http://hl7.org/fhir/goal-status` | v2.0 | 246 |
| `10752` | `Goal.outcomeCode` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 247 |
| `10752` | `Goal.outcomeCode` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 248 |
| `10753` | `Goal.outcomeReference` | Referensi | `Observation` | v2.0 | 249 |
| `10846` | `Goal.statusDate` | Tanggal, waktu atau periode | `date` | v2.0 | 250 |
| `10734` | `Goal.subject` | Referensi | `Patient` | v2.0 | 251 |
| `10742` | `Goal.target.detailBoolean` | Tipe nilai | `boolean` | v2.0 | 252 |
| `10740` | `Goal.target.detailCodeableConcept` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 253 |
| `10743` | `Goal.target.detailInteger` | Tipe nilai | `integer` | v2.0 | 254 |
| `10737` | `Goal.target.detailQuantity.code` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 255 |
| `10736` | `Goal.target.detailQuantity.value` | Tipe nilai | `decimal` | v2.0 | 256 |
| `10738` | `Goal.target.detailRange.high.value` | Tipe nilai | `decimal` | v2.0 | 257 |
| `10739` | `Goal.target.detailRange.low.value` | Tipe nilai | `decimal` | v2.0 | 258 |
| `10746` | `Goal.target.detailRatio.denominator.system` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 259 |
| `10747` | `Goal.target.detailRatio.denominator.value` | Tipe nilai | `decimal` | v2.0 | 260 |
| `10744` | `Goal.target.detailRatio.numerator.system` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 261 |
| `10745` | `Goal.target.detailRatio.numerator.value` | Tipe nilai | `decimal` | v2.0 | 262 |
| `10741` | `Goal.target.detailString` | Tipe nilai | `string` | v2.0 | 263 |
| `10748` | `Goal.target.dueDate` | Tanggal, waktu atau periode | `date` | v2.0 | 264 |
| `10750` | `Goal.target.dueDuration` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 265 |
| `10735` | `Goal.target.measure` | Terminologi atau system | `http://loinc.org` | v2.0 | 266 |
| `10154` | `ImagingStudy.basedOn` | Elemen wajib | — | v1.0 | 267 |
| `10150` | `ImagingStudy.identifier` | Elemen wajib | — | v1.0 | 268 |
| `10152` | `ImagingStudy.modality` | Elemen wajib | — | v1.0 | 269 |
| `10424` | `ImagingStudy.started` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 270 |
| `10151` | `ImagingStudy.status` | Elemen wajib | — | v1.0 | 271 |
| `10153` | `ImagingStudy.subject` | Elemen wajib | — | v1.0 | 272 |
| `10293` | `Immunization.encounter` | Elemen wajib | — | v1.0 | 273 |
| `10307` | `Immunization.expirationDate` | Aturan spesifik | — | v1.0 | 274 |
| `10307` | `Immunization.expirationDate` | Aturan spesifik | — | v2.0 | 275 |
| `10426` | `Immunization.fundingSource` | Terminologi atau system | — | v1.0 | 276 |
| `10305` | `Immunization.location` | Elemen wajib | — | v1.0 | 277 |
| `10306` | `Immunization.lotNumber` | Elemen wajib | — | v1.0 | 278 |
| `10156` | `Immunization.occurrence[x]` | Elemen wajib | — | v1.0 | 279 |
| `10155` | `Immunization.patient` | Elemen wajib | — | v1.0 | 280 |
| `10294` | `Immunization.performer.actor` | Elemen wajib | — | v1.0 | 281 |
| `10104` | `Immunization.performer.function` | Terminologi atau system | `http://terminology.hl7.org/3.1.0/CodeSystem-v2-0443.html` | v1.0 | 282 |
| `10292` | `Immunization.primarySource` | Elemen wajib | — | v1.0 | 283 |
| `10450` | `Immunization.protocolApplied` | Aturan spesifik | — | v1.0 | 284 |
| `10456` | `Immunization.protocolApplied.doseNumberPositiveInt` | Aturan spesifik | — | v1.0 | 285 |
| `10819` | `Immunization.reaction.date` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 286 |
| `10820` | `Immunization.reaction.detail` | Referensi | — | v2.0 | 287 |
| `10105` | `Immunization.reasonCode` | Terminologi atau system | — | v1.0 | 288 |
| `10451` | `Immunization.recorded` | Aturan spesifik | — | v1.0 | 289 |
| `10106` | `Immunization.reportOrigin` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/immunization-origin` | v1.0 | 290 |
| `10107` | `Immunization.status` | Terminologi atau system | `http://hl7.org/fhir/event-status` | v1.0 | 291 |
| `10108` | `Immunization.statusReason` | Terminologi atau system | — | v1.0 | 292 |
| `10103` | `Immunization.vaccineCode` | Terminologi atau system | — | v1.0 | 293 |
| `10234` | `Invoice.account` | Referensi | `Account` | v2.0 | 294 |
| `10236` | `Invoice.chargeItemRefrence` | Referensi | `ChargeItem` | v2.0 | 295 |
| `10233` | `Invoice.issuer` | Referensi | `Organization` | v2.0 | 296 |
| `10811` | `Invoice.lineItem.priceComponent.amount.currency` | Terminologi atau system | — | v2.0 | 297 |
| `10811` | `Invoice.lineItem.priceComponent.amount.value` | Aturan spesifik | — | v2.0 | 298 |
| `10513` | `Invoice.lineItem.priceComponent.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/kptl` | v2.0 | 299 |
| `10513` | `Invoice.lineItem.priceComponent.code` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v2.0 | 300 |
| `10231` | `Invoice.subject` | Referensi | `Patient` | v2.0 | 301 |
| `10812` | `Invoice.totalNet.currency` | Terminologi atau system | — | v2.0 | 302 |
| `10812` | `Invoice.totalNet.value` | Aturan spesifik | — | v2.0 | 303 |
| `10101` | `Location.address.type` | Terminologi atau system | `http://hl7.org/fhir/address-type` | v1.0 | 304 |
| `10100` | `Location.address.use` | Terminologi atau system | `http://hl7.org/fhir/address-use` | v1.0 | 305 |
| `10163` | `Location.extension.serviceClass` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/locationServiceClass` | v1.0 | 306 |
| `10447` | `Location.identifier` | Terminologi atau system | — | v1.0 | 307 |
| `10097` | `Location.mode` | Terminologi atau system | `http://hl7.org/fhir/location-mode` | v1.0 | 308 |
| `10096` | `Location.operationalStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v2-0116` | v1.0 | 309 |
| `10171` | `Location.operationalStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v2-0116` | v1.0 | 310 |
| `10102` | `Location.physicalType` | Terminologi atau system | — | v1.0 | 311 |
| `10095` | `Location.status` | Terminologi atau system | `http://hl7.org/fhir/location-status` | v1.0 | 312 |
| `10098` | `Location.telecom.system` | Terminologi atau system | `http://hl7.org/fhir/contact-point-system` | v1.0 | 313 |
| `10099` | `Location.telecom.use` | Terminologi atau system | `http://hl7.org/fhir/contact-point-use` | v1.0 | 314 |
| `10172` | `Location.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-RoleCode` | v1.0 | 315 |
| `10172` | `Location.type` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/location-type` | v1.0 | 316 |
| `10310` | `Medication.batch.expirationDate` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 317 |
| `10309` | `Medication.batch.lotnumber` | Aturan spesifik | — | v1.0 | 318 |
| `10024` | `Medication.code` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v1.0 | 319 |
| `10024` | `Medication.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 320 |
| `10031` | `Medication.extension.valueCodableConcept.coding` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/medication-type` | v1.0 | 321 |
| `10025` | `Medication.form` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/medication-form` | v1.0 | 322 |
| `10380` | `Medication.identifier` | Elemen wajib | — | v1.0 | 323 |
| `10030` | `Medication.ingredient.itemCodableConcept.coding` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v1.0 | 324 |
| `10028` | `Medication.ingredient.strength.denominator` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 325 |
| `10028` | `Medication.ingredient.strength.denominator` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v1.0 | 326 |
| `10028` | `Medication.ingredient.strength.denominator` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 327 |
| `10335` | `Medication.ingredient.strength.denominator.value` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v1.0 | 328 |
| `10027` | `Medication.ingredient.strength.numerator` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 329 |
| `10334` | `Medication.ingredient.strength.numerator.value` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 330 |
| `10391` | `Medication.manufacturer` | Referensi | — | v1.0 | 331 |
| `10026` | `Medication.status` | Terminologi atau system | `http://hl7.org/fhir/CodeSystem/medication-status` | v1.0 | 332 |
| `10849` | `MedicationAdministration.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medication-admin-category` | v2.0 | 333 |
| `10760` | `MedicationAdministration.context` | Referensi | `Encounter` | v2.0 | 334 |
| `10852` | `MedicationAdministration.dosage.dose` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v2.0 | 335 |
| `10852` | `MedicationAdministration.dosage.dose` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 336 |
| `10852` | `MedicationAdministration.dosage.dose` | Terminologi atau system | `https://terminology.kemkes.go.id/CodeSystem/smallest-logistic-unit` | v2.0 | 337 |
| `10852` | `MedicationAdministration.dosage.dose.code` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 338 |
| `10769` | `MedicationAdministration.dosage.dose.value` | Tipe nilai | `decimal` | v2.0 | 339 |
| `10768` | `MedicationAdministration.dosage.method` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 340 |
| `10774` | `MedicationAdministration.dosage.rateQuantity.value` | Tipe nilai | `decimal` | v2.0 | 341 |
| `10772` | `MedicationAdministration.dosage.rateRatio.denominator.system` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 342 |
| `10773` | `MedicationAdministration.dosage.rateRatio.denominator.value` | Tipe nilai | `decimal` | v2.0 | 343 |
| `10770` | `MedicationAdministration.dosage.rateRatio.numerator.system` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 344 |
| `10771` | `MedicationAdministration.dosage.rateRatio.numerator.value` | Tipe nilai | `decimal` | v2.0 | 345 |
| `10767` | `MedicationAdministration.dosage.route` | Terminologi atau system | — | v2.0 | 346 |
| `10766` | `MedicationAdministration.dosage.site` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 347 |
| `10761` | `MedicationAdministration.effectiveDateTime` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 348 |
| `10851` | `MedicationAdministration.effectivePeriod.end` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 349 |
| `10850` | `MedicationAdministration.effectivePeriod.start` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 350 |
| `10848` | `MedicationAdministration.manufacturer` | Referensi | `Organization` | v2.0 | 351 |
| `10757` | `MedicationAdministration.medicationCodeableConcept` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v2.0 | 352 |
| `10758` | `MedicationAdministration.medicationReference` | Referensi | `Medication` | v2.0 | 353 |
| `10756` | `MedicationAdministration.partOf` | Referensi | — | v2.0 | 354 |
| `10762` | `MedicationAdministration.performer.actor` | Referensi | `Practitioner` | v2.0 | 355 |
| `10763` | `MedicationAdministration.reasonCode` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/reason-medication-given` | v2.0 | 356 |
| `10764` | `MedicationAdministration.reasonReference` | Referensi | — | v2.0 | 357 |
| `10765` | `MedicationAdministration.request` | Referensi | `MedicationRequest` | v2.0 | 358 |
| `10755` | `MedicationAdministration.status` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medication-admin-status` | v2.0 | 359 |
| `10759` | `MedicationAdministration.subject` | Referensi | `Patient` | v2.0 | 360 |
| `10394` | `MedicationDispense.authorizingPrescription` | Aturan spesifik | — | v1.0 | 361 |
| `10048` | `MedicationDispense.category` | Terminologi atau system | `http://terminology.hl7.org/fhir/CodeSystem/medicationdispense-category` | v1.0 | 362 |
| `10390` | `MedicationDispense.context` | Aturan spesifik | — | v1.0 | 363 |
| `10051` | `MedicationDispense.daysSupply.code` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 364 |
| `10350` | `MedicationDispense.daysSupply.value` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 365 |
| `10054` | `MedicationDispense.dosageInstruction.additionalInstruction` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 366 |
| `10357` | `MedicationDispense.dosageInstruction.doseAndRate.doseQuantity.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v1.0 | 367 |
| `10357` | `MedicationDispense.dosageInstruction.doseAndRate.doseQuantity.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 368 |
| `10356` | `MedicationDispense.dosageInstruction.doseAndRate.doseQuantity.value` | Tipe nilai | — | v1.0 | 369 |
| `10053` | `MedicationDispense.dosageInstruction.doseAndRate.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/dose-rate-type` | v1.0 | 370 |
| `10057` | `MedicationDispense.dosageInstruction.doseAndRate.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/dose-rate-type` | v1.0 | 371 |
| `10056` | `MedicationDispense.dosageInstruction.route` | Terminologi atau system | — | v1.0 | 372 |
| `10353` | `MedicationDispense.dosageInstruction.sequence` | Tipe nilai | — | v1.0 | 373 |
| `10784` | `MedicationDispense.dosageInstruction.site` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 374 |
| `10055` | `MedicationDispense.dosageInstruction.timing.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation` | v1.0 | 375 |
| `10052` | `MedicationDispense.dosageInstruction.timing.periodUnit` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 376 |
| `10354` | `MedicationDispense.dosageInstruction.timing.repeat.frequency` | Tipe nilai | — | v1.0 | 377 |
| `10355` | `MedicationDispense.dosageInstruction.timing.repeat.period` | Tipe nilai | — | v1.0 | 378 |
| `10058` | `MedicationDispense.dosageInstruction.timing.repeat.when` | Terminologi atau system | `http://hl7.org/fhir/ValueSet/event-timing` | v1.0 | 379 |
| `10389` | `MedicationDispense.identifier` | Elemen wajib | — | v1.0 | 380 |
| `10389` | `MedicationDispense.identifier` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/coverage-type` | v2.0 | 381 |
| `10389` | `MedicationDispense.identifier` | Terminologi atau system | — | v2.0 | 382 |
| `10389` | `MedicationDispense.identifier` | Terminologi atau system | — | v2.0 | 383 |
| `10389` | `MedicationDispense.identifier` | Terminologi atau system | — | v2.0 | 384 |
| `10393` | `MedicationDispense.location` | Aturan spesifik | — | v1.0 | 385 |
| `10138` | `MedicationDispense.medication` | Elemen wajib | — | v1.0 | 386 |
| `10138` | `MedicationDispense.medicationReference` | Aturan spesifik | — | v1.0 | 387 |
| `10392` | `MedicationDispense.performer` | Referensi | `Practitioner` | v1.0 | 388 |
| `10050` | `MedicationDispense.quantity.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v1.0 | 389 |
| `10049` | `MedicationDispense.status` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medicationdispense-status` | v1.0 | 390 |
| `10049` | `MedicationDispense.status` | Elemen wajib | — | v1.0 | 391 |
| `10139` | `MedicationDispense.subject` | Elemen wajib | — | v1.0 | 392 |
| `10674` | `MedicationDispense.substitution.reason.coding` | Terminologi atau system | — | v2.0 | 393 |
| `10676` | `MedicationDispense.substitution.responsibleParty` | Referensi | `Practitioner` | v2.0 | 394 |
| `10675` | `MedicationDispense.substitution.type.coding` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-substanceAdminSubstitution` | v2.0 | 395 |
| `10352` | `MedicationDispense.whenHandedOver` | Tanggal, waktu atau periode | `datetime` | v1.0 | 396 |
| `10351` | `MedicationDispense.whenPrepared` | Tanggal, waktu atau periode | `datetime` | v1.0 | 397 |
| `10337` | `MedicationRequest.authoredOn` | Tanggal, waktu atau periode | `datetime` | v1.0 | 398 |
| `10337` | `MedicationRequest.authoredOn` | Elemen wajib | — | v2.0 | 399 |
| `10034` | `MedicationRequest.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medicationrequest-category` | v1.0 | 400 |
| `10045` | `MedicationRequest.courseOfTherapyType` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medicationrequest-course-of-therapy` | v1.0 | 401 |
| `10042` | `MedicationRequest.dispenseRequest.dispenseInterval` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 402 |
| `10344` | `MedicationRequest.dispenseRequest.dispenseInterval.value` | Tipe nilai | — | v1.0 | 403 |
| `10043` | `MedicationRequest.dispenseRequest.expectedSupplyDuration` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 404 |
| `10347` | `MedicationRequest.dispenseRequest.expectedSupplyDuration.value` | Tipe nilai | — | v1.0 | 405 |
| `10041` | `MedicationRequest.dispenseRequest.initialFill.duration` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 406 |
| `10345` | `MedicationRequest.dispenseRequest.numberOfRepeatsAllowed` | Tipe nilai | — | v1.0 | 407 |
| `10453` | `MedicationRequest.dispenseRequest.performer` | Referensi | — | v1.0 | 408 |
| `10348` | `MedicationRequest.dispenseRequest.quantity.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 409 |
| `10348` | `MedicationRequest.dispenseRequest.quantity.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm` | v1.0 | 410 |
| `10348` | `MedicationRequest.dispenseRequest.quantity.code` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 411 |
| `10346` | `MedicationRequest.dispenseRequest.quantity.value` | Tipe nilai | — | v1.0 | 412 |
| `10339` | `MedicationRequest.dispenseRequest.validityPeriod.end` | Tanggal, waktu atau periode | `datetime` | v1.0 | 413 |
| `10338` | `MedicationRequest.dispenseRequest.validityPeriod.start` | Tanggal, waktu atau periode | `datetime` | v1.0 | 414 |
| `10047` | `MedicationRequest.dosageInstruction.additionalInstruction.coding.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 415 |
| `10349` | `MedicationRequest.dosageInstruction.doseAndRate.doseQuantity.code` | Terminologi atau system | — | v1.0 | 416 |
| `10343` | `MedicationRequest.dosageInstruction.doseAndRate.doseQuantity.value` | Tipe nilai | — | v1.0 | 417 |
| `10039` | `MedicationRequest.dosageInstruction.doseAndRate.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/dose-rate-type` | v1.0 | 418 |
| `10040` | `MedicationRequest.dosageInstruction.method` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 419 |
| `10038` | `MedicationRequest.dosageInstruction.route` | Terminologi atau system | — | v1.0 | 420 |
| `10340` | `MedicationRequest.dosageInstruction.sequence` | Tipe nilai | — | v1.0 | 421 |
| `10037` | `MedicationRequest.dosageInstruction.site` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 422 |
| `10046` | `MedicationRequest.dosageInstruction.timing.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-GTSAbbreviation` | v1.0 | 423 |
| `10036` | `MedicationRequest.dosageInstruction.timing.periodUnit` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 424 |
| `10341` | `MedicationRequest.dosageInstruction.timing.repeat.frequency` | Tipe nilai | — | v1.0 | 425 |
| `10342` | `MedicationRequest.dosageInstruction.timing.repeat.period` | Tipe nilai | — | v1.0 | 426 |
| `10454` | `MedicationRequest.encounter` | Aturan spesifik | — | v1.0 | 427 |
| `10388` | `MedicationRequest.identifier` | Elemen wajib | — | v1.0 | 428 |
| `10388` | `MedicationRequest.identifier` | Terminologi atau system | — | v2.0 | 429 |
| `10033` | `MedicationRequest.intent` | Terminologi atau system | `http://hl7.org/fhir/CodeSystem/medicationrequest-intent` | v1.0 | 430 |
| `10135` | `MedicationRequest.medication[x]` | Elemen wajib | — | v1.0 | 431 |
| `10135` | `MedicationRequest.medicationReference` | Referensi | `Medication` | v1.0 | 432 |
| `10044` | `MedicationRequest.priority` | Terminologi atau system | `http://hl7.org/fhir/request-priority` | v1.0 | 433 |
| `10035` | `MedicationRequest.reasonCode` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 434 |
| `10455` | `MedicationRequest.requester` | Aturan spesifik | — | v1.0 | 435 |
| `10032` | `MedicationRequest.status` | Terminologi atau system | `http://hl7.org/fhir/CodeSystem/medicationrequest-status` | v1.0 | 436 |
| `10136` | `MedicationRequest.subject` | Elemen wajib | — | v1.0 | 437 |
| `10436` | `MedicationStatement.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/medication-statement-category` | v1.0 | 438 |
| `10438` | `MedicationStatement.context` | Aturan spesifik | — | v1.0 | 439 |
| `10299` | `MedicationStatement.dateAsserted` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 440 |
| `10783` | `MedicationStatement.dosage.site` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 441 |
| `10437` | `MedicationStatement.dosage.timing.periodUnit` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 442 |
| `10445` | `MedicationStatement.identifier` | Terminologi atau system | — | v1.0 | 443 |
| `10439` | `MedicationStatement.informationSource` | Referensi | — | v1.0 | 444 |
| `10160` | `MedicationStatement.medication[x]` | Aturan spesifik | — | v1.0 | 445 |
| `10160` / `10433` | `MedicationStatement.medication[x]` | Elemen wajib | — | v1.0 | 446 |
| `10433` | `MedicationStatement.medicationCodeableConcept` | Terminologi atau system | `http://sys-ids.kemkes.go.id/kfa` | v1.0 | 447 |
| `10433` | `MedicationStatement.medicationCodeableConcept` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 448 |
| `10159` | `MedicationStatement.status` | Elemen wajib | — | v1.0 | 449 |
| `10161` | `MedicationStatement.subject` | Elemen wajib | — | v1.0 | 450 |
| `10828` | `NutritionOrder.excludeFoodModifier` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 451 |
| `10827` | `NutritionOrder.foodPreferenceModifier` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/diet` | v2.0 | 452 |
| `10011` | `Observation.bodySite` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 453 |
| `10009` | `Observation.category` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/observation-category` | v1.0 | 454 |
| `10010` | `Observation.code` | Aturan spesifik | — | v1.0 | 455 |
| `10010` | `Observation.code` | Terminologi atau system | `http://loinc.org` | v1.0 | 456 |
| `10010` | `Observation.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 457 |
| `10010` | `Observation.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/examination` | v1.0 | 458 |
| `10010` | `Observation.code.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 459 |
| `10434` | `Observation.component.code` | Terminologi atau system | — | v1.0 | 460 |
| `10434` | `Observation.component.code` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 461 |
| `10434` | `Observation.component.code.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 462 |
| `10435` | `Observation.component.valueCodeableConcept` | Terminologi atau system | — | v2.0 | 463 |
| `10435` | `⁠Observation.component.valueCodeableConcept` | Terminologi atau system | — | v1.0 | 464 |
| `10862` | `Observation.component.valueQuantity.code` | Terminologi atau system | `http://unitsofmeasure.org` | v2.0 | 465 |
| `10332` | `Observation.component.valueQuantity.value` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 466 |
| `10428` | `Observation.derivedFrom` | Referensi | — | v1.0 | 467 |
| `10295` | `Observation.effectiveDateTime` | Tanggal, waktu atau periode | `datetime` | v1.0 | 468 |
| `10130` | `Observation.encounter` | Elemen wajib | — | v1.0 | 469 |
| `10861` | `Observation.hasMember` | Referensi | — | v2.0 | 470 |
| `10441` | `Observation.identifier` | Terminologi atau system | — | v1.0 | 471 |
| `10398` | `Observation.interpretation` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/examination` | v1.0 | 472 |
| `10398` | `Observation.interpretation.coding.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 473 |
| `10398` | `Observation.interpretation.coding.code` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation` | v1.0 | 474 |
| `10398` | `Observation.interpretation.coding.code` | Terminologi atau system | `http://loinc.org` | v2.0 | 475 |
| `10296` | `Observation.issued` | Tanggal, waktu atau periode | `datetime` | v1.0 | 476 |
| `10416` | `Observation.method` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/clinical-term` | v1.0 | 477 |
| `10383` | `Observation.performer` | Aturan spesifik | — | v1.0 | 478 |
| `10381` | `Observation.referenceRange.high.code` | Terminologi atau system | — | v1.0 | 479 |
| `10381` | `Observation.referenceRange.high.code` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 480 |
| `10368` | `Observation.referenceRange.high.value` | Tipe nilai | — | v1.0 | 481 |
| `10382` | `Observation.referenceRange.low.code` | Terminologi atau system | — | v1.0 | 482 |
| `10369` | `Observation.referenceRange.low.value` | Tipe nilai | — | v1.0 | 483 |
| `10008` | `Observation.status` | Terminologi atau system | `http://hl7.org/fhir/observation-status` | v1.0 | 484 |
| `10129` | `Observation.subject` | Elemen wajib | — | v1.0 | 485 |
| `10297` | `Observation.valueCodeableConcept` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 486 |
| `10297` | `Observation.valueCodeableConcept` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 487 |
| `10297` | `Observation.valueCodeableConcept` | Terminologi atau system | — | v1.0 | 488 |
| `10297` | `Observation.valueCodeableConcept` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/tb-case-definition` | v2.0 | 489 |
| `10297` | `Observation.valueCodeableConcept.coding` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 490 |
| `10429` | `Observation.valueDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 491 |
| `10012` | `Observation.valueQuantity.code` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 492 |
| `10331` | `Observation.valueQuantity.value` | Terminologi atau system | `http://unitsofmeasure.org` | v1.0 | 493 |
| `10669` | `Observation.valueTime` | Aturan spesifik | — | v2.0 | 494 |
| `10093` | `Organization.address.type` | Terminologi atau system | `http://hl7.org/fhir/address-type` | v1.0 | 495 |
| `10092` | `Organization.address.use` | Terminologi atau system | `http://hl7.org/fhir/address-use` | v1.0 | 496 |
| `10094` | `Organization.contact.purpose` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/contactentity-type` | v1.0 | 497 |
| `10446` | `Organization.identifier` | Terminologi atau system | — | v1.0 | 498 |
| `10090` | `Organization.telecom.system` | Terminologi atau system | `http://hl7.org/fhir/contact-point-system` | v1.0 | 499 |
| `10091` | `Organization.telecom.use` | Terminologi atau system | `http://hl7.org/fhir/contact-point-use` | v1.0 | 500 |
| `10089` | `Organization.type` | Terminologi atau system | — | v1.0 | 501 |
| `10333` | `Patient.address` | Aturan spesifik | — | v1.0 | 502 |
| `10397` | `Patient.birthDate` | Elemen wajib | — | v1.0 | 503 |
| `10413` | `Patient.gender` | Elemen wajib | — | v1.0 | 504 |
| `10166` | `Patient.identifier` | Elemen wajib | — | v1.0 | 505 |
| `10167` | `Patient.multipleBirthInteger` | Elemen wajib | — | v1.0 | 506 |
| `10168` | `Patient.name.text` | Elemen wajib | — | v1.0 | 507 |
| `10634` | `PaymentNotice.amount.currency` | Terminologi atau system | — | v2.0 | 508 |
| `10634` | `PaymentNotice.amount.value` | Tipe nilai | `decimal` | v2.0 | 509 |
| `10632` | `PaymentNotice.created` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 510 |
| `10659` | `PaymentNotice.payee` | Referensi | `Organization` | v2.0 | 511 |
| `10635` | `PaymentNotice.payment` | Referensi | `PaymentReconciliation` | v2.0 | 512 |
| `10633` | `PaymentNotice.paymentDate` | Tanggal, waktu atau periode | `date` | v2.0 | 513 |
| `10636` | `PaymentNotice.paymentStatus` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/payment-status` | v2.0 | 514 |
| `10660` | `PaymentNotice.provider` | Referensi | `Organization` | v2.0 | 515 |
| `10661` | `PaymentNotice.recipient` | Referensi | `Organization` | v2.0 | 516 |
| `10655` | `PaymentNotice.request` | Referensi | — | v2.0 | 517 |
| `10656` | `PaymentNotice.response` | Referensi | `ClaimResponse` | v2.0 | 518 |
| `10631` | `PaymentNotice.status` | Terminologi atau system | `http://hl7.org/fhir/fm-status` | v2.0 | 519 |
| `10640` | `PaymentReconciliation.created` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 520 |
| `10653` | `PaymentReconciliation.detail.request` | Referensi | — | v2.0 | 521 |
| `10654` | `PaymentReconciliation.detail.response` | Referensi | `ClaimResponse` | v2.0 | 522 |
| `10652` | `PaymentReconciliation.detail.type` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/payment-type` | v2.0 | 523 |
| `10642` | `PaymentReconciliation.disposition` | Tipe nilai | `string` | v2.0 | 524 |
| `10641` | `PaymentReconciliation.outcome` | Terminologi atau system | `http://hl7.org/fhir/remittance-outcome` | v2.0 | 525 |
| `10644` | `PaymentReconciliation.paymentAmount.currency` | Terminologi atau system | — | v2.0 | 526 |
| `10644` | `PaymentReconciliation.paymentAmount.value` | Tipe nilai | `decimal` | v2.0 | 527 |
| `10643` | `PaymentReconciliation.paymentDate` | Tanggal, waktu atau periode | `date` | v2.0 | 528 |
| `10657` | `PaymentReconciliation.paymentIssuer` | Referensi | `Organization` | v2.0 | 529 |
| `10639` | `PaymentReconciliation.period.end` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 530 |
| `10638` | `PaymentReconciliation.period.start` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 531 |
| `10646` | `PaymentReconciliation.processNote.text` | Tipe nilai | `string` | v2.0 | 532 |
| `10645` | `PaymentReconciliation.processNote.type` | Terminologi atau system | `http://hl7.org/fhir/note-type` | v2.0 | 533 |
| `10658` | `PaymentReconciliation.requestor` | Referensi | `Organization` | v2.0 | 534 |
| `10637` | `PaymentReconciliation.status` | Terminologi atau system | `http://hl7.org/fhir/fm-status` | v2.0 | 535 |
| `10938` | `PractitionerRole.active` | Tipe nilai | — | v2.0 | 536 |
| `10941` | `PractitionerRole.availableTime.availableEndTime` | Aturan spesifik | — | v2.0 | 537 |
| `10940` | `PractitionerRole.availableTime.availableStartTime` | Aturan spesifik | — | v2.0 | 538 |
| `10939` | `PractitionerRole.availableTime.daysOfWeek` | Terminologi atau system | `http://hl7.org/fhir/days-of-week` | v2.0 | 539 |
| `10933` | `PractitionerRole.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 540 |
| `10933` | `PractitionerRole.code` | Elemen wajib | — | v2.0 | 541 |
| `10929` | `PractitionerRole.identifier.assigner` | Referensi | — | v2.0 | 542 |
| `10930` | `PractitionerRole.identifier.assigner.display` | Tipe nilai | — | v2.0 | 543 |
| `10928` | `PractitionerRole.identifier.period.end` | Aturan spesifik | — | v2.0 | 544 |
| `10927` | `PractitionerRole.identifier.period.start` | Aturan spesifik | — | v2.0 | 545 |
| `10924` | `PractitionerRole.identifier.system` | Terminologi atau system | `https://fhir.kemkes.go.id/id/sip-number` | v2.0 | 546 |
| `10925` | `PractitionerRole.identifier.use` | Terminologi atau system | `http://hl7.org/fhir/identifier-use` | v2.0 | 547 |
| `10926` | `PractitionerRole.identifier.value` | Tipe nilai | — | v2.0 | 548 |
| `10932` | `PractitionerRole.organization` | Referensi | — | v2.0 | 549 |
| `10932` | `PractitionerRole.organization` | Elemen wajib | — | v2.0 | 550 |
| `10931` | `PractitionerRole.practitioner` | Referensi | — | v2.0 | 551 |
| `10931` | `PractitionerRole.practitioner` | Elemen wajib | — | v2.0 | 552 |
| `10934` | `PractitionerRole.specialty` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 553 |
| `10935` | `PractitionerRole.telecom.system` | Terminologi atau system | `http://hl7.org/fhir/contact-point-system` | v2.0 | 554 |
| `10936` | `PractitionerRole.telecom.use` | Terminologi atau system | `http://hl7.org/fhir/contact-point-use` | v2.0 | 555 |
| `10937` | `PractitionerRole.telecom.value` | Tipe nilai | — | v2.0 | 556 |
| `10425` | `Procedure.basedOn` | Aturan spesifik | — | v1.0 | 557 |
| `10016` | `Procedure.bodySite` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 558 |
| `10013` | `Procedure.category` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 559 |
| `10013` | `Procedure.category` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 560 |
| `10015` | `Procedure.code` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-9-cm` | v1.0 | 561 |
| `10015` | `Procedure.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 562 |
| `10015` | `Procedure.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/clinical-term` | v1.0 | 563 |
| `10015` | `Procedure.code` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 564 |
| `10015` | `Procedure.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/kptl` | v2.0 | 565 |
| `10128` | `Procedure.encounter` | Elemen wajib | — | v1.0 | 566 |
| `10442` | `Procedure.identifier` | Terminologi atau system | — | v1.0 | 567 |
| `10401` | `Procedure.performedPeriod.end` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 568 |
| `10400` | `Procedure.performedPeriod.start` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 569 |
| `10399` | `Procedure.performer` | Aturan spesifik | — | v1.0 | 570 |
| `10018` | `Procedure.reasonCode` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 571 |
| `10019` | `Procedure.status` | Terminologi atau system | `http://hl7.org/fhir/event-status` | v1.0 | 572 |
| `10127` | `Procedure.subject` | Elemen wajib | — | v1.0 | 573 |
| `10371` | `QuestionnaireResponse.author` | Aturan spesifik | — | v1.0 | 574 |
| `10373` | `QuestionnaireResponse.authored` | Tanggal, waktu atau periode | `datetime` | v1.0 | 575 |
| `10378` | `QuestionnaireResponse.encounter` | Aturan spesifik | — | v1.0 | 576 |
| `10665` | `QuestionnaireResponse.item.answer.valueCoding` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/clinical-term` | v2.0 | 577 |
| `10665` | `QuestionnaireResponse.item.answer.valueCoding` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-ActCode` | v2.0 | 578 |
| `10665` | `QuestionnaireResponse.item.answer.valueCoding` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/clinical-speciality` | v2.0 | 579 |
| `10283` | `QuestionnaireResponse.item.item.answer.valueCoding` | Terminologi atau system | — | v1.0 | 580 |
| `10863` | `QuestionnaireResponse.item.X.answer.item.X.answer.valueReference` | Referensi | — | v2.0 | 581 |
| `10665` | `QuestionnaireResponse.item.X.answer.valueCoding` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/organization-type` | v2.0 | 582 |
| `10169` | `QuestionnaireResponse.questionnaire` | Terminologi atau system | — | v1.0 | 583 |
| `10169` | `QuestionnaireResponse.questionnaire` | Terminologi atau system | `https://fhir.kemkes.go.id/Questionnaire/Q0023` | v2.0 | 584 |
| `10372` | `QuestionnaireResponse.source` | Aturan spesifik | — | v1.0 | 585 |
| `10112` | `QuestionnaireResponse.status` | Terminologi atau system | `http://hl7.org/fhir/ValueSet/questionnaire-answers-status` | v1.0 | 586 |
| `10370` | `QuestionnaireResponse.subject` | Referensi | — | v1.0 | 587 |
| `10162` | `RelatedPerson.patient` | Elemen wajib | — | v1.0 | 588 |
| `10711` | `RiskAssessment.code` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 589 |
| `10725` | `RiskAssessment.condition` | Referensi | `Condition` | v2.0 | 590 |
| `10727` | `RiskAssessment.encounter` | Referensi | `Encounter` | v2.0 | 591 |
| `10721` | `RiskAssessment.note.authorReference` | Referensi | — | v2.0 | 592 |
| `10722` | `RiskAssessment.note.authorString` | Tipe nilai | `string` | v2.0 | 593 |
| `10724` | `RiskAssessment.note.text` | Tipe nilai | `string` | v2.0 | 594 |
| `10723` | `RiskAssessment.note.time` | Tanggal, waktu atau periode | `datetime` | v2.0 | 595 |
| `10847` | `RiskAssessment.performer` | Referensi | — | v2.0 | 596 |
| `10728` | `RiskAssessment.practitioner` | Referensi | `Practitioner` | v2.0 | 597 |
| `10713` | `RiskAssessment.prediction.outcome` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 598 |
| `10714` | `RiskAssessment.prediction.probabilityDecimal` | Tipe nilai | `decimal` | v2.0 | 599 |
| `10715` | `RiskAssessment.prediction.qualitativeRisk` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/risk-probability` | v2.0 | 600 |
| `10716` | `RiskAssessment.prediction.relativeRisk` | Tipe nilai | `decimal` | v2.0 | 601 |
| `10718` | `RiskAssessment.prediction.whenPeriod.end` | Tanggal, waktu atau periode | `datetime` | v2.0 | 602 |
| `10717` | `RiskAssessment.prediction.whenPeriod.start` | Tanggal, waktu atau periode | `datetime` | v2.0 | 603 |
| `10719` | `RiskAssessment.prediction.whenRange.high.value` | Tipe nilai | `decimal` | v2.0 | 604 |
| `10720` | `RiskAssessment.prediction.whenRange.low.value` | Tipe nilai | `decimal` | v2.0 | 605 |
| `10712` | `RiskAssessment.reasonReference` | Referensi | — | v2.0 | 606 |
| `10710` | `RiskAssessment.status` | Terminologi atau system | `http://hl7.org/fhir/observation-status` | v2.0 | 607 |
| `10726` | `RiskAssessment.subject` | Referensi | — | v2.0 | 608 |
| `10361` | `ServiceRequest.authoredOn` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 609 |
| `10059` | `ServiceRequest.bodySite` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 610 |
| `10462` | `ServiceRequest.category` | Terminologi atau system | `http://terminology.kemkes.go.id` | v2.0 | 611 |
| `10060` | `ServiceRequest.code` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-9-cm` | v1.0 | 612 |
| `10060` | `ServiceRequest.code` | Terminologi atau system | `http://loinc.org` | v1.0 | 613 |
| `10060` | `ServiceRequest.code` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 614 |
| `10060` | `ServiceRequest.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/examination` | v1.0 | 615 |
| — | `ServiceRequest.code` | Terminologi atau system | `http://terminology.kemkes.go.id/CodeSystem/examination` | v1.0 | 616 |
| `10142` | `ServiceRequest.encounter` | Elemen wajib | — | v1.0 | 617 |
| `10415` | `ServiceRequest.identifier` | Referensi | — | v1.0 | 618 |
| `10415` | `ServiceRequest.identifier.system` | Terminologi atau system | — | v1.0 | 619 |
| `10063` | `ServiceRequest.intent` | Terminologi atau system | `http://hl7.org/fhir/request-intent` | v1.0 | 620 |
| `10067` | `ServiceRequest.locationCode` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v3-RoleCode` | v1.0 | 621 |
| `10431` | `ServiceRequest.locationReference` | Aturan spesifik | — | v1.0 | 622 |
| `10360` | `ServiceRequest.occurrenceDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 623 |
| `10427` | `ServiceRequest.orderDetail` | Terminologi atau system | — | v1.0 | 624 |
| `10377` | `ServiceRequest.performer` | Referensi | `Practitioner` | v1.0 | 625 |
| `10066` | `ServiceRequest.priority` | Terminologi atau system | `http://hl7.org/fhir/request-priority` | v1.0 | 626 |
| `10064` | `ServiceRequest.reasonCode` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-10` | v1.0 | 627 |
| `10064` | `ServiceRequest.reasonCode` | Terminologi atau system | `http://hl7.org/fhir/sid/icd-9-cm` | v1.0 | 628 |
| `10064` | `ServiceRequest.reasonCode.coding` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 629 |
| `10376` | `ServiceRequest.requester` | Referensi | `Practitioner` | v1.0 | 630 |
| `10065` | `ServiceRequest.status` | Terminologi atau system | `http://hl7.org/fhir/request-status` | v1.0 | 631 |
| `10065` | `ServiceRequest.status` | Elemen wajib | — | v1.0 | 632 |
| `10141` | `ServiceRequest.subject` | Elemen wajib | — | v1.0 | 633 |
| `10680` | `Specimen.collection.bodySite` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 634 |
| `10362` | `Specimen.collection.collectedDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 635 |
| `10396` | `Specimen.collection.collector` | Aturan spesifik | — | v1.0 | 636 |
| `10363` | `Specimen.collection.fastingStatusCodeableConcept.coding` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/v2-0916` | v1.0 | 637 |
| `10068` | `Specimen.collection.method` | Terminologi atau system | `http://snomed.info/sct` | v1.0 | 638 |
| `10364` | `Specimen.collection.quantity.value` | Tipe nilai | — | v1.0 | 639 |
| `10679` | `Specimen.container.type` | Terminologi atau system | `http://snomed.info/sct` | v2.0 | 640 |
| `10367` | `Specimen.extension.valueDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 641 |
| `10395` | `Specimen.identifier.assigner` | Aturan spesifik | — | v1.0 | 642 |
| `10414` | `Specimen.identifier.system` | Terminologi atau system | — | v1.0 | 643 |
| `10365` | `Specimen.processing.timeDateTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 644 |
| `10366` | `Specimen.receivedTime` | Tanggal, waktu atau periode | `dateTime` | v1.0 | 645 |
| `10440` | `Specimen.request` | Aturan spesifik | — | v1.0 | 646 |
| `10069` | `Specimen.status` | Terminologi atau system | `http://hl7.org/fhir/specimen-status` | v1.0 | 647 |
| `10143` | `Specimen.subject` | Elemen wajib | — | v1.0 | 648 |
| `10070` | `Specimen.type` | Terminologi atau system | — | v1.0 | 649 |
| `10683` | `VisionPrescription.dateTime` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 650 |
| `10686` | `VisionPrescription.dateWritten` | Tanggal, waktu atau periode | `dateTime` | v2.0 | 651 |
| `10685` | `VisionPrescription.encounter` | Elemen wajib | — | v2.0 | 652 |
| `10692` | `VisionPrescription.lensSpecification.axis` | Tipe nilai | `integer` | v2.0 | 653 |
| `10691` | `VisionPrescription.lensSpecification.cylinder` | Tipe nilai | `decimal` | v2.0 | 654 |
| `10689` | `VisionPrescription.lensSpecification.eye` | Terminologi atau system | `http://hl7.org/fhir/vision-eye-codes` | v2.0 | 655 |
| `10693` | `VisionPrescription.lensSpecification.prism.amount` | Tipe nilai | `decimal` | v2.0 | 656 |
| `10694` | `VisionPrescription.lensSpecification.prism.base` | Terminologi atau system | `http://hl7.org/fhir/vision-base-codes` | v2.0 | 657 |
| `10688` | `VisionPrescription.lensSpecification.product` | Terminologi atau system | `http://terminology.hl7.org/CodeSystem/ex-visionprescriptionproduct` | v2.0 | 658 |
| `10690` | `VisionPrescription.lensSpecification.sphere` | Tipe nilai | `decimal` | v2.0 | 659 |
| `10684` | `VisionPrescription.patient` | Referensi | `Patient` | v2.0 | 660 |
| `10687` | `VisionPrescription.prescriber` | Referensi | `Practitioner` | v2.0 | 661 |
| `10682` | `VisionPrescription.status` | Terminologi atau system | `http://hl7.org/fhir/fm-status` | v2.0 | 662 |
| `10615` | `Procedure.usedReference` | Referensi | `Medication` | v2.0 | 663 |
