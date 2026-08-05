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
// origin are both set. FRONTEND_URL covers the deployed frontend; the
// localhost/127.0.0.1/private-LAN-IP allowance mirrors the frontend's own
// dev-detection pattern (src/lib/api.ts) so testing from a phone/another
// device on the same network still works during local development.
const isDevOrigin = (origin) => {
  if (!origin) return true; // same-origin / non-browser tools (curl, Postman)
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
};
app.use(
  cors({
    origin: (origin, callback) => {
      if (origin === process.env.FRONTEND_URL || isDevOrigin(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
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
app.use(express.json({ limit: '50mb' }));
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
