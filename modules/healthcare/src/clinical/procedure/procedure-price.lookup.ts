import type {
    PriceLocation,
    ProcedureTariff,
} from './procedure-price.options.ts';

// Pencarian tarif jasa sistem lama: GetTarifBiayaNonKerjasama (beserta _BUFF) dan GetTarifBiayaJKN_BUFF, lalu saringan
// Services::datatable_charge_collection. Fungsi murni tanpa database; pemuatnya ProcedurePrices.lookup. Uang teks
// desimal empat angka di belakang koma yang diteruskan apa adanya, tanggal teks YYYY-MM-DD.

// Satu baris harga tindakan hidup. Kunci kosong berarti wildcard sistem lama: kelas XX, spesialis ALL, dokter XX,
// kategori operasi 1 ALL.
export type PriceCandidate = {
    id: string;
    priceGroupId: string;
    careClassId: string | null;
    specialtyId: string | null;
    doctorId: string | null;
    operationCategoryId: string | null;
    ktpPatient: boolean;
    cito: boolean;
    location: PriceLocation;
    previousPrice: string;
    newPrice: string;
    newPriceDate: string;
    previousBpjsPrice: string;
    bpjsPrice: string;
    bpjsPriceDate: string | null;
};

// Baris harga dalam urutan dibuat: urutan itu yang memutus seri sesudah ORDER BY Lokasi, seperti ListHargaID.
export type ProcedureForLookup = {
    variesByCito: boolean;
    variesByOperationCategory: boolean;
    prices: readonly PriceCandidate[];
};

// priceGroupId adalah kelompok harga yang dicari tarifnya, hasil pemetaan tipe pasien. Dokter tanpa spesialis
// dicocokkan hanya dengan baris spesialis ALL, seperti dokter XX sistem lama yang spesialisnya tidak ada di master.
export type PriceLookupRequest = {
    tariff: ProcedureTariff;
    priceGroupId: string | null;
    doctor: { id: string; specialtyId: string | null } | null;
    careClassId: string | null;
    cito: boolean;
    operationCategoryId: string | null;
    ktpPatient: boolean;
    location: PriceLocation | null;
};

// kind general: Harga Baru, Harga Lama, Tanggal Harga Baru. kind bpjs: kolom BPJS-nya.
export type ChosenPrice = {
    kind: TariffPrice;
    priceRowId: string;
    price: string;
    previousPrice: string;
    priceDate: string | null;
};

// step: langkah yang terpilih, juga bila saringan sesudahnya mengosongkan hasil; null untuk tarif `none`.
export type PriceLookupResult = {
    step: TariffStep | null;
    price: ChosenPrice | null;
};

type KeyMatch = 'requested' | 'wildcard' | 'any';
type StepPattern = {
    ownPriceGroup: boolean;
    careClass: KeyMatch;
    doctor: KeyMatch;
    specialty: 'doctor_or_all' | 'any';
};

// Satu langkah satu cabang IF EXISTS fungsi sistem lama. requested = nilai yang diminta (kosong berarti wildcard),
// wildcard = baris berkunci wildcard saja, any = kunci itu tidak disaring.
export const tariffSteps = {
    class_doctor_specialty: {
        ownPriceGroup: true,
        careClass: 'requested',
        doctor: 'requested',
        specialty: 'doctor_or_all',
    },
    class_specialty: {
        ownPriceGroup: true,
        careClass: 'requested',
        doctor: 'wildcard',
        specialty: 'doctor_or_all',
    },
    specialty: {
        ownPriceGroup: true,
        careClass: 'wildcard',
        doctor: 'wildcard',
        specialty: 'doctor_or_all',
    },
    care_class: {
        ownPriceGroup: true,
        careClass: 'requested',
        doctor: 'wildcard',
        specialty: 'any',
    },
    wildcard: {
        ownPriceGroup: true,
        careClass: 'wildcard',
        doctor: 'wildcard',
        specialty: 'any',
    },
    care_class_any_doctor: {
        ownPriceGroup: true,
        careClass: 'requested',
        doctor: 'any',
        specialty: 'any',
    },
    price_group: {
        ownPriceGroup: true,
        careClass: 'any',
        doctor: 'any',
        specialty: 'any',
    },
    any_price_group: {
        ownPriceGroup: false,
        careClass: 'any',
        doctor: 'any',
        specialty: 'any',
    },
} as const satisfies Record<string, StepPattern>;
export type TariffStep = keyof typeof tariffSteps;

// general: Harga Baru, saringan cyto dan kategori operasi GetTarifBiayaNonKerjasama, dan saringan KTP PHP.
// bpjs: Harga Baru BPJS tanpa saringan itu, karena PHP memanggil GetTarifBiayaJKN_BUFF langsung.
export type TariffPrice = 'general' | 'bpjs';

