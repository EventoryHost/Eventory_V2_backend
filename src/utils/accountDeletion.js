import {
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "../config/awsConfig.js";
import Vendor from "../models/Vendor.js";
import Booking from "../models/Booking.js";
import Enquiry from "../models/Enquiry.js";
import Package from "../models/Package.js";
import CalendarBlock from "../models/CalendarBlock.js";
import Transaction from "../models/Transaction.js";

/**
 * Retention window between a vendor requesting deletion and the account being
 * purged. The vendor can cancel at any point inside it; once it lapses the
 * purge is irreversible.
 */
export const DELETION_RETENTION_DAYS = Number(
  process.env.DELETION_RETENTION_DAYS || 30
);

export const retentionWindowMs = () =>
  DELETION_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The moment a request made at `requestedAt` becomes eligible for purge. */
export const purgeEligibleAt = (requestedAt) =>
  new Date(new Date(requestedAt).getTime() + retentionWindowMs());

/**
 * Delete the vendor's Cognito identity. Without this the phone number stays
 * registered and the vendor could neither sign up again nor be considered
 * deleted. A missing user is treated as success so the purge stays idempotent.
 */
async function deleteCognitoUser(phone) {
  try {
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: phone,
      })
    );
  } catch (error) {
    if (error.name === "UserNotFoundException") return;
    throw error;
  }
}

/**
 * Permanently remove a vendor and everything scoped to them.
 *
 * Bookings and transactions are intentionally NOT deleted: they belong to the
 * counterparty's records and to our financial history, and destroying them
 * would corrupt another user's data. They are anonymised instead, which is the
 * standard reading of a deletion request against jointly-owned records.
 */
export async function purgeVendor(vendorId) {
  const vendor = await Vendor.findOne({ id: vendorId });
  if (!vendor) return { purged: false, reason: "not_found" };

  // Vendor-owned content: safe to remove outright.
  await Promise.all([
    Package.deleteMany({ vendorId }),
    Enquiry.deleteMany({ vendorId }),
    CalendarBlock.deleteMany({ vendorId }),
  ]);

  // Jointly-owned records: sever the link to the person, keep the record.
  await Promise.all([
    Booking.updateMany({ vendorId }, { $set: { vendorDeleted: true } }),
    Transaction.updateMany({ vendorId }, { $set: { vendorDeleted: true } }),
  ]);

  await deleteCognitoUser(vendor.phone);
  await Vendor.deleteOne({ id: vendorId });

  return { purged: true };
}

/**
 * Vendors whose retention window has lapsed and are therefore due for purge.
 *
 * Purging itself is run manually by the team, so this only reports what is
 * due — call `purgeVendor` per id to actually remove one. Anything listed here
 * has passed its window and can no longer be cancelled by the vendor.
 */
export async function findVendorsDueForPurge() {
  const cutoff = new Date(Date.now() - retentionWindowMs());
  return Vendor.find({
    deletionRequestedAt: { $ne: null, $lte: cutoff },
  }).select("id phone deletionRequestedAt");
}
