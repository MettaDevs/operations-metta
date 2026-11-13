import { Decimal } from '@core/platform/money/index.ts';
import type { ApiBody } from '@core/platform/shell/index.ts';
import type { PriceSumField } from './procedure-price.options.ts';

// Baris tab Detail Harga yang sedang disusun di kartu tindakan. Angka disimpan sebagai teks desimal API, sama dengan
// yang dikirim saat kartu disimpan. Seperti grid sistem lama, perubahan baru tersimpan saat kartu disimpan.

export type PriceMetadata = ApiBody<'healthcareProcedureMetadata'>;
export type SavedPrice =
    ApiBody<'healthcareProcedureShow'>['data']['prices'][number];
type SavedComponent = SavedPrice['components'][number];

export type ComponentDraft = Omit<
    SavedComponent,
    'charge_component_code' | 'charge_component_name'
>;
export type PriceDraft = Omit<
    SavedPrice,
    | 'id'
    | 'price_group_name'
    | 'care_class_name'
    | 'specialty_name'
    | 'doctor_name'
    | 'operation_category_name'
    | 'components'
    | PriceSumField
> & {
    key: string;
    id: string | null;
    components: ComponentDraft[];
};

let keys = 0;
export const nextPriceKey = () => `harga-baru-${++keys}`;

export function priceDrafts(prices: SavedPrice[]): PriceDraft[] {
    return prices.map(
        ({
            price_group_name: _group,
            care_class_name: _careClass,
            specialty_name: _specialty,
            doctor_name: _doctor,
            operation_category_name: _operationCategory,
            previous_price: _previous,
            new_price: _new,
            previous_hc_price: _previousHc,
            new_hc_price: _newHc,
            previous_bpjs_price: _previousBpjs,
            new_bpjs_price: _newBpjs,
            components,
            ...price
        }) => ({
            ...price,
            key: price.id,
            components: components.map(
                ({
                    charge_component_code: _code,
                    charge_component_name: _name,
                    ...component
                }) => component,
            ),
        }),
    );
}

export function priceInputs(drafts: PriceDraft[]) {
    return drafts.map(({ key: _key, ...draft }) => draft);
}

// Harga baris = jumlah biasa harga komponennya (calculate_total_price sistem lama), teks desimal API.
export function priceTotal(
    components: ComponentDraft[],
    field: PriceSumField,
): string {
    return components
        .reduce(
            (sum, component) => sum.plus(Decimal.of(component[field])),
            Decimal.of('0'),
        )
        .normalized();
}
