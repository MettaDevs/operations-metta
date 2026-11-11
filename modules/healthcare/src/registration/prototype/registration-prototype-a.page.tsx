import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { FactBox } from '@operations-metta/ui/fact-box';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import { RegistrationList } from './registration-prototype-list.tsx';
import { installations, sections } from './registration-prototype.mock.ts';
import {
    DestinationFields,
    PatientFacts,
    PatientHistory,
    PatientPicker,
    SavedNotice,
    TriageFields,
    VariantSwitcher,
    VisitFields,
    triageLevel,
    useRegistrationDraft,
} from './registration-prototype-parts.tsx';

// Varian A: kartu PageDialog di atas daftar, seperti kartu pasien. Bagian isian berurutan sebagai FastTab,
// identitas dan riwayat pasien di FactBox kanan.

function RegistrationCard({ onClose }: { onClose: () => void }): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const state = useRegistrationDraft();
    const { draft, saved } = state;
    const section = sections.find((item) => item.id === draft.sectionId);
    const level = triageLevel(draft.triage);
    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title="Registrasi kunjungan"
                recordTitle={
                    saved
                        ? `${saved.number} · ${draft.patient?.name ?? ''}`
                        : 'Registrasi baru'
                }
                onNew={state.reset}
            >
                <div className="flex min-h-0 flex-1 flex-col">
                    <RecordActionBar>
                        {!saved && (
                            <>
                                <ActionButton
                                    action="save"
                                    type="button"
                                    onClick={() => void state.save()}
                                />
                                <ActionButton
                                    action="cancel"
                                    onClick={onClose}
                                />
                            </>
                        )}
                    </RecordActionBar>
                    <PageDialogBody className="py-3">
                        <FactBox
                            attachments={
                                <p className="p-3 text-sm text-muted-foreground">
                                    Belum ada lampiran.
                                </p>
                            }
                            details={
                                <div className="space-y-3 p-3">
                                    <PatientFacts
                                        patient={draft.patient}
                                        compact
                                    />
                                    <PatientHistory patient={draft.patient} />
                                </div>
                            }
                        >
                            <div className="space-y-3">
                                {saved && (
                                    <SavedNotice
                                        saved={saved}
                                        patient={draft.patient}
                                        onNext={state.reset}
                                        onList={onClose}
                                    />
                                )}
                                <CollapsibleSectionGroup
                                    defaultValue={[
                                        'patient',
                                        'visit',
                                        'triage',
                                        'destination',
                                    ]}
                                >
                                    <CollapsibleSection
                                        value="patient"
                                        title="Pasien"
                                        summary={
                                            draft.patient?.name ??
                                            'Belum dipilih'
                                        }
                                    >
                                        <div className="px-3 py-3">
                                            <PatientPicker
                                                state={state}
                                                portalContainer={contentRef}
                                            />
                                        </div>
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="visit"
                                        title="Data kunjungan"
                                        summary={
                                            draft.visitKind === 'healthy'
                                                ? 'Kunjungan sehat'
                                                : 'Kunjungan sakit'
                                        }
                                    >
                                        <div className="px-3 py-3">
                                            <VisitFields
                                                state={state}
                                                portalContainer={contentRef}
                                            />
                                        </div>
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="triage"
                                        title="Skrining visual"
                                        summary={
                                            level
                                                ? `Kategori ${level.name}`
                                                : 'Belum diisi'
                                        }
                                    >
                                        <div className="px-3 py-3">
                                            <TriageFields state={state} />
                                        </div>
                                    </CollapsibleSection>
                                    <CollapsibleSection
                                        value="destination"
                                        title="Tujuan"
                                        summary={
                                            section
                                                ? `${installations.find((item) => item.id === draft.installation)?.name ?? ''} · ${section.name}`
                                                : 'Belum dipilih'
                                        }
                                    >
                                        <div className="px-3 py-3">
                                            <DestinationFields state={state} />
                                        </div>
                                    </CollapsibleSection>
                                </CollapsibleSectionGroup>
                            </div>
                        </FactBox>
                    </PageDialogBody>
                </div>
            </PageDialogContent>
        </PageDialog>
    );
}

function RegistrationPrototypeA(): ReactNode {
    const [open, setOpen] = useState(true);
    const [key, setKey] = useState(0);
    return (
        <div className="flex h-full min-h-0 flex-col">
            <VariantSwitcher current="a" />
            <div className="min-h-0 flex-1">
                <RegistrationList
                    onNew={() => {
                        setKey((value) => value + 1);
                        setOpen(true);
                    }}
                    onOpen={() => undefined}
                />
            </div>
            {open && (
                <RegistrationCard key={key} onClose={() => setOpen(false)} />
            )}
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/registration/prototype-a',
    layout: 'app',
    title: 'Registrasi A (prototype)',
    component: RegistrationPrototypeA,
});
