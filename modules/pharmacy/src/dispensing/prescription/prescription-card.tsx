import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import {
    PageDialogBody,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, errorText, type ApiBody } from '@core/platform/shell/index.ts';
import { birthText, dateTimeText, Fact } from './prescription-display.tsx';

type Prescription = ApiBody<'pharmacyPrescriptionShow'>['data'];
type Line = Prescription['lines'][number];

const isCompoundHeader = (line: Line) =>
    line.item === null && line.compound !== null;

// Resep di antrean farmasi, apa adanya seperti dikirim dokter: kepala racikan sebagai pengelompok, komponennya di
// bawahnya.
export function PrescriptionCard({
    prescriptionId,
}: {
    prescriptionId: string;
}): ReactNode {
    const stored = useQuery({
        queryKey: ['pharmacy-prescription', prescriptionId],
        queryFn: async () =>
            (
                await api.pharmacyPrescriptionShow({
                    params: { id: prescriptionId },
                })
            ).body.data,
        refetchOnWindowFocus: false,
    });
    const prescription = stored.data ?? null;
    usePageDialogRecord({
        recordTitle: prescription
            ? `${prescription.prescription_number} · ${prescription.patient_name}`
            : 'Resep',
        editing: false,
        recordUrl: `/pharmacy/dispensing/prescriptions?prescription=${prescriptionId}`,
    });
    if (!prescription)
        return (
            <div className="space-y-3 p-6">
                <p
                    role={stored.isError ? 'alert' : 'status'}
                    className={
                        stored.isError
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                    }
                >
                    {stored.isError
                        ? errorText(stored.error, 'Resep belum dapat dimuat.')
                        : 'Memuat resep…'}
                </p>
                {stored.isError && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void stored.refetch()}
                    >
                        Coba lagi
                    </Button>
                )}
            </div>
        );
    const text = (value: string | null) => (
        <DataTableText>{value ?? ''}</DataTableText>
    );
    return (
        <PageDialogBody className="py-3">
            <CollapsibleSectionGroup defaultValue={['prescription', 'lines']}>
                <CollapsibleSection
                    value="prescription"
                    title="Resep"
                    summary={`${prescription.patient_name} · ${prescription.medical_record_number}`}
                >
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                        <Fact label="No resep">
                            {prescription.prescription_number}
                        </Fact>
                        <Fact label="No registrasi">
                            {prescription.registration_number}
                        </Fact>
                        <Fact label="Diterbitkan">
                            {dateTimeText(prescription.issued_at)}
                        </Fact>
                        <Fact label="Lokasi farmasi">
                            {prescription.location
                                ? `${prescription.location.code} · ${prescription.location.name}`
                                : 'Belum ada lokasi'}
                        </Fact>
                        <Fact label="Pasien">{prescription.patient_name}</Fact>
                        <Fact label="NRM">
                            {prescription.medical_record_number}
                        </Fact>
                        <Fact label="Tanggal lahir">
                            {birthText(prescription.birth_date)}
                        </Fact>
                        <Fact label="Dokter">{prescription.doctor_name}</Fact>
                        <Fact label="Section asal">
                            {prescription.section_name}
                        </Fact>
                        <Fact label="Operating unit">
                            {prescription.operating_unit_name}
                        </Fact>
                        {prescription.notes && (
                            <Fact label="Catatan dokter">
                                {prescription.notes}
                            </Fact>
                        )}
                    </dl>
                </CollapsibleSection>
                <CollapsibleSection
                    value="lines"
                    title="Obat"
                    summary={`${prescription.item_count} obat`}
                >
                    <DocumentLines
                        title="Obat diresepkan"
                        data={prescription.lines}
                        getRowKey={(line) => line.id}
                        getRowLabel={(line) =>
                            line.item?.name ?? `Racikan ${line.compound ?? ''}`
                        }
                        showRowNumbers
                        readOnly
                        emptyMessage="Resep ini tidak berisi obat."
                        columns={[
                            {
                                id: 'item',
                                header: 'Obat',
                                minWidth: 280,
                                cell: (line) =>
                                    isCompoundHeader(line) ? (
                                        <DataTableText>
                                            <span className="font-medium">
                                                Racikan {line.compound}
                                            </span>
                                        </DataTableText>
                                    ) : (
                                        <DataTableText>
                                            <span
                                                className={
                                                    line.compound !== null
                                                        ? 'ps-4'
                                                        : undefined
                                                }
                                            >
                                                {`${line.item?.code ?? ''} · ${line.item?.name ?? ''}`}
                                            </span>
                                        </DataTableText>
                                    ),
                            },
                            {
                                id: 'quantity',
                                header: 'Jumlah',
                                width: 110,
                                align: 'right',
                                cell: (line) =>
                                    text(
                                        isCompoundHeader(line)
                                            ? line.requested_quantity === null
                                                ? null
                                                : `${displayNumber(line.requested_quantity)} racikan`
                                            : line.quantity === null
                                              ? null
                                              : displayNumber(line.quantity),
                                    ),
                            },
                            {
                                id: 'unit',
                                header: 'Satuan',
                                width: 100,
                                cell: (line) => text(line.unit?.code ?? null),
                            },
                            {
                                id: 'signa',
                                header: 'Signa',
                                width: 110,
                                cell: (line) => text(line.signa),
                            },
                            {
                                id: 'usage_instruction',
                                header: 'Aturan pakai',
                                width: 150,
                                cell: (line) => text(line.usage_instruction),
                            },
                            {
                                id: 'notes',
                                header: 'Keterangan',
                                width: 200,
                                cell: (line) => text(line.notes),
                            },
                        ]}
                    />
                </CollapsibleSection>
            </CollapsibleSectionGroup>
        </PageDialogBody>
    );
}
