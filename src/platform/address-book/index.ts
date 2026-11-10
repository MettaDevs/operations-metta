import { occupationRoutes } from './occupation.routes.ts';
import { partyAddressRoutes } from './party-address.routes.ts';
import { partyRoutes } from './party.routes.ts';

export { checkDetails, type PartyDetails } from './party-address.schema.ts';
export { PartyAddresses } from './party-address.service.ts';
export { registerPartyRole } from './party-role.service.ts';

// Buku alamat global: party (orang dan organisasi), alamat, kontak, nomor identitas, hubungan, peran, dan cek data
// ganda. Route pengguna tenant di bawah `/api/v1/parties`, `/api/v1/organizations/{id}/...`, dan
// `/api/v1/occupations`.
export function addressBookRoutes() {
    return { ...partyRoutes(), ...partyAddressRoutes(), ...occupationRoutes() };
}
