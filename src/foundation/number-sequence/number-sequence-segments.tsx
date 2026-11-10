import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import type { Key, ReactNode, RefObject } from 'react';
import type { ApiBody } from '../../platform/shell/index.ts';

// Bagian Segments kartu Number sequences F&O: grid Segment | Value | Length dengan Tambah, Delete, Naikkan, dan
// Turunkan, lalu Format yang dihitung dari segmen dan hanya bisa dibaca.

type Stored = ApiBody<'numberSequenceShow'>['data'];
type Reference =
    ApiBody<'numberSequenceMetadata'>['data']['references'][number];
export type ScopeType = Stored['scope_type'];
export type Segment = Stored['segments'][number];
type SegmentType = Segment['type'];
// Baris segmen di draft membawa kunci lokal, karena segmen tidak punya id dan urutannya bisa diubah.
export type SegmentRow = { key: string; segment: Segment };

const segmentTypes: SegmentType[] = [
    'constant',
    'number',
    'scope',
    'year',
    'fiscal_year',
    'fiscal_period',
    'context',
];

// Nama segmen organisasi mengikuti scope, seperti F&O yang menamai segmennya Legal entity atau Operating unit.
export function scopeSegmentLabel(scope: ScopeType): string {
    return scope === 'operating_unit' ? 'Operating unit' : 'Perusahaan';
}

function segmentLabel(type: SegmentType, scope: ScopeType): string {
    switch (type) {
        case 'constant':
            return 'Teks tetap';
        case 'number':
            return 'Nomor urut';
        case 'scope':
            return scopeSegmentLabel(scope);
        case 'year':
            return 'Tahun';
        case 'fiscal_year':
            return 'Tahun fiskal';
        case 'fiscal_period':
            return 'Periode fiskal';
        case 'context':
            return 'Bagian dari data';
        default: {
            const exhaustive: never = type;
            return exhaustive;
        }
    }
}

export function rowsOf(segments: Segment[]): SegmentRow[] {
    return segments.map((segment) => ({
        key: crypto.randomUUID(),
        segment,
    }));
}

// Segmen yang boleh dipilih untuk scope ini. Segmen organisasi hanya ada bila scope memilih organisasi, dan segmen
// fiskal hanya bila sequence berjalan per periode fiskal atau direset per tahun/periode fiskal.
function availableTypes(
    scope: ScopeType,
    fiscal: boolean,
    reference: Reference | undefined,
): SegmentType[] {
    return segmentTypes.filter((type) => {
        switch (type) {
            case 'scope':
                return scope !== 'tenant';
            case 'fiscal_year':
            case 'fiscal_period':
                return fiscal;
            case 'context':
                return Boolean(reference?.context_fields.length);
            case 'constant':
            case 'number':
            case 'year':
                return true;
            default: {
                const exhaustive: never = type;
                return exhaustive;
            }
        }
    });
}

export function newSegment(type: SegmentType, reference?: Reference): Segment {
    switch (type) {
        case 'constant':
            return { type, value: '' };
        case 'number':
            return { type, length: 5 };
        case 'fiscal_period':
            return { type, length: 2 };
        case 'context': {
            const field = reference?.context_fields[0];
            return {
                type,
                value: field?.value ?? '',
                length: field?.length ?? 10,
                ...(field?.name ? { name: field.name } : {}),
            };
        }
        case 'year':
        case 'scope':
        case 'fiscal_year':
            return { type };
        default: {
            const exhaustive: never = type;
            return exhaustive;
        }
    }
}

