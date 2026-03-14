const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const routes = require("./routes");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

// --------------- Middleware ---------------

// CORS
app.use(cors());

// Request logging
app.use(morgan("dev"));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --------------- Routes ---------------

app.use("/api", routes);

// --------------- Error Handling ---------------

app.use(errorHandler);

module.exports = app;
