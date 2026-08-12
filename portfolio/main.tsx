import React from "react";
import { createRoot } from "react-dom/client";
import { SharedExpenseDashboard } from "../app/shared-expense-dashboard";
import { LearningDashboard } from "../app/v2/learning-dashboard";
import "../app/globals.css";

const normalizedPath = window.location.pathname.replace(/\/+$/, "");
const isLearningVersion = normalizedPath.endsWith("/v2");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isLearningVersion ? <LearningDashboard /> : <SharedExpenseDashboard />}
  </React.StrictMode>,
);
