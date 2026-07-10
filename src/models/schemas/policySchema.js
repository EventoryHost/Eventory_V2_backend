import mongoose from "mongoose";

// A single configurable policy the vendor sets in Step 3 "Policies and other
// documents": either a picked template, uploaded document(s), or written text.
// Mirrors the frontend PolicyConfig. Reused for the cancellation slot, the last
// minute slot, and each entry in the repeatable general policies list.
const policySchema = new mongoose.Schema(
  {
    templateId: { type: String },
    templateTitle: { type: String },
    files: [{ type: String }],
    writtenText: { type: String },
  },
  { _id: false }
);

export default policySchema;
