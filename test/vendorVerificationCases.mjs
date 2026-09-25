/**
 * Vendor step verification — end-to-end cases against a live server.
 *
 * Shared by e2e-full-suite.mjs and the standalone e2e-vendor-verification.mjs.
 * Creates its own throwaway vendors and returns their ids for cleanup; it
 * needs no pre-existing data.
 */
export async function runVendorVerificationCases({ call, section, suffix }) {

  // A throwaway vendor with every counted step filled in, so completion
  // starts at 100% and every drop below is caused by the review.
  const stepVendorId = `VENE2E${suffix}`;
  const stepVendorBody = {
    id: stepVendorId,
    phone: `+9190${String(suffix).slice(-8)}`,
    businessName: "E2E Step Review Caterers",
    isIndividual: false,
    pocName: "E2E Reviewer",
    email: `e2e.vendor.${suffix}@example.com`,
    teamSize: "5",
    bookingsPerYear: "20",
    experience: "3",
    vendorType: "Caterer",
    eventCategories: ["Wedding"],
    serviceAreas: ["Delhi"],
    profilePicture: "https://example.com/p.jpg",
    description: "E2E test vendor",
    businessPhotos: ["https://example.com/1.jpg"],
    isAgreementAccepted: true,
    aadharNumber: "123412341234",
    isAadharVerified: true,
    panNumber: "ABCDE1234F",
    isPanVerified: true,
    gstNumber: "07AABCA1906H1Z4",
    isGstVerified: true,
    bankDetails: [{ accountNumber: "123456789012", ifscCode: "HDFC0001234", beneficiaryName: "E2E" }],
    // Server-owned — must be ignored on create.
    isVerified: true,
  };

  await call({
    method: "post", path: "/vendors", body: stepVendorBody,
    description: "Create a fully filled test vendor; isVerified in the body is ignored",
    expect: (s, b) => s === 201 && b.data?.isVerified === false && b.data?.verification?.status === "Pending",
  });

  await call({
    method: "get", path: `/vendors/${stepVendorId}`,
    description: "Vendor GET carries profileCompletion (100% for a filled, unreviewed profile)",
    expect: (s, b) => s === 200 && b.data?.profileCompletion?.percent === 100 && b.data.profileCompletion.total === 14,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/review-step`,
    body: { stepKey: "pan", status: "Rejected", note: "   ", reviewedBy: "E2E Admin" },
    description: "review-step: Not correct without a note -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/review-step`,
    body: { stepKey: "notAStep", status: "Approved" },
    description: "review-step: unknown stepKey -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/request-changes`,
    body: { finalNote: "Please fix", reviewedBy: "E2E Admin" },
    description: "request-changes with no step marked Not correct -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/review-step`,
    body: { stepKey: "pan", status: "Rejected", note: "Name on PAN does not match", reviewedBy: "E2E Admin" },
    description: "review-step: mark PAN Not correct with a note; completion drops, status unchanged",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.steps?.pan?.status === "Rejected" &&
      b.data.verification.status === "Pending" &&
      b.profileCompletion?.percent === 93 &&
      b.profileCompletion.flagged?.length === 1,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/verify`,
    body: { reviewedBy: "E2E Admin" },
    description: "verify while a step is Not correct -> 409",
    expect: (s) => s === 409,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/request-changes`,
    body: { finalNote: "", reviewedBy: "E2E Admin" },
    description: "request-changes without a final note -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/request-changes`,
    body: { finalNote: "Please re-upload your PAN", reviewedBy: "E2E Admin" },
    description: "legacy request-changes with a final note sends back the group with the flagged step",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.status === "Changes Requested" &&
      b.data.verification.groups?.personalDocuments?.status === "Changes Requested" &&
      b.data.verification.groups?.personalDocuments?.finalNote === "Please re-upload your PAN" &&
      b.data.verification.groups?.businessProfile?.status === "Pending",
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: { isVerified: true, "verification.status": "Verified", adminReview: {} },
    description: "Vendor PATCH of server-owned fields (isVerified, verification.*) is ignored",
    expect: (s, b) => s === 200 && b.data?.isVerified === false && b.data?.verification?.status === "Changes Requested",
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: { gstNumber: "06AABCA1906H1Z6" },
    description: "While Personal Documents is sent back, a step not marked Not correct is locked (ignoredFields)",
    expect: (s, b) =>
      s === 200 &&
      Array.isArray(b.ignoredFields) && b.ignoredFields.includes("gstNumber") &&
      b.data?.gstNumber === "07AABCA1906H1Z4" &&
      b.data.profileCompletion?.steps?.find((st) => st.key === "gst")?.editable === false,
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: { panNumber: "ABCDE1234G" },
    description: "Vendor fixes the flagged step: it resets to Pending and the profile auto-resubmits",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.status === "Pending" &&
      b.data.verification.steps?.pan?.status === "Pending" &&
      b.data.verification.steps.pan.previousNote === "Name on PAN does not match" &&
      b.data.verification.submission?.count === 1 &&
      b.data.verification.hasPendingEdits === true &&
      b.profileCompletion?.percent === 100,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/edit-step/aadhaar`,
    body: { fields: { aadharNumber: "12345" }, reviewedBy: "E2E Admin" },
    description: "edit-step: invalid Aadhaar -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/edit-step/bankDetails`,
    body: { fields: { bankDetails: { accountNumber: "999988887777", ifscCode: "SBIN0001234", beneficiaryName: "E2E Two" } }, markCorrect: true, reviewedBy: "E2E Admin" },
    description: "edit-step: admin adds a bank account and marks the step correct",
    expect: (s, b) => s === 200 && b.data?.bankDetails?.length === 2 && b.data.verification?.steps?.bankDetails?.status === "Approved",
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/verify`,
    body: { reviewedBy: "E2E Admin" },
    description: "legacy verify: approves both groups; status Verified, isVerified on",
    expect: (s, b) => s === 200 && b.data?.verification?.status === "Verified" && b.data.isVerified === true && b.data.verification.hasPendingEdits === false,
  });

  await call({
    method: "get", path: `/admin/vendors/${stepVendorId}/verification-history`,
    description: "verification-history lists events newest first",
    expect: (s, b) => s === 200 && Array.isArray(b.data) && b.data[0]?.event === "Verified",
  });

  await call({
    method: "get", path: `/admin/vendors/review-queue?filter=verified&search=${encodeURIComponent(stepVendorId)}`,
    description: "review-queue filter=verified finds the verified test vendor with a completion summary",
    expect: (s, b) => s === 200 && b.data?.[0]?.id === stepVendorId && b.data[0].profileCompletion?.percent === 100,
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: { description: "E2E test vendor, now with more detail" },
    description: "A verified vendor edits a step: Needs Action, still isVerified, the step's group back to Pending",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.status === "Needs Action" &&
      b.data.isVerified === true &&
      b.profileCompletion?.groups?.businessProfile?.status === "Pending" &&
      b.profileCompletion.groups.personalDocuments?.status === "Approved",
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/notAGroup/approve`,
    body: { reviewedBy: "E2E Admin" },
    description: "group decision with an unknown group -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/businessProfile/approve`,
    body: { reviewedBy: "E2E Admin" },
    description: "Approving the edited group returns the vendor to Verified",
    expect: (s, b) => s === 200 && b.data?.verification?.status === "Verified",
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/businessProfile/reject`,
    body: { reviewedBy: "E2E Admin" },
    description: "group reject without a final note -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/businessProfile/reject`,
    body: { finalNote: "Business photos are stock images", reviewedBy: "E2E Admin" },
    description: "group reject: every step in the group Not correct, reinitiate, account stays active",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.status === "Rejected" &&
      b.data.isVerified === false &&
      b.data.isDeactivated === false &&
      b.data.verification.steps?.businessName?.status === "Rejected" &&
      b.data.verification.steps?.pan?.status === "Approved" &&
      b.profileCompletion?.groups?.businessProfile?.reinitiate === true,
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: { businessName: stepVendorBody.businessName },
    description: "Redoing a rejected group: re-saving one step resets it, the group stays Rejected",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.steps?.businessName?.status === "Pending" &&
      b.data.verification.steps.businessName.previousNote === "Business photos are stock images" &&
      b.profileCompletion?.groups?.businessProfile?.status === "Rejected",
  });

  await call({
    method: "patch", path: `/vendors/${stepVendorId}`,
    body: {
      pocName: stepVendorBody.pocName,
      email: stepVendorBody.email,
      teamSize: "6",
      bookingsPerYear: stepVendorBody.bookingsPerYear,
      experience: stepVendorBody.experience,
      vendorType: stepVendorBody.vendorType,
      eventCategories: stepVendorBody.eventCategories,
      serviceAreas: stepVendorBody.serviceAreas,
      profilePicture: stepVendorBody.profilePicture,
      description: "Redone description",
      businessPhotos: ["https://example.com/2.jpg"],
      isAgreementAccepted: true,
    },
    description: "Finishing the redo of every rejected step resubmits the group (Pending)",
    expect: (s, b) =>
      s === 200 &&
      b.profileCompletion?.groups?.businessProfile?.status === "Pending" &&
      b.profileCompletion.groups.businessProfile.reinitiate === false &&
      b.data?.verification?.status === "Pending" &&
      b.profileCompletion.flagged?.length === 0,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/review-step`,
    body: { stepKey: "aboutBrand", status: "Rejected", note: "Mention your cuisines", reviewedBy: "E2E Admin" },
    description: "review-step: flag About the Brand",
    expect: (s) => s === 200,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/businessProfile/request-changes`,
    body: { finalNote: "One small fix", reviewedBy: "E2E Admin" },
    description: "group request-changes on Business Profile",
    expect: (s, b) =>
      s === 200 &&
      b.data?.verification?.status === "Changes Requested" &&
      b.profileCompletion?.groups?.businessProfile?.finalNote === "One small fix" &&
      b.profileCompletion.steps?.find((st) => st.key === "aboutBrand")?.editable === true &&
      b.profileCompletion.steps?.find((st) => st.key === "businessName")?.editable === false,
  });

  await call({
    method: "put", path: `/admin/vendors/${stepVendorId}/groups/personalDocuments/request-changes`,
    body: { finalNote: "x", reviewedBy: "E2E Admin" },
    description: "group request-changes with no flagged step in that group -> 400",
    expect: (s) => s === 400,
  });

  await call({
    method: "get", path: "/admin/vendors/search-suggestions?q=E2E%20Step&limit=50",
    description: "search-suggestions matches by name and returns the compact shape",
    expect: (s, b) =>
      s === 200 &&
      Array.isArray(b.data) && b.data.length <= 20 &&
      b.data.some((v) => v.id === stepVendorId && v.verificationStatus === "Changes Requested" && v.completionPercent === 93),
  });

  await call({
    method: "get", path: "/admin/vendors/search-suggestions?q=E",
    description: "search-suggestions with a 1-character query returns an empty list",
    expect: (s, b) => s === 200 && Array.isArray(b.data) && b.data.length === 0,
  });

  await call({
    method: "get", path: `/admin/vendors/review-queue?search=${encodeURIComponent("+91(")}`,
    description: "review-queue search with regex metacharacters does not 500",
    expect: (s, b) => s === 200 && Array.isArray(b.data),
  });

  await call({
    method: "get", path: `/admin/vendors/all?search=${encodeURIComponent("+91(")}`,
    description: "vendor library search with regex metacharacters does not 500",
    expect: (s) => s === 200,
  });

  await call({
    method: "get", path: "/admin/vendors/review-queue/count",
    description: "review-queue/count returns byStatus and byFilter (incl. needs_action)",
    expect: (s, b) =>
      s === 200 && typeof b.count === "number" && b.byStatus && b.byFilter &&
      typeof b.byFilter.all === "number" && typeof b.byFilter.needs_action === "number",
  });

  // A GST-skipped individual (no team size) is still 100% complete.
  const skipVendorId = `VENE2ESKIP${suffix}`;
  await call({
    method: "post", path: "/vendors",
    body: { ...stepVendorBody, id: skipVendorId, phone: `+9191${String(suffix).slice(-8)}`, isIndividual: true, teamSize: undefined, gstNumber: undefined, isGstVerified: false, isGstSkipped: true },
    description: "Create a GST-skipped individual test vendor",
    expect: (s) => s === 201,
  });
  await call({
    method: "get", path: `/vendors/${skipVendorId}`,
    description: "Completion is 100% for an individual (no teamSize) who skipped GST",
    expect: (s, b) => s === 200 && b.data?.profileCompletion?.percent === 100,
  });

  return [stepVendorId, skipVendorId];
}
