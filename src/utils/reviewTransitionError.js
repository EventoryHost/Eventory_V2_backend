/**
 * A review decision that is not allowed from the current state (409), or a
 * request that is missing what the decision needs (400). Shared by the package
 * and the vendor review services.
 */
export class ReviewTransitionError extends Error {
  constructor(message, statusCode = 409, details = undefined) {
    super(message);
    this.name = "ReviewTransitionError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export default ReviewTransitionError;
