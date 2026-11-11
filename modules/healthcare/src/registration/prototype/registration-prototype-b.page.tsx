import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useNavigate } from '@tanstack/react-router';
import { Save, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    PatientPanel,
    TriagePanel,
    TriageResult,
    VisitPanel,
} from './registration-prototype-b-parts.tsx';
import {
    DestinationFields,
    PatientHistory,
    SavedNotice,
    VariantSwitcher,
    useRegistrationDraft,
} from './registration-prototype-parts.tsx';

// Varian B (dipilih pemilik): satu halaman penuh dua kolom seperti aplikasi lama. Kiri data dan riwayat pasien
// sebagai baris label : nilai, kanan isian kunjungan, skrining, dan tujuan.

function RegistrationPrototypeB(): ReactNode {
    const navigate = useNavigate();
    const state = useRegistrationDraft();
    const { draft, saved } = state;
    const toList = () =>
        void navigate({ to: '/healthcare/registration/prototype-list' });
    const submit = () => {
        if (state.save())
            document
                .getElementById('registration-top')
                ?.scrollIntoView({ behavior: 'smooth' });
    };
    return (
        <div className="flex h-full min-h-0 flex-col">
            <VariantSwitcher current="b" />
            <RecordActionBar title="Registrasi kunjungan baru">
                {saved ? (
                    <ActionButton action="create" onClick={state.reset} />
                ) : (
                    <>
                        <ActionButton
                            action="save"
                            type="button"
                            onClick={submit}
                        />
                        <ActionButton action="cancel" onClick={toList} />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div id="registration-top" className="space-y-4 p-3 lg:p-4">
                    {saved && (
                        <SavedNotice
                            saved={saved}
                            patient={draft.patient}
                            onNext={state.reset}
                            onList={toList}
                        />
                    )}
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(360px,1fr)_2fr]">
                        <div className="min-w-0 space-y-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data pasien</CardTitle>
                                    <CardAction align="end">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                        >
                                            <UserPlus aria-hidden="true" />
                                            Buat pasien baru
                                        </Button>
                                    </CardAction>
                                </CardHeader>
                                <CardContent>
                                    <PatientPanel state={state} />
                                </CardContent>
                            </Card>
                            <Card className="py-0">
                                <PatientHistory patient={draft.patient} />
                            </Card>
                        </div>
                        <fieldset
                            disabled={saved !== null}
                            className="min-w-0 space-y-4"
                        >
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data kunjungan</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <VisitPanel state={state} />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Skrining visual</CardTitle>
                                    <CardAction align="end">
                                        <TriageResult state={state} />
                                    </CardAction>
                                </CardHeader>
                                <CardContent>
                                    <TriagePanel state={state} />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data tujuan</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <DestinationFields state={state} />
                                </CardContent>
                            </Card>
                            {!saved && (
                                <Button
                                    type="button"
                                    size="lg"
                                    className="w-full"
                                    onClick={submit}
                                >
                                    <Save aria-hidden="true" /> Simpan
                                    registrasi
                                </Button>
                            )}
                        </fieldset>
                    </div>
                </div>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/registration/prototype-b',
    layout: 'app',
    title: 'Registrasi B (prototype)',
    component: RegistrationPrototypeB,
});
