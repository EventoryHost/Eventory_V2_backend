import Template from "../models/Template.js";

// GET /api/admin/templates
export const getAllTemplates = async (req, res) => {
  try {
    const { page = 1, limit = 12, vendorTypeLabel } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (vendorTypeLabel) query.vendorTypeLabel = vendorTypeLabel;

    const templates = await Template.find(query)
      .populate("ownerVendorId", "businessName city")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Template.countDocuments(query);

    res.status(200).json({
      success: true,
      data: templates,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/templates/stats
export const getTemplateStats = async (req, res) => {
  try {
    const total = await Template.countDocuments();
    const live = await Template.countDocuments({ isLive: true });
    const hidden = total - live;
    
    // Aggregate by vendor type
    const byType = await Template.aggregate([
      { $group: { _id: "$vendorTypeLabel", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        live,
        hidden,
        byType
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/templates/:id
export const getTemplateDetails = async (req, res) => {
  try {
    const template = await Template.findById(req.params.id)
      .populate("ownerVendorId", "businessName city phone");
      
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    res.status(200).json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/admin/templates/:id
export const deleteTemplate = async (req, res) => {
  try {
    const template = await Template.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    res.status(200).json({ success: true, message: "Template deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/templates/:id/toggle-live
export const toggleTemplateLive = async (req, res) => {
  try {
    const { isLive } = req.body;
    if (typeof isLive !== "boolean") {
      return res.status(400).json({ success: false, message: "isLive must be a boolean" });
    }

    const template = await Template.findByIdAndUpdate(
      req.params.id,
      { isLive },
      { new: true }
    );
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });

    res.status(200).json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
