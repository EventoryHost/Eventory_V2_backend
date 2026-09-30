import { z } from "zod";

const rating = z.number().int().min(1).max(5);

// Package photos: real uploaded https URLs only. z.string().url() on its own
// accepts a "data:image/...;base64,..." string (see customerCartValidators.js's
// noteAttachments for where that was caught), so the scheme is checked too.
const photos = z
  .array(
    z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((url) => url.startsWith("https://"), "Photos must be an uploaded https URL, not a data URI")
  )
  .max(5)
  .default([]);

// "What made it exceptional?" chips under an event question.
const highlights = z
  .array(z.string().trim().min(1).max(60))
  .max(10)
  .refine((items) => new Set(items).size === items.length, { message: "Each highlight can only be picked once" })
  .optional();

// POST /api/customer/bookings/:bookingId/review — the "Add a review" screen.
// Both halves are optional (the design lets a customer skip anything they
// can't fairly judge), but the request has to rate at least one thing.
export const submitReviewSchema = z
  .object({
    event: z
      .object({
        overallRating: rating.optional(),
        supportRating: rating.optional(),
        overallHighlights: highlights,
        supportHighlights: highlights,
      })
      .refine((event) => event.overallRating != null || event.supportRating != null, {
        message: "Rate at least one event question, or leave out `event`",
      })
      .refine((event) => !event.overallHighlights?.length || event.overallRating != null, {
        message: "overallHighlights need an overallRating",
      })
      .refine((event) => !event.supportHighlights?.length || event.supportRating != null, {
        message: "supportHighlights need a supportRating",
      })
      .optional(),
    // One entry per package, keyed by that package's booking (a Booking row
    // is one vendor's package — Booking.packageId).
    packages: z
      .array(
        z.object({
          bookingId: z.string().trim().min(1).max(64),
          rating,
          comment: z.string().trim().max(2000).default(""),
          photos,
        })
      )
      .max(50)
      .refine((items) => new Set(items.map((item) => item.bookingId)).size === items.length, {
        message: "Each package can only be rated once per request",
      })
      .default([]),
  })
  .refine((body) => body.event || body.packages.length > 0, {
    message: "Nothing to submit — rate the event or at least one package",
  });
