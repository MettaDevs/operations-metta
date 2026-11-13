import { expect, test } from 'bun:test';
import { closeClerk } from '../../../../src/foundation/billing/clerk/clerk.close.ts';

const cash = { id: 'tunai', active: true };
const card = { id: 'kartu', active: true };

test('a Kuta session closes to the same shortage as the legacy system when only cash was sold', () => {
    // Sesi Kuta yang ditutup, hanya angka: 2 pembayaran tunai senilai 150.000, kasir menghitung 100.000 tunai, dan
    // SIMtrClerk mencatat JumlahTotalSelisih -50.000.
    const closed = closeClerk(
        [cash, card],
        {
            transactions: 2,
            total: '150000',
            byMethod: new Map([['tunai', '150000']]),
        },
        new Map([['tunai', '100000']]),
    );
    expect(closed).toEqual({
        lines: [
            {
                paymentMethodId: 'tunai',
                system: '150000',
                counted: '100000',
                difference: '-50000',
            },
            {
                paymentMethodId: 'kartu',
                system: '0',
                counted: '0',
                difference: '0',
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
                ['tunai', '75000'],
                ['kartu', '100000'],
                ['bpjs', '250000'],
            ]),
        },
        new Map([
            ['tunai', '75000'],
            ['kartu', '100000.50'],
        ]),
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
            byMethod: new Map([['edc-lama', '50000']]),
        },
        new Map(),
    );
    expect(
        closed.lines.map((line) => [line.paymentMethodId, line.difference]),
    ).toEqual([
        ['tunai', '0'],
        ['edc-lama', '-50000'],
    ]);
});
