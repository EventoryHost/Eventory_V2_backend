import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import dotenv from "dotenv";
import os from "os";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 5000;

// Resolve local network IP for dev convenience logging
const nets = os.networkInterfaces();
const localIp =
  Object.values(nets)
    .flat()
    .find((n) => n?.family === "IPv4" && !n.internal)?.address || "localhost";

// Connect to MongoDB and start server
connectDB()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
      );
      console.log(`📱 Local network: http://${localIp}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to database:", err.message);
    process.exit(1);
  });
