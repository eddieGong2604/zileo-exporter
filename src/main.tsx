import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLogger } from "./lib/logger";
import "./index.css";
import App from "./App.tsx";

createLogger("src/main").info("bootstrap");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
