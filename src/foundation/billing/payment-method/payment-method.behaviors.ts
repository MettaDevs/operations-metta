// Katalog perilaku jenis bayar. Setiap perilaku diimplementasikan sekali di kode dan dipilih per jenis bayar lewat
// jenis_bayar.perilaku, jadi kode kasir bertanya "perilaku apa yang dipegang jenis bayar ini", tidak pernah "apakah ini
// TUNAI". Bentuknya mengikuti tender type Commerce (setiap metode memilih satu fungsi) dan Payment Method Business
// Central (metode adalah data). Jenis bayar baru dengan perilaku yang sudah ada cukup berupa baris data; perilaku baru,
// misalnya uang muka, butuh kode sekali di sini.
//
// `parties` adalah pihak yang boleh dipilih perilaku itu, yang pertama bawaannya. `options` adalah isian tambahan yang
// berlaku untuk perilaku itu; isian di luar daftarnya ditolak, supaya jenis bayar tidak menyimpan kombinasi yang tidak
// pernah dibaca layar kasir.
export const paymentMethodParties = {
    tidak: 'Tanpa pihak',
    penjamin_kunjungan: 'Penjamin kunjungan',
    pasien: 'Pasien',
    pilih_pihak: 'Dipilih saat bayar',
} as const;
export type PaymentMethodParty = keyof typeof paymentMethodParties;

// Isian ya/tidak jenis bayar, dengan kolom jenis_bayar dan labelnya di kartu jenis bayar.
export const paymentMethodOptionFields = [
    {
        option: 'requires_merchant',
        column: 'wajib_merchan',
        label: 'Wajib pilih merchan',
        hint: 'Kasir memilih bank atau mesin EDC saat menerima pembayaran ini.',
    },
    {
        option: 'requires_reference',
        column: 'wajib_referensi',
        label: 'Wajib nomor referensi',
        hint: 'Kasir mengisi nomor kartu atau nomor transaksi.',
    },
    {
        option: 'allows_surcharge',
        column: 'biaya_tambahan',
        label: 'Boleh biaya tambahan',
        hint: 'Kasir boleh menambah biaya kartu dalam persen.',
    },
    {
        option: 'takes_remainder',
        column: 'menampung_sisa',
        label: 'Menampung sisa',
        hint: 'Tampil sebagai centang di kasir yang memindahkan sisa tagihan ke jenis bayar ini, seperti Pasien BON.',
    },
    {
        option: 'counted_at_close',
        column: 'dihitung_tutup_kas',
        label: 'Dihitung saat Clerk End',
        hint: 'Kasir mengisi jumlah fisiknya saat menutup kas, lalu selisihnya dihitung.',
    },
] as const;
export type PaymentMethodOption =
    (typeof paymentMethodOptionFields)[number]['option'];

type BehaviorRule = {
    label: string;
    description: string;
    parties: readonly PaymentMethodParty[];
    options: readonly PaymentMethodOption[];
};

export const paymentMethodBehaviors = {
    tunai: {
        label: 'Tunai',
        description:
            'Uang tunai di laci. Kasir mengisi uang yang diterima dan melihat kembaliannya.',
        parties: ['tidak'],
        options: ['counted_at_close'],
    },
    non_tunai: {
        label: 'Non tunai',
        description: 'Kartu, EDC, transfer, atau QRIS.',
        parties: ['tidak'],
        options: [
            'requires_merchant',
            'requires_reference',
            'allows_surcharge',
            'counted_at_close',
        ],
    },
    penjamin: {
        label: 'Penjamin',
        description:
            'Ditagihkan ke penjamin kunjungan, misalnya perusahaan, BPJS, atau asuransi.',
        parties: ['penjamin_kunjungan'],
        options: ['requires_reference'],
    },
    piutang: {
        label: 'Piutang',
        description:
            'Bon pasien atau pihak lain, dilunasi kemudian di Pembayaran Hutang.',
        parties: ['pasien', 'pilih_pihak'],
        options: ['requires_reference', 'takes_remainder'],
    },
    beban: {
        label: 'Beban',
        description: 'Ditanggung klinik sendiri, tanpa piutang.',
        parties: ['tidak'],
        options: [],
    },
} as const satisfies Record<string, BehaviorRule>;
export type PaymentMethodBehavior = keyof typeof paymentMethodBehaviors;

export function isPaymentMethodBehavior(
    value: string,
): value is PaymentMethodBehavior {
    return Object.hasOwn(paymentMethodBehaviors, value);
}

export function behaviorRule(behavior: PaymentMethodBehavior): BehaviorRule {
    return paymentMethodBehaviors[behavior];
}

export function isPaymentMethodParty(
    value: string,
): value is PaymentMethodParty {
    return Object.hasOwn(paymentMethodParties, value);
}
