import { getRouteApi } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import {
    DiagnosisReferenceList,
    referenceSearchSchema,
} from './diagnosis-reference-list.tsx';

// Aturan pakai baris resep. Bawaannya lima pilihan FormEresep.php sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/usage-instructions');

function UsageInstructionsPage(): ReactNode {
    const navigate = route.useNavigate();
    return (
        <DiagnosisReferenceList
            list="usage-instructions"
            title="Aturan pakai"
            search={route.useSearch()}
            onSearchChange={(next) =>
                void navigate({
                    search: (current) => ({ ...current, ...next }),
                    replace: true,
                })
            }
        />
    );
}

export const page = definePage({
    path: '/healthcare/clinical/usage-instructions',
    layout: 'app',
    title: 'Aturan pakai',
    validateSearch: referenceSearchSchema,
    component: UsageInstructionsPage,
});
