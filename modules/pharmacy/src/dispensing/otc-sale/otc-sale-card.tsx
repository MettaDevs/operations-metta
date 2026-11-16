import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorText, type ApiBody } from '@core/platform/shell/index.ts';
import {
    ReturnCard,
    ReturnsSection,
    useCanReturn,
    type ReturnTarget,
} from '../dispensing-return/dispensing-returns.tsx';
import { FeeLines } from '../dispensing-fee/fee-lines.tsx';
import { dateTimeText, Fact } from '../prescription/prescription-display.tsx';

type Sale = ApiBody<'pharmacyOtcSaleShow'>['data'];

export const saleKey = (id: string) => ['pharmacy-otc-sale', id];

export function PaidBadge({ paid }: { paid: boolean }): ReactNode {
    return (
        <Badge variant={paid ? 'secondary' : 'outline'}>
            {paid ? 'Dibayar' : 'Belum dibayar'}
        </Badge>
    );
}

// Kartu penjualan obat bebas: kepala, baris obat dengan jumlah yang masih ditagih sesudah retur, dan returnya. Retur
// atas penjualan yang sudah dibayar ditolak server dengan pesan sistem lama sampai kasir membatalkan pembayarannya atau
// membuat nota kredit; sesudah retur, tagihan kasir hanya berisi obat yang tidak dikembalikan.
export function OtcSaleCard({
    saleId,
    onChanged,
}: {
    saleId: string;
    onChanged: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useQuery({
        queryKey: saleKey(saleId),
        queryFn: async () =>
            (await api.pharmacyOtcSaleShow({ params: { id: saleId } })).body
                .data,
        refetchOnWindowFocus: false,
    });
    const target: ReturnTarget = { kind: 'otc-sale', id: saleId };
    const canReturn = useCanReturn(target, true);
    const [returning, setReturning] = useState(false);
    const returnContent = useRef<HTMLDivElement>(null);
    const sale = stored.data;
    usePageDialogRecord({
        recordTitle: sale ? (
            <span className="inline-flex flex-wrap items-center gap-2">
                {`${sale.number} · ${sale.buyer_name ?? 'Pembeli umum'}`}
                <PaidBadge paid={sale.paid} />
            </span>
        ) : (
            'Memuat penjualan…'
        ),
        recordUrl: `/pharmacy/dispensing/otc-sales?sale=${saleId}`,
    });
    const changed = () => {
        void queryClient.invalidateQueries({ queryKey: saleKey(saleId) });
        onChanged();
    };

    if (!sale)
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
                        ? errorText(
                              stored.error,
                              'Penjualan belum dapat dimuat.',
                          )
                        : 'Memuat penjualan…'}
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

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {canReturn && (
                <PageDialogToolbar>
                    <Button
                        type="button"
                        variant="ghost"
                        title="Catat obat yang dikembalikan pembeli; stoknya masuk lagi ke lokasi penjualan."
                        onClick={() => setReturning(true)}
                    >
                        <RotateCcw aria-hidden="true" />
                        Retur
                    </Button>
                </PageDialogToolbar>
            )}
            <PageDialogBody className="py-3">
                <CollapsibleSectionGroup
                    defaultValue={['sale', 'lines', 'returns']}
                >
                    <CollapsibleSection
                        value="sale"
                        title="Penjualan"
                        summary={`${sale.location.name} · ${displayNumber(sale.total)}`}
                    >
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
                            <Fact label="No penjualan">{sale.number}</Fact>
                            <Fact label="Waktu">
                                {dateTimeText(sale.handed_over_at)}
                            </Fact>
                            <Fact label="Lokasi">{`${sale.location.code} · ${sale.location.name}`}</Fact>
                            <Fact label="Pembeli">
                                {sale.buyer_name ?? 'Pembeli umum'}
                            </Fact>
                            <Fact label="Kelompok harga">
                                {sale.price_group?.name ?? 'Harga dasar'}
                            </Fact>
                            <Fact label="Pembeli ber-KTP">
                                {sale.ktp_patient ? 'Ya' : 'Tidak'}
                            </Fact>
                            <Fact label="Tanpa resep">
                                {sale.without_prescription ? 'Ya' : 'Tidak'}
                            </Fact>
                            <Fact label="Total ditagih">
                                {displayNumber(sale.total)}
                            </Fact>
                            <Fact label="Pembayaran">
                                <PaidBadge paid={sale.paid} />
                            </Fact>
                        </dl>
                    </CollapsibleSection>
                    <CollapsibleSection value="lines" title="Obat">
                        <SaleLines lines={sale.lines} />
                        <div className="mt-3">
                            <FeeLines fees={sale.fees} />
                        </div>
                    </CollapsibleSection>
                    <CollapsibleSection value="returns" title="Retur">
                        <ReturnsSection target={target} onReversed={changed} />
                    </CollapsibleSection>
                </CollapsibleSectionGroup>
            </PageDialogBody>
            {returning && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setReturning(false);
                    }}
                >
                    <PageDialogContent ref={returnContent} title="Retur obat">
                        <ReturnCard
                            target={target}
                            onDone={(saved) => {
                                setReturning(false);
                                if (saved) changed();
                            }}
                            portalContainer={returnContent}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}

function SaleLines({ lines }: { lines: Sale['lines'] }): ReactNode {
    return (
        <DataTable
            data={lines}
            getRowKey={(line) => line.line_id}
            getRowLabel={(line) => line.item.name}
            scrollMode="inline"
            showRowNumbers
            emptyMessage="Penjualan ini tidak punya baris obat."
            columns={[
                {
                    id: 'item',
                    header: 'Obat',
                    minWidth: 240,
                    cell: (line) => (
                        <DataTableText>{`${line.item.code} · ${line.item.name}`}</DataTableText>
                    ),
                },
                {
                    id: 'quantity',
                    header: 'Terjual',
                    width: 110,
                    align: 'right',
                    cell: (line) => (
                        <DataTableText>{`${displayNumber(line.quantity)} ${line.unit_code}`}</DataTableText>
                    ),
                },
                {
                    id: 'net_quantity',
                    header: 'Ditagih',
                    width: 110,
                    align: 'right',
                    cell: (line) => (
                        <DataTableText>{`${displayNumber(line.net_quantity)} ${line.unit_code}`}</DataTableText>
                    ),
                },
                {
                    id: 'unit_price',
                    header: 'Harga satuan',
                    width: 120,
                    align: 'right',
                    cell: (line) => (
                        <DataTableText>
                            {displayNumber(line.unit_price)}
                        </DataTableText>
                    ),
                },
                {
                    id: 'discount_percent',
                    header: 'Diskon %',
                    width: 90,
                    align: 'right',
                    cell: (line) => (
                        <DataTableText>
                            {displayNumber(line.discount_percent)}
                        </DataTableText>
                    ),
                },
                {
                    id: 'amount',
                    header: 'Nilai',
                    width: 120,
                    align: 'right',
                    cell: (line) => (
                        <DataTableText>
                            {displayNumber(line.amount)}
                        </DataTableText>
                    ),
                },
            ]}
        />
    );
}
