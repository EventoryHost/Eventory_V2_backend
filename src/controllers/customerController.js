import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Fields a customer (or an internal caller acting on their behalf) is
 * allowed to write directly. Deliberately excludes id, role, isDeactivated,
 * isPhoneVerified/isEmailVerified/verificationStatus, authProvider,
 * email/phone (identity fields change only through the OTP-verified auth
 * flow, not a generic profile PATCH) — those must only ever be set by
 * trusted server-side logic (auth controller, admin tooling), never taken
 * verbatim from a request body. This prevents privilege-escalation /
 * mass-assignment (e.g. a customer PATCHing their own role or marking
 * themselves verified).
 */
const SELF_UPDATABLE_FIELDS = [
  "name",
  "profilePicture",
  "dateOfBirth",
  "gender",
  "addresses",
  "preferences",
];

function pickAllowedFields(payload, allowedFields) {
  const cleaned = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      cleaned[field] = payload[field];
    }
  }
  return cleaned;
}

/**
 * Blocks base64/data-URI values from being persisted — images must be
 * uploaded to S3 client-side and only the resulting URL stored here,
 * matching the existing convention used for Vendor.
 */
function rejectBase64Fields(payload) {
  const sanitized = { ...payload };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string" && value.startsWith("data:")) {
      console.warn(`[customerController] Blocked base64 write on field: ${key}`);
      delete sanitized[key];
    }
  }
  return sanitized;
}

// Create a new customer (used by the auth flow on first-time OTP verification)
export const createCustomer = async (req, res, next) => {
  try {
    const customerData = rejectBase64Fields({ ...req.body });
    if (!customerData.id) {
      customerData.id = generateISTId("CUS");
    }
    const customer = new Customer(customerData);
    await customer.save();
    res.status(201).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A customer with this phone or email already exists",
      });
    }
    next(error);
  }
};

// Get single customer by ID
export const getCustomerById = async (req, res, next) => {
  try {
    let query = Customer.findOne({ id: req.params.id });
    if (req.query.select) {
      const fields = req.query.select.split(",").join(" ");
      query = query.select(fields);
    }
    const customer = await query.lean();
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};

// Update own profile (whitelisted fields only — see SELF_UPDATABLE_FIELDS)
export const updateCustomer = async (req, res, next) => {
  try {
    const cleanBody = rejectBase64Fields(pickAllowedFields(req.body, SELF_UPDATABLE_FIELDS));
    const customer = await Customer.findOneAndUpdate(
      { id: req.params.id },
      cleanBody,
      { new: true, runValidators: true }
    );
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.status(200).json({
      success: true,
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc Phase 5 Step 25 — change the customer's own email. Deliberately
 * separate from updateCustomer/SELF_UPDATABLE_FIELDS: email is an identity
 * field, changing it always resets isEmailVerified to false (and
 * verificationStatus is recomputed off the customer's CURRENT phone
 * verification only) — an unconfirmed new address is never left marked
 * verified just because the old one was.
 *
 * NO real re-verification (OTP/confirmation link) is sent here — checked
 * with the user first: no email-sending service (SMTP/SendGrid/SES) exists
 * anywhere in this codebase to send one through. Honestly reflected via
 * isEmailVerified:false rather than faking a "verified" state, or blocking
 * email changes entirely (also considered, not chosen). Revisit once an
 * email service exists — see info.txt.
 */
export const updateCustomerEmail = async (req, res, next) => {
  try {
    const { email } = req.body;

    const taken = await Customer.findOne({ email, id: { $ne: req.params.id } });
    if (taken) {
      return res.status(409).json({ success: false, message: "This email is already linked to another account" });
    }

    const customer = await Customer.findOne({ id: req.params.id });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    customer.email = email;
    customer.isEmailVerified = false;
    customer.verificationStatus = customer.isPhoneVerified ? "PhoneVerified" : "Unverified";
    await customer.save();

    const { password, ...safeCustomer } = customer.toObject();
    res.status(200).json({
      success: true,
      message: "Email updated — this address is not yet verified",
      data: safeCustomer,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This email is already linked to another account" });
    }
    next(error);
  }
};

// Deactivate own account (soft delete — preserves booking/order history integrity)
export const deactivateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: true },
      { new: true, runValidators: true }
    );
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Customer account has been deactivated",
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};

export const reactivateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: false },
      { new: true, runValidators: true }
    );
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Customer account has been reactivated",
      data: customer,
    });
  } catch (error) {
    next(error);
  }
};
