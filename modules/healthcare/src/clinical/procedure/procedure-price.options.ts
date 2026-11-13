import { Decimal } from '@core/platform/money/index.ts';

// Isian tab Detail Harga kartu Jasa sistem lama (views/services/price/form.php dan form_component.php) dengan kolom
// sim_m_tindakan_harga dan sim_m_tindakan_harga_komponen serta label sistem lama. Dipakai service untuk membaca dan
// menulis, dan layar untuk label isian.

// Lokasi (Price_model::dropdown_static('Lokasi')): kode yang disimpan sistem lama, labelnya kode itu sendiri.
export const priceLocations = {
    RJ: 'RJ',
    UGD: 'UGD',
    RI: 'RI',
    XX: 'XX',
} as const;
export type PriceLocation = keyof typeof priceLocations;

export function isPriceLocation(value: string): value is PriceLocation {
    return Object.hasOwn(priceLocations, value);
}

// Cara tipe pasien mendapat tarif jasa (sim_m_tipe_pasien.tarif_jasa). Sistem lama memilihnya dari JenisKerjasamaID yang
// ditulis mati di Services::datatable_charge_collection, dan langkah pencariannya berbeda per pemasangan, jadi di sini
// setiap fungsi tarif sistem lama menjadi satu kode. Langkahnya ada di procedure-price.lookup.ts.
export const procedureTariffs = {
    // Tipe di luar daftar PHP: tidak memanggil fungsi tarif apa pun.
    none: 'Tanpa tarif jasa',
    // GetTarifBiayaNonKerjasama Kuta 1 dan Penta.
    general: 'Tarif umum',
    // GetTarifBiayaNonKerjasama Seroja: tanpa langkah terakhir "jasa saja, tipe apa pun".
    general_own_group: 'Tarif umum, tanpa tarif kelompok harga lain',
    // GetTarifBiayaJKN_BUFF Kuta 1 dan Penta.
    bpjs: 'Tarif BPJS',
    // GetTarifBiayaJKN_BUFF Seroja: berhenti di tarif semua kelas tanpa dokter.
    bpjs_matching_only:
        'Tarif BPJS, tanpa tarif kelas, dokter, atau kelompok harga lain',
} as const;
export type ProcedureTariff = keyof typeof procedureTariffs;

export function isProcedureTariff(value: string): value is ProcedureTariff {
    return Object.hasOwn(procedureTariffs, value);
}

// money: uang (money SQL Server), 0 atau lebih karena isian mask-number sistem lama menjadikan angka negatif 0.
// number: persen dan Qty, isian teks biasa di sistem lama tanpa batas bawah.
export type PriceNumberKind = 'money' | 'number';

// Isian angka baris harga yang diketik pengguna. Harga baris tidak termasuk: harga itu jumlah komponennya.
export const priceNumberFields = {
    detail_incentive: {
        column: 'insentif_detail',
        kind: 'money',
        label: 'Insentif Detail',
    },
    component_incentive: {
        column: 'insentif_komponen',
        kind: 'money',
        label: 'Insentif Komponen',
    },
    hc_discount_percent: {
        column: 'disc_hc_umum',
        kind: 'number',
        label: 'Diskon HC (%)',
    },
} as const;

// Harga baris = jumlah biasa nilai komponen bernama sama, tanpa dikali Qty (calculate_total_price). Kolomnya bernama
// sama di kedua tabel.
export const priceSumFields = {
    previous_price: { column: 'harga_lama', label: 'Harga Lama' },
    new_price: { column: 'harga_baru', label: 'Harga Baru' },
    previous_hc_price: { column: 'harga_hc_lama', label: 'Harga Lama HC' },
    new_hc_price: { column: 'harga_hc_baru', label: 'Harga Baru HC' },
    previous_bpjs_price: {
        column: 'harga_bpjs_lama',
        label: 'Harga Lama BPJS',
    },
    new_bpjs_price: { column: 'harga_bpjs', label: 'Harga Baru BPJS' },
} as const;
export type PriceSumField = keyof typeof priceSumFields;

const hundredth = Decimal.of('0.01');

// Harga Baru yang diisikan form komponen sistem lama begitu Harga Awal, Persen Insentif, atau Persen Pajak Titipan
// ditinggalkan dan Include Insentif diubah (calculate_new_price di form_component.php): Harga Awal, ditambah insentif
// bila tidak termasuk, ditambah pajak titipan. Rumusnya sama dengan sistem lama, tetapi dihitung desimal tepat lalu
// dibulatkan sekali ke presisi harga satuan mata uang tenant, bukan pecahan biner peramban lalu toFixed(2). Isian
// Harga Baru tetap boleh diubah sesudahnya.
export function legacyNewPrice(
    initialPrice: string,
    incentivePercent: string,
    taxDepositPercent: string,
    includesIncentive: boolean,
    decimals: number,
): string {
    const initial = Decimal.of(initialPrice);
    const percentOf = (percent: string) =>
        initial.multipliedBy(Decimal.of(percent)).multipliedBy(hundredth);
    const incentive = includesIncentive
        ? Decimal.of('0')
        : percentOf(incentivePercent);
    return initial
        .plus(incentive)
        .plus(percentOf(taxDepositPercent))
        .fixed(decimals);
}

// Isian angka komponen, urutan form komponen sistem lama.
export const componentNumberFields = {
    quantity: { column: 'qty', kind: 'number', label: 'Qty' },
    initial_price: { column: 'harga_awal', kind: 'money', label: 'Harga Awal' },
    previous_price: {
        column: 'harga_lama',
        kind: 'money',
        label: 'Harga Lama',
    },
    tax_deposit_percent: {
        column: 'persen_pajak_titipan',
        kind: 'number',
        label: 'Persen Pajak Titipan',
    },
    incentive_percent: {
        column: 'persen_insentif',
        kind: 'number',
        label: 'Persen Insentif',
    },
    new_price: { column: 'harga_baru', kind: 'money', label: 'Harga Baru' },
    previous_hc_price: {
        column: 'harga_hc_lama',
        kind: 'money',
        label: 'Harga Lama HC',
    },
    new_hc_price: {
        column: 'harga_hc_baru',
        kind: 'money',
        label: 'Harga Baru HC',
    },
    hc_incentive_percent: {
        column: 'persen_insentif_hc',
        kind: 'number',
        label: 'Insentif HC (%)',
    },
    previous_bpjs_price: {
        column: 'harga_bpjs_lama',
        kind: 'money',
        label: 'Harga Lama BPJS',
    },
    new_bpjs_price: {
        column: 'harga_bpjs',
        kind: 'money',
        label: 'Harga Baru BPJS',
    },
} as const;
export type ComponentNumberField = keyof typeof componentNumberFields;
