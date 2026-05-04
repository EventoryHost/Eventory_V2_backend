import express from "express";
import cors from "cors";
import morgan from "morgan";
import routes from "./routes/index.js";
import errorHandler from "./middlewares/errorHandler.js";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger.js";
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

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --------------- Error Handling ---------------

app.use(errorHandler);

export default app;
