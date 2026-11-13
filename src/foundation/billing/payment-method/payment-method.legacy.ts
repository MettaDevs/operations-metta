import type {
    PaymentMethodBehavior,
    PaymentMethodOption,
    PaymentMethodParty,
} from './payment-method.behaviors.ts';
import type { LegacyPaymentType } from './payment-method.schema.ts';

// Impor mJenisBayar sistem lama ke jenis_bayar. Perilaku setiap baris diambil dari dua sumber, tidak dari namanya:
//
// 1. Isian layar Pembayaran sistem lama (KC views/general_payment/form.php, helpers/general_payment_helper.php). Layar
//    itu menulis mati tujuh isian, masing-masing menyimpan ke satu IDBayar master standar. IDBayar itu sama di semua
//    database klinik dan puskesmas yang dibaca, walau Description-nya diganti per klinik. Label isian adalah teks layar
//    lama, disimpan sebagai label kasir bila beda dari nama jenis bayarnya. Catatan yang mudah keliru: isian
//    "KREDIT / BON" menyimpan ke 19 BON KARYAWAN, sedangkan 9 KREDIT / BON diisi centang "Pasien BON" sebesar sisa.
// 2. Flag mJenisBayar untuk baris lain: Cash berarti tunai, Bank atau CC non tunai, Jaminan penjamin. Baris tanpa isian
//    di layar lama tidak tampil di kasir, seperti di sistem lama.
//
// Baris yang flag-nya tidak menunjuk satu perilaku pun (hanya Others, atau tanpa flag) dan tidak punya isian layar lama
// tidak diimpor. Others dipakai bersama jenis bayar beban (12) dan bon karyawan (19), jadi flag itu sendiri tidak
// membedakan beban dari piutang.

type Field = {
    position: number;
    label: string;
    behavior: PaymentMethodBehavior;
    party: PaymentMethodParty;
    options: PaymentMethodOption[];
};

const cardOptions: PaymentMethodOption[] = [
    'requires_merchant',
    'allows_surcharge',
    'counted_at_close',
];

const legacyCashierFields = new Map<number, Field>([
    [
        4,
        {
            position: 1,
            label: 'TUNAI',
            behavior: 'tunai',
            party: 'tidak',
            options: ['counted_at_close'],
        },
    ],
    [
        7,
        {
            position: 2,
            label: 'KARTU KREDIT/DEBIT',
            behavior: 'non_tunai',
            party: 'tidak',
            options: cardOptions,
        },
    ],
    [
        13,
        {
            position: 3,
            label: 'DIJAMIN BPJS',
            behavior: 'penjamin',
            party: 'penjamin_kunjungan',
            options: [],
        },
    ],
    [
        5,
        {
            position: 4,
            label: 'PERUSAHAAN',
            behavior: 'penjamin',
            party: 'penjamin_kunjungan',
            options: [],
        },
    ],
    [
        19,
        {
            position: 5,
            label: 'KREDIT / BON',
            behavior: 'piutang',
            party: 'pilih_pihak',
            options: [],
        },
    ],
    [
        12,
        {
            position: 6,
            label: 'BEBAN/KEUNTUNGAN RS',
            behavior: 'beban',
            party: 'tidak',
            options: [],
        },
    ],
    [
        9,
        {
            position: 7,
            label: 'Pasien BON',
            behavior: 'piutang',
            party: 'pasien',
            options: ['takes_remainder'],
        },
    ],
]);

type FlaggedBehavior = 'tunai' | 'non_tunai' | 'penjamin';

// Perilaku yang ditunjuk flag, atau null bila tidak ada atau lebih dari satu.
function flaggedBehavior(row: LegacyPaymentType): FlaggedBehavior | null {
    const flagged: FlaggedBehavior[] = [
        ...(row.Cash ? ['tunai' as const] : []),
        ...(row.Bank || row.CC ? ['non_tunai' as const] : []),
        ...(row.Jaminan ? ['penjamin' as const] : []),
    ];
    return flagged.length === 1 ? (flagged[0] ?? null) : null;
}

const flaggedDefaults: Record<
    FlaggedBehavior,
    Pick<Field, 'party' | 'options'>
> = {
    tunai: { party: 'tidak', options: ['counted_at_close'] },
    non_tunai: { party: 'tidak', options: cardOptions },
    penjamin: { party: 'penjamin_kunjungan', options: [] },
};

// Isian layar lama berlaku bila flag baris itu sejalan dengannya: isian tunai, kartu, dan penjamin butuh flag yang sama,
// isian piutang dan beban butuh baris tanpa flag tunai, bank, atau penjamin. IDBayar yang dipakai ulang untuk jenis
// bayar lain jatuh ke pemetaan flag.
function cashierField(row: LegacyPaymentType): Field | null {
    const field = legacyCashierFields.get(row.IDBayar);
    if (!field) return null;
    const flagged = row.Cash || row.Bank || row.CC || row.Jaminan;
    const consistent =
        field.behavior === 'piutang' || field.behavior === 'beban'
            ? !flagged
            : flaggedBehavior(row) === field.behavior;
    return consistent ? field : null;
}

