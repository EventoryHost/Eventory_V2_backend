import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
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

// CORS
app.use(cors());

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
