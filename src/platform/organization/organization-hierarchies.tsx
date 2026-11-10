import '@xyflow/react/dist/style.css';

import { ActionButton } from '@operations-metta/ui/action-button';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@operations-metta/ui/alert-dialog';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker } from '@operations-metta/ui/date-picker';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { Field, FieldLegend, FieldSet } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MasterDetailLayout } from '@operations-metta/ui/master-detail-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    PageDialogTrigger,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import {
    ToggleGroup,
    ToggleGroupItem,
} from '@operations-metta/ui/toggle-group';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import {
    Background,
    Controls,
    Handle,
    MiniMap,
    Position,
    ReactFlow,
} from '@xyflow/react';
import type {
    Edge,
    Node as FlowNode,
    NodeProps,
    NodeTypes,
} from '@xyflow/react';
import { Check, Network, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    useAppearance,
    type ApiBody,
} from '../shell/index.ts';
import type { Organization } from './organization-directory.tsx';
import { OrganizationLookup } from './organization-lookup.tsx';

// Layar hierarki organisasi, dipindah dari organization-hierarchies CoreERP. Penanda kode unit yang menahan posting
// finance tidak ditampilkan, karena posting finance belum dipindah.

type HierarchyPageBody = ApiBody<'hierarchyPage'>;
export type HierarchyProps = Extract<HierarchyPageBody, { purposes: unknown }>;
type Saved = ApiBody<'hierarchyCreate'>;
type Hierarchy = Saved['savedHierarchy'];
type Version = Hierarchy['versions'][number];
type HierarchyNode = Version['nodes'][number];
type HierarchyRow = Exclude<
    Exclude<HierarchyPageBody, HierarchyProps>['data'][number],
    Organization | Hierarchy
>;
type Errors = Record<string, string[]>;

function isHierarchy(
    row: HierarchyRow | Organization | Hierarchy,
): row is Hierarchy {
    return 'versions' in row;
}

export function hierarchyProps(body: HierarchyPageBody): HierarchyProps {
    if (!('purposes' in body))
        throw new Error('Jawaban layar hierarki tidak berisi props halaman.');
    return body;
}

// Jawaban GET layar hierarki bergantung pada query-nya; tanpa `resource` dan `record_id`, isinya batch hierarki.
async function hierarchyBatch(
    query: { q?: string; cursor?: string; record_id?: string },
    signal?: AbortSignal,
) {
    const { body } = await api.hierarchyPage(
        { query: { incremental: '1', ...query } },
        { signal },
    );
    if (!('next_cursor' in body))
        throw new Error('Jawaban daftar hierarki tidak berisi batch.');
    return body;
}

// Penyimpanan hierarki: setiap aksi dijawab hierarki tersimpan beserta pesannya, sama dengan CoreERP yang kembali ke
// halaman dengan props savedHierarchy dan flash.status.
function useHierarchySave(onSaved: (saved: Saved) => void, fallback: string) {
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const clear = () => {
        setErrors({});
        setMessage(null);
    };
    const run = async (request: () => Promise<{ body: Saved }>) => {
        setProcessing(true);
        clear();
        try {
            const { body } = await request();
            toast.success(body.flash.status);
            onSaved(body);
            return true;
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, fallback));
            return false;
        } finally {
            setProcessing(false);
        }
    };
    return { processing, errors, message, run, clear };
}

