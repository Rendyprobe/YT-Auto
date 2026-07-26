import { Dashboard } from "@/components/dashboard";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <Dashboard initialData={loadDashboardData()} />;
}
