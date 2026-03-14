const express = require("express");
const router = express.Router();

// Health check
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount feature routes below
// Example: router.use("/users", require("./userRoutes"));

module.exports = router;
