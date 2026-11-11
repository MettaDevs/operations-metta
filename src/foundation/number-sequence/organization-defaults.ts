import { onOrganizationCreated } from '../../platform/organization/index.ts';
import { NumberSequences } from './number-sequence.service.ts';

let registered = false;

// Legal entity dan unit baru mendapat number sequence bawaan untuk setiap reference yang memintanya lewat
// app_number_sequence_references. Organization ada di Platform, jadi ia tidak meng-import Foundation sendiri; setiap
// proses yang membuat organisasi atau memasang module (server http dan worker) memanggil ini sekali saat mulai.
export function registerOrganizationDefaults(): void {
    if (registered) return;
    registered = true;
    onOrganizationCreated(async (db, organization) => {
        const sequences = new NumberSequences(
            db,
            organization.tenantId,
            organization.userId,
        );
        switch (organization.classification) {
            case 'legal_entity':
                return sequences.createLegalEntityDefaults(
                    organization.organizationId,
                );
            case 'operating_unit':
                return sequences.createUnitDefaults(
                    organization.organizationId,
                );
            default: {
                const unknown: never = organization.classification;
                throw new Error(`Unknown classification: ${String(unknown)}`);
            }
        }
    });
}
