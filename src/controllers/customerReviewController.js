import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import EventReview from "../models/EventReview.js";
import { bookingLookupQuery } from "./customerBookingController.js";
import { utcDayRange } from "../utils/dateRange.js";

/**
 * Customer "Add a review" — the write side Review.js was waiting on, plus
 * the read the screen needs to know what's already been reviewed.
 *
 * The screen is about one EVENT (every package booked for the same event
 * type on the same day, as My Bookings groups them), opened from any one of
 * its bookings. It collects two kinds of rating:
 *   - event-level (overall, support & coordination) -> EventReview
 *   - one per package                               -> Review
 *
 * ELIGIBILITY: a package can be reviewed once its booking is Completed, or
 * Confirmed with the event date already past — vendors don't reliably flip
 * bookings to Completed, and the customer-side timeline already treats
 * "confirmed and the day has passed" as a finished event. Declined,
 * cancelled and not-yet-accepted bookings can't be reviewed. The event
 * itself can be reviewed once any of its packages can.
 *
 * Reviews are create-only: one per package per customer, one per event per
 * customer (both enforced by unique indexes). There's no edit flow yet.
 */

const REVIEWABLE_AFTER_EVENT = ["Confirmed"];

function isReviewable(booking, now = Date.now()) {
  if (booking.status === "Completed") return true;
  return REVIEWABLE_AFTER_EVENT.includes(booking.status) && new Date(booking.eventDate).getTime() < now;
}

/** "<eventType>|YYYY-MM-DD" — the same grouping key the frontend uses. */
function eventKeyOf(booking) {
  return `${booking.eventType ?? "Event"}|${new Date(booking.eventDate).toISOString().slice(0, 10)}`;
}

/**
 * The anchor booking plus every other booking of the same customer's event.
 * eventType null is treated as its own "Event" bucket, matching the
 * frontend's `eventType ?? "Event"`.
 */
async function loadEventGroup(anchor, customerId) {
  const { start, end } = utcDayRange(anchor.eventDate);
  const eventType = anchor.eventType ?? null;
  return Booking.find({
    customerId,
    eventType: eventType === null ? { $in: [null, "Event"] } : eventType,
    eventDate: { $gte: start, $lt: end },
  })
    .select("bookingId packageId vendorId eventType eventDate status")
    .lean();
}

async function buildReviewState(anchor, group, customerId) {
  const packageIds = [...new Set(group.map((b) => String(b.packageId)))];
  const [packageReviews, eventReview] = await Promise.all([
    Review.find({ customerId, packageId: { $in: packageIds } }).select("packageId bookingId rating comment photos createdAt").lean(),
    EventReview.findOne({ customerId, eventKey: eventKeyOf(anchor) })
      .select("overallRating supportRating overallHighlights supportHighlights createdAt")
      .lean(),
  ]);
  const reviewByPackage = new Map(packageReviews.map((r) => [String(r.packageId), r]));

  const packages = group.map((booking) => {
    const review = reviewByPackage.get(String(booking.packageId));
    return {
      bookingId: booking.bookingId,
      packageId: String(booking.packageId),
      reviewable: isReviewable(booking),
      // A review of this package — possibly written against an earlier
      // booking of it, since the limit is one per package per customer.
      review: review
        ? {
            rating: review.rating,
            comment: review.comment ?? "",
            photos: review.photos ?? [],
            bookingId: review.bookingId,
            createdAt: review.createdAt,
          }
        : null,
    };
  });

  return {
    eventKey: eventKeyOf(anchor),
    canReviewEvent: group.some((booking) => isReviewable(booking)),
    eventReview: eventReview
      ? {
          overallRating: eventReview.overallRating,
          supportRating: eventReview.supportRating,
          overallHighlights: eventReview.overallHighlights ?? [],
          supportHighlights: eventReview.supportHighlights ?? [],
          createdAt: eventReview.createdAt,
        }
      : null,
    packages,
  };
}

async function loadAnchor(req, res) {
  const customerId = String(req.customer._id);
  const query = bookingLookupQuery(req.params.bookingId, customerId);
  if (!query) {
    res.status(400).json({ status: "FAILED", message: "Invalid bookingId" });
    return null;
  }
  const anchor = await Booking.findOne(query).select("bookingId eventType eventDate").lean();
  if (!anchor) {
    res.status(404).json({ status: "FAILED", message: "Booking not found" });
    return null;
  }
  return { anchor, customerId };
}

