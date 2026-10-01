import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import { requestContext } from "./middlewares/requestContext.js";
import healthRoutes from "./routes/healthRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";

const app = express();

app.set("trust proxy", env.trustProxyHops);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(requestContext);
app.use(express.json({ limit: "1mb" }));

app.use("/health", healthRoutes);
app.use("/api/uploads", uploadRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
