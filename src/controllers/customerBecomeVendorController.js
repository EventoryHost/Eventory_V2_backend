import VendorLead from "../models/VendorLead.js";

/**
 * @desc Public (no auth) — saves a "Contact Us" lead from the Become a
 * Vendor page. Validated by becomeVendorLeadSchema (see
 * customerBecomeVendorRoutes.js) before this runs.
 */
export const createVendorLead = async (req, res) => {
  try {
    const { name, vendorType, phone } = req.body;
    const lead = await VendorLead.create({ name, vendorType, phone });
    return res.status(201).json({
      success: true,
      data: { leadId: lead.leadId, name: lead.name },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export default createVendorLead;
