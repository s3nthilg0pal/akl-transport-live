import JSZip from "jszip";
import type {
  GtfsRealtimeFeed,
  GtfsRealtimeTripUpdatesFeed,
  JsonApiRoutesResponse,
  LegacyTripUpdatesResponse,
  LegacyVehicleLocationsResponse
} from "./types.js";

const ROUTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GTFS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GTFS_ZIP_URL = "https://gtfs.at.govt.nz/gtfs.zip";

type RouteCache = {
  expiresAt: number;
  routeIds: Set<string>;
  hasRouteMetadata: boolean;
};

let routeCache: RouteCache | null = null;
let stopCache: {
  expiresAt: number;
  stops: Map<string, string>;
  stopCoords: Map<string, [number, number]>;
  shapesByTripId: Map<string, [number, number][]>;
  stopsByTripId: Map<string, string[]>;
} | null = null;

export async function fetchRealtimeFeed(config: {
  endpoint: string;
  subscriptionKey: string;
}): Promise<GtfsRealtimeFeed> {
  const response = await fetch(config.endpoint, {
    headers: {
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`AT realtime request failed with ${response.status} ${response.statusText}`);
  }

  return unwrapRealtimeFeed((await response.json()) as GtfsRealtimeFeed | LegacyVehicleLocationsResponse);
}

export async function fetchTripUpdates(config: {
  endpoint: string;
  subscriptionKey: string;
}): Promise<GtfsRealtimeTripUpdatesFeed> {
  const response = await fetch(config.endpoint, {
    headers: {
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`AT trip updates request failed with ${response.status} ${response.statusText}`);
  }

  return unwrapTripUpdatesFeed((await response.json()) as GtfsRealtimeTripUpdatesFeed | LegacyTripUpdatesResponse);
}

export async function fetchTrainRouteIds(config: {
  endpoint?: string;
  subscriptionKey: string;
  extract: (routes: JsonApiRoutesResponse) => Set<string>;
}): Promise<{ routeIds: Set<string>; hasRouteMetadata: boolean }> {
  if (!config.endpoint) {
    return { routeIds: new Set(), hasRouteMetadata: false };
  }

  const now = Date.now();

  if (routeCache && routeCache.expiresAt > now) {
    return {
      routeIds: routeCache.routeIds,
      hasRouteMetadata: routeCache.hasRouteMetadata
    };
  }

  const response = await fetch(config.endpoint, {
    headers: {
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`AT GTFS routes request failed with ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as JsonApiRoutesResponse;
  const routeIds = config.extract(json);
  routeCache = {
    expiresAt: now + ROUTE_CACHE_TTL_MS,
    routeIds,
    hasRouteMetadata: true
  };

  return { routeIds, hasRouteMetadata: true };
}

export async function fetchGtfsStops(config: {
  url?: string;
  subscriptionKey?: string;
} = {}): Promise<Map<string, string>> {
  const now = Date.now();

  if (stopCache && stopCache.expiresAt > now) {
    return stopCache.stops;
  }

  const url = config.url ?? DEFAULT_GTFS_ZIP_URL;
  const response = await fetch(url, {
    headers: config.subscriptionKey
      ? {
          "Ocp-Apim-Subscription-Key": config.subscriptionKey
        }
      : undefined
  });

  if (!response.ok) {
    throw new Error(`AT GTFS zip request failed with ${response.status} ${response.statusText}`);
  }

  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const stopsFile = zip.file("stops.txt");

  if (!stopsFile) {
    throw new Error("AT GTFS zip did not contain stops.txt");
  }

  const [stopsCsv, tripsCsv, shapesCsv, stopTimesCsv] = await Promise.all([
    stopsFile.async("text"),
    zip.file("trips.txt")?.async("text") ?? Promise.resolve(null),
    zip.file("shapes.txt")?.async("text") ?? Promise.resolve(null),
    zip.file("stop_times.txt")?.async("text") ?? Promise.resolve(null)
  ]);

  const stops = parseStopsCsv(stopsCsv);
  const stopCoords = parseStopCoordsCsv(stopsCsv);
  const tripShapeIds = tripsCsv ? parseTripShapesCsv(tripsCsv) : new Map<string, string>();
  const shapesById = shapesCsv ? parseShapesCsv(shapesCsv) : new Map<string, [number, number][]>();
  const stopsByTripId = stopTimesCsv ? parseStopTimesCsv(stopTimesCsv) : new Map<string, string[]>();

  const shapesByTripId = new Map<string, [number, number][]>();
  for (const [tripId, shapeId] of tripShapeIds) {
    const pts = shapesById.get(shapeId);
    if (pts) shapesByTripId.set(tripId, pts);
  }

  stopCache = {
    expiresAt: now + GTFS_CACHE_TTL_MS,
    stops,
    stopCoords,
    shapesByTripId,
    stopsByTripId
  };

  return stops;
}

export async function fetchShapeForTrip(config: {
  url?: string;
  tripId: string;
}): Promise<{ points: [number, number][]; stops: { name: string; lat: number; lon: number }[] } | null> {
  await fetchGtfsStops({ url: config.url });
  if (!stopCache) return null;

  const points = stopCache.shapesByTripId.get(config.tripId);
  if (!points) return null;

  const stopIds = stopCache.stopsByTripId.get(config.tripId) ?? [];
  const stops = stopIds.flatMap((stopId) => {
    const coords = stopCache!.stopCoords.get(stopId);
    const name = stopCache!.stops.get(stopId);
    if (!coords || !name) return [];
    return [{ name, lat: coords[0], lon: coords[1] }];
  });

  return { points, stops };
}

function unwrapRealtimeFeed(payload: GtfsRealtimeFeed | LegacyVehicleLocationsResponse): GtfsRealtimeFeed {
  if ("response" in payload && payload.response?.entity) {
    return payload.response;
  }

  return payload as GtfsRealtimeFeed;
}

function unwrapTripUpdatesFeed(
  payload: GtfsRealtimeTripUpdatesFeed | LegacyTripUpdatesResponse
): GtfsRealtimeTripUpdatesFeed {
  if ("response" in payload && payload.response?.entity) {
    return payload.response;
  }

  return payload as GtfsRealtimeTripUpdatesFeed;
}

function parseStopsCsv(text: string): Map<string, string> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return new Map();
  }

  const headers = parseCsvLine(lines[0]);
  const stopIdIndex = headers.indexOf("stop_id");
  const stopNameIndex = headers.indexOf("stop_name");

  if (stopIdIndex < 0 || stopNameIndex < 0) {
    return new Map();
  }

  const stops = new Map<string, string>();

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const stopId = row[stopIdIndex];
    const stopName = row[stopNameIndex];

    if (stopId && stopName) {
      stops.set(stopId, stopName);
    }
  }

  return stops;
}

function parseStopCoordsCsv(text: string): Map<string, [number, number]> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]);
  const stopIdIdx = headers.indexOf("stop_id");
  const latIdx = headers.indexOf("stop_lat");
  const lonIdx = headers.indexOf("stop_lon");
  if (stopIdIdx < 0 || latIdx < 0 || lonIdx < 0) return new Map();

  const coords = new Map<string, [number, number]>();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const stopId = row[stopIdIdx];
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    if (stopId && Number.isFinite(lat) && Number.isFinite(lon)) {
      coords.set(stopId, [lat, lon]);
    }
  }
  return coords;
}

function parseStopTimesCsv(text: string): Map<string, string[]> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]);
  const tripIdIdx = headers.indexOf("trip_id");
  const stopIdIdx = headers.indexOf("stop_id");
  const seqIdx = headers.indexOf("stop_sequence");
  if (tripIdIdx < 0 || stopIdIdx < 0) return new Map();

  const raw = new Map<string, { seq: number; stopId: string }[]>();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const tripId = row[tripIdIdx];
    const stopId = row[stopIdIdx];
    const seq = seqIdx >= 0 ? Number(row[seqIdx]) : i;
    if (tripId && stopId) {
      const entries = raw.get(tripId) ?? [];
      entries.push({ seq, stopId });
      raw.set(tripId, entries);
    }
  }

  const result = new Map<string, string[]>();
  for (const [tripId, entries] of raw) {
    result.set(
      tripId,
      entries.sort((a, b) => a.seq - b.seq).map((e) => e.stopId)
    );
  }
  return result;
}

function parseTripShapesCsv(text: string): Map<string, string> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]);
  const tripIdIdx = headers.indexOf("trip_id");
  const shapeIdIdx = headers.indexOf("shape_id");
  if (tripIdIdx < 0 || shapeIdIdx < 0) return new Map();

  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const tripId = row[tripIdIdx];
    const shapeId = row[shapeIdIdx];
    if (tripId && shapeId) map.set(tripId, shapeId);
  }
  return map;
}

function parseShapesCsv(text: string): Map<string, [number, number][]> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]);
  const shapeIdIdx = headers.indexOf("shape_id");
  const latIdx = headers.indexOf("shape_pt_lat");
  const lonIdx = headers.indexOf("shape_pt_lon");
  const seqIdx = headers.indexOf("shape_pt_sequence");
  if (shapeIdIdx < 0 || latIdx < 0 || lonIdx < 0) return new Map();

  const raw = new Map<string, { seq: number; lat: number; lon: number }[]>();
  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const shapeId = row[shapeIdIdx];
    const lat = Number(row[latIdx]);
    const lon = Number(row[lonIdx]);
    const seq = seqIdx >= 0 ? Number(row[seqIdx]) : i;
    if (shapeId && Number.isFinite(lat) && Number.isFinite(lon)) {
      const pts = raw.get(shapeId) ?? [];
      pts.push({ seq, lat, lon });
      raw.set(shapeId, pts);
    }
  }

  const shapes = new Map<string, [number, number][]>();
  for (const [shapeId, pts] of raw) {
    shapes.set(
      shapeId,
      pts.sort((a, b) => a.seq - b.seq).map((p): [number, number] => [p.lat, p.lon])
    );
  }
  return shapes;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}
