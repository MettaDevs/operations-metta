import { Decimal } from '../../../platform/money/index.ts';

// Hitungan Clerk End. Jenis bayar yang dihitung adalah jenis bayar bertanda dihitung_tutup_kas yang aktif, ditambah yang
// sudah nonaktif tetapi punya uang awal atau penjualan di sesi ini, supaya uangnya tidak hilang dari hitungan. Selisih per
// jenis bayar = jumlah fisik - uang awal - jumlah sistem, dalam mata uang jenis bayar itu; jenis bayar bermata uang asing
// dihitung dalam lembar valuta, lalu selisihnya dinilai dengan kurs hari Clerk End.

export type CountedMethod = { id: string; active: boolean };

// Penjualan per jenis bayar: nilai dalam mata uang lokal (dengan kurs saat dibayar) dan dalam mata uang jenis bayar.
export type MethodSales = { local: string; currency: string };

// Penjualan kasir selama sesi: jumlah pembayaran dan nilainya dalam mata uang lokal, semua jenis bayar, dan nilai per id
// jenis bayar.
export type ClerkSales = {
    transactions: number;
    total: string;
    byMethod: ReadonlyMap<string, MethodSales>;
};

// Uang awal laci saat Clerk Start per id jenis bayar, dalam mata uang jenis bayar itu.
export type ClerkOpenings = ReadonlyMap<string, string>;

export type ClerkClose = {
    lines: {
        paymentMethodId: string;
        opening: string;
        system: string;
        systemLocal: string;
        counted: string;
        difference: string;
        rate: string;
        differenceLocal: string;
    }[];
    transactions: number;
    openingTotal: string;
    systemTotal: string;
    clerkTotal: string;
    differenceTotal: string;
};

const zero = Decimal.of('0');
// Jumlah yang dihitung di sini sudah berpresisi mata uang (isian diperiksa, penjualan dijumlah dari baris tersimpan, dan
// nilai lokal dibulatkan sekali), jadi ditulis apa adanya tanpa dibulatkan lagi.
const money = (value: Decimal) => value.normalized();
const nonZero = (value: string | undefined) =>
    Decimal.of(value ?? '0').compare(zero) !== 0;

export function countedMethods<M extends CountedMethod>(
    methods: M[],
    sales: ClerkSales,
    openings: ClerkOpenings,
): M[] {
    return methods.filter(
        (method) =>
            method.active ||
            nonZero(openings.get(method.id)) ||
            nonZero(sales.byMethod.get(method.id)?.currency),
    );
}

// `rates` adalah kurs Clerk End per id jenis bayar (1 untuk mata uang lokal), dan `toLocal` membulatkan nilai lokal ke
// presisi jumlah mata uang lokal.
export function closeClerk(
    methods: CountedMethod[],
    sales: ClerkSales,
    openings: ClerkOpenings,
    counts: ReadonlyMap<string, string>,
    rates: ReadonlyMap<string, Decimal>,
    toLocal: (value: Decimal) => Decimal,
): ClerkClose {
    const lines = countedMethods(methods, sales, openings).map((method) => {
        const sold = sales.byMethod.get(method.id);
        const opening = Decimal.of(openings.get(method.id) ?? '0');
        const system = Decimal.of(sold?.currency ?? '0');
        const counted = Decimal.of(counts.get(method.id) ?? '0');
        const rate = rates.get(method.id) ?? Decimal.of('1');
        const difference = counted.minus(opening).minus(system);
        return {
            paymentMethodId: method.id,
            opening,
            openingLocal: toLocal(opening.multipliedBy(rate)),
            system,
            systemLocal: Decimal.of(sold?.local ?? '0'),
            counted,
            countedLocal: toLocal(counted.multipliedBy(rate)),
            difference,
            rate,
            differenceLocal: toLocal(difference.multipliedBy(rate)),
        };
    });
    const sum = (pick: (line: (typeof lines)[number]) => Decimal) =>
        lines.reduce((total, line) => total.plus(pick(line)), zero);
    return {
        lines: lines.map((line) => ({
            paymentMethodId: line.paymentMethodId,
            opening: money(line.opening),
            system: money(line.system),
            systemLocal: money(line.systemLocal),
            counted: money(line.counted),
            difference: money(line.difference),
            rate: money(line.rate),
            differenceLocal: money(line.differenceLocal),
        })),
        transactions: sales.transactions,
        openingTotal: money(sum((line) => line.openingLocal)),
        systemTotal: money(Decimal.of(sales.total)),
        clerkTotal: money(sum((line) => line.countedLocal)),
        differenceTotal: money(sum((line) => line.differenceLocal)),
    };
}
