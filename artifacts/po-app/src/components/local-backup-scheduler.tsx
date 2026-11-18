import { useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { runDueLocalDownload } from "@/lib/local-backup-download";

/** While BizOne is open, save the latest server backup into the linked Windows folder at the scheduled time. */
export function LocalBackupScheduler() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await runDueLocalDownload();
      } catch {
        // The next check retries. A missing folder grant waits until the user links it.
      }
    };
    void tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user]);

  return null;
}
