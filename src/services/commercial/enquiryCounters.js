import mongoose from "mongoose";
import { round2 } from "../../utils/money.js";

/**
 * Vendor behaviour counters from quote requests (PRD §5.1: QUOTE_REQUESTED /
 * CUSTOMISATION_REQUESTED count as qualified leads). Same pattern as
 * bookingCounters.js, registered on EnquirySchema:
 *
 *   created                            qualifiedLeads +1, vendorActionRequired +1
 *   pre-proposal -> ProposalSent       acceptedLeads +1, response
 *   pre-proposal -> Declined           rejectedLeads +1, response
 *   -> Converted                       bookings +1
 *
 * A converted enquiry's booking carries no checkout snapshot, so it is not
 * counted a second time by bookingCounters.
 */

const PRE_PROPOSAL = ["NewEnquiry", "Viewed", "InDiscussion", "AwaitingResponse"];

const minutesBetween = (from, to) =>
  from && to ? Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60000) : null;

function vendorFilter(vendorId) {
  const id = String(vendorId);
  return mongoose.Types.ObjectId.isValid(id) ? { $or: [{ _id: id }, { id }] } : { id };
}

function response(inc, doc, at) {
  const mins = minutesBetween(doc.createdAt, at || new Date());
  if (mins == null) return;
  inc["commercial.counters.responseCount"] = 1;
  inc["commercial.counters.responseTimeTotalMinutes"] = round2(mins);
}

function counterUpdate(doc, from, isNew) {
  if (isNew) {
    return { "commercial.counters.qualifiedLeadsCount": 1, "commercial.counters.vendorActionRequiredCount": 1 };
  }
  const inc = {};
  if (doc.status === "ProposalSent" && PRE_PROPOSAL.includes(from)) {
    inc["commercial.counters.acceptedLeadsCount"] = 1;
    response(inc, doc, doc.proposalSentAt);
  } else if (doc.status === "Declined" && PRE_PROPOSAL.includes(from)) {
    inc["commercial.counters.rejectedLeadsCount"] = 1;
    response(inc, doc, doc.declinedAt);
  } else if (doc.status === "Converted") {
    inc["commercial.counters.bookingsCount"] = 1;
  }
  return inc;
}

export function registerEnquiryCounterHooks(schema) {
  schema.post("init", function rememberStatus() {
    this.$locals.statusAtLoad = this.status;
  });

  schema.pre("save", function markTransition() {
    this.$locals.counterIsNew = this.isNew;
    this.$locals.counterFrom = this.isNew ? null : this.$locals.statusAtLoad;
    this.$locals.counterChanged = this.isNew || this.isModified("status");
  });

  schema.post("save", async function updateCounters(doc) {
    if (!doc.$locals.counterChanged || !doc.vendorId) return;
    const isNew = doc.$locals.counterIsNew;
    const from = doc.$locals.counterFrom;
    if (!isNew && from === doc.status) return;
    const inc = counterUpdate(doc, from, isNew);
    if (Object.keys(inc).length) {
      try {
        await mongoose.model("Vendor").updateOne(vendorFilter(doc.vendorId), { $inc: inc });
      } catch (err) {
        console.error(`[enquiryCounters] vendor counters not updated for enquiry ${doc.enquiryId}:`, err.message);
      }
    }
    doc.$locals.statusAtLoad = doc.status;
  });
}
