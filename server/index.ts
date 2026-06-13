import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchGtfsStops, fetchRealtimeFeed, fetchShapeForTrip, fetchTransitRouteIds, fetchTripUpdates } from "./atClient.js";
import { extractFerryRouteIds, extractNextStopsByTripId, extractTrainRouteIds, normalizeVehicleFeed, parseRouteIds } from "./normalize.js";

const app = express();
const port = Number(process.env.PORT ?? 5174);
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/debug/feed", async (_req, res) => {
  const subscriptionKey = process.env.AT_SUBSCRIPTION_KEY;
  const realtimeEndpoint = process.env.AT_REALTIME_ENDPOINT;

  if (!subscriptionKey || !realtimeEndpoint) {
    res.status(500).json({ error: "Missing AT_SUBSCRIPTION_KEY or AT_REALTIME_ENDPOINT" });
    return;
  }

  try {
    const feed = await fetchRealtimeFeed({ endpoint: realtimeEndpoint, subscriptionKey });
    const routeCounts = new Map<string, number>();

    for (const entity of feed.entity ?? []) {
      const routeId = entity.vehicle?.trip?.route_id ?? "(none)";
      routeCounts.set(routeId, (routeCounts.get(routeId) ?? 0) + 1);
    }

    const routes = [...routeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([routeId, count]) => ({ routeId, count }));

    res.json({ totalEntities: feed.entity?.length ?? 0, routes });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch feed" });
  }
});

app.get("/api/vehicles", async (_req, res) => {
  const subscriptionKey = process.env.AT_SUBSCRIPTION_KEY;
  const realtimeEndpoint = process.env.AT_REALTIME_ENDPOINT;

  if (!subscriptionKey || !realtimeEndpoint) {
    res.status(500).json({
      error: "Missing AT_SUBSCRIPTION_KEY or AT_REALTIME_ENDPOINT in server environment."
    });
    return;
  }

  if (isBaseApiUrl(realtimeEndpoint)) {
    res.status(500).json({
      error:
        "AT_REALTIME_ENDPOINT must be the full realtime feed URL from the AT developer portal, not just https://api.at.govt.nz/."
    });
    return;
  }

  try {
    const [feed, tripUpdates, stopNames, routeMetadata] = await Promise.all([
      fetchRealtimeFeed({
        endpoint: realtimeEndpoint,
        subscriptionKey
      }),
      fetchTripUpdates({
        endpoint: process.env.AT_TRIP_UPDATES_ENDPOINT ?? "https://api.at.govt.nz/realtime/legacy/tripupdates",
        subscriptionKey
      }).catch((error: unknown) => {
        console.warn(error);
        return { entity: [] };
      }),
      fetchGtfsStops({
        url: process.env.AT_GTFS_ZIP_URL
      }).catch((error: unknown) => {
        console.warn(error);
        return new Map<string, string>();
      }),
      fetchTransitRouteIds({
        endpoint: process.env.AT_GTFS_ROUTES_ENDPOINT,
        subscriptionKey,
        extractTrain: extractTrainRouteIds,
        extractFerry: extractFerryRouteIds
      }).catch((error: unknown) => {
        console.warn(error);
        return { trainRouteIds: new Set<string>(), ferryRouteIds: new Set<string>(), hasRouteMetadata: false };
      })
    ]);

    const nextStopsByTripId = extractNextStopsByTripId(tripUpdates, stopNames);

    const payload = normalizeVehicleFeed(feed, {
      trainRouteIds: routeMetadata.trainRouteIds,
      ferryRouteIds: routeMetadata.ferryRouteIds,
      hasRouteMetadata: routeMetadata.hasRouteMetadata,
      configuredRouteIds: parseRouteIds(process.env.TRAIN_ROUTE_IDS),
      nextStopsByTripId
    });

    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to fetch AT realtime feed."
    });
  }
});

app.get("/api/shape/:tripId", async (req, res) => {
  try {
    const shape = await fetchShapeForTrip({
      url: process.env.AT_GTFS_ZIP_URL,
      tripId: req.params.tripId
    });

    if (!shape) {
      res.status(404).json({ error: "Shape not found for trip" });
      return;
    }

    res.json(shape);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch shape" });
  }
});

app.use(express.static(staticDir));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});

function isBaseApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "api.at.govt.nz" && (url.pathname === "" || url.pathname === "/");
  } catch {
    return false;
  }
}
