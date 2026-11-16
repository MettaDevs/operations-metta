import {
    onBeforePayment,
    onPaymentHolds,
} from '@core/foundation/billing/index.ts';
import { onEvent } from '@core/platform/events/index.ts';
import {
    prescriptionIssued,
    receivePrescription,
} from './dispensing/prescription/prescription.events.ts';
import { dispensingReturnRoutes } from './dispensing/dispensing-return/dispensing-return.routes.ts';
import { dispensingRoutes } from './dispensing/dispensing/dispensing.routes.ts';
import { prescriptionRoutes } from './dispensing/prescription/prescription.routes.ts';
import {
    waitingPrescriptionHolds,
    waitingPrescriptionRefusal,
} from './dispensing/prescription/prescription.service.ts';
import { serviceLocationRoutes } from './dispensing/service-location/service-location.routes.ts';
import { drugClassRoutes } from './drug/drug-class/drug-class.routes.ts';
import { drugPriceRoutes } from './drug/drug-price/drug-price.routes.ts';
import { drugRoutes } from './drug/drug/drug.routes.ts';
import { gradingGroupRoutes } from './drug/grading-group/grading-group.routes.ts';
import { moduleId } from './module.ts';
import { otcSaleRoutes } from './dispensing/otc-sale/otc-sale.routes.ts';
import { otcSaleLocationRoutes } from './dispensing/otc-sale-location/otc-sale-location.routes.ts';

export function pharmacyRoutes() {
    return {
        ...prescriptionRoutes(),
        ...dispensingRoutes(),
        ...dispensingReturnRoutes(),
        ...serviceLocationRoutes(),
        ...drugClassRoutes(),
        ...drugRoutes(),
        ...gradingGroupRoutes(),
        ...drugPriceRoutes(),
        ...otcSaleRoutes(),
        ...otcSaleLocationRoutes(),
    };
}

let registered = false;

// Dipanggil src/main.ts dan src/worker.ts. Proses yang tidak memanggilnya tidak mengantar resep ke farmasi, dan kasirnya
// tidak menunggu atau menampilkan resep yang belum disiapkan.
export function registerPharmacyEventHandlers(): void {
    if (registered) return;
    registered = true;
    onEvent(prescriptionIssued, moduleId, receivePrescription);
    onBeforePayment(moduleId, waitingPrescriptionRefusal);
    onPaymentHolds(moduleId, waitingPrescriptionHolds);
}
