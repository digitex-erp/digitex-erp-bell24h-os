import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { AdminCommunicationsPage } from "@/pages/AdminCommunicationsPage";

createRoot(document.getElementById("root")!).render(
  <div className="mx-auto max-w-6xl p-6">
    <AdminCommunicationsPage />
  </div>,
);
