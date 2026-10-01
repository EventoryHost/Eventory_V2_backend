import rateLimit from "express-rate-limit";

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many upload requests. Please slow down." },
});
