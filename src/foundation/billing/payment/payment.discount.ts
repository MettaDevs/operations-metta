import { Decimal, divideRounded } from '../../../platform/money/index.ts';

// Tab Diskon Form Pembayaran (form/discount.php dan general_payments/Discount.php sistem lama), dipakai server dan
// layar. Setiap baris memilih satu diskon dari master; jenisnya menentukan dasar persennya:
// - total (DiskonTotal): Nilai tagihan, rumus kasir Kuta;
// - komponen (DiskonKomponen): Qty x nilai komponen biaya itu pada jasa dan dokter yang dipilih
//   (GetDetailKomponenBiaya_ForDiskon_GABUNGAN, `SUM(QTY * Harga)` per komponen);
// - kelompok_jasa (DiskonGroupJasa): tanpa dasar. Sistem lama tidak punya cabang hitungnya, jadi nilainya diketik.
// Persen ke nilai: dasar x persen / 100, dibulatkan ke presisi jumlah mata uang lokal. Nilai ke persen: nilai / dasar x
// 100 dengan dua angka di belakang koma, seperti toFixed(2) di layar lama.

export const discountKinds = ['total', 'komponen', 'kelompok_jasa'] as const;
export type DiscountKind = (typeof discountKinds)[number];

export function isDiscountKind(value: string): value is DiscountKind {
    return discountKinds.some((kind) => kind === value);
}

export type DiscountCharge = {
    procedureId: string;
    doctorId: string | null;
    quantity: string;
    components: { componentId: string; value: string }[];
};

export function discountBase(
    kind: DiscountKind,
    input: {
        invoiceValue: string;
        componentId: string | null;
        procedureId: string | null;
        doctorId: string | null;
        charges: DiscountCharge[];
    },
): Decimal | null {
    switch (kind) {
        case 'total':
            return Decimal.of(input.invoiceValue);
        case 'komponen':
            return input.charges
                .filter(
                    (charge) =>
                        charge.procedureId === input.procedureId &&
                        (input.doctorId === null ||
                            charge.doctorId === input.doctorId),
                )
                .flatMap((charge) =>
                    charge.components
                        .filter(
                            (component) =>
                                component.componentId === input.componentId,
                        )
                        .map((component) =>
                            Decimal.of(charge.quantity).multipliedBy(
                                Decimal.of(component.value),
                            ),
                        ),
                )
                .reduce((sum, value) => sum.plus(value), Decimal.of('0'));
        case 'kelompok_jasa':
            return null;
        default: {
            const unknown: never = kind;
            throw new Error(`Jenis diskon tidak dikenal: ${String(unknown)}`);
        }
    }
}

// Persen dan nilai satu baris dari isian yang diketik terakhir. Persen tanpa dasar tidak bisa dihitung, jadi hasilnya
// null dan pemanggil meminta nilainya diketik.
export function discountLine(
    base: Decimal | null,
    typed: { percent: string } | { amount: string },
    amountDecimals: number,
): { percent: string; amount: string } | null {
    if ('percent' in typed) {
        if (base === null) return null;
        return {
            percent: Decimal.of(typed.percent).normalized(),
            amount: base
                .multipliedBy(Decimal.of(typed.percent))
                .multipliedBy(Decimal.of('0.01'))
                .rounded(amountDecimals)
                .normalized(),
        };
    }
    const amount = Decimal.of(typed.amount);
    if (base === null || base.compare(Decimal.of('0')) <= 0)
        return { percent: '0', amount: amount.normalized() };
    const minor = (value: Decimal) => value.rounded(4).coefficient;
    return {
        percent: Decimal.of(
            String(divideRounded(minor(amount) * 10000n, minor(base))),
        )
            .multipliedBy(Decimal.of('0.01'))
            .normalized(),
        amount: amount.normalized(),
    };
}
