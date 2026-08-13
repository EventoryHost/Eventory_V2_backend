import PDFDocument from "pdfkit";
import Invoice from "../models/Invoice.js";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Phase 5 Step 24 — Invoice model + PDF generation/download. Two
 * responsibilities, kept in one file since both are small and only ever
 * used together from customerInvoiceController.js (same "one small
 * service file per feature area" pattern as milestonePaymentService.js):
 * getOrCreateInvoiceForBooking (the model side) and renderInvoicePdf (the
 * PDF side).
 */

/**
 * @desc Idempotent — returns the existing Invoice for this Booking if one
 * was already issued (one Invoice per Booking, see Invoice.js's own
 * comment on why), otherwise creates one as a FROZEN SNAPSHOT of the
 * Booking's current charges/amounts. Deliberately does NOT update an
 * existing invoice if the Booking has since received more payments (e.g.
 * a Step 22 milestone payment after this invoice was first issued) — an
 * invoice, once issued, is a fixed record of what it said at the time;
 * re-issuing to reflect new payments would need an explicit "re-issue"
 * action, not built here (not asked for by this step).
 */
export async function getOrCreateInvoiceForBooking(booking, vendor) {
  const existing = await Invoice.findOne({ bookingId: booking._id });
  if (existing) return existing;

  const charges = booking.charges || [];
  const subtotal = charges.filter((c) => c.type === "Base" || c.type === "Fee").reduce((sum, c) => sum + c.amount, 0);
  const taxAmount = charges.filter((c) => c.type === "Tax").reduce((sum, c) => sum + c.amount, 0);
  const discountAmount = charges.filter((c) => c.type === "Discount").reduce((sum, c) => sum + c.amount, 0);

  return Invoice.create({
    invoiceNumber: generateISTId("INV"),
    bookingId: booking._id,
    customerId: booking.customerId,
    vendorId: booking.vendorId,
    customerSnapshot: {
      name: booking.customer?.name || null,
      phone: booking.customer?.phone || null,
      email: booking.customer?.email || null,
    },
    vendorSnapshot: {
      businessName: vendor?.businessName || null,
      city: vendor?.city || null,
    },
    packageSnapshot: {
      name: booking.packageSnapshot?.name || null,
      vendorType: booking.packageSnapshot?.vendorType || null,
    },
    lineItems: charges.map((c) => ({ label: c.label, amount: c.amount, type: c.type })),
    subtotal,
    taxAmount,
    discountAmount,
    totalAmount: booking.totalAmount || 0,
    totalReceivedAtIssue: booking.totalReceived || 0,
    amountDueAtIssue: Math.max(0, (booking.totalAmount || 0) - (booking.totalReceived || 0)),
    eventDate: booking.eventDate || null,
  });
}

/**
 * @desc Renders an Invoice document to a PDF buffer with pdfkit (pure
 * Node.js, no browser dependency — added for this step, see info.txt).
 * Plain, structured layout: header, parties, line items table, totals —
 * deliberately unstyled/simple rather than a fabricated "branded" design
 * nobody specified.
 */
export function renderInvoicePdf(invoice, booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Invoice", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#555").text(`Invoice #: ${invoice.invoiceNumber}`);
    doc.text(`Issued: ${invoice.issuedAt.toDateString()}`);
    doc.text(`Booking ID: ${booking.bookingId}`);
    if (invoice.eventDate) doc.text(`Event Date: ${new Date(invoice.eventDate).toDateString()}`);
    doc.fillColor("#000");
    doc.moveDown();

    doc.fontSize(12).text("Billed to:", { underline: true });
    doc.fontSize(10).text(invoice.customerSnapshot.name || "Customer");
    if (invoice.customerSnapshot.phone) doc.text(invoice.customerSnapshot.phone);
    if (invoice.customerSnapshot.email) doc.text(invoice.customerSnapshot.email);
    doc.moveDown(0.5);

    doc.fontSize(12).text("Vendor:", { underline: true });
    doc.fontSize(10).text(invoice.vendorSnapshot.businessName || "Vendor");
    if (invoice.vendorSnapshot.city) doc.text(invoice.vendorSnapshot.city);
    if (invoice.packageSnapshot.name) doc.text(`Package: ${invoice.packageSnapshot.name}`);
    doc.moveDown();

    // Line items table — simple two-column layout, no external table lib.
    doc.fontSize(12).text("Charges", { underline: true });
    doc.moveDown(0.3);
    const colLabelX = 50;
    const colAmountX = 450;
    doc.fontSize(10);
    (invoice.lineItems || []).forEach((item) => {
      const y = doc.y;
      doc.text(item.label, colLabelX, y, { width: colAmountX - colLabelX - 10 });
      doc.text(`Rs. ${item.amount.toFixed(2)}`, colAmountX, y, { width: 100, align: "right" });
      doc.moveDown(0.2);
    });

    doc.moveDown(0.5);
    doc.moveTo(colLabelX, doc.y).lineTo(545, doc.y).strokeColor("#ccc").stroke();
    doc.moveDown(0.3);

    const totalsRow = (label, value, opts = {}) => {
      const y = doc.y;
      doc.fontSize(opts.bold ? 11 : 10).text(label, colLabelX, y, { width: colAmountX - colLabelX - 10 });
      doc.fontSize(opts.bold ? 11 : 10).text(`Rs. ${value.toFixed(2)}`, colAmountX, y, { width: 100, align: "right" });
      doc.moveDown(0.2);
    };
    totalsRow("Subtotal", invoice.subtotal);
    if (invoice.taxAmount) totalsRow("Tax", invoice.taxAmount);
    if (invoice.discountAmount) totalsRow("Discount", -invoice.discountAmount);
    totalsRow("Total Amount", invoice.totalAmount, { bold: true });
    totalsRow("Received (as of this invoice)", invoice.totalReceivedAtIssue);
    totalsRow("Amount Due (as of this invoice)", invoice.amountDueAtIssue, { bold: true });

    doc.moveDown();
    doc.fontSize(8).fillColor("#888").text(
      "This invoice reflects amounts as of the date it was first issued. It is not automatically updated by later payments — see the booking's own payment timeline for the current status.",
      colLabelX,
      doc.y,
      { width: 495 }
    );

    doc.end();
  });
}

export default { getOrCreateInvoiceForBooking, renderInvoicePdf };
