import mongoose from "mongoose";
import EmReplyTemplate from "../models/EmReplyTemplate.js";

/** An Event Manager can keep this many templates. */
const MAX_PER_EM = 100;

const view = (t) => ({
  id: String(t._id),
  emId: t.emId,
  title: t.title,
  text: t.text,
  useCount: t.useCount ?? 0,
  lastUsedAt: t.lastUsedAt,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

// Only that Event Manager's own template matches; anything else is a 404.
const ownFilter = (id, emId) => (mongoose.isValidObjectId(id) ? { _id: id, emId } : null);

export const listEmReplyTemplates = async (req, res) => {
  try {
    const rows = await EmReplyTemplate.find({ emId: req.query.emId })
      .sort({ useCount: -1, updatedAt: -1 })
      .limit(MAX_PER_EM)
      .lean();
    res.json({ success: true, templates: rows.map(view) });
  } catch (err) {
    console.error("listEmReplyTemplates:", err);
    res.status(500).json({ success: false, message: "Could not load templates" });
  }
};

export const createEmReplyTemplate = async (req, res) => {
  try {
    const { emId, emName, title, text } = req.body;
    if ((await EmReplyTemplate.countDocuments({ emId })) >= MAX_PER_EM) {
      return res.status(400).json({ success: false, message: `An Event Manager can keep up to ${MAX_PER_EM} templates` });
    }
    const t = await EmReplyTemplate.create({ emId, emName: emName || null, title, text });
    res.status(201).json({ success: true, template: view(t) });
  } catch (err) {
    console.error("createEmReplyTemplate:", err);
    res.status(500).json({ success: false, message: "Could not save the template" });
  }
};

export const updateEmReplyTemplate = async (req, res) => {
  try {
    const { emId, title, text } = req.body;
    const filter = ownFilter(req.params.id, emId);
    const set = {};
    if (title != null) set.title = title;
    if (text != null) set.text = text;
    const t = filter && (await EmReplyTemplate.findOneAndUpdate(filter, { $set: set }, { returnDocument: "after" }).lean());
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, template: view(t) });
  } catch (err) {
    console.error("updateEmReplyTemplate:", err);
    res.status(500).json({ success: false, message: "Could not update the template" });
  }
};

export const deleteEmReplyTemplate = async (req, res) => {
  try {
    const filter = ownFilter(req.params.id, req.query.emId);
    const t = filter && (await EmReplyTemplate.findOneAndDelete(filter).lean());
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmReplyTemplate:", err);
    res.status(500).json({ success: false, message: "Could not delete the template" });
  }
};

/** The template was put into a reply; counts towards the list order. */
export const useEmReplyTemplate = async (req, res) => {
  try {
    const filter = ownFilter(req.params.id, req.body.emId);
    const t =
      filter &&
      (await EmReplyTemplate.findOneAndUpdate(
        filter,
        { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } },
        { returnDocument: "after", timestamps: false }
      ).lean());
    if (!t) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, template: view(t) });
  } catch (err) {
    console.error("useEmReplyTemplate:", err);
    res.status(500).json({ success: false, message: "Could not update the template" });
  }
};
