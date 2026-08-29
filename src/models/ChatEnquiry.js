import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Anonymous Chat / lead-gen chatbot — the state machine record
 * (chatBotEngine.js reads/writes `status` to decide what to ask next, per
 * the client's own spec). Deliberately a SEPARATE model from the
 * vendor-authored src/models/Enquiry.js (never touched here, per the
 * standing rule not to interfere with existing/vendor-side code) — that
 * model requires a vendorId and represents a real per-vendor enquiry after
 * a customer has already picked a vendor/package; THIS model represents a
 * pre-vendor-selection lead captured by the homepage chatbot, with no
 * vendorId at all. Own collection ("customer_chat_enquiries"), checked
 * live for name collisions first, same policy as every other new model
 * this engagement.
 *
 * `status` enum values match the client's own spec verbatim (OPEN,
 * COLLECTING_DATE, ... FLOW_COMPLETE) since that IS the state-machine
 * contract chatBotEngine.js is built against — CLOSED/CONVERTED are added
 * on top (same as V1) as terminal/lifecycle states, not visited by the
 * conversational flow itself.
 */
const ChatEnquirySchema = new mongoose.Schema(
  {
    enquiryId: { type: String, unique: true, required: true, default: () => generateISTId("CENQ") },

    // Exactly one of these is set — same anon-XOR-customer pattern as
    // ChatSession.
    anonId: { type: String, default: null, index: true },
    customerId: { type: String, ref: "Customer", default: null, index: true },

    // Collected requirements — field-by-field per the client's step flow.
    eventType: { type: String, default: null },
    eventDate: { type: Date, default: null },
    eventDateRaw: { type: String, default: null }, // original user-typed text, preserved even when unparseable
    city: { type: String, default: null },
    venueSetting: { type: String, default: null }, // "At home" | "Outdoor / Outside venue"
    venueHelpNeeded: { type: Boolean, default: null },
    servicesNeeded: { type: [String], default: [] },
    pendingOthersInput: { type: Boolean, default: false },
    otherServiceDetails: { type: String, default: null },
    guestCount: { type: String, default: null },
    budgetOption: { type: String, default: null }, // "Yes" | "No"
    budgetRange: { type: String, default: null },
    customerName: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    bestTimeToCall: { type: String, default: null },

    // Set once the Slack notification for this lead has actually been
    // posted (see chatSlackNotifier.js) — separate from `status` so a
    // Slack-post failure never blocks/loops the conversation itself.
    slackNotifiedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: [
        "OPEN",
        "COLLECTING_DATE",
        "COLLECTING_LOCATION",
        "COLLECTING_VENUE_SETTING",
        "COLLECTING_VENUE_DECISION",
        "COLLECTING_SERVICES",
        "COLLECTING_OTHER_SERVICES_DETAILS",
        "COLLECTING_GUEST_COUNT",
        "COLLECTING_BUDGET_OPTION",
        "COLLECTING_BUDGET_RANGE",
        "STEP_8_HANDOFF",
        "COLLECTING_NAME",
        "COLLECTING_PHONE",
        "COLLECTING_CALL_TIME",
        "FLOW_COMPLETE",
        "CLOSED",
        "CONVERTED",
      ],
      default: "OPEN",
    },
  },
  {
    timestamps: true,
    collection: "customer_chat_enquiries",
  }
);

ChatEnquirySchema.index({ anonId: 1, status: 1 });
ChatEnquirySchema.index({ customerId: 1, status: 1 });

export default mongoose.model("ChatEnquiry", ChatEnquirySchema);
