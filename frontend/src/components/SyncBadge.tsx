import { useCallback, useState } from "react";
import { getSyncStatus, syncNow } from "../api/client.js";
import { useFetch } from "../hooks/useFetch.js";

/**
 * Header indicator for the sync engine: signed-out / idle / syncing / error,
 * with a rough pending count. Renders nothing when the backend runs without
 * sync wiring. Clicking it kicks a sync now.
 */
export function SyncBadge() {
  const [tick, setTick] = useState(0);
  const load = useCallback(() => getSyncStatus(), [tick]);
  const { data: status } = useFetch(load, [tick]);

  if (!status) return null;

  const label =
    status.state === "signed-out"
      ? "local only"
      : status.state === "syncing"
        ? "syncing…"
        : status.state === "error"
          ? "sync error"
          : status.pending > 0
            ? `${status.pending} pending`
            : "synced";

  return (
    <button
      className={`sync-badge sync-badge--${status.state}`}
      title={
        status.lastError ??
        (status.lastSyncAt ? `Last sync ${new Date(status.lastSyncAt).toLocaleString()}` : "Sync now")
      }
      disabled={status.state === "syncing"}
      onClick={async () => {
        try {
          await syncNow();
        } catch {
          /* the badge re-polls and shows the error state */
        }
        setTick((t) => t + 1);
      }}
    >
      {label}
    </button>
  );
}
