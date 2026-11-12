import { Badge } from '@operations-metta/ui/badge';
import type { ReactNode } from 'react';
import type { ApiBody } from '../../../platform/shell/index.ts';

// Penyesuaian stok seperti yang dikirim API ke layar, beserta label arah dan statusnya. Label ditulis per nilai, supaya
// arah atau status baru dari server langsung gagal dikompilasi sampai labelnya ada.

export type Adjustment = ApiBody<'inventoryAdjustmentShow'>['data'];
export type AdjustmentRow = ApiBody<'inventoryAdjustmentList'>['data'][number];
export type AdjustmentPermissions =
    ApiBody<'inventoryAdjustmentList'>['permissions'];
export type Direction = Adjustment['direction'];
export type Status = Adjustment['status'];

export const directionLabels: Record<Direction, string> = {
    masuk: 'Stok masuk',
    keluar: 'Stok keluar',
};

export const statusLabels: Record<Status, string> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};

const statusBadges: Record<Status, 'outline' | 'default' | 'secondary'> = {
    draf: 'outline',
    diposting: 'default',
    dibatalkan: 'secondary',
};

const keyOf =
    <K extends string>(labels: Record<K, string>) =>
    (value: unknown): value is K =>
        typeof value === 'string' && Object.hasOwn(labels, value);

export const isDirection = keyOf(directionLabels);
export const isStatus = keyOf(statusLabels);

export function StatusBadge({ status }: { status: Status }): ReactNode {
    return <Badge variant={statusBadges[status]}>{statusLabels[status]}</Badge>;
}
