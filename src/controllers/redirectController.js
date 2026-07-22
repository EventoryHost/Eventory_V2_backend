import Redirect from "../models/Redirect.js";

const MAIN_ID = "main";

/**
 * Basic URL sanity check — only http/https destinations are allowed so a
 * bad update can't turn the printed QR into a javascript:/data: payload.
 */
const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * @desc    Redirect a QR scan to the currently configured destination URL
 * @route   GET /api/redirect
 */
export const handleRedirect = async (req, res) => {
  try {
    const redirect = await Redirect.findById(MAIN_ID).lean();

    if (!redirect || !redirect.destinationUrl) {
      return res.status(404).json({
        status: "FAILED",
        message: "Redirect destination not configured",
      });
    }

    // Never let a scan be served from a cache — the URL can change at any time.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.redirect(302, redirect.destinationUrl);
  } catch (error) {
    console.error("Handle Redirect Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to resolve redirect destination",
      error: error.message,
    });
  }
};

/**
 * @desc    Get the current redirect destination (without redirecting)
 * @route   GET /api/redirect/config
 */
export const getRedirectConfig = async (req, res) => {
  try {
    const redirect = await Redirect.findById(MAIN_ID).lean();

    if (!redirect) {
      return res.status(404).json({
        status: "FAILED",
        message: "Redirect destination not configured",
      });
    }

    return res.status(200).json({
      status: "SUCCESS",
      redirect,
    });
  } catch (error) {
    console.error("Get Redirect Config Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch redirect config",
      error: error.message,
    });
  }
};

/**
 * @desc    Create or update the redirect destination
 * @route   PUT /api/redirect/config
 * @body    { destinationUrl: "https://wa.me/918800725840" }
 */
export const updateRedirectConfig = async (req, res) => {
  try {
    const { destinationUrl } = req.body;

    if (!destinationUrl || typeof destinationUrl !== "string") {
      return res.status(400).json({
        status: "FAILED",
        message: "destinationUrl is required",
      });
    }

    const trimmedUrl = destinationUrl.trim();

    if (!isValidHttpUrl(trimmedUrl)) {
      return res.status(400).json({
        status: "FAILED",
        message: "destinationUrl must be a valid http or https URL",
      });
    }

    const redirect = await Redirect.findByIdAndUpdate(
      MAIN_ID,
      { destinationUrl: trimmedUrl },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Redirect destination updated",
      redirect,
    });
  } catch (error) {
    console.error("Update Redirect Config Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to update redirect destination",
      error: error.message,
    });
  }
};
