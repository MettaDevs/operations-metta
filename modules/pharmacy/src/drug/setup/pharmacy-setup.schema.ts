import { z } from 'zod';
import { unitPriceDecimalOptions } from '../drug-price/drug-price.calculation.ts';

// Setelan farmasi per legal entity (far_m_parameter), pola Inventory Setup BC. version kosong berarti legal entity itu
// belum punya baris setelan dan memakai nilai bawaan.
export const pharmacySetupRowSchema = z.object({
    unit_price_decimals: z.literal(unitPriceDecimalOptions),
    version: z.number().nullable(),
});

export const pharmacySetupInputSchema = pharmacySetupRowSchema;
