import { VENDOR_STEPS, VENDOR_GROUPS } from "../constants/vendorSteps.js";
import { effectiveVerification } from "./vendorVerificationLegacy.js";
import { isStepEditable } from "./vendorVerificationStatus.js";

const toPlain = (vendor) =>
  vendor && typeof vendor.toObject === "function" ? vendor.toObject() : vendor || {};

const tally = (steps) => {
  const counted = steps.filter((s) => s.counted);
  const done = counted.filter((s) => s.filled && s.status !== "Rejected").length;
  const total = counted.length;
  return { percent: total ? Math.round((100 * done) / total) : 100, done, total };
};

/**
 * How complete a vendor profile is, as the vendor app and the admin panel both
 * show it — overall and per review group.
 *
 * A counted step is done when it is filled in AND an admin has not marked it
 * Not correct — so flagging a step lowers the percentage until the vendor
 * fixes it. Computed on read; `verification.completionPercent` is only a
 * denormalised copy for filtering.
 *
 * `groups.<g>.reinitiate` tells the app the group was rejected and its flow
 * restarts from the first step. `steps[].editable` is whether the vendor may
 * change that step now (see isStepEditable).
 */
export function computeCompletion(vendor) {
  const v = toPlain(vendor);
  const verification = effectiveVerification(v);
  const reviews = verification.steps || {};

  const steps = VENDOR_STEPS.map((s) => {
    const review = reviews[s.key] || {};
    return {
      key: s.key,
      label: s.label,
      group: s.group,
      section: s.section,
      counted: s.counted,
      filled: Boolean(s.isFilled(v)),
      status: review.status || "Pending",
      note: review.note || null,
      previousNote: review.previousNote || null,
      reviewedAt: review.reviewedAt || null,
      vendorEditedAt: review.vendorEditedAt || null,
      editable: isStepEditable(verification, s.key),
    };
  });

  const groups = Object.fromEntries(
    VENDOR_GROUPS.map((g) => {
      const decision = verification.groups?.[g] || {};
      const status = decision.status || "Pending";
      return [
        g,
        {
          status,
          finalNote: decision.finalNote || null,
          reinitiate: status === "Rejected",
          ...tally(steps.filter((s) => s.group === g)),
        },
      ];
    })
  );

  return {
    ...tally(steps),
    status: verification.status || "Pending",
    finalNote: verification.finalNote || null,
    hasPendingEdits: Boolean(verification.hasPendingEdits),
    groups,
    steps,
    flagged: steps.filter((s) => s.status === "Rejected"),
  };
}

/** The per-row summary the admin review queue carries. */
export const completionSummary = (vendor) => {
  const c = computeCompletion(vendor);
  return { percent: c.percent, flaggedCount: c.flagged.length };
};

export default computeCompletion;
