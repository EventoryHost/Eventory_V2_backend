import { randomUUID } from "node:crypto";

import { logger } from "../utils/logger.js";

const REQUEST_ID_HEADER = "x-request-id";

export function requestContext(req, res, next) {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.set(REQUEST_ID_HEADER, req.id);

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const fields = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error("request", fields);
    else if (res.statusCode >= 400) logger.warn("request", fields);
    else logger.info("request", fields);
  });

  next();
}
