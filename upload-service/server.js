import app from "./src/app.js";
import { env } from "./src/config/env.js";
import { logger } from "./src/utils/logger.js";

const server = app.listen(env.port, "0.0.0.0", () => {
  logger.info("upload-service started", { port: env.port, bucket: env.bucket });
});

function shutdown(signal) {
  logger.info("upload-service stopping", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", { error: String(reason), stack: reason?.stack });
});
