# Contoh payload penunjang dan logistik

> **Revisi dokumen** 2026-11-16 · **Sumber diperiksa** 2026-11-16 · [Tanggal dan versi sumber](../referensi/inventaris-sumber-resmi.md)
>
> **Acuan utama** [Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/) (disunting 2024-12-15) · [Substance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/substance/) (disunting 2024-12-15) · [Endpoint](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/endpoint/) (disunting 2024-12-15)

[Indeks SATUSEHAT](../README.md) · [Payload dan pemetaan](README.md) · [Peta contoh](indeks-contoh-payload.md) · [Laboratorium](../alur/laboratorium-rujukan-spesimen.md) · [Radiologi](../alur/radiologi-dicom.md) · [ALKES](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes)

Gunakan ID dan kode dari environment yang sesuai. Contoh dasar mencatat bentuk dan dependensi. Untuk resource di luar katalog HTTP, konfirmasi operasi dari kontrak aktif sebelum pengiriman. Contoh DeviceDispense memakai definisi R5.

### Specimen

Contoh create sampel urin sesuai fakta pemeriksaan. Hubungkan request, Patient dan petugas. Resolve ID/specimen accession sesuai alur lokal atau rujukan. [Laboratorium dan spesimen](../alur/laboratorium-rujukan-spesimen.md) · [Profil Specimen](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/specimen/)

```json
{
  "resourceType": "Specimen",
  "identifier": [
    {
      "system": "https://example.invalid/metta/specimen",
      "value": "SAMPLE-FIXTURE-01"
    }
  ],
  "status": "available",
  "type": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "122575003"
      }
    ]
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "request": [
    {
      "reference": "ServiceRequest/<ORDER_LAB>"
    }
  ],
  "collection": {
    "collector": {
      "reference": "Practitioner/<PRACTITIONER>"
    },
    "collectedDateTime": "2026-11-16T04:00:00Z"
  }
}
```

### Substance

Contoh dasar bahan yang dipakai dalam proses lab bila dicatat. Pilih code system dan produk dari profil atau terminologi yang disetujui. Dukungan endpoint Substance perlu dibuktikan dari modul. [Laboratorium](../alur/laboratorium-rujukan-spesimen.md) · [Profil Substance](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/substance/)

```json
{
  "resourceType": "Substance",
  "identifier": [
    {
      "system": "https://example.invalid/metta/substance",
      "value": "SUBSTANCE-FIXTURE-01"
    }
  ],
  "status": "active",
  "code": {
    "coding": [
      {
        "system": "<SYSTEM_BAHAN>",
        "code": "<KODE_BAHAN>"
      }
    ]
  }
}
```

### Endpoint