function CreateHierarchyDialog({
    purposes,
    onSaved,
}: {
    purposes: HierarchyProps['purposes'];
    onSaved: (saved: Saved) => void;
}) {
    const emptyCodes: string[] = [];
    const blank = {
        name: '',
        purpose_codes: emptyCodes,
        root_organization_id: '',
        // Tanpa nilai awal: CoreERP mengisinya dengan hari ini menurut jam server, dan data itu belum dikirim
        // `/api/v1/shell`. Layar tidak menghitung hari ini dari jam perangkat.
        effective_from: '',
    };
    const [open, setOpen] = useState(false);
    const [data, setData] = useState(blank);
    const contentRef = useRef<HTMLDivElement>(null);
    const save = useHierarchySave(onSaved, 'Hierarki belum dibuat.');

    return (
        <PageDialog
            open={open}
            onOpenChange={(next) => {
                if (save.processing) return;
                if (!next) {
                    setData(blank);
                    save.clear();
                }
                setOpen(next);
            }}
        >
            <PageDialogTrigger asChild>
                <ActionButton action="create" />
            </PageDialogTrigger>
            <PageDialogContent
                ref={contentRef}
                title="Hierarki organisasi"
                recordTitle={data.name.trim() || 'Hierarki baru'}
                editing
                busy={save.processing}
                description="Susun organisasi berdasarkan tujuan dan tanggal berlakunya."
            >
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void save
                            .run(() => api.hierarchyCreate({ body: data }))
                            .then((saved) => {
                                if (!saved) return;
                                setData(blank);
                                setOpen(false);
                            });
                    }}
                >
                    <PageDialogToolbar>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={save.processing}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={save.processing}
                            onClick={() => {
                                setData(blank);
                                save.clear();
                                setOpen(false);
                            }}
                        />
                    </PageDialogToolbar>
                    <FormErrorHeader
                        errors={save.errors}
                        message={save.message}
                        operation="Hierarki belum dibuat"
                    />
                    <PageDialogBody className="space-y-4">
                        <FormGrid columns={1}>
                            <FormControl data-error-field="name">
                                <Input
                                    label="Nama hierarki"
                                    required
                                    value={data.name}
                                    onChange={(event) =>
                                        setData({
                                            ...data,
                                            name: event.target.value,
                                        })
                                    }
                                    placeholder="Contoh: Bagan Organisasi Holding Utama"
                                />
                            </FormControl>
                            <FieldSet data-error-field="purpose_codes">
                                <FieldLegend hint="Pilih proses bisnis yang akan membaca susunan ini.">
                                    Tujuan hierarki
                                </FieldLegend>
                                <ToggleGroup
                                    type="multiple"
                                    variant="outline"
                                    className="grid grid-cols-2 gap-2"
                                    value={data.purpose_codes}
                                    onValueChange={(values) =>
                                        setData({
                                            ...data,
                                            purpose_codes: values,
                                        })
                                    }
                                >
                                    {purposes.map((purpose) => (
                                        <ToggleGroupItem
                                            key={purpose.code}
                                            value={purpose.code}
                                            className="border-border/80 font-medium"
                                        >
                                            {purpose.name}
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>
                            </FieldSet>
                        </FormGrid>
                        <FormGrid>
                            <FormControl data-error-field="root_organization_id">
                                <OrganizationLookup
                                    label="Organisasi paling atas"
                                    value={data.root_organization_id}
                                    onChange={(value) =>
                                        setData({
                                            ...data,
                                            root_organization_id: value,
                                        })
                                    }
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                            <FormControl data-error-field="effective_from">
                                <DatePicker
                                    label="Berlaku mulai"
                                    required
                                    value={data.effective_from}
                                    onValueChange={(value) =>
                                        setData({
                                            ...data,
                                            effective_from: value,
                                        })
                                    }
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                        </FormGrid>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

function DraftActions({
    version,
    rowVersion,
    onSaved,
}: {
    version: Version;
    rowVersion: number;
    onSaved: (saved: Saved) => void;
}) {
    const [organizationId, setOrganizationId] = useState('');
    const [parentId, setParentId] = useState(
        version.nodes[0]?.organization.id ?? '',
    );
    // Lookup dipasang ulang setelah penempatan, supaya organisasi yang baru ditempatkan tidak ditawarkan lagi.
    const [lookupRevision, setLookupRevision] = useState(0);
    const place = useHierarchySave(onSaved, 'Organisasi belum ditempatkan.');
    const publish = useHierarchySave(onSaved, 'Hierarki belum dipublikasikan.');
    const processing = place.processing || publish.processing;

    return (
        <form
            noValidate
            className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-2xs"
            onSubmit={(event) => {
                event.preventDefault();
                void place
                    .run(() =>
                        api.hierarchyPlace({
                            params: { version: version.id },
                            body: {
                                organization_id: organizationId,
                                parent_organization_id: parentId,
                                version: rowVersion,
                            },
                        }),
                    )
                    .then((saved) => {
                        if (!saved) return;
                        setOrganizationId('');
                        setLookupRevision((revision) => revision + 1);
                    });
            }}
        >
            <FormErrorHeader
                errors={{ ...place.errors, ...publish.errors }}
                message={place.message ?? publish.message}
                operation="Hierarki belum berubah"
            />
            <div className="grid gap-3 md:grid-cols-2">
                <Field data-error-field="organization_id">
                    <OrganizationLookup
                        key={lookupRevision}
                        label="Organisasi yang ditambahkan"
                        value={organizationId}
                        onChange={setOrganizationId}
                        excludeVersionId={version.id}
                    />
                </Field>
                <Field data-error-field="parent_organization_id">
                    <Select
                        label="Berada di bawah"
                        required
                        value={parentId}
                        onValueChange={(value) => value && setParentId(value)}
                        items={version.nodes.map((node) => ({
                            value: node.organization.id,
                            label: node.organization.name,
                        }))}
                    />
                </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-2">
                <p className="text-muted-foreground">
                    Hubungan ini berlaku pada draft hierarki ini untuk menyusun
                    struktur pohon.
                </p>
                <div className="flex gap-2">
                    <ActionButton
                        action="add"
                        type="submit"
                        disabled={!organizationId || processing}
                    />
                    <Button
                        type="button"
                        size="sm"
                        className="font-medium shadow-xs"
                        disabled={processing}
                        onClick={() =>
                            void publish.run(() =>
                                api.hierarchyPublish({
                                    params: { version: version.id },
                                    body: { version: rowVersion },
                                }),
                            )
                        }
                    >
                        <Check className="mr-1.5 size-3.5" /> Publikasikan
                    </Button>
                </div>
            </div>
        </form>
    );
}

type FlowData = {
    label: string;
    classification: string;
    operatingUnitType: string | null;
    operatingUnitNumber: string | null;
};
type OrganizationFlowNode = FlowNode<FlowData, 'organization'>;

function OrganizationHierarchyFlowNode({
    data,
}: NodeProps<OrganizationFlowNode>) {
    return (
        <div className="min-w-56 rounded-xl border border-border bg-card px-4 py-3 text-foreground shadow-xs">
            <Handle
                type="target"
                position={Position.Top}
                className="!size-3 !border-2 !border-background !bg-muted-foreground"
            />
            <div className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded bg-primary/10 font-bold text-primary">
                    {data.classification === 'legal_entity' ? 'LE' : 'OU'}
                </span>
                <p className="truncate font-bold text-foreground">
                    {data.label}
                </p>
            </div>
            <p className="mt-1 text-muted-foreground">
                {data.classification === 'legal_entity'
                    ? 'Perusahaan (Badan Hukum)'
                    : [
                          data.operatingUnitType ?? 'Operating Unit',
                          data.operatingUnitNumber,
                      ]
                          .filter(Boolean)
                          .join(' · ')}
            </p>
            <Handle
                type="source"
                position={Position.Bottom}
                className="!size-3 !border-2 !border-background !bg-muted-foreground"
            />
        </div>
    );
}

const nodeTypes: NodeTypes = { organization: OrganizationHierarchyFlowNode };

// Tata letak pohon dari atas ke bawah: setiap subpohon selebar anak-anaknya, induk di tengahnya.
function buildHierarchyGraph(
    version: Version,
    operatingUnitTypes: Record<string, string>,
): { nodes: OrganizationFlowNode[]; edges: Edge[] } {
    const nodeById = new Map(version.nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map<string, HierarchyNode[]>();
    const roots: HierarchyNode[] = [];

    for (const node of version.nodes) {
        const parentId = node.parent_node?.id;
        if (!parentId || !nodeById.has(parentId)) {
            roots.push(node);
            continue;
        }
        const children = childrenByParent.get(parentId) ?? [];
        children.push(node);
        childrenByParent.set(parentId, children);
    }

    const nodeWidth = 224;
    const horizontalGap = 64;
    const verticalGap = 180;
    const subtreeWidths = new Map<string, number>();
    const measure = (node: HierarchyNode, path = new Set<string>()): number => {
        if (path.has(node.id)) return nodeWidth;
        const known = subtreeWidths.get(node.id);
        if (known !== undefined) return known;
        const children = childrenByParent.get(node.id) ?? [];
        const nextPath = new Set(path).add(node.id);
        const childrenWidth = children.reduce(
            (total, child, index) =>
                total +
                measure(child, nextPath) +
                (index > 0 ? horizontalGap : 0),
            0,
        );
        const width = Math.max(nodeWidth, childrenWidth);
        subtreeWidths.set(node.id, width);
        return width;
    };
    const positions = new Map<string, { x: number; y: number }>();
    const place = (
        node: HierarchyNode,
        left: number,
        depth: number,
        path = new Set<string>(),
    ): void => {
        if (path.has(node.id)) return;
        const width = subtreeWidths.get(node.id) ?? measure(node);
        positions.set(node.id, {
            x: left + (width - nodeWidth) / 2,
            y: depth * verticalGap,
        });
        const children = childrenByParent.get(node.id) ?? [];
        const childWidths = children.map(
            (child) => subtreeWidths.get(child.id) ?? measure(child),
        );
        const childrenWidth = childWidths.reduce(
            (total, childWidth, index) =>
                total + childWidth + (index > 0 ? horizontalGap : 0),
            0,
        );
        let childLeft = left + (width - childrenWidth) / 2;
        const nextPath = new Set(path).add(node.id);
        children.forEach((child, index) => {
            place(child, childLeft, depth + 1, nextPath);
            childLeft += (childWidths[index] ?? nodeWidth) + horizontalGap;
        });
    };

    let rootLeft = 0;
    for (const root of roots.length ? roots : version.nodes.slice(0, 1)) {
        const width = measure(root);
        place(root, rootLeft, 0);
        rootLeft += width + horizontalGap;
    }

    return {
        nodes: version.nodes.map((node) => ({
            id: node.id,
            type: 'organization' as const,
            position: positions.get(node.id) ?? { x: 0, y: 0 },
            data: {
                label: node.organization.name,
                classification: node.organization.classification,
                // Label tipe, bukan kodenya: daftar operating unit memakai label yang sama.
                operatingUnitType: node.organization.operating_unit
                    ? (operatingUnitTypes[
                          node.organization.operating_unit.type
                      ] ?? node.organization.operating_unit.type)
                    : null,
                operatingUnitNumber:
                    node.organization.operating_unit?.number ?? null,
            },
        })),
        edges: version.nodes.flatMap((node) =>
            node.parent_node
                ? [
                      {
                          id: `${node.parent_node.id}-${node.id}`,
                          source: node.parent_node.id,
                          target: node.id,
                          type: 'smoothstep',
                      },
                  ]
                : [],
        ),
    };
}

function HierarchyCanvas({
    version,
    operatingUnitTypes,
}: {
    version: Version;
    operatingUnitTypes: Record<string, string>;
}) {
    const graph = buildHierarchyGraph(version, operatingUnitTypes);
    // Kanvas mengikuti tema aplikasi, bukan tema sistem, supaya kontrol dan peta kecilnya tidak terang di mode gelap.
    const { resolvedAppearance } = useAppearance();

    return (
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-xs">
            <div className="flex items-center justify-between border-b border-border bg-card/80 px-4 py-2.5 font-semibold text-foreground">
                <span className="flex items-center gap-2">
                    <Network className="size-4 text-primary" /> Visualisasi
                    Organigram Struktur Perusahaan
                </span>
                <Badge
                    variant="outline"
                    className="border-primary/20 bg-primary/5 font-mono text-primary"
                >
                    {version.nodes.length} Unit Terhubung
                </Badge>
            </div>
            <div className="h-[520px] bg-background">
                <ReactFlow
                    nodes={graph.nodes}
                    edges={graph.edges}
                    nodeTypes={nodeTypes}
                    nodesConnectable={false}
                    nodesDraggable={false}
                    fitView
                    proOptions={{ hideAttribution: true }}
                    colorMode={resolvedAppearance}
                >
                    <Background gap={18} size={1} />
                    <Controls />
                    <MiniMap
                        pannable
                        zoomable
                        className="!right-3 !bottom-3 overflow-hidden !rounded-lg border border-border/60"
                    />
                </ReactFlow>
            </div>
        </div>
    );
}

function RemovePlacementAction({
    version,
    rowVersion,
    node,
    onSaved,
}: {
    version: Version;
    rowVersion: number;
    node: HierarchyNode;
    onSaved: (saved: Saved) => void;
}) {
    const [open, setOpen] = useState(false);
    const remove = useHierarchySave(onSaved, 'Penempatan belum dibatalkan.');

    return (
        <AlertDialog
            open={open}
            onOpenChange={(next) => {
                if (remove.processing) return;
                if (!next) remove.clear();
                setOpen(next);
            }}
        >
            <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                    <Trash2 />
                    Batalkan
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Batalkan penempatan?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {node.organization.name} akan dilepas dari draft ini dan
                        dapat ditempatkan kembali di bawah organisasi yang
                        benar.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <FormErrorHeader
                    errors={remove.errors}
                    message={remove.message}
                    operation="Penempatan belum dibatalkan"
                />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={remove.processing}>
                        Kembali
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={remove.processing}
                        onClick={() =>
                            void remove
                                .run(() =>
                                    api.hierarchyUnplace({
                                        params: {
                                            version: version.id,
                                            node: node.id,
                                        },
                                        body: { version: rowVersion },
                                    }),
                                )
                                .then((saved) => saved && setOpen(false))
                        }
                    >
                        Batalkan Penempatan
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function CreateVersionDraftAction({
    version,
    rowVersion,
    onSaved,
}: {
    version: Version;
    rowVersion: number;
    onSaved: (saved: Saved) => void;
}) {
    const [open, setOpen] = useState(false);
    const [effectiveFrom, setEffectiveFrom] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);
    const draft = useHierarchySave(onSaved, 'Draft versi baru belum dibuat.');

    return (
        <PageDialog
            open={open}
            onOpenChange={(next) => {
                if (draft.processing) return;
                if (!next) {
                    setEffectiveFrom('');
                    draft.clear();
                }
                setOpen(next);
            }}
        >
            <PageDialogTrigger asChild>
                <ActionButton action="create" className="font-medium" />
            </PageDialogTrigger>
            <PageDialogContent
                ref={contentRef}
                title="Hierarki organisasi"
                recordTitle={`Draf baru dari versi ${version.version_number}`}
                editing
                busy={draft.processing}
                description="Versi yang sudah dipublikasikan tetap menjadi riwayat resmi."
            >
                <form
                    noValidate
                    className="flex min-h-0 flex-1 flex-col"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void draft
                            .run(() =>
                                api.hierarchyDraft({
                                    params: { version: version.id },
                                    body: {
                                        effective_from: effectiveFrom,
                                        version: rowVersion,
                                    },
                                }),
                            )
                            .then((saved) => saved && setOpen(false));
                    }}
                >
                    <PageDialogToolbar>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={draft.processing}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={draft.processing}
                            onClick={() => {
                                setEffectiveFrom('');
                                draft.clear();
                                setOpen(false);
                            }}
                        />
                    </PageDialogToolbar>
                    <FormErrorHeader
                        errors={draft.errors}
                        message={draft.message}
                        operation="Draft versi baru belum dibuat"
                    />
                    <PageDialogBody className="space-y-4">
                        <FormGrid columns={1}>
                            <FormControl data-error-field="effective_from">
                                <DatePicker
                                    label="Berlaku mulai"
                                    required
                                    value={effectiveFrom}
                                    onValueChange={setEffectiveFrom}
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                        </FormGrid>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

function HierarchyDetail({
    hierarchy,
    canManage,
    operatingUnitTypes,
    onSaved,
}: {
    hierarchy: Hierarchy;
    canManage: boolean;
    operatingUnitTypes: Record<string, string>;
    onSaved: (saved: Saved) => void;
}) {
    const version = hierarchy.versions[0];
    if (!version) return null;

    return (
        <div className="space-y-4 border-b border-border pb-8 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-bold text-foreground">
                        {hierarchy.name}
                    </h3>
                    <p className="mt-0.5 text-muted-foreground">
                        Tujuan:{' '}
                        {hierarchy.purposes
                            .map((purpose) => purpose.name)
                            .join(' · ') || '—'}
                    </p>
                </div>
                <Badge variant="outline">
                    {version.status === 'draft'
                        ? 'Draft'
                        : `Terbit v${version.version_number}`}
                </Badge>
            </div>

            <HierarchyCanvas
                version={version}
                operatingUnitTypes={operatingUnitTypes}
            />

            <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                    <p className="font-semibold tracking-wider text-muted-foreground uppercase">
                        Daftar Penempatan Unit Organisasi
                    </p>
                    <span className="text-muted-foreground">
                        {version.nodes.length} Unit Terpasang
                    </span>
                </div>
                <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                    {version.nodes.map((node) => (
                        <div
                            key={node.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-card px-3.5 py-2.5 shadow-2xs"
                        >
                            <div className="min-w-0 flex-1">
                                <span className="block truncate font-bold text-foreground">
                                    {node.organization.name}
                                    {node.organization.operating_unit
                                        ?.number && (
                                        <span className="ml-1.5 font-mono font-normal text-muted-foreground">
                                            {
                                                node.organization.operating_unit
                                                    .number
                                            }
                                        </span>
                                    )}
                                </span>
                                <span className="mt-0.5 block truncate text-muted-foreground">
                                    {node.parent_node
                                        ? `Di bawah ${node.parent_node.organization.name}`
                                        : 'Organisasi paling atas'}
                                </span>
                            </div>
                            {canManage &&
                                version.status === 'draft' &&
                                node.parent_node && (
                                    <RemovePlacementAction
                                        version={version}
                                        rowVersion={hierarchy.version}
                                        node={node}
                                        onSaved={onSaved}
                                    />
                                )}
                        </div>
                    ))}
                </div>
            </div>

            {canManage && version.status === 'draft' && (
                <DraftActions
                    key={`${version.id}:${hierarchy.version}`}
                    version={version}
                    rowVersion={hierarchy.version}
                    onSaved={onSaved}
                />
            )}
            {canManage && version.status === 'published' && (
                <div className="flex justify-end pt-2">
                    <CreateVersionDraftAction
                        version={version}
                        rowVersion={hierarchy.version}
                        onSaved={onSaved}
                    />
                </div>
            )}
        </div>
    );
}

export function OrganizationHierarchies({
    props,
    search,
    onSearchChange,
}: {
    props: HierarchyProps;
    search: string;
    onSearchChange: (search: string) => void;
}): ReactNode {
    const operatingUnitTypes: Record<string, string> = props.operatingUnitTypes;
    const [showDetail, setShowDetail] = useState(false);
    const [selected, setSelected] = useState<Hierarchy | null>(null);
    const [error, setError] = useState('');
    const pending = useRef<AbortController | null>(null);
    useEffect(() => () => pending.current?.abort(), []);
    const loader = useCallback<ListLoader<HierarchyRow>>(
        async ({ query, cursor, signal }) => {
            const batch = await hierarchyBatch(
                { q: query, ...(cursor ? { cursor } : {}) },
                signal,
            );
            // Tanpa `resource` dan `record_id`, barisnya baris daftar hierarki.
            return {
                items: batch.data,
                nextCursor: batch.next_cursor,
            };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search,
        getKey: (item) => item.id,
    });
    const saved = (result: Saved) => {
        pending.current?.abort();
        setSelected(result.savedHierarchy);
        setShowDetail(true);
        list.reload();
    };
    const open = async (id: string) => {
        pending.current?.abort();
        const controller = new AbortController();
        pending.current = controller;
        setError('');
        try {
            const batch = await hierarchyBatch(
                { record_id: id },
                controller.signal,
            );
            // Dengan `record_id`, isinya satu hierarki lengkap.
            const [hierarchy] = batch.data;
            if (hierarchy && !isHierarchy(hierarchy))
                throw new Error(
                    'Jawaban hierarki tidak berisi hierarki lengkap.',
                );
            if (!controller.signal.aborted && hierarchy) {
                setSelected(hierarchy);
                setShowDetail(true);
            }
        } catch (caught) {
            if (!controller.signal.aborted)
                setError(
                    errorText(
                        caught,
                        'Hierarki belum dapat dibuka. Pilih kembali untuk mencoba lagi.',
                    ),
                );
        }
    };

    return (
        <ListPageLayout
            filters={
                error && (
                    <p role="alert" className="px-4 py-2 text-destructive">
                        {error}
                    </p>
                )
            }
            header={
                <RecordActionBar
                    title="Hierarki organisasi"
                    search={{
                        value: search,
                        onValueChange: onSearchChange,
                        label: 'Cari hierarki',
                        placeholder: 'Cari hierarki...',
                    }}
                >
                    {props.canManage && (
                        <CreateHierarchyDialog
                            purposes={props.purposes}
                            onSaved={(result) => {
                                saved(result);
                                onSearchChange('');
                            }}
                        />
                    )}
                </RecordActionBar>
            }
        >
            <MasterDetailLayout
                detailOpen={showDetail}
                onDetailOpenChange={setShowDetail}
                list={
                    <aside className="flex h-full min-h-0 min-w-0 flex-col">
                        <DataTable
                            data={list.items}
                            getRowKey={(item) => item.id}
                            columns={[
                                {
                                    id: 'name',
                                    header: 'Nama hierarki',
                                    cell: (item) => (
                                        <DataTableText>
                                            {item.name}
                                        </DataTableText>
                                    ),
                                },
                            ]}
                            activeRowKey={selected?.id}
                            rowActivation="single-click"
                            onRowClick={(item) => {
                                if (selected?.id === item.id)
                                    setShowDetail(true);
                                else void open(item.id);
                            }}
                            incremental={list}
                            emptyMessage="Belum ada hierarki yang cocok."
                        />
                    </aside>
                }
            >
                <div
                    className="h-full min-h-0 min-w-0 flex-1 space-y-4 overflow-auto p-4 lg:p-6"
                    scroll-region=""
                >
                    {selected ? (
                        <HierarchyDetail
                            key={selected.id}
                            hierarchy={selected}
                            canManage={props.canManage}
                            operatingUnitTypes={operatingUnitTypes}
                            onSaved={saved}
                        />
                    ) : (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>
                                    Pilih hierarki organisasi
                                </EmptyTitle>
                                <EmptyDescription>
                                    Pilih hierarki dari daftar untuk melihat
                                    susunan dan versi yang berlaku.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </div>
            </MasterDetailLayout>
        </ListPageLayout>
    );
}
