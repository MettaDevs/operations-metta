import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    lookupProcedurePrice,
    tariffStepsOf,
    type PriceCandidate,
    type PriceLookupRequest,
    type PriceLookupResult,
    type ProcedureForLookup,
} from '../../../src/clinical/procedure/procedure-price.lookup.ts';
import {
    isPriceLocation,
    isProcedureTariff,
    procedureTariffs,
    type ProcedureTariff,
} from '../../../src/clinical/procedure/procedure-price.options.ts';
import fixture from './legacy-procedure-prices.json';

const caller = z.object({
    tariff: z.string().refine(isProcedureTariff),
    price_group: z.string().nullable(),
});
const callers = z.record(z.string(), caller);
const fixtureSchema = z.object({
    sources: z.record(
        z.string(),
        z.object({
            callers,
            procedures: z.array(z.string()),
            cases: z.array(z.string()),
        }),
    ),
    synthetic: z.object({
        doctors: z.record(z.string(), z.string().nullable()),
        axes: z.object({
            doctors: z.array(z.string()),
            care_classes: z.array(z.string()),
            cito_and_operation_category: z.array(
                z.tuple([z.boolean(), z.string()]),
            ),
            ktp_patient: z.array(z.boolean()),
            locations: z.array(z.string()),
        }),
        procedures: z.array(z.string()),
        passes: z.record(
            z.string(),
            z.object({ callers, grid: z.array(z.string()) }),
        ),
    }),
    reasons: z.record(z.string(), z.string()),
    expected_differences: z.array(
        z.object({
            case: z.string(),
            legacy: z.string(),
            ours: z.string(),
            reason: z.string(),
        }),
    ),
});
const golden = fixtureSchema.parse(fixture);

type Outcome = {
    id: string;
    price: string;
    previousPrice: string;
    date: string | null;
} | null;
type Evaluated = {
    key: string;
    tariff: ProcedureTariff;
    result: PriceLookupResult;
    legacy: string;
    ours: string;
};

// Wildcard sistem lama menjadi kunci kosong, dibandingkan tanpa membedakan huruf besar seperti collation CI_AS.
const unlessWildcard = (value: string, wildcard: string) =>
    value.toUpperCase() === wildcard ? null : value;
// Tanggal Harga Baru BPJS yang tidak diisi tersimpan 1900-01-01 (Kuta) atau NULL (Penta); di sini kosong.
const legacyDate = (value: string) =>
    value === '~' || value === '1900-01-01' ? null : value;
const legacyFlag = (value: string) => {
    if (value !== '0' && value !== '1') throw new Error(`flag ${value}`);
    return value === '1';
};

function candidate(row: string): PriceCandidate {
    const [
        id,
        type,
        careClass,
        doctor,
        specialty,
        category,
        cito,
        ktp,
        location,
        previousPrice,
        newPrice,
        newPriceDate,
        previousBpjsPrice,
        bpjsPrice,
        bpjsPriceDate,
    ] = row.split(',');
    if (bpjsPriceDate === undefined || !isPriceLocation(location!))
        throw new Error(`row ${row}`);
    if ([type, previousBpjsPrice, bpjsPrice].includes('~'))
        throw new Error(`row ${row}`);
    return {
        id: id!,
        priceGroupId: type!,
        careClassId: unlessWildcard(careClass!, 'XX'),
        doctorId: unlessWildcard(doctor!, 'XX'),
        specialtyId: unlessWildcard(specialty!, 'ALL'),
        operationCategoryId: category === '1' ? null : category!,
        ktpPatient: legacyFlag(ktp!),
        cito: legacyFlag(cito!),
        location,
        previousPrice: previousPrice!,
        newPrice: newPrice!,
        newPriceDate: newPriceDate!,
        previousBpjsPrice: previousBpjsPrice!,
        bpjsPrice: bpjsPrice!,
        bpjsPriceDate: legacyDate(bpjsPriceDate),
    };
}

// JasaID|Var_Cito|Var_KategoriOperasi|pola|baris/baris.
function proceduresOf(lines: string[]): Map<string, ProcedureForLookup> {
    return new Map(
        lines.map((line) => {
            const [jasa, cito, category, , rows] = line.split('|');
            return [
                jasa!,
                {
                    variesByCito: legacyFlag(cito!),
                    variesByOperationCategory: legacyFlag(category!),
                    prices: rows ? rows.split('/').map(candidate) : [],
                },
            ];
        }),
    );
}

const show = (outcome: Outcome) =>
    outcome === null
        ? 'tanpa tarif'
        : `${outcome.id} ${outcome.price} ${outcome.previousPrice} ${outcome.date ?? '-'}`;
const outcomeOf = (result: PriceLookupResult): Outcome =>
    result.price && {
        id: result.price.priceRowId,
        price: result.price.price,
        previousPrice: result.price.previousPrice,
        date: result.price.priceDate,
    };

function requestFor(
    entry: z.infer<typeof caller>,
    input: Omit<PriceLookupRequest, 'tariff' | 'priceGroupId'>,
): PriceLookupRequest {
    if (!isProcedureTariff(entry.tariff)) throw new Error(entry.tariff);
    return { ...input, tariff: entry.tariff, priceGroupId: entry.price_group };
}

