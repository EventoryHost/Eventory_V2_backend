import express from "express";
import { getDashboardKPIs } from "../controllers/adminDashboardController.js";

const router = express.Router();

router.get("/kpis", getDashboardKPIs);

export default router;
