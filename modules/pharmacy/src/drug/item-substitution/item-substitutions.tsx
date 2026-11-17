import { Button } from '@operations-metta/ui/button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    type ApiBody,
} from '@core/platform/shell/index.ts';

type Listing = ApiBody<'pharmacyItemSubstitutionList'>;

// Obat yang boleh menggantikan obat ini saat resep disiapkan (Item Substitutions BC dari kartu barang). Setiap
// perubahan langsung tersimpan, terpisah dari tombol Simpan data obat.
export function ItemSubstitutions({
    itemId,
    canManage,
    portalContainer,
}: {
    itemId: string;
    canManage: boolean;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const queryClient = useQueryClient();
    const key = ['pharmacy-item-substitutions', itemId];
    const listing = useQuery({
        queryKey: key,
        queryFn: async () =>
            (
                await api.pharmacyItemSubstitutionList({
                    params: { id: itemId },
                })
            ).body,
    });
    const switchId = useId();
    const [substitute, setSubstitute] = useState<Reference | null>(null);
    const [notes, setNotes] = useState('');
    const [interchangeable, setInterchangeable] = useState(true);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const { confirm, confirmation } = useConfirmation();
    const loadDrugs = async ({ query, cursor, signal }: LookupRequest) => {
        const { body } = await api.pharmacyDrugList(
            { query: { q: query, ...(cursor ? { cursor } : {}) } },
            { signal },
        );
        return {
            items: body.data.filter((drug) => drug.id !== itemId),
            nextCursor: body.next_cursor,
        };
    };
    const done = (next: Listing) => queryClient.setQueryData(key, next);

    const add = async () => {
        if (!substitute) {
            setErrors({ substitute_item_id: ['Pilih obat pengganti.'] });
            return;
        }
        setBusy(true);
        setErrors({});
        try {
            const { body } = await api.pharmacyItemSubstitutionCreate({
                params: { id: itemId },
                body: {
                    substitute_item_id: substitute.id,
                    notes: notes.trim() || null,
                    interchangeable,
                },
            });
            done(body);
            toast.success(`${substitute.name} ditambahkan sebagai pengganti.`);
            setSubstitute(null);
            setNotes('');
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                toast.error(
                    errorText(caught, 'Obat pengganti belum ditambahkan.'),
                );
        } finally {
            setBusy(false);
        }
    };

    const remove = async (row: Listing['data'][number]) => {
        if (
            !(await confirm({
                title: `Delete ${row.substitute.name} dari obat pengganti?`,
                description:
                    'Resep yang disiapkan sesudah ini tidak bisa diganti dengan obat ini. Penyerahan yang sudah memakainya tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            const { body } = await api.pharmacyItemSubstitutionDelete({
                params: { id: itemId, substitutionId: row.id },
                body: { version: row.version },
            });
            done(body);
        } catch (caught) {
            toast.error(errorText(caught, 'Obat pengganti belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    const rows = listing.data?.data ?? [];
    return (
        <section aria-label="Obat pengganti" className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold">Obat pengganti</h3>
            <p className="text-sm text-muted-foreground">
                Saat resep disiapkan, apoteker boleh menyerahkan salah satu obat
                ini sebagai ganti obat ini, misalnya generik dengan zat aktif
                dan kekuatan yang sama. Satu satuan dasar obat pengganti
                menggantikan satu satuan dasar obat ini.
            </p>
            {listing.isError ? (
                <p role="alert" className="text-sm text-destructive">
                    {errorText(
                        listing.error,
                        'Obat pengganti belum dapat dimuat.',
                    )}
                </p>
            ) : rows.length ? (
                <ul className="divide-y rounded-md border">
                    {rows.map((row) => (
                        <li
                            key={row.id}
                            className="flex items-center gap-3 px-3 py-2 text-sm"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block">
                                    {`${row.substitute.code} · ${row.substitute.name}`}
                                    {row.is_blocked ? ' (diblokir)' : ''}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {[
                                        `Satuan dasar ${row.base_unit_name}`,
                                        row.notes,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </span>
                            {canManage && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete ${row.substitute.name}`}
                                    disabled={busy}
                                    onClick={() => void remove(row)}
                                >
                                    <Trash2 />
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {listing.isPending
                        ? 'Memuat obat pengganti…'
                        : 'Belum ada obat pengganti.'}
                </p>
            )}
            {canManage && (
                <FormGrid>
                    <MasterLookup<Reference>
                        label="Obat pengganti"
                        field="substitute_item_id"
                        value={substitute}
                        onChange={(drug) =>
                            setSubstitute({
                                id: drug.id,
                                code: drug.code,
                                name: drug.name,
                            })
                        }
                        disabled={busy}
                        error={errors.substitute_item_id?.[0]}
                        portalContainer={portalContainer}
                        noun="Obat"
                        load={loadDrugs}
                        columns={[codeColumn(160), nameColumn(260)]}
                    />
                    <FormControl error={errors.notes?.[0]}>
                        <Input
                            label="Keterangan"
                            maxLength={100}
                            value={notes}
                            disabled={busy}
                            onChange={(event) => setNotes(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void add();
                                }
                            }}
                        />
                    </FormControl>
                    <FormControl hint="Obat pengganti itu juga boleh diganti dengan obat ini.">
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={switchId}
                                checked={interchangeable}
                                disabled={busy}
                                onCheckedChange={setInterchangeable}
                            />
                            <FieldLabel
                                htmlFor={switchId}
                                className="font-normal"
                            >
                                Berlaku dua arah
                            </FieldLabel>
                        </Field>
                    </FormControl>
                    <div className="flex items-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void add()}
                        >
                            Tambah obat pengganti
                        </Button>
                    </div>
                </FormGrid>
            )}
            {confirmation}
        </section>
    );
}