// Satu segmen sebagai teks. `number` null menghasilkan pola (# per digit), angka menghasilkan contoh nomor. Kode
// organisasi yang belum dipilih ditulis sebagai nama segmennya.
function render(
    segment: Segment,
    scope: ScopeType,
    scopeCode: string | null,
    number: number | null,
): string {
    switch (segment.type) {
        case 'constant':
            return segment.value;
        case 'number': {
            // Mask seperti segmen Alphanumeric F&O: setiap # satu digit, karakter lain dicetak apa adanya.
            const mask = segment.mask ?? '#'.repeat(segment.length);
            if (number === null) return mask;
            const digits = String(number).padStart(segment.length, '0');
            let position = 0;
            return mask.replace(/#/g, () => digits.charAt(position++));
        }
        case 'year':
            return String(new Date().getFullYear());
        case 'scope':
            return scopeCode ?? `[${scopeSegmentLabel(scope).toLowerCase()}]`;
        case 'fiscal_year':
            return '[tahun fiskal]';
        case 'fiscal_period':
            return '#'.repeat(segment.length ?? 2);
        case 'context':
            return `[${segment.name ?? segment.value}]`;
        default: {
            const exhaustive: never = segment;
            return exhaustive;
        }
    }
}

export function formatOf(
    segments: Segment[],
    scope: ScopeType,
    scopeCode: string | null,
    number: number | null = null,
): string {
    return segments
        .map((segment) => render(segment, scope, scopeCode, number))
        .join('');
}

function lengthOf(segment: Segment, scopeCode: string | null): number | null {
    switch (segment.type) {
        case 'constant':
            return segment.value.length;
        case 'number':
            return segment.mask?.length ?? segment.length;
        case 'context':
            return segment.length;
        case 'fiscal_period':
            return segment.length ?? 2;
        case 'year':
            return 4;
        case 'scope':
            return scopeCode?.length ?? 0;
        case 'fiscal_year':
            return null;
        default: {
            const exhaustive: never = segment;
            return exhaustive;
        }
    }
}

export function SegmentGrid({
    rows,
    onChange,
    scope,
    scopeCode,
    fiscal,
    reference,
    editable,
    portalContainer,
}: {
    rows: SegmentRow[];
    onChange: (rows: SegmentRow[]) => void;
    scope: ScopeType;
    scopeCode: string | null;
    fiscal: boolean;
    reference: Reference | undefined;
    editable: boolean;
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
    const [selected, setSelected] = useState<Key[]>([]);
    const types = availableTypes(scope, fiscal, reference);
    const update = (key: string, segment: Segment) =>
        onChange(rows.map((row) => (row.key === key ? { key, segment } : row)));
    const [only] = selected;
    const position =
        selected.length === 1 ? rows.findIndex((row) => row.key === only) : -1;
    const move = (offset: number) => {
        const next = [...rows];
        const [row] = next.splice(position, 1);
        if (row) next.splice(position + offset, 0, row);
        onChange(next);
    };
    return (
        <DocumentLines
            title="Segmen"
            data={rows}
            getRowKey={(row) => row.key}
            getRowLabel={(row) => segmentLabel(row.segment.type, scope)}
            readOnly={!editable}
            portalContainer={portalContainer}
            selection={
                editable
                    ? {
                          selectedKeys: selected,
                          onSelectedKeysChange: setSelected,
                      }
                    : undefined
            }
            onAddRow={
                rows.length < 10
                    ? () =>
                          onChange([
                              ...rows,
                              ...rowsOf([newSegment('constant')]),
                          ])
                    : undefined
            }
            onDeleteRows={
                editable
                    ? (removed) =>
                          onChange(rows.filter((row) => !removed.includes(row)))
                    : undefined
            }
            toolbar={
                editable && (
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={position <= 0}
                            onClick={() => move(-1)}
                        >
                            <ArrowUp aria-hidden="true" />
                            Naikkan
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={
                                position < 0 || position === rows.length - 1
                            }
                            onClick={() => move(1)}
                        >
                            <ArrowDown aria-hidden="true" />
                            Turunkan
                        </Button>
                    </>
                )
            }
            emptyMessage="Belum ada segmen. Pilih Tambah untuk menambahkan segmen."
            columns={[
                {
                    id: 'type',
                    header: 'Segmen',
                    content: 'control',
                    minWidth: 180,
                    cell: (row) =>
                        editable ? (
                            <FormControl>
                                <Select
                                    label="Segmen"
                                    searchPlaceholder="Cari segmen"
                                    items={types.map((type) => ({
                                        value: type,
                                        label: segmentLabel(type, scope),
                                    }))}
                                    value={row.segment.type}
                                    onValueChange={(value) => {
                                        const type = types.find(
                                            (item) => item === value,
                                        );
                                        if (type && type !== row.segment.type)
                                            update(
                                                row.key,
                                                newSegment(type, reference),
                                            );
                                    }}
                                />
                            </FormControl>
                        ) : (
                            <DataTableText>
                                {segmentLabel(row.segment.type, scope)}
                            </DataTableText>
                        ),
                },
                {
                    id: 'value',
                    header: 'Nilai',
                    content: 'control',
                    minWidth: 160,
                    cell: (row) => (
                        <SegmentValue
                            segment={row.segment}
                            scope={scope}
                            scopeCode={scopeCode}
                            reference={reference}
                            editable={editable}
                            onChange={(segment) => update(row.key, segment)}
                        />
                    ),
                },
                {
                    id: 'length',
                    header: 'Panjang',
                    content: 'control',
                    width: 110,
                    align: 'right',
                    cell: (row) => (
                        <SegmentLength
                            segment={row.segment}
                            scopeCode={scopeCode}
                            editable={editable}
                            onChange={(segment) => update(row.key, segment)}
                        />
                    ),
                },
            ]}
        />
    );
}

function SegmentValue({
    segment,
    scope,
    scopeCode,
    reference,
    editable,
    onChange,
}: {
    segment: Segment;
    scope: ScopeType;
    scopeCode: string | null;
    reference: Reference | undefined;
    editable: boolean;
    onChange: (segment: Segment) => void;
}): ReactNode {
    if (segment.type === 'constant' && editable)
        return (
            <FormControl>
                <Input
                    label="Nilai"
                    value={segment.value}
                    maxLength={20}
                    onChange={(event) =>
                        onChange({ ...segment, value: event.target.value })
                    }
                />
            </FormControl>
        );
    // Nilai segmen nomor adalah mask-nya, misalnya ###### atau ##.##.##: jumlah # menjadi panjang nomor.
    if (segment.type === 'number' && editable)
        return (
            <FormControl hint="Setiap # diisi satu digit nomor. Titik, garis miring, garis bawah, atau strip di antaranya ikut dicetak, misalnya ##.##.## menjadi 00.00.01.">
                <Input
                    label="Nilai"
                    value={segment.mask ?? '#'.repeat(segment.length)}
                    maxLength={40}
                    onChange={(event) => {
                        const mask = event.target.value;
                        const length = mask.replace(/[^#]/g, '').length;
                        onChange(
                            /^#*$/.test(mask)
                                ? { type: 'number', length }
                                : { type: 'number', length, mask },
                        );
                    }}
                />
            </FormControl>
        );
    if (segment.type === 'context' && editable)
        return (
            <FormControl>
                <Select
                    label="Nilai"
                    items={(reference?.context_fields ?? []).map((field) => ({
                        value: field.value,
                        label: field.name ?? field.value,
                    }))}
                    value={segment.value}
                    onValueChange={(value) => {
                        const field = reference?.context_fields.find(
                            (item) => item.value === value,
                        );
                        if (field)
                            onChange({
                                type: 'context',
                                value: field.value,
                                length: field.length,
                                ...(field.name ? { name: field.name } : {}),
                            });
                    }}
                />
            </FormControl>
        );
    // Segmen organisasi menampilkan kode yang akan dicetak; kosong selama organisasinya belum dipilih, seperti F&O.
    const text =
        segment.type === 'scope'
            ? (scopeCode ?? '')
            : render(segment, scope, scopeCode, null);
    return <DataTableText>{text}</DataTableText>;
}

function SegmentLength({
    segment,
    scopeCode,
    editable,
    onChange,
}: {
    segment: Segment;
    scopeCode: string | null;
    editable: boolean;
    onChange: (segment: Segment) => void;
}): ReactNode {
    if (
        editable &&
        ((segment.type === 'number' && segment.mask === undefined) ||
            segment.type === 'fiscal_period')
    )
        return (
            <FormControl>
                <Input
                    label="Panjang"
                    inputMode="numeric"
                    className="text-right"
                    value={String(segment.length ?? '')}
                    onChange={(event) =>
                        onChange({
                            ...segment,
                            length: Number(event.target.value) || 0,
                        })
                    }
                />
            </FormControl>
        );
    const length = lengthOf(segment, scopeCode);
    return (
        <DataTableText>
            <span className="block text-right">{length ?? ''}</span>
        </DataTableText>
    );
}
