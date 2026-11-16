import { ActionButton } from '@operations-metta/ui/action-button';
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
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import {
    keepPreviousData,
    useQuery,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    useUnsavedChangesGuard,
} from '@core/platform/shell/index.ts';
import { newLine, OtcSaleLines, type SaleLine } from './otc-sale-lines.tsx';
import {
    emptyTender,
    OtcSaleTender,
    PartyLookup,
    tenderChange,
    tenderPayload,
    typed,
    type Options,
    type Tender,
} from './otc-sale-tender.tsx';

// Loket penjualan obat bebas, satu langkah: pilih obat, lihat total, terima bayar, serahkan. Harga dan total hanya
// datang dari quote server, yang diminta ulang sebentar sesudah isian berhenti berubah. Simpan dan bayar mengirim total
// quote itu sebagai expected_total; server menolak bila harga berubah sejak itu. Sesudah berhasil, layar kosong untuk
// pembeli berikutnya dengan lokasi dan kelompok harga yang sama. Lokasi terakhir diingat per pengguna di peramban.

type Header = {
    locationId: string;
    // Kelompok harga penjualan ini; null berarti harga dasar.
    priceGroup: Reference | null;
    buyer: Reference | null;
    buyerName: string;
    ktp: boolean;
};

const quoteDelay = 300;
const locationKey = (userId: string) => `pharmacy-otc-sale-location:${userId}`;

function readLocation(userId: string): string | null {
    try {
        return localStorage.getItem(locationKey(userId));
    } catch {
        // Penyimpanan peramban diblokir: lokasi pertama dipakai.
        return null;
    }
}

function rememberLocation(userId: string, locationId: string): void {
    try {
        localStorage.setItem(locationKey(userId), locationId);
    } catch {
        // Penyimpanan peramban diblokir: lokasi tidak diingat.
    }
}

// Pesan server untuk `lines.N.*` memakai urutan baris yang dikirim; layar memakai urutan semua baris.
function linesToRows(
    errors: Record<string, string[]>,
    rowOf: number[],
): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(errors).map(([key, list]) => {
            const match = /^lines\.(\d+)\.(.+)$/.exec(key);
            const row = match ? rowOf[Number(match[1])] : undefined;
            return [
                match && row !== undefined ? `lines.${row}.${match[2]}` : key,
                list,
            ];
        }),
    );
}