export type PaymentMethodDraft = {
    kode: string;
    nama: string;
    label_kasir: string | null;
    urutan: number;
    perilaku: PaymentMethodBehavior;
    pihak: PaymentMethodParty;
    wajib_merchan: boolean;
    wajib_referensi: boolean;
    biaya_tambahan: boolean;
    menampung_sisa: boolean;
    dihitung_tutup_kas: boolean;
    tampil_di_kasir: boolean;
    aktif: boolean;
    id_bayar_lama: number;
};

export type LegacyImportPlan = {
    legacyId: number;
    legacyName: string;
    draft: PaymentMethodDraft | null;
    notes: string[];
};

// Keadaan jenis bayar legal entity itu sebelum impor.
export type ExistingPaymentMethods = {
    codes: Set<string>;
    // IDBayar sistem lama yang sudah diimpor, dengan kode jenis bayarnya.
    imported: Map<number, string>;
    activeCash: boolean;
    activeRemainder: boolean;
};

const maxSortOrder = 999;

// Rencana impor: satu hasil per baris, dengan alasan bila baris itu tidak diimpor. Mengulang impor yang sama tidak
// menambah apa pun, karena IDBayar yang sudah diimpor dilewati.
export function planLegacyImport(
    rows: LegacyPaymentType[],
    existing: ExistingPaymentMethods,
): LegacyImportPlan[] {
    const codes = new Set(existing.codes);
    let activeCash = existing.activeCash;
    let activeRemainder = existing.activeRemainder;
    const seen = new Set<number>();
    return rows.map((row) => {
        const name = row.Description.trim();
        const result = (draft: PaymentMethodDraft | null, notes: string[]) => ({
            legacyId: row.IDBayar,
            legacyName: name,
            draft,
            notes,
        });
        const already = existing.imported.get(row.IDBayar);
        if (already !== undefined)
            return result(null, [`Sudah diimpor sebagai ${already}.`]);
        if (seen.has(row.IDBayar))
            return result(null, [
                `IDBayar ${row.IDBayar} muncul lebih dari sekali; hanya baris pertama yang diimpor.`,
            ]);
        seen.add(row.IDBayar);
        if (!name || name.length > 100)
            return result(null, [
                'Description kosong atau lebih dari 100 karakter.',
            ]);

        const field = cashierField(row);
        const flagged = flaggedBehavior(row);
        const rule =
            field ??
            (flagged === null
                ? null
                : { behavior: flagged, ...flaggedDefaults[flagged] });
        if (rule === null)
            return result(null, [
                'Perilakunya tidak bisa ditentukan dari data sistem lama: bukan tunai, bank, atau penjamin, dan tidak punya isian di layar kasir lama. Tambahkan sendiri di Jenis bayar dengan perilaku yang sesuai.',
            ]);
        const { behavior, party, options } = rule;
        const notes: string[] = [];
        if (!field)
            notes.push(
                'Tidak punya isian di layar kasir lama, jadi tidak tampil di kasir. Nyalakan Tampil di kasir bila perlu.',
            );

        const base =
            (row.Kode ?? '').trim().toUpperCase() || String(row.IDBayar);
        let code = base;
        if (codes.has(code)) {
            code = `${base}-${row.IDBayar}`;
            if (codes.has(code) || code.length > 20)
                return result(null, [
                    `Kode ${base} sudah dipakai jenis bayar lain. Ganti kode yang lama, lalu impor lagi.`,
                ]);
            notes.push(
                `Kode ${base} sudah dipakai jenis bayar lain, jadi disimpan sebagai ${code}.`,
            );
        } else if (code.length > 20)
            return result(null, [`Kode ${base} lebih dari 20 karakter.`]);

        let active = row.Active;
        const option = (name: PaymentMethodOption) => options.includes(name);
        if (active && behavior === 'tunai') {
            if (activeCash) {
                active = false;
                notes.push(
                    'Sudah ada jenis bayar tunai yang aktif, jadi baris ini diimpor nonaktif.',
                );
            } else activeCash = true;
        }
        if (active && option('takes_remainder')) {
            if (activeRemainder) {
                active = false;
                notes.push(
                    'Sudah ada jenis bayar aktif yang menampung sisa, jadi baris ini diimpor nonaktif.',
                );
            } else activeRemainder = true;
        }
        codes.add(code);
        const sortOrder = field
            ? field.position
            : Math.min(100 + Math.max(row.NoUrut ?? 0, 0), maxSortOrder);
        return result(
            {
                kode: code,
                nama: name,
                label_kasir: field && field.label !== name ? field.label : null,
                urutan: sortOrder,
                perilaku: behavior,
                pihak: party,
                wajib_merchan: option('requires_merchant'),
                wajib_referensi: option('requires_reference'),
                biaya_tambahan: option('allows_surcharge'),
                menampung_sisa: option('takes_remainder'),
                dihitung_tutup_kas: option('counted_at_close'),
                tampil_di_kasir: field !== null,
                aktif: active,
                id_bayar_lama: row.IDBayar,
            },
            notes,
        );
    });
}
