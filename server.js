import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 5000;

// Connect to MongoDB and start server
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `🚀 Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to database:", err.message);
    process.exit(1);
  });
