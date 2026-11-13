"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { useToast } from "./toast";

/**
 * One place that tells the user when a screen's data failed to load.
 *
 * Sixteen screens used `data ?? []` with no error branch, so a dropped connection or a server
 * error looked exactly like "nothing here" — an empty schedule, no patients, a ₹0.00 balance
 * (docs/bug-log.md entry 35). Rather than an error branch per screen, every failed query raises
 * this toast, including screens added later. 404s are left to the screen (it knows what was
 * missing) and 401s to the auth flow.
 */
export function QueryErrorToasts() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const error = event.action.error;
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) return;
      showToast({
        message: error instanceof ApiError && error.status === 403 ? error.message : "Some data couldn't be loaded.",
        action: {
          label: "Retry",
          onClick: () => void queryClient.refetchQueries({ predicate: (q) => q.state.status === "error" }),
        },
      });
    });
  }, [queryClient, showToast]);

  return null;
}
