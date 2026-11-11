import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { definePage } from '@core/platform/shell/index.ts';
import { VariantSwitcher } from './registration-prototype-parts.tsx';
import { RegistrationList } from './registration-prototype-list.tsx';

function RegistrationListPrototype(): ReactNode {
    const navigate = useNavigate();
    return (
        <div className="flex h-full min-h-0 flex-col">
            <VariantSwitcher current="list" />
            <div className="min-h-0 flex-1">
                <RegistrationList
                    onNew={() =>
                        void navigate({
                            to: '/healthcare/registration/prototype-b',
                        })
                    }
                    onOpen={() =>
                        void navigate({
                            to: '/healthcare/registration/prototype-a',
                        })
                    }
                />
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/healthcare/registration/prototype-list',
    layout: 'app',
    title: 'Registrasi (prototype)',
    component: RegistrationListPrototype,
});
