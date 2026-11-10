import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorText, type ApiBody } from '../shell/index.ts';

export type DuplicateCandidate = ApiBody<'partyDuplicates'>['data'][number];

// Pola Contact Duplicates BC: kandidat hanya ditawarkan. Pengguna membuka kandidat untuk memeriksa, atau menandai
// pasangan itu bukan orang yang sama supaya tidak ditawarkan lagi.
function CandidateTable({
    candidates,
    canManage,
    busyId,
    onOpen,
    onSeparate,
}: {
    candidates: DuplicateCandidate[];
    canManage: boolean;
    busyId: string | null;
    onOpen: (id: string) => void;
    onSeparate: (candidate: DuplicateCandidate) => void;
}) {
    return (
        <DataTable
            scrollMode="inline"
            data={candidates}
            getRowKey={(candidate) => candidate.id}
            getRowLabel={(candidate) => candidate.name}
            actionsPlacement="inline"
            actions={[
                { id: 'open', label: 'Buka' },
                ...(canManage
                    ? [{ id: 'separate', label: 'Bukan ganda' }]
                    : []),
            ]}
            onRowAction={(action, candidate) =>
                action === 'open'
                    ? onOpen(candidate.id)
                    : busyId === null && onSeparate(candidate)
            }
            columns={[
                {
                    id: 'name',
                    header: 'Nama',
                    width: 220,
                    cell: (candidate) => (
                        <DataTableText>{candidate.name}</DataTableText>
                    ),
                },
                {
                    id: 'birth_date',
                    header: 'Tanggal lahir',
                    width: 130,
                    cell: (candidate) => (
                        <DataTableText>
                            {candidate.birth_date
                                ? displayDate(candidate.birth_date)
                                : '—'}
                        </DataTableText>
                    ),
                },
                {
                    id: 'matches',
                    header: 'Kecocokan',
                    width: 110,
                    cell: (candidate) => (
                        <DataTableText>{`${candidate.matches} bagian`}</DataTableText>
                    ),
                },
            ]}
        />
    );
}

function useSeparate(
    partyId: string,
    onDone: (candidate: DuplicateCandidate) => void,
) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const separate = async (candidate: DuplicateCandidate) => {
        setBusyId(candidate.id);
        setFailed(null);
        try {
            await api.partySeparate({
                params: { id: partyId },
                body: { party_id: candidate.id },
            });
            toast.success(
                `${candidate.name} tidak akan ditawarkan lagi sebagai data ganda.`,
            );
            onDone(candidate);
        } catch (caught) {
            setFailed(errorText(caught, 'Tanda bukan ganda belum disimpan.'));
        } finally {
            setBusyId(null);
        }
    };
    return { busyId, failed, separate };
}

/** Kandidat data ganda untuk orang yang tersimpan, dihitung ulang setiap kali bagian ini dibuka. */
export function PartyDuplicatesSection({
    partyId,
    canManage,
    onOpen,
}: {
    partyId: string;
    canManage: boolean;
    onOpen: (id: string) => void;
}): ReactNode {
    const candidates = useQuery({
        queryKey: ['party-duplicates', partyId],
        queryFn: async () =>
            (await api.partyDuplicates({ params: { id: partyId } })).body.data,
    });
    const { busyId, failed, separate } = useSeparate(
        partyId,
        () => void candidates.refetch(),
    );

    if (candidates.isPending)
        return (
            <p role="status" className="text-sm text-muted-foreground">
                Memeriksa data ganda…
            </p>
        );
    if (candidates.isError)
        return (
            <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-destructive">
                    {errorText(
                        candidates.error,
                        'Kandidat data ganda belum dapat dimuat.',
                    )}
                </p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void candidates.refetch()}
                >
                    Coba lagi
                </Button>
            </div>
        );
    return (
        <div className="space-y-3">
            {failed && (
                <p role="alert" className="text-sm text-destructive">
                    {failed}
                </p>
            )}
            {candidates.data.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Tidak ada orang lain dengan nama, tanggal lahir, dan telepon
                    yang mirip.
                </p>
            ) : (
                <CandidateTable
                    candidates={candidates.data}
                    canManage={canManage}
                    busyId={busyId}
                    onOpen={onOpen}
                    onSeparate={(candidate) => void separate(candidate)}
                />
            )}
        </div>
    );
}

/** Kandidat yang ditemukan saat party baru disimpan. Party sudah tersimpan; dialog ini hanya menawarkan pemeriksaan. */
export function PartyDuplicatesDialog({
    partyId,
    partyName,
    candidates: initial,
    canManage,
    onOpen,
    onClose,
}: {
    partyId: string;
    partyName: string;
    candidates: DuplicateCandidate[];
    canManage: boolean;
    onOpen: (id: string) => void;
    onClose: () => void;
}): ReactNode {
    const [candidates, setCandidates] = useState(initial);
    const { busyId, failed, separate } = useSeparate(partyId, (done) => {
        const remaining = candidates.filter(
            (candidate) => candidate.id !== done.id,
        );
        setCandidates(remaining);
        if (!remaining.length) onClose();
    });

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && busyId === null) onClose();
            }}
        >
            <DialogContent size="wide">
                <DialogHeader>
                    <DialogTitle>Mungkin data ganda</DialogTitle>
                    <DialogDescription>
                        {partyName} sudah disimpan. Orang berikut punya nama,
                        tanggal lahir, atau telepon yang mirip. Buka untuk
                        memeriksa, atau pilih Bukan ganda bila memang orang yang
                        berbeda.
                    </DialogDescription>
                </DialogHeader>
                <DialogBody className="space-y-3">
                    {failed && (
                        <p role="alert" className="text-sm text-destructive">
                            {failed}
                        </p>
                    )}
                    <CandidateTable
                        candidates={candidates}
                        canManage={canManage}
                        busyId={busyId}
                        onOpen={(id) => {
                            onClose();
                            onOpen(id);
                        }}
                        onSeparate={(candidate) => void separate(candidate)}
                    />
                </DialogBody>
                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busyId !== null}
                        onClick={onClose}
                    >
                        Tutup
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