type TariffMethod = {
    price: TariffPrice;
    steps: readonly TariffStep[];
};

// Langkah pertama yang punya baris dipakai seluruhnya; langkah terakhir tanpa IF EXISTS, jadi hasilnya boleh kosong.
// Cabang keempat GetTarifBiayaNonKerjasama_BUFF sama persis dengan cabang kedua, dan cabang keempat sampai keenam
// GetTarifBiayaJKN_BUFF mengulang cabang kedua dan ketiga, jadi tidak pernah berjalan dan tidak ditulis di sini.
const tariffMethods = {
    none: null,
    general: {
        price: 'general',
        steps: [
            'class_doctor_specialty',
            'class_specialty',
            'specialty',
            'care_class',
            'wildcard',
            'care_class_any_doctor',
            'price_group',
            'any_price_group',
        ],
    },
    general_own_group: {
        price: 'general',
        steps: [
            'class_doctor_specialty',
            'class_specialty',
            'specialty',
            'care_class',
            'wildcard',
            'care_class_any_doctor',
            'price_group',
        ],
    },
    bpjs: {
        price: 'bpjs',
        steps: [
            'class_doctor_specialty',
            'class_specialty',
            'specialty',
            'care_class',
            'price_group',
            'any_price_group',
        ],
    },
    bpjs_matching_only: {
        price: 'bpjs',
        steps: [
            'class_doctor_specialty',
            'class_specialty',
            'specialty',
            'care_class',
            'wildcard',
        ],
    },
} as const satisfies Record<ProcedureTariff, TariffMethod | null>;

export function tariffStepsOf(tariff: ProcedureTariff): readonly TariffStep[] {
    return tariffMethods[tariff]?.steps ?? [];
}

function keyMatches(
    match: KeyMatch,
    value: string | null,
    requested: string | null,
): boolean {
    switch (match) {
        case 'requested':
            return value === requested;
        case 'wildcard':
            return value === null;
        case 'any':
            return true;
        default:
            return match satisfies never;
    }
}

function stepMatches(
    step: TariffStep,
    row: PriceCandidate,
    request: PriceLookupRequest,
): boolean {
    const pattern: StepPattern = tariffSteps[step];
    const doctorSpecialty = request.doctor?.specialtyId ?? null;
    return (
        (!pattern.ownPriceGroup || row.priceGroupId === request.priceGroupId) &&
        keyMatches(pattern.careClass, row.careClassId, request.careClassId) &&
        keyMatches(pattern.doctor, row.doctorId, request.doctor?.id ?? null) &&
        (pattern.specialty === 'any' ||
            row.specialtyId === null ||
            (doctorSpecialty !== null && row.specialtyId === doctorSpecialty))
    );
}

// Saringan sesudah langkah dipilih. Hasil yang kosong tidak membuat pencarian pindah ke langkah berikutnya.
function passesFilters(
    row: PriceCandidate,
    procedure: ProcedureForLookup,
    request: PriceLookupRequest,
    price: TariffMethod['price'],
): boolean {
    if (price === 'general') {
        if (procedure.variesByCito && row.cito !== request.cito) return false;
        if (
            procedure.variesByOperationCategory &&
            row.operationCategoryId !== null &&
            row.operationCategoryId !== request.operationCategoryId
        )
            return false;
        if (request.ktpPatient && !row.ktpPatient) return false;
    }
    return (
        request.location === null ||
        row.location === request.location ||
        row.location === 'XX'
    );
}

export function lookupProcedurePrice(
    procedure: ProcedureForLookup,
    request: PriceLookupRequest,
): PriceLookupResult {
    const method = tariffMethods[request.tariff];
    if (method === null) return { step: null, price: null };
    let step: TariffStep | null = null;
    let rows: PriceCandidate[] = [];
    for (const candidate of method.steps) {
        step = candidate;
        rows = procedure.prices.filter((row) =>
            stepMatches(candidate, row, request),
        );
        if (rows.length) break;
    }
    const [chosen] = rows
        .filter((row) => passesFilters(row, procedure, request, method.price))
        .sort((a, b) =>
            a.location < b.location ? -1 : a.location > b.location ? 1 : 0,
        );
    if (!chosen) return { step, price: null };
    return {
        step,
        price:
            method.price === 'general'
                ? {
                      kind: 'general',
                      priceRowId: chosen.id,
                      price: chosen.newPrice,
                      previousPrice: chosen.previousPrice,
                      priceDate: chosen.newPriceDate,
                  }
                : {
                      kind: 'bpjs',
                      priceRowId: chosen.id,
                      price: chosen.bpjsPrice,
                      previousPrice: chosen.previousBpjsPrice,
                      priceDate: chosen.bpjsPriceDate,
                  },
    };
}
