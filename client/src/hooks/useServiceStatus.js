import { useEffect, useState } from "react";
import { hostedApi, localApi } from "../api";

const CHECK_INTERVAL_MS = 15000;

async function ping(apiClient, paths) {
  for (const path of paths) {
    try {
      const response = await apiClient.get(path, { timeout: 4000 });
      if (response.status >= 200 && response.status < 500) {
        return true;
      }
    } catch {
      // Try the next probe endpoint.
    }
  }
  return false;
}

export default function useServiceStatus() {
  const [status, setStatus] = useState({
    hostedOnline: null,
    localOnline: null,
    checkedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const check = async () => {
      const [hostedOnline, localOnline] = await Promise.all([
        ping(hostedApi, ["/health", "/api/docs"]).catch(() => false),
        ping(localApi, ["/health"]).catch(() => false),
      ]);
      if (cancelled) return;
      setStatus({
        hostedOnline,
        localOnline,
        checkedAt: new Date().toISOString(),
      });
    };

    check();
    timer = window.setInterval(check, CHECK_INTERVAL_MS);

    const handleNetworkChange = () => check();
    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("online", handleNetworkChange);
      window.removeEventListener("offline", handleNetworkChange);
    };
  }, []);

  return status;
}
