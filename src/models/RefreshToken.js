import mongoose from "mongoose";

/**
 * Refresh token store — a MongoDB stand-in for the Redis-backed refresh
 * token store called for in the Login/Signup spec. Same behavior (opaque
 * token, rotated on every use, revocable, TTL-expired), just backed by the
 * database this project already runs instead of standing up a new Redis
 * service for local development. Swappable for a real Redis store later
 * without changing any calling code, since everything goes through
 * src/utils/tokenService.js.
 *
 * The raw token is never stored — only its SHA-256 hash — so a database
 * read/leak alone can't be used to impersonate a customer.
 */
const RefreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    // Rotation chain: when a token is used, it's marked revoked and this
    // points at whatever token replaced it — useful for detecting reuse of
    // an already-rotated token (a strong signal of theft).
    revoked: { type: Boolean, default: false },
    replacedByTokenHash: { type: String, default: null },
    createdByIp: { type: String, default: null },
    userAgent: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index — MongoDB automatically deletes the document once expiresAt has
// passed, so expired refresh tokens don't need a manual cleanup job.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("RefreshToken", RefreshTokenSchema);
