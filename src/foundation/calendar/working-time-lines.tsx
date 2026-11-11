import { Checkbox } from '@operations-metta/ui/checkbox';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

// Rentang jam kerja yang sedang diisi di kartu. `key` lokal, karena baris draft belum punya id database.
export type LineDraft = {
    key: string;
    day_of_week: number;
    from: string;
    to: string;
    ends_next_day: boolean;
};

export const weekdayNames = [
    'Senin',
    'Selasa',
    'Rabu',
    'Kamis',
    'Jumat',
    'Sabtu',
    'Minggu',
];

export const linesOf = (
    lines: {
        day_of_week?: number;
        from: string;
        to: string;
        ends_next_day: boolean;
    }[],
): LineDraft[] =>
    lines.map((line) => ({
        key: crypto.randomUUID(),
        day_of_week: line.day_of_week ?? 0,
        from: line.from,
        to: line.to,
        ends_next_day: line.ends_next_day,
    }));

export const intervalText = (line: {
    from: string;
    to: string;
    ends_next_day: boolean;
}) => `${line.from}–${line.to}${line.ends_next_day ? ' (besok)' : ''}`;

// Editor rentang jam kerja, dipakai template (dengan kolom Hari) dan satu tanggal kalender (tanpa). Tambah meneruskan
// baris terakhir ke hari berikutnya dengan jam yang sama, sehingga Senin sampai Jumat cukup diisi sekali lalu Tambah.
export function WorkingTimeLines({
    lines,
    onChange,
    withWeekday,
    editable,
    errors,
    portalContainer,
}: {
    lines: LineDraft[];
    onChange: (lines: LineDraft[]) => void;
    withWeekday: boolean;
    editable: boolean;
    errors: Record<string, string[]>;
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
    const [selected, setSelected] = useState<string[]>([]);
    const update = (key: string, change: Partial<LineDraft>) =>
        onChange(
            lines.map((line) =>
                line.key === key ? { ...line, ...change } : line,
            ),
        );
    const error = (line: LineDraft, part: 'from' | 'to' | 'day_of_week') =>
        errors[`lines.${lines.indexOf(line)}.${part}`]?.[0];
    const add = () => {
        const last = lines.at(-1);
        onChange([
            ...lines,
            {
                key: crypto.randomUUID(),
                day_of_week:
                    withWeekday && last ? (last.day_of_week + 1) % 7 : 0,
                from: last?.from ?? '08:00',
                to: last?.to ?? '16:00',
                ends_next_day: last?.ends_next_day ?? false,
            },
        ]);
    };
    const time = (
        line: LineDraft,
        part: 'from' | 'to',
        label: string,
    ): ReactNode =>
        editable ? (
            <FormControl error={error(line, part)}>
                <Input
                    label={label}
                    type="time"
                    required
                    data-error-field={`lines.${lines.indexOf(line)}.${part}`}
                    value={line[part]}
                    onChange={(event) =>
                        update(line.key, { [part]: event.target.value })
                    }
                />
            </FormControl>
        ) : (
            <DataTableText>{line[part]}</DataTableText>
        );

    return (
        <DocumentLines
            title="Jam kerja"
            data={lines}
            getRowKey={(line) => line.key}
            getRowLabel={(line) =>
                withWeekday
                    ? `${weekdayNames[line.day_of_week] ?? ''} ${intervalText(line)}`
                    : intervalText(line)
            }
            readOnly={!editable}
            portalContainer={portalContainer}
            selection={
                editable
                    ? {
                          selectedKeys: selected,
                          onSelectedKeysChange: (keys) =>
                              setSelected(keys.map(String)),
                      }
                    : undefined
            }
            onAddRow={editable ? add : undefined}
            onDeleteRows={
                editable
                    ? (removed) =>
                          onChange(
                              lines.filter((line) => !removed.includes(line)),
                          )
                    : undefined
            }
            emptyMessage={
                editable
                    ? withWeekday
                        ? 'Belum ada jam kerja; setiap hari tutup. Pilih Tambah untuk menambahkan jam kerja.'
                        : 'Belum ada jam kerja. Pilih Tambah untuk menambahkan jam kerja.'
                    : 'Tidak ada jam kerja.'
            }
            columns={[
                ...(withWeekday
                    ? [
                          {
                              id: 'day_of_week',
                              header: 'Hari',
                              content: 'control' as const,
                              minWidth: 140,
                              cell: (line: LineDraft) =>
                                  editable ? (
                                      <FormControl
                                          error={error(line, 'day_of_week')}
                                      >
                                          <Select
                                              label="Hari"
                                              required
                                              items={weekdayNames.map(
                                                  (name, day) => ({
                                                      value: String(day),
                                                      label: name,
                                                  }),
                                              )}
                                              value={String(line.day_of_week)}
                                              onValueChange={(value) =>
                                                  update(line.key, {
                                                      day_of_week: Number(
                                                          value ?? 0,
                                                      ),
                                                  })
                                              }
                                              searchPlaceholder="Cari hari"
                                              emptyMessage="Hari tidak ditemukan."
                                              portalContainer={portalContainer}
                                          />
                                      </FormControl>
                                  ) : (
                                      <DataTableText>
                                          {weekdayNames[line.day_of_week]}
                                      </DataTableText>
                                  ),
                          },
                      ]
                    : []),
                {
                    id: 'from',
                    header: 'Mulai',
                    content: 'control',
                    minWidth: 120,
                    cell: (line) => time(line, 'from', 'Mulai'),
                },
                {
                    id: 'to',
                    header: 'Selesai',
                    content: 'control',
                    minWidth: 120,
                    cell: (line) => time(line, 'to', 'Selesai'),
                },
                {
                    id: 'ends_next_day',
                    header: 'Selesai besok',
                    content: 'control',
                    width: 120,
                    cell: (line) => (
                        <Checkbox
                            aria-label="Selesai besok"
                            checked={line.ends_next_day}
                            disabled={!editable}
                            onCheckedChange={(checked) =>
                                update(line.key, {
                                    ends_next_day: checked === true,
                                })
                            }
                        />
                    ),
                },
            ]}
        />
    );
}
