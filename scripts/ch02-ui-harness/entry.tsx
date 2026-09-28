import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { AdminCommunicationsPage } from "@/pages/AdminCommunicationsPage";
import { IndustryDashboardPage } from "@/pages/IndustryDashboardPage";

// The harness serves one bundle: /industry renders the Industry Intelligence page, everything else the Communications console.
const page = window.location.pathname.startsWith("/industry") ? <IndustryDashboardPage /> : <AdminCommunicationsPage />;
createRoot(document.getElementById("root")!).render(<div className="mx-auto max-w-6xl p-6">{page}</div>);
