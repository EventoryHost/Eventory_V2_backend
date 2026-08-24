import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import passport from "./config/passport.js";
import routes from "./routes/index.js";
import errorHandler from "./middlewares/errorHandler.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";
const app = express();

// --------------- Middleware ---------------

// Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.).
// contentSecurityPolicy is disabled because Swagger UI (served from this
// same app at /api-docs) needs inline scripts/styles that helmet's default
// CSP blocks; every other API response here is JSON, which CSP doesn't
// meaningfully protect anyway.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — customer auth now relies on httpOnly cookies, which browsers only
// send cross-origin when credentials:true AND a specific (non-wildcard)
// origin are both set. Setting origin: true dynamically reflects the
// requesting origin back in the Access-Control-Allow-Origin header,
// which satisfies the requirement for credentials while allowing all origins.
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Cookies (access/refresh token) — customer auth reads these in
// protectCustomer / refresh-token / logout.
app.use(cookieParser());

// Stateless OAuth (Google/Facebook) — no sessions, see src/config/passport.js.
app.use(passport.initialize());

// Request logging
app.use(morgan("dev"));

// Body parsers
// `verify` captures the exact raw bytes of every JSON request onto
// req.rawBody, IN ADDITION TO normal parsing — added for Phase 4 Step 18's
// Cashfree webhook signature verification, which must HMAC the raw
// payload exactly as Cashfree sent it. Re-serializing the already-parsed
// req.body with JSON.stringify() is NOT safe for this (key order/
// whitespace can differ from the original bytes, silently breaking every
// signature check) — capturing the raw buffer here is the only reliable
// way, and doing it globally is cheap/harmless for every other route that
// never reads req.rawBody.
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --------------- Routes ---------------

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Eventory Backend API is running",
    version: "2.0.0",
    deploymentCheck: "pipeline-smoke-test-2026-05-26",
    docs: "/api-docs"
  });
});

app.use("/api", routes);

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --------------- Error Handling ---------------

app.use(errorHandler);

export default app;
