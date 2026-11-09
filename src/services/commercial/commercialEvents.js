import CommercialEvent from "../../models/CommercialEvent.js";

/**
 * Fire-and-forget funnel event (PRD §5.1). Never awaited by callers and
 * never throws: analytics must not slow down or break a customer action.
 */
export function recordCommercialEvent(type, fields = {}) {
  CommercialEvent.create({
    type,
    customerId: fields.customerId != null ? String(fields.customerId) : null,
    guestId: fields.guestId ?? null,
    packageId: fields.packageId != null ? String(fields.packageId) : null,
    vendorId: fields.vendorId != null ? String(fields.vendorId) : null,
    eventDate: fields.eventDate ?? null,
    price: fields.price ?? null,
    meta: fields.meta ?? null,
  }).catch((err) => console.warn(`[commercialEvents] ${type} not recorded:`, err.message));
}
