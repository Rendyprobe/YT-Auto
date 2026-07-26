import { Dashboard } from "@/components/dashboard";
import { loadDashboardData } from "@/lib/dashboard-data";
import { loadQueue } from "@/lib/queue-store";
import type { QueueData } from "@/lib/queue-store";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const requested = (await searchParams).view;
  const initialView =
    requested === "queue" || requested === "videos" ? requested : "overview";
  let initialQueue: QueueData | null = null;
  if (initialView === "queue") {
    try {
      initialQueue = await loadQueue();
    } catch (error) {
      console.error(
        "Unable to preload queue editor.",
        error instanceof Error ? error.message : "Unknown queue error",
      );
    }
  }
  return (
    <Dashboard
      initialData={loadDashboardData()}
      initialQueue={initialQueue}
      initialView={initialView}
    />
  );
}