/**
 * @desc What the customer has already reviewed for this booking's event,
 * and what they still can.
 */
export const getBookingReview = async (req, res) => {
  try {
    const loaded = await loadAnchor(req, res);
    if (!loaded) return;
    const { anchor, customerId } = loaded;

    const group = await loadEventGroup(anchor, customerId);
    const state = await buildReviewState(anchor, group, customerId);
    return res.status(200).json({ status: "SUCCESS", ...state });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to load reviews", error: error.message });
  }
};

/**
 * @desc Submit the "Add a review" screen: optional event-level ratings and
 * any number of package ratings, all for the event of :bookingId. All or
 * nothing on validation — any package outside the event, not reviewable
 * yet, or already reviewed fails the whole request before anything is
 * written.
 */
export const submitBookingReview = async (req, res) => {
  try {
    const loaded = await loadAnchor(req, res);
    if (!loaded) return;
    const { anchor, customerId } = loaded;
    const { event, packages } = req.body;

    const group = await loadEventGroup(anchor, customerId);
    const bookingById = new Map(group.map((b) => [b.bookingId, b]));
    const state = await buildReviewState(anchor, group, customerId);
    const stateByBooking = new Map(state.packages.map((p) => [p.bookingId, p]));

    for (const item of packages) {
      const booking = bookingById.get(item.bookingId);
      if (!booking) {
        return res.status(400).json({
          status: "FAILED",
          message: `Booking ${item.bookingId} isn't part of this event`,
        });
      }
      const current = stateByBooking.get(item.bookingId);
      if (!current.reviewable) {
        return res.status(409).json({
          status: "FAILED",
          message: `Booking ${item.bookingId} can't be reviewed until the event is complete`,
        });
      }
      if (current.review) {
        return res.status(409).json({
          status: "FAILED",
          message: `You've already reviewed the package on booking ${item.bookingId}`,
        });
      }
    }

    // Two bookings of the same package in one event collapse to one review.
    const seenPackages = new Set();
    for (const item of packages) {
      const packageId = String(bookingById.get(item.bookingId).packageId);
      if (seenPackages.has(packageId)) {
        return res.status(409).json({
          status: "FAILED",
          message: "The same package appears twice — rate it once",
        });
      }
      seenPackages.add(packageId);
    }

    if (event) {
      if (!state.canReviewEvent) {
        return res.status(409).json({ status: "FAILED", message: "This event can't be reviewed until it's complete" });
      }
      if (state.eventReview) {
        return res.status(409).json({ status: "FAILED", message: "You've already reviewed this event" });
      }
    }

    if (event) {
      await EventReview.create({
        customerId,
        eventKey: state.eventKey,
        eventType: anchor.eventType ?? null,
        eventDate: anchor.eventDate,
        bookingId: anchor.bookingId,
        bookingIds: group.map((b) => b.bookingId),
        overallRating: event.overallRating ?? null,
        supportRating: event.supportRating ?? null,
        overallHighlights: event.overallHighlights ?? [],
        supportHighlights: event.supportHighlights ?? [],
      });
    }

    if (packages.length) {
      await Review.insertMany(
        packages.map((item) => {
          const booking = bookingById.get(item.bookingId);
          return {
            customerId,
            // As stored on the booking — Review.vendorId reads already accept
            // either the "VEN..." business id or a stringified _id.
            vendorId: String(booking.vendorId),
            packageId: String(booking.packageId),
            bookingId: booking.bookingId,
            rating: item.rating,
            comment: item.comment,
            photos: item.photos,
          };
        })
      );
    }

    const next = await buildReviewState(anchor, group, customerId);
    return res.status(201).json({ status: "SUCCESS", message: "Thanks for your review", ...next });
  } catch (error) {
    // A double submit racing past the checks above lands on a unique index.
    if (error?.code === 11000) {
      return res.status(409).json({ status: "FAILED", message: "You've already reviewed this" });
    }
    return res.status(500).json({ status: "ERROR", message: "Failed to submit review", error: error.message });
  }
};
