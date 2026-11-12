// Cara stok diambil dan dijaga adalah setelan, bukan kode: legal entity memegang bawaan (gd_m_parameter), operating
// unit dan lokasi boleh menimpa cara pengambilan, dan barang boleh menimpa penolakan stok minus. Mesin posting hanya
// membaca setelan lewat resolveStockPolicy.
export const pickingMethods = ['fefo', 'fifo', 'manual'] as const;
export type PickingMethod = (typeof pickingMethods)[number];
export const transferModes = ['langsung', 'kirim_terima'] as const;
export type TransferMode = (typeof transferModes)[number];

// Profil pelacakan barang (Item Tracking Code). Barang tanpa profil tidak wajib apa pun.
export type TrackingProfile = {
    batchRequired: boolean;
    expiryRequired: boolean;
    strictExpiry: boolean;
};

export type PolicySettings = {
    legalEntity: {
        picking: PickingMethod;
        refuseNegative: boolean;
        transferMode: TransferMode;
    };
    operatingUnit: { picking: PickingMethod | null };
    location: {
        picking: PickingMethod | null;
        transferMode: TransferMode | null;
    };
    item: { refuseNegative: boolean | null; tracking: TrackingProfile | null };
};

export type Movement = 'inbound' | 'outbound' | 'transfer';

export type StockPolicy = {
    picking: PickingMethod;
    refuseNegative: boolean;
    tracking: TrackingProfile;
    transferMode: TransferMode;
};

const untracked: TrackingProfile = {
    batchRequired: false,
    expiryRequired: false,
    strictExpiry: false,
};

// Transfer selalu menolak stok minus, apa pun setelan barang dan legal entity: lokasi asal tidak boleh mengirim stok
// yang tidak dimilikinya.
function refusesNegative(settings: PolicySettings, movement: Movement) {
    switch (movement) {
        case 'transfer':
            return true;
        case 'inbound':
        case 'outbound':
            return (
                settings.item.refuseNegative ??
                settings.legalEntity.refuseNegative
            );
        default: {
            const unknown: never = movement;
            throw new Error(`Unknown movement: ${String(unknown)}`);
        }
    }
}

export function resolveStockPolicy(
    settings: PolicySettings,
    movement: Movement,
): StockPolicy {
    return {
        picking:
            settings.location.picking ??
            settings.operatingUnit.picking ??
            settings.legalEntity.picking,
        refuseNegative: refusesNegative(settings, movement),
        tracking: settings.item.tracking ?? untracked,
        transferMode:
            settings.location.transferMode ?? settings.legalEntity.transferMode,
    };
}
