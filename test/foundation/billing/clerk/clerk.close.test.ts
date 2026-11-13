import { expect, test } from 'bun:test';
import { closeClerk } from '../../../../src/foundation/billing/clerk/clerk.close.ts';
import { Decimal } from '../../../../src/platform/money/index.ts';

const cash = { id: 'tunai', active: true };
const card = { id: 'kartu', active: true };
const foreignCash = { id: 'tunai-valuta', active: true };

// Penjualan mata uang lokal: nilai lokal sama dengan nilai dalam mata uangnya.
const local = (value: string) => ({ local: value, currency: value });
const noRates = new Map<string, Decimal>();
const toTwoDecimals = (value: Decimal) => value.rounded(2);
const toWholeRupiah = (value: Decimal) => value.rounded(0);

test('a Kuta session closes to the same shortage as the legacy system when only cash was sold', () => {
    // Sesi Kuta yang ditutup, hanya angka: 2 pembayaran tunai senilai 150.000, kasir menghitung 100.000 tunai, dan
    // SIMtrClerk mencatat JumlahTotalSelisih -50.000.
    const closed = closeClerk(
        [cash, card],
        {
            transactions: 2,
            total: '150000',
            byMethod: new Map([['tunai', local('150000')]]),
        },
        new Map([['tunai', '100000']]),
        noRates,
        toWholeRupiah,
    );
    expect(closed).toEqual({
        lines: [
            {
                paymentMethodId: 'tunai',
                system: '150000',
                systemLocal: '150000',
                counted: '100000',
                difference: '-50000',
                rate: '1',
                differenceLocal: '-50000',
            },
            {
                paymentMethodId: 'kartu',
                system: '0',
                systemLocal: '0',
                counted: '0',
                difference: '0',
                rate: '1',
                differenceLocal: '0',
            },
        ],
        transactions: 2,
        systemTotal: '150000',
        clerkTotal: '100000',
        differenceTotal: '-50000',
    });
});

test('a guarantor sale counts toward the session total but not toward the difference, because it is not in the drawer', () => {
    const closed = closeClerk(
        [cash, card],
        {
            transactions: 3,
            total: '425000',
            byMethod: new Map([
                ['tunai', local('75000')],
                ['kartu', local('100000')],
                ['bpjs', local('250000')],
            ]),
        },
        new Map([
            ['tunai', '75000'],
            ['kartu', '100000.50'],
        ]),
        noRates,
        toTwoDecimals,
    );
    expect(closed.lines.map((line) => line.paymentMethodId)).toEqual([
        'tunai',
        'kartu',
    ]);
    expect(closed.systemTotal).toBe('425000');
    expect(closed.clerkTotal).toBe('175000.5');
    expect(closed.differenceTotal).toBe('0.5');
});

test('an inactive counted method is closed only when it sold something in the session', () => {
    const retired = { id: 'edc-lama', active: false };
    const unused = { id: 'edc-mati', active: false };
    const closed = closeClerk(
        [cash, retired, unused],
        {
            transactions: 1,
            total: '50000',
            byMethod: new Map([['edc-lama', local('50000')]]),
        },
        new Map(),
        noRates,
        toWholeRupiah,
    );
    expect(
        closed.lines.map((line) => [line.paymentMethodId, line.difference]),
    ).toEqual([
        ['tunai', '0'],
        ['edc-lama', '-50000'],
    ]);
});

test('foreign cash is counted in its own currency, and its difference is valued at the closing rate', () => {
    // Satu pembayaran 12,35 valuta (200.694 rupiah dengan kurs 16.250,5) dengan kembalian 694 rupiah dari laci lokal,
    // jadi tunai lokal sistem -694. Kasir menghitung 12,30 valuta, dan 0 untuk tunai lokal karena jumlah fisik tidak bisa
    // negatif. Kurs hari Clerk End 16.300: kurang 0,05 valuta = 815 rupiah.
    const closed = closeClerk(
        [cash, foreignCash],
        {
            transactions: 1,
            total: '200000',
            byMethod: new Map([
                ['tunai', local('-694')],
                ['tunai-valuta', { local: '200694', currency: '12.35' }],
            ]),
        },
        new Map([
            ['tunai', '0'],
            ['tunai-valuta', '12.30'],
        ]),
        new Map([['tunai-valuta', Decimal.of('16300')]]),
        toWholeRupiah,
    );
    expect(closed.lines).toEqual([
        {
            paymentMethodId: 'tunai',
            system: '-694',
            systemLocal: '-694',
            counted: '0',
            difference: '694',
            rate: '1',
            differenceLocal: '694',
        },
        {
            paymentMethodId: 'tunai-valuta',
            system: '12.35',
            systemLocal: '200694',
            counted: '12.3',
            difference: '-0.05',
            rate: '16300',
            differenceLocal: '-815',
        },
    ]);
    // Jumlah fisik dinilai dengan kurs hari itu: 12,30 x 16.300 = 200.490 rupiah.
    expect([
        closed.systemTotal,
        closed.clerkTotal,
        closed.differenceTotal,
    ]).toEqual(['200000', '200490', '-121']);
});
