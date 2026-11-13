import { Decimal } from '../../../platform/money/index.ts';

// Hitungan Clerk End. Jenis bayar yang dihitung adalah jenis bayar bertanda dihitung_tutup_kas yang aktif, ditambah yang
// sudah nonaktif tetapi punya penjualan di sesi ini, supaya penjualannya tidak hilang dari hitungan. Selisih per jenis
// bayar = jumlah fisik - jumlah sistem.

export type CountedMethod = { id: string; active: boolean };

// Penjualan kasir selama sesi: jumlah pembayaran dan nilainya, semua jenis bayar, dan nilai per id jenis bayar.
export type ClerkSales = {
    transactions: number;
    total: string;
    byMethod: ReadonlyMap<string, string>;
};

export type ClerkClose = {
    lines: {
        paymentMethodId: string;
        system: string;
        counted: string;
        difference: string;
    }[];
    transactions: number;
    systemTotal: string;
    clerkTotal: string;
    differenceTotal: string;
};

const zero = Decimal.of('0');
// Jumlah yang dihitung di sini sudah berpresisi mata uang (isian diperiksa, penjualan dijumlah dari baris tersimpan), jadi
// ditulis apa adanya tanpa dibulatkan lagi.
const money = (value: Decimal) => value.normalized();

export function countedMethods<M extends CountedMethod>(
    methods: M[],
    sales: ClerkSales,
): M[] {
    return methods.filter(
        (method) =>
            method.active ||
            Decimal.of(sales.byMethod.get(method.id) ?? '0').compare(zero) !==
                0,
    );
}

export function closeClerk(
    methods: CountedMethod[],
    sales: ClerkSales,
    counts: ReadonlyMap<string, string>,
): ClerkClose {
    const lines = countedMethods(methods, sales).map((method) => {
        const system = Decimal.of(sales.byMethod.get(method.id) ?? '0');
        const counted = Decimal.of(counts.get(method.id) ?? '0');
        return {
            paymentMethodId: method.id,
            system,
            counted,
            difference: counted.minus(system),
        };
    });
    const sum = (pick: (line: (typeof lines)[number]) => Decimal) =>
        lines.reduce((total, line) => total.plus(pick(line)), zero);
    return {
        lines: lines.map((line) => ({
            paymentMethodId: line.paymentMethodId,
            system: money(line.system),
            counted: money(line.counted),
            difference: money(line.difference),
        })),
        transactions: sales.transactions,
        systemTotal: money(Decimal.of(sales.total)),
        clerkTotal: money(sum((line) => line.counted)),
        differenceTotal: money(sum((line) => line.difference)),
    };
}
