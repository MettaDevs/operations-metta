import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';

// Penanda tangan yang sedang diisi di kartu kop surat. `key` lokal untuk baris yang belum disimpan.
export type SignerDraft = {
    key: string;
    id: string | null;
    title: string;
    name: string;
    id_number: string;
    report_code: string;
};

type Report = { code: string; name: string };

const allDocuments = '*';

export const signersOf = (
    signers: {
        id: string;
        title: string;
        name: string;
        id_number: string | null;
        report_code: string | null;
    }[],
): SignerDraft[] =>
    signers.map((signer) => ({
        key: signer.id,
        id: signer.id,
        title: signer.title,
        name: signer.name,
        id_number: signer.id_number ?? '',
        report_code: signer.report_code ?? allDocuments,
    }));

export const signersBody = (lines: SignerDraft[]) =>
    lines.map((line) => ({
        id: line.id,
        title: line.title,
        name: line.name,
        id_number: line.id_number,
        report_code:
            line.report_code === allDocuments ? null : line.report_code,
    }));

export function SignerLines({
    lines,
    onChange,
    reports,
    editable,
    errors,
    portalContainer,
}: {
    lines: SignerDraft[];
    onChange: (lines: SignerDraft[]) => void;
    reports: Report[];
    editable: boolean;
    errors: Record<string, string[]>;
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
    const [selected, setSelected] = useState<string[]>([]);
    const update = (key: string, change: Partial<SignerDraft>) =>
        onChange(
            lines.map((line) =>
                line.key === key ? { ...line, ...change } : line,
            ),
        );
    const fieldOf = (line: SignerDraft, part: string) =>
        `signers.${lines.indexOf(line)}.${part}`;
    const documents = [
        { value: allDocuments, label: 'Semua dokumen' },
        ...reports.map((report) => ({
            value: report.code,
            label: report.name,
        })),
    ];
    const text = (
        line: SignerDraft,
        part: 'title' | 'name' | 'id_number',
        label: string,
        maxLength: number,
    ): ReactNode =>
        editable ? (
            <FormControl error={errors[fieldOf(line, part)]?.[0]}>
                <Input
                    label={label}
                    required={part !== 'id_number'}
                    maxLength={maxLength}
                    data-error-field={fieldOf(line, part)}
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
            title="Penanda tangan"
            data={lines}
            getRowKey={(line) => line.key}
            getRowLabel={(line) => `${line.title} ${line.name}`}
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
            onAddRow={
                editable
                    ? () =>
                          onChange([
                              ...lines,
                              {
                                  key: crypto.randomUUID(),
                                  id: null,
                                  title: '',
                                  name: '',
                                  id_number: '',
                                  report_code: allDocuments,
                              },
                          ])
                    : undefined
            }
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
                    ? 'Belum ada penanda tangan. Pilih Tambah untuk mencetak pejabat yang mengetahui di bawah dokumen gudang.'
                    : 'Belum ada penanda tangan.'
            }
            columns={[
                {
                    id: 'title',
                    header: 'Jabatan',
                    content: 'control',
                    minWidth: 200,
                    cell: (line) => text(line, 'title', 'Jabatan', 150),
                },
                {
                    id: 'name',
                    header: 'Nama',
                    content: 'control',
                    minWidth: 200,
                    cell: (line) => text(line, 'name', 'Nama', 200),
                },
                {
                    id: 'id_number',
                    header: 'Nomor di bawah nama',
                    content: 'control',
                    minWidth: 180,
                    cell: (line) =>
                        text(line, 'id_number', 'Nomor di bawah nama', 60),
                },
                {
                    id: 'report_code',
                    header: 'Dicetak di',
                    content: 'control',
                    minWidth: 200,
                    cell: (line) =>
                        editable ? (
                            <FormControl
                                error={
                                    errors[fieldOf(line, 'report_code')]?.[0]
                                }
                            >
                                <Select
                                    label="Dicetak di"
                                    items={documents}
                                    value={line.report_code}
                                    onValueChange={(value) =>
                                        update(line.key, {
                                            report_code: value ?? allDocuments,
                                        })
                                    }
                                    searchPlaceholder="Cari dokumen"
                                    emptyMessage="Dokumen tidak ditemukan."
                                    portalContainer={portalContainer}
                                />
                            </FormControl>
                        ) : (
                            <DataTableText>
                                {documents.find(
                                    (entry) => entry.value === line.report_code,
                                )?.label ?? line.report_code}
                            </DataTableText>
                        ),
                },
            ]}
        />
    );
}
