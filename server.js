import http from "http";
import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import { initSocket } from "./src/config/socket.js";
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

// Wrap the Express app in a raw http.Server so socket.io can share the same
// port — added for the Anonymous Chat feature (real-time bot replies).
// app.set("io", io) makes it reachable from any controller via
// req.app.get("io"), without threading it through route-factory functions.
const httpServer = http.createServer(app);
const io = initSocket(httpServer);
app.set("io", io);

// Connect to MongoDB and start server
connectDB()
  .then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
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