Contoh berbentuk FHIR R4 untuk koneksi WADO-RS. Gunakan URL layanan yang benar dari instalasi resmi dan batasi akses gambar. Endpoint ini merupakan resource FHIR, sedangkan route gambar pada DICOMweb mengikuti layanan media. Operation untuk Endpoint perlu konfirmasi. [Radiologi/DICOM](../endpoint/radiologi-dicom.md#endpoint-dan-respons) · [Profil Endpoint](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/endpoint/)

```json
{
  "resourceType": "Endpoint",
  "status": "active",
  "connectionType": {
    "system": "http://terminology.hl7.org/CodeSystem/endpoint-connection-type",
    "code": "dicom-wado-rs"
  },
  "managingOrganization": {
    "reference": "Organization/<ORGANIZATION>"
  },
  "payloadType": [
    {
      "text": "Citra DICOM"
    }
  ],
  "payloadMimeType": [
    "application/dicom"
  ],
  "address": "https://example.invalid/dicom-web"
}
```

### ImagingStudy

Contoh bentuk metadata studi dengan satu seri CT. UID dan accession ini sintetis. Pada alur router, pastikan hanya satu komponen yang memiliki tanggung jawab membuat metadata dan gunakan identifier yang ditetapkan untuk pencarian. [Radiologi/DICOM](../alur/radiologi-dicom.md) · [Profil ImagingStudy](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/imaging-study/)

```json
{
  "resourceType": "ImagingStudy",
  "identifier": [
    {
      "use": "official",
      "system": "urn:dicom:uid",
      "value": "urn:oid:1.2.826.0.1.3680043.10.987.1"
    }
  ],
  "status": "available",
  "modality": [
    {
      "system": "http://dicom.nema.org/resources/ontology/DCM",
      "code": "CT"
    }
  ],
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "started": "2026-11-16T04:00:00Z",
  "basedOn": [
    {
      "reference": "ServiceRequest/<ORDER_RAD>"
    }
  ],
  "endpoint": [
    {
      "reference": "Endpoint/<DICOM_ENDPOINT>"
    }
  ],
  "series": [
    {
      "uid": "1.2.826.0.1.3680043.10.987.2",
      "modality": {
        "system": "http://dicom.nema.org/resources/ontology/DCM",
        "code": "CT"
      },
      "performer": [
        {
          "actor": {
            "reference": "Practitioner/<PRACTITIONER>"
          }
        }
      ],
      "instance": [
        {
          "uid": "1.2.826.0.1.3680043.10.987.3",
          "sopClass": {
            "system": "urn:ietf:rfc:3986",
            "code": "urn:oid:1.2.840.10008.5.1.4.1.1.2"
          }
        }
      ]
    }
  ]
}
```

### DocumentReference

Contoh dasar dokumen resep. ID, kode, format attachment dan akses link mengikuti skenario NRN atau TTE. Untuk create serta pencarian NRN, gunakan identifier dan operasi yang tercatat pada koleksi Farmasi. URL contoh hanya placeholder. [Dokumen dan item resep berdasarkan NRN](../alur/pelayanan-kefarmasian-lintas-fasyankes.md#dokumen-dan-item-resep-berdasarkan-nrn) · [Profil DocumentReference](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/document-reference/)

```json
{
  "resourceType": "DocumentReference",
  "identifier": [
    {
      "system": "https://example.invalid/metta/prescription-document",
      "value": "DOC-RESEP-FIXTURE-01"
    }
  ],
  "status": "current",
  "type": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "57833-6"
      }
    ]
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "date": "2026-11-16T04:00:00Z",
  "author": [
    {
      "reference": "Practitioner/<PRACTITIONER>"
    }
  ],
  "custodian": {
    "reference": "Organization/<ORGANIZATION>"
  },
  "content": [
    {
      "attachment": {
        "contentType": "application/pdf",
        "url": "https://example.invalid/resep-fixture.pdf",
        "title": "Resep fixture"
      }
    }
  ],
  "context": {
    "encounter": [
      {
        "reference": "Encounter/<ENCOUNTER>"
      }
    ]
  }
}
```

### Device

Contoh dasar identitas alat. Lengkapi kode KFA, label dan lokasi sesuai inventaris aktual per fasyankes. Scope Create Device dan pemetaan alat membutuhkan kontrak modul. [ALKES Rawat Inap](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes) · [Profil Device](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device/)

```json
{
  "resourceType": "Device",
  "identifier": [
    {
      "system": "http://sys-ids.kemkes.go.id/device/<ORGANIZATION>",
      "value": "DEV-FIXTURE-01"
    }
  ],
  "status": "active",
  "deviceName": [
    {
      "name": "Alat fixture",
      "type": "user-friendly-name"
    }
  ],
  "type": {
    "coding": [
      {
        "system": "http://sys-ids.kemkes.go.id/kfa",
        "code": "<KFA_ALKES>"
      }
    ]
  },
  "owner": {
    "reference": "Organization/<ORGANIZATION>"
  },
  "location": {
    "reference": "Location/<LOKASI>"
  }
}
```

### DeviceRequest

Contoh batas bawah permintaan alat untuk pasien. Hubungkan Device, Encounter dan peminta yang sah. Jika item dipilih dengan code, gunakan tipe pilihan yang diizinkan profil. [ALKES Rawat Inap](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes) · [Profil DeviceRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-request/)

```json
{
  "resourceType": "DeviceRequest",
  "identifier": [
    {
      "system": "https://example.invalid/metta/device-request",
      "value": "DEVICE-ORDER-FIXTURE"
    }
  ],
  "status": "active",
  "intent": "order",
  "codeReference": {
    "reference": "Device/<DEVICE>"
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "authoredOn": "2026-11-16T04:00:00Z",
  "requester": {
    "reference": "Practitioner/<PRACTITIONER>"
  }
}
```

### DeviceUseStatement

Contoh dasar penggunaan alat yang memang terjadi. Ganti status, periode dan pihak pencatat dengan data klinis. Buktikan operasi dan versi yang dipakai. [ALKES Rawat Inap](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes) · [Profil DeviceUseStatement](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/device-use-statement/)

```json
{
  "resourceType": "DeviceUseStatement",
  "identifier": [
    {
      "system": "https://example.invalid/metta/device-use",
      "value": "USE-FIXTURE"
    }
  ],
  "status": "completed",
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "timingPeriod": {
    "start": "2026-11-16T04:00:00Z",
    "end": "2026-11-16T04:20:00Z"
  },
  "recordedOn": "2026-11-16T04:25:00Z",
  "source": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "device": {
    "reference": "Device/<DEVICE>"
  }
}
```

### DeviceDispense

Contoh dasar **FHIR R5**, dengan bentuk device sebagai CodeableReference. Contoh ini menunjukkan tata letak yang sah di HL7. Field context/whenPrepared pada materi Kemenkes dan operasi aktif perlu verifikasi dari profil instalasi sebelum dikirim. [FHIR R5 DeviceDispense](https://hl7.org/fhir/R5/devicedispense.html) · [Kompatibilitas](kompatibilitas-payload-fhir.md#extension-dan-kontrak-modul)

```json
{
  "resourceType": "DeviceDispense",
  "status": "completed",
  "basedOn": [
    {
      "reference": "DeviceRequest/<DEVICE_REQUEST>"
    }
  ],
  "device": {
    "reference": {
      "reference": "Device/<DEVICE>"
    }
  },
  "subject": {
    "reference": "Patient/<PATIENT>"
  },
  "encounter": {
    "reference": "Encounter/<ENCOUNTER>"
  },
  "performer": [
    {
      "actor": {
        "reference": "Practitioner/<PRACTITIONER>"
      }
    }
  ],
  "preparedDate": "2026-11-16T03:45:00Z",
  "whenHandedOver": "2026-11-16T04:00:00Z",
  "destination": {
    "reference": "Location/<LOKASI>"
  }
}
```

### SupplyRequest

Contoh dasar permintaan internal antar lokasi. Petakan jumlah, jenis persediaan, asal dan tujuan dari transaksi yang sah. Operasi SupplyRequest perlu profil serta akses alur ALKES. [Supply dan ALKES](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes) · [Profil SupplyRequest](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/supply-request/)

```json
{
  "resourceType": "SupplyRequest",
  "identifier": [
    {
      "system": "https://example.invalid/metta/supply-request",
      "value": "SUPPLY-FIXTURE-01"
    }
  ],
  "status": "active",
  "category": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/supply-kind",
        "code": "central"
      }
    ]
  },
  "itemReference": {
    "reference": "Device/<DEVICE>"
  },
  "quantity": {
    "value": 1,
    "unit": "unit",
    "system": "http://unitsofmeasure.org",
    "code": "{unit}"
  },
  "authoredOn": "2026-11-16T04:00:00Z",
  "requester": {
    "reference": "Practitioner/<PRACTITIONER>"
  },
  "deliverFrom": {
    "reference": "Location/<GUDANG>"
  },
  "deliverTo": {
    "reference": "Location/<LOKASI>"
  }
}
```

### SupplyDelivery

Contoh dasar serah persediaan. Rekonsiliasi jumlah, waktu dan lokasi terhadap SupplyRequest. Catat tiap pengiriman dan statusnya secara terpisah dari permintaan. [Supply dan ALKES](../alur/igd-dan-rawat-inap.md#rawat-inap-kelas-perawatan-dan-alkes) · [Profil SupplyDelivery](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/supply-delivery/)

```json
{
  "resourceType": "SupplyDelivery",
  "identifier": [
    {
      "system": "https://example.invalid/metta/supply-delivery",
      "value": "DELIVERY-FIXTURE-01"
    }
  ],
  "basedOn": [
    {
      "reference": "SupplyRequest/<SUPPLY_REQUEST>"
    }
  ],
  "status": "completed",
  "type": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/supply-item-type",
        "code": "device"
      }
    ]
  },
  "suppliedItem": {
    "quantity": {
      "value": 1,
      "unit": "unit",
      "system": "http://unitsofmeasure.org",
      "code": "{unit}"
    },
    "itemReference": {
      "reference": "Device/<DEVICE>"
    }
  },
  "occurrenceDateTime": "2026-11-16T04:00:00Z",
  "destination": {
    "reference": "Location/<LOKASI>"
  },
  "receiver": [
    {
      "reference": "Practitioner/<PRACTITIONER>"
    }
  ]
}
```

### BiologicallyDerivedProduct

Contoh dasar R4 produk biologis dengan donor tersamar. Untuk produk darah, Standar v12.0 memakai nomor kantong unik pada identifier dan kategori fluida menggunakan `fluid`. Untuk kuantitas dan status rinci, [tabel terminologi](../terminologi/kontrak-terminologi.md#nilai-yang-dibutuhkan-lintas-modul) memuat kode yang sudah diterbitkan. Untuk Metta, sumber terverifikasi bagi label produk, pengambilan, status dan relasi donor masih perlu ditentukan. Pastikan URI, tipe, izin, dan alur distribusi sebelum memakai extension atau operasi terkait. Lindungi hubungan donor–produk. [Profil BiologicallyDerivedProduct](https://satusehat.kemkes.go.id/platform/docs/id/fhir/resources/biologically-derived-product/) · [FHIR R4 BiologicallyDerivedProduct](https://hl7.org/fhir/R4/biologicallyderivedproduct.html)

```json
{
  "resourceType": "BiologicallyDerivedProduct",
  "identifier": [
    {
      "system": "https://example.invalid/metta/biological-product",
      "value": "PRODUCT-FIXTURE-01"
    }
  ],
  "productCategory": "fluid",
  "productCode": {
    "coding": [
      {
        "system": "<SYSTEM_PRODUK_BIOLOGIS>",
        "code": "<KODE_PRODUK_BIOLOGIS>"
      }
    ]
  },
  "status": "available",
  "collection": {
    "source": {
      "reference": "Patient/<DONOR_FIXTURE>"
    },
    "collector": {
      "reference": "Practitioner/<PRACTITIONER>"
    },
    "collectedDateTime": "2026-11-16T04:00:00Z"
  }
}
```
