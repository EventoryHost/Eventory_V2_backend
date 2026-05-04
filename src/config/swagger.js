import swaggerJSDoc from "swagger-jsdoc";
import "dotenv/config";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Eventory V2 API Documentation",
      version: "1.0.0",
      description: "API Documentation for Eventory V2 Backend",
    },
    servers: [
      {
        url: process.env.IS_DEV === "true" ? `http://localhost:${process.env.PORT || 5000}` : "https://your-production-url.com", // You can update the production URL later
        description: process.env.IS_DEV === "true" ? "Development server" : "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ["./src/routes/*.js"], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
