/**
 * Generic Zod-schema validation middleware.
 *
 * Unlike the existing hand-rolled validators in src/validators/ (which are
 * plain functions a controller has to remember to call), this runs as
 * Express middleware BEFORE the controller — a route simply can't forget to
 * validate, and invalid input never reaches business logic. It also gives
 * defense-in-depth against mass-assignment: zod's default object parsing
 * strips any key not declared in the schema, so a request body can't smuggle
 * in extra fields the controller wasn't expecting.
 *
 * Usage: router.post("/login", validateRequest(loginSchema), loginOrSignUp);
 */
export const validateRequest = (schema, source = "body") => (req, res, next) => {
  // A request sent with no body and no Content-Type header leaves req.body
  // undefined (nothing in the pipeline parsed it) rather than {} — treat
  // that as "no fields provided" so schemas made of all-optional fields
  // (e.g. refresh-token, which can rely entirely on a cookie) don't fail
  // validation just because the client sent an empty POST.
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

  req[source] = result.data;
  next();
};

export default validateRequest;