// Kasus asli: dokter xx, kelas XX, cyto 0, kategori operasi 1, PasienKTP kosong, Lokasi RJ.
function realCases(source: string): Evaluated[] {
    const data = golden.sources[source]!;
    const procedures = proceduresOf(data.procedures);
    return data.cases.map((line) => {
        const [jasa, type, fn, row] = line.split('|');
        const key = `${type!}${fn!}`;
        const request = requestFor(data.callers[key]!, {
            doctor: null,
            careClassId: null,
            cito: false,
            operationCategoryId: null,
            ktpPatient: false,
            location: 'RJ',
        });
        const result = lookupProcedurePrice(procedures.get(jasa!)!, request);
        const [id, previousPrice, price, date] = row ? row.split(',') : [];
        const legacy: Outcome =
            id === undefined
                ? null
                : {
                      id,
                      price: price!,
                      previousPrice: previousPrice!,
                      date: fn === 'J' ? legacyDate(date!) : date!,
                  };
        return {
            key: `${source}|${key}|${jasa!}`,
            tariff: request.tariff,
            result,
            legacy: show(legacy),
            ours: show(outcomeOf(result)),
        };
    });
}

// Grid sintetis: id baris pertama per sel; harga yang diharapkan Harga_Baru (N) atau HargaBPJS (J) baris itu.
function syntheticCases(pass: string): Evaluated[] {
    const { axes, doctors } = golden.synthetic;
    const data = golden.synthetic.passes[pass]!;
    const procedures = proceduresOf(golden.synthetic.procedures);
    const cells = axes.doctors.flatMap((doctor) =>
        axes.care_classes.flatMap((careClass) =>
            axes.cito_and_operation_category.flatMap(([cito, category]) =>
                axes.ktp_patient.flatMap((ktpPatient) =>
                    axes.locations.map((location) => ({
                        doctor:
                            doctor === 'xx'
                                ? null
                                : { id: doctor, specialtyId: doctors[doctor]! },
                        careClassId: unlessWildcard(careClass, 'XX'),
                        cito,
                        operationCategoryId: category === '1' ? null : category,
                        ktpPatient,
                        location: isPriceLocation(location) ? location : null,
                    })),
                ),
            ),
        ),
    );
    return data.grid.flatMap((line) => {
        const [key, jasa, ids] = line.split('|');
        const procedure = procedures.get(jasa!)!;
        const expected = ids!.split(',');
        if (expected.length !== cells.length) throw new Error(line);
        return cells.map((cell, index) => {
            const request = requestFor(data.callers[key!]!, cell);
            const result = lookupProcedurePrice(procedure, request);
            const row = procedure.prices.find(
                (price) => price.id === expected[index],
            );
            const legacy =
                row === undefined
                    ? 'tanpa tarif'
                    : `${row.id} ${key!.endsWith('J') ? row.bpjsPrice : row.newPrice}`;
            const ours = result.price
                ? `${result.price.priceRowId} ${result.price.price}`
                : 'tanpa tarif';
            return {
                key: `${pass}|${key!}|${jasa!}|${String(index)}`,
                tariff: request.tariff,
                result,
                legacy,
                ours,
            };
        });
    });
}

const differences = new Map(
    golden.expected_differences.map((entry) => [entry.case, entry]),
);

function unexplained(cases: Evaluated[]): string[] {
    return cases.flatMap((entry) => {
        const difference = differences.get(entry.key);
        if (!difference)
            return entry.ours === entry.legacy
                ? []
                : [
                      `${entry.key}: sistem lama ${entry.legacy}, di sini ${entry.ours}`,
                  ];
        return difference.legacy === entry.legacy &&
            difference.ours === entry.ours &&
            golden.reasons[difference.reason] !== undefined &&
            entry.ours !== entry.legacy
            ? []
            : [`${entry.key}: beda tercatat tidak cocok`];
    });
}

const sources = Object.keys(golden.sources);
const passes = Object.keys(golden.synthetic.passes);
const all = [...sources.flatMap(realCases), ...passes.flatMap(syntheticCases)];

// Golden test pencarian tarif jasa terhadap GetTarifBiayaNonKerjasama dan GetTarifBiayaJKN_BUFF sistem lama. Fixture-nya
// keluaran legacy-procedure-prices.sql (data asli Kuta 1, Seroja, Penta) dan legacy-procedure-prices.synthetic.sql
// (database scratch); CI tidak punya SQL Server. Kasus yang berbeda tanpa tercatat di expected_differences, atau yang
// tercatat tetapi ternyata sama, membuat test gagal.
describe('legacy procedure prices', () => {
    test.each(sources)(
        '%s: every sampled procedure and patient type gets the legacy price',
        (source) => {
            expect(unexplained(realCases(source))).toEqual([]);
        },
    );

    test.each(passes)(
        'synthetic grid with the %s functions: every cell gets the legacy row',
        (pass) => {
            expect(unexplained(syntheticCases(pass))).toEqual([]);
        },
    );

    test('every expected difference names a golden case, once', () => {
        const known = new Set(all.map((entry) => entry.key));
        expect(
            golden.expected_differences.filter(
                (entry) => !known.has(entry.case),
            ),
        ).toEqual([]);
        expect(differences.size).toBe(golden.expected_differences.length);
    });

    test('every step of every tariff is reached, and filters after a step can leave no price', () => {
        const reached = new Set(
            all.map((entry) => `${entry.tariff}|${entry.result.step ?? ''}`),
        );
        const filteredEmpty = new Set(
            all
                .filter(
                    (entry) =>
                        entry.result.price === null &&
                        entry.result.step !== null &&
                        entry.result.step !==
                            tariffStepsOf(entry.tariff).at(-1),
                )
                .map((entry) => entry.tariff),
        );
        for (const tariff of Object.keys(procedureTariffs).filter(
            isProcedureTariff,
        )) {
            for (const step of tariffStepsOf(tariff))
                expect(reached).toContain(`${tariff}|${step}`);
            if (tariff !== 'none') expect(filteredEmpty).toContain(tariff);
        }
        expect(reached).toContain('none|');
    });
});