const loadPriceGroups = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyPriceGroupLookup(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

function useDebounced<T>(value: T, delay: number): T {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return settled;
}

function OtcSalePage(): ReactNode {
    const { data: userId } = useSuspenseQuery(
        orpc.shell.queryOptions({
            select: (response) => response.body.auth.user.id,
        }),
    );
    const { data: options } = useSuspenseQuery(
        orpc.pharmacyOtcSaleOptions.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    return options.locations.length ? (
        <OtcSaleCounter options={options} userId={userId} />
    ) : (
        <div className="flex h-full min-h-0 flex-col">
            <RecordActionBar title="Penjualan obat bebas" />
            <p className="p-4 text-sm text-muted-foreground">
                Belum ada lokasi yang boleh menjual obat bebas. Atur lokasinya
                di Setup › Lokasi penjualan obat bebas.
            </p>
        </div>
    );
}

function OtcSaleCounter({
    options,
    userId,
}: {
    options: Options;
    userId: string;
}): ReactNode {
    const ktpId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    const headerFor = (locationId: string): Header => ({
        locationId,
        priceGroup:
            options.locations.find((location) => location.id === locationId)
                ?.price_group ?? null,
        buyer: null,
        buyerName: '',
        ktp: true,
    });
    const [header, setHeader] = useState<Header>(() => {
        const stored = readLocation(userId);
        return headerFor(
            options.locations.find((location) => location.id === stored)?.id ??
                options.locations[0]?.id ??
                '',
        );
    });
    const [lines, setLines] = useState<SaleLine[]>(() => [newLine()]);
    const [tender, setTender] = useState<Tender>(emptyTender);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const quoted = lines.flatMap((line, row) =>
        line.drug && line.unitId && line.quantity.trim() ? [{ row, line }] : [],
    );
    const quoteBody = quoted.length
        ? {
              location_id: header.locationId,
              price_group_id: header.priceGroup?.id ?? null,
              ktp_patient: header.ktp,
              lines: quoted.map(({ line }) => ({
                  item_id: line.drug?.id ?? '',
                  unit_id: line.unitId,
                  quantity: typed(line.quantity),
              })),
          }
        : null;
    const quoteKey = JSON.stringify(quoteBody);
    const settledKey = useDebounced(quoteKey, quoteDelay);
    const quote = useQuery({
        queryKey: ['pharmacy-otc-sale-quote', settledKey],
        enabled: quoteBody !== null && settledKey === quoteKey,
        placeholderData: keepPreviousData,
        retry: false,
        queryFn: async ({ signal }) => {
            const body = quoteBody;
            if (body === null) return null;
            const { body: response } = await api.pharmacyOtcSaleQuote(
                { body },
                { signal },
            );
            return {
                key: quoteKey,
                rowKeys: quoted.map(({ line }) => line.key),
                ...response.data,
            };
        },
    });
    const current =
        quote.data?.key === quoteKey && !quote.isFetching ? quote.data : null;
    // Quote sebelumnya tetap tampil redup selama quote isian terbaru belum kembali.
    const shown = quoteBody ? quote.data : null;
    const priced = new Map(
        shown
            ? shown.rowKeys.flatMap((key, index) => {
                  const price = shown.lines[index];
                  return price ? [[key, price] as const] : [];
              })
            : [],
    );
    const quoteErrors =
        quote.error instanceof ApiError && quote.error.status === 422
            ? linesToRows(
                  quote.error.errors,
                  quoted.map(({ row }) => row),
              )
            : {};
    const shownErrors = { ...quoteErrors, ...errors };
    const quoteFailure =
        quote.error &&
        !(quote.error instanceof ApiError && quote.error.status === 422)
            ? errorText(
                  quote.error,
                  'Total belum bisa dihitung. Silakan coba lagi.',
              )
            : null;
    const total = shown?.total ?? null;

    const reset = () => {
        setHeader((now) => ({
            ...headerFor(now.locationId),
            priceGroup: now.priceGroup,
        }));
        setLines([newLine()]);
        setTender(emptyTender);
        setErrors({});
        setMessage(null);
    };
    const dirty = lines.some((line) => line.drug !== null);
    const guard = useUnsavedChangesGuard(dirty, reset);

    const save = async () => {
        if (!current || busy) return;
        const sent = lines.flatMap((line, row) =>
            line.drug ? [{ row, line }] : [],
        );
        const change = tenderChange(options, current.total, tender);
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.pharmacyOtcSaleCreate({
                body: {
                    location_id: header.locationId,
                    price_group_id: header.priceGroup?.id ?? null,
                    ktp_patient: header.ktp,
                    buyer_party_id: header.buyer?.id ?? null,
                    buyer_name: header.buyerName.trim() || null,
                    lines: sent.map(({ line }) => ({
                        item_id: line.drug?.id ?? '',
                        unit_id: line.unitId,
                        quantity: typed(line.quantity),
                        batch_id: line.batch?.id ?? null,
                    })),
                    expected_total: current.total,
                    payment: tenderPayload(options, tender),
                },
            });
            toast.success(
                `Penjualan ${body.data.number} tersimpan dengan pembayaran ${body.data.payment.number}. Kembalian ${change}.`,
            );
            reset();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(
                    linesToRows(
                        caught.errors,
                        sent.map(({ row }) => row),
                    ),
                );
            else {
                if (
                    caught instanceof ApiError &&
                    caught.errorCode === 'stale_total'
                )
                    void quote.refetch();
                setMessage(
                    errorText(
                        caught,
                        'Penjualan belum disimpan. Silakan coba lagi.',
                    ),
                );
            }
        } finally {
            setBusy(false);
        }
    };

    const chooseLocation = (locationId: string) => {
        rememberLocation(userId, locationId);
        setHeader((now) => ({
            ...headerFor(locationId),
            buyer: now.buyer,
            buyerName: now.buyerName,
            ktp: now.ktp,
        }));
        setLines((now) => now.map((line) => ({ ...line, batch: null })));
    };

    return (
        <form
            ref={portalContainer}
            noValidate
            className="flex h-full min-h-0 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <RecordActionBar title="Penjualan obat bebas">
                <Button
                    type="submit"
                    variant="ghost"
                    disabled={!current || busy || !options.can_pay}
                >
                    <Banknote aria-hidden="true" />
                    {busy ? 'Menyimpan…' : 'Simpan dan bayar'}
                </Button>
                <ActionButton
                    action="cancel"
                    type="button"
                    disabled={busy || !dirty}
                    onClick={reset}
                />
            </RecordActionBar>
            <div className="scroll-region min-h-0 flex-1 overflow-y-auto">
                <FormErrorHeader
                    errors={errors}
                    message={message ?? quoteFailure}
                    operation="Penjualan belum disimpan"
                />
                <div className="space-y-6 p-4">
                    {!options.can_pay && (
                        <p className="text-sm text-destructive">
                            Anda belum boleh menerima pembayaran di kasir, jadi
                            penjualan ini belum bisa disimpan. Minta izin terima
                            pembayaran kasir ke admin.
                        </p>
                    )}
                    <FormGrid>
                        <FormControl
                            error={shownErrors.location_id?.[0]}
                            data-error-field="location_id"
                        >
                            <Select
                                label="Lokasi"
                                required
                                items={options.locations.map((location) => ({
                                    value: location.id,
                                    label: `${location.code} · ${location.name}`,
                                }))}
                                value={header.locationId}
                                onValueChange={(value) => {
                                    if (value) chooseLocation(value);
                                }}
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <MasterLookup<Reference>
                            label="Kelompok harga"
                            field="price_group_id"
                            value={header.priceGroup}
                            onChange={(priceGroup) =>
                                setHeader((now) => ({ ...now, priceGroup }))
                            }
                            error={shownErrors.price_group_id?.[0]}
                            hint="Bawaan lokasi. Ganti bila pembeli ini mendapat harga kelompok lain. Kosong berarti harga dasar."
                            portalContainer={portalContainer}
                            noun="Kelompok harga"
                            load={loadPriceGroups}
                            columns={[codeColumn(), nameColumn(220)]}
                        />
                        {options.can_search_buyers && (
                            <PartyLookup
                                label="Pembeli dari buku alamat"
                                field="buyer_party_id"
                                value={header.buyer}
                                onChange={(buyer) =>
                                    setHeader((now) => ({ ...now, buyer }))
                                }
                                error={shownErrors.buyer_party_id?.[0]}
                                hint="Isi bila pembeli sudah tercatat, misalnya untuk dibayar sebagai piutang."
                                portalContainer={portalContainer}
                            />
                        )}
                        <FormControl
                            error={shownErrors.buyer_name?.[0]}
                            hint="Kosongkan untuk pembeli umum."
                        >
                            <Input
                                label="Nama pembeli"
                                maxLength={255}
                                data-error-field="buyer_name"
                                value={header.buyerName}
                                onChange={(event) =>
                                    setHeader((now) => ({
                                        ...now,
                                        buyerName: event.target.value,
                                    }))
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={shownErrors.ktp_patient?.[0]}
                            hint="Harga obat mengikuti grading untuk pembeli ber-KTP. Matikan untuk pembeli tanpa KTP."
                        >
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id={ktpId}
                                    checked={header.ktp}
                                    onCheckedChange={(ktp) =>
                                        setHeader((now) => ({ ...now, ktp }))
                                    }
                                />
                                <FieldLabel
                                    htmlFor={ktpId}
                                    className="font-normal"
                                >
                                    Pembeli ber-KTP
                                </FieldLabel>
                            </Field>
                        </FormControl>
                    </FormGrid>
                    <OtcSaleLines
                        lines={lines}
                        onChange={setLines}
                        locationId={header.locationId}
                        priced={priced}
                        pricesCurrent={current !== null}
                        total={total}
                        errors={shownErrors}
                        portalContainer={portalContainer}
                    />
                    <section className="space-y-3">
                        <h3 className="text-sm font-semibold">Pembayaran</h3>
                        <OtcSaleTender
                            options={options}
                            total={total}
                            tender={tender}
                            onChange={setTender}
                            errors={errors}
                            portalContainer={portalContainer}
                        />
                    </section>
                </div>
            </div>
            {guard}
        </form>
    );
}

export const page = definePage({
    path: '/pharmacy/dispensing/otc-sale',
    layout: 'app',
    title: 'Penjualan obat bebas',
    component: OtcSalePage,
});
