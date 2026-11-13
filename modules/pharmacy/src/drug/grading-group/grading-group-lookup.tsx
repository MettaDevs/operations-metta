import {
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import type { ReactNode, RefObject } from 'react';
import { api } from '@core/platform/shell/index.ts';

export type GradingGroupReference = { id: string; name: string };

// Kelompok grading tidak berkode, jadi pilihannya dicari dan ditampilkan dengan namanya saja.
const loadGradingGroups = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyGradingGroupList(
        { query: { q: query, active: '1', ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((row) => ({
            id: row.id,
            code: '',
            name: row.name,
        })),
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

// Pilihan kelompok grading aktif untuk data obat farmasi dan grading harga obat.
export function GradingGroupLookup({
    value,
    onChange,
    disabled,
    required,
    error,
    hint,
    portalContainer,
    onCreate,
}: {
    value: GradingGroupReference | null;
    onChange: (group: GradingGroupReference) => void;
    disabled: boolean;
    required?: boolean;
    error: string | undefined;
    hint?: string;
    portalContainer: RefObject<HTMLElement | null>;
    onCreate: (() => void) | undefined;
}): ReactNode {
    return (
        <MasterLookup<Reference>
            label="Kelompok grading"
            field="grading_group_id"
            required={required}
            value={value && { id: value.id, code: '', name: value.name }}
            onChange={(group) => onChange({ id: group.id, name: group.name })}
            disabled={disabled}
            error={error}
            hint={hint}
            portalContainer={portalContainer}
            onCreate={onCreate}
            noun="Kelompok grading"
            placeholder="Cari nama kelompok…"
            load={loadGradingGroups}
            columns={[nameColumn(240)]}
        />
    );
}
