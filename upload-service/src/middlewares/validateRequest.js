export const validateRequest = (schema, source = "body") => (req, res, next) => {
  const input = source === "body" && req[source] === undefined ? {} : req[source];
  const result = schema.safeParse(input);

  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message,
      })),
    });
  }

  if (source === "query") {
    Object.defineProperty(req, "query", { value: result.data, writable: true, configurable: true });
  } else {
    req[source] = result.data;
  }
  next();
};

export default validateRequest;
