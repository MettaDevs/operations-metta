// Pilihan tetap form Komponen jasa sistem lama (Component_model::dropdown_static): kode yang disimpan sistem lama dan
// label yang ditampilkannya. Kodenya disimpan apa adanya di komponen_biaya, jadi kode yang sudah dipakai tidak diganti.
export const chargeComponentOptions = {
    // KelompokAkun.
    account_group: { Pendapatan: 'Pendapatan', Biaya: 'Pengeluaran' },
    // PostinganKe.
    posting_to: {
        Hutang: 'Hutang',
        Piutang: 'Piutang',
        GL: 'General Ledger',
        'K.S.O': 'K.S.O',
    },
    // HutangKe.
    payable_to: {
        None: 'None',
        Dokter: 'Dokter',
        'Dokter Anak': 'Dokter Anak',
        'Dokter Asisten': 'Dokter Asisten',
        'Dokter Anastesi': 'Dokter Anastesi',
        'Dokter Asisten Anastesi': 'Dokter Asisten Anastesi',
        'Dokter Operator': 'Dokter Operator',
        'Asisten/Instrumen': 'Asisten/Instrumen',
        'On Loop': 'On Loop',
    },
    // KelompokJasa: jasa sarana, jasa pelayanan, atau obat.
    service_group: {
        'Jasa Sarana': 'Jasa Sarana',
        'Jasa Pelayanan': 'Jasa Pelayanan',
        Obat: 'Obat',
    },
} as const;
export type ChargeComponentOption = keyof typeof chargeComponentOptions;

export function isChargeComponentOptionCode(
    option: ChargeComponentOption,
    value: string,
): boolean {
    return Object.hasOwn(chargeComponentOptions[option], value);
}

// Isian pilihan, urutan form sistem lama, dengan kolom komponen_biaya, label, dan nilai bawaannya.
export const chargeComponentOptionFields: {
    option: ChargeComponentOption;
    column: string;
    label: string;
    fallback: string;
}[] = [
    {
        option: 'account_group',
        column: 'kelompok_rekening',
        label: 'Kelompok Rekening',
        fallback: 'Pendapatan',
    },
    {
        option: 'posting_to',
        column: 'posting_ke',
        label: 'Posting Ke',
        fallback: 'GL',
    },
    {
        option: 'payable_to',
        column: 'hutang_ke',
        label: 'Hutang Ke',
        fallback: 'None',
    },
    {
        option: 'service_group',
        column: 'kelompok_jasa',
        label: 'Kelompok Jasa',
        fallback: 'Jasa Pelayanan',
    },
];
