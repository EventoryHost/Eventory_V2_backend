/**
 * Seeds the single redirect document used by the dynamic QR feature.
 *
 *   node seed_redirect.mjs                          # seeds the default WhatsApp link
 *   node seed_redirect.mjs https://example.com      # seeds a custom URL
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./src/config/db.js";
import Redirect from "./src/models/Redirect.js";

const destinationUrl = process.argv[2] || "https://wa.me/918800725840";

const run = async () => {
  try {
    await connectDB();

    const redirect = await Redirect.findByIdAndUpdate(
      "main",
      { destinationUrl },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    console.log("✅ Redirect seeded:", redirect);
  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
};

run();
