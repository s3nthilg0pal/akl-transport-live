import { useEffect, useState } from "react";
import type { VehicleResponse } from "./types";

const REFRESH_MS = 3_000;

type LiveVehicleState = {
  data: VehicleResponse | null;
  error: string | null;
  loading: boolean;
};

export function useLiveVehicles(): LiveVehicleState {
  const [state, setState] = useState<LiveVehicleState>({
    data: null,
    error: null,
    loading: true
  });

  useEffect(() => {
    let cancelled = false;

    async function loadVehicles() {
      try {
        const response = await fetch("/api/vehicles");
        const payload = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error(payload.error ?? `Request failed with ${response.status}`);
        }

        if (!cancelled) {
          setState({
            data: payload as VehicleResponse,
            error: null,
            loading: false
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to load live train locations.",
            loading: false
          }));
        }
      }
    }

    void loadVehicles();
    const timer = window.setInterval(loadVehicles, REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
