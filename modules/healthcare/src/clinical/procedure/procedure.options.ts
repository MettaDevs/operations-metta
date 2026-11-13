// Pilihan tetap kartu Jasa sistem lama (Service_model::dropdown_static), dengan kode yang disimpan sistem lama dan label
// yang ditampilkannya. Kodenya disimpan apa adanya di sim_m_tindakan, jadi kode yang sudah dipakai tidak diganti.
export const procedureOptions = {
    // KelompokPostingan: pendapatan jasa diposting per kelompok jasa atau per komponen.
    posting_group: { 'GROUP JASA': 'KELOMPOK JASA', KOMPONEN: 'KOMPONEN' },
    // ModelInsentif.
    incentive_source: { NONE: 'NONE', DETAIL: 'DETAIL', KOMPONEN: 'KOMPONEN' },
    // PoliKlinik: jasa poli umum atau poli spesialis.
    polyclinic: { NONE: 'NONE', UMUM: 'UMUM', SPESIALIS: 'SPESIALIS' },
} as const;
export type ProcedureOption = keyof typeof procedureOptions;

export function isProcedureOptionCode(
    option: ProcedureOption,
    value: string,
): boolean {
    return Object.hasOwn(procedureOptions[option], value);
}

// Centang status kartu Jasa sistem lama, urutan form-nya, dengan kolom sim_m_tindakan dan label sistem lama.
export const procedureFlags = {
    is_package: { column: 'paket', label: 'Paket Jasa' },
    reproductive_clinic: {
        column: 'klinik_reproduksi',
        label: 'Klinik Reproduksi',
    },
    manual_tariff: { column: 'tarif_manual', label: 'Tarif Manual' },
    inpatient_day: { column: 'hari_rawat_inap', label: 'Hari Rawat Inap' },
    mcu: { column: 'mcu', label: 'MCU' },
    auto_system: { column: 'auto_system', label: 'Auto System' },
    kso: { column: 'kso', label: 'KSO' },
    varies_by_operation_category: {
        column: 'variabel_kategori_operasi',
        label: 'Variabel Kategori Operasi',
    },
    varies_by_cito: { column: 'variabel_cyto', label: 'Variabel Cyto' },
    requires_doctor: {
        column: 'harus_dengan_dokter',
        label: 'Harus Dengan Dokter',
    },
    uses_device: {
        column: 'menggunakan_alat',
        label: 'Menggunakan Alat Penunjang',
    },
} as const;
export type ProcedureFlag = keyof typeof procedureFlags;

export function isProcedureFlag(value: string): value is ProcedureFlag {
    return Object.hasOwn(procedureFlags, value);
}
