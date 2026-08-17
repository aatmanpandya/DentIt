import { useQueries } from "@tanstack/react-query";
import { getProviderSchedule, type Provider, type ProviderScheduleRow } from "@/lib/schedule-api";

/**
 * Fetches every provider's schedule rows for one location, keyed by provider id — used
 * to derive the day/week grid's displayed time range (see computeGridRange in
 * time-grid.ts). Keyed only on (providerId, locationId), not on the date being viewed,
 * so switching days/weeks doesn't refetch: a provider's working hours don't change
 * based on which day you're looking at. Rebuilding the map itself is cheap enough
 * (bounded by clinic staff count) not to need memoising.
 */
export function useProviderSchedules(providers: Provider[], locationId: string): Map<string, ProviderScheduleRow[]> {
  const queries = useQueries({
    queries: providers.map((p) => ({
      queryKey: ["provider-schedule", p.id, locationId],
      queryFn: () => getProviderSchedule(p.id, locationId),
      enabled: Boolean(locationId),
    })),
  });

  const map = new Map<string, ProviderScheduleRow[]>();
  providers.forEach((p, i) => {
    map.set(p.id, queries[i]?.data?.data ?? []);
  });
  return map;
}
