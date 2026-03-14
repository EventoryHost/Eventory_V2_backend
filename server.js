const app = require("./src/app");
const connectDB = require("./src/config/db");

// Load environment variables
require("dotenv").config();

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
