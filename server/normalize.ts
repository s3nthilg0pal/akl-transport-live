import type {
  GtfsRealtimeFeed,
  GtfsRealtimeTripUpdatesFeed,
  JsonApiRoutesResponse,
  NormalizedVehicleResponse,
  TrainVehicle
} from "./types.js";

const TRAIN_ROUTE_TYPE = 2;
const AUCKLAND_RAIL_HINTS = [
  "east",
  "west",
  "sth",
  "south",
  "one",
  "puk",
  "rail",
  "train"
];

export function parseRouteIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((routeId) => routeId.trim())
      .filter(Boolean)
  );
}

export function extractTrainRouteIds(routes: JsonApiRoutesResponse): Set<string> {
  const ids = new Set<string>();

  for (const route of routes.data ?? []) {
    const routeType = Number(route.attributes?.route_type);

    if (route.id && routeType === TRAIN_ROUTE_TYPE) {
      ids.add(route.id);
    }
  }

  return ids;
}

export function normalizeVehicleFeed(
  feed: GtfsRealtimeFeed,
  options: {
    now?: Date;
    trainRouteIds?: Set<string>;
    hasRouteMetadata?: boolean;
    configuredRouteIds?: Set<string>;
    nextStopsByTripId?: Map<string, { stopId: string; stopName: string | null }>;
  } = {}
): NormalizedVehicleResponse {
  const now = options.now ?? new Date();
  const trainRouteIds = options.trainRouteIds ?? new Set<string>();
  const configuredRouteIds = options.configuredRouteIds ?? new Set<string>();
  const nextStopsByTripId = options.nextStopsByTripId ?? new Map();
  const filterMode = resolveFilterMode({
    trainRouteIds,
    configuredRouteIds,
    hasRouteMetadata: options.hasRouteMetadata ?? false
  });

  const vehicles = (feed.entity ?? [])
    .map((entity): TrainVehicle | null => {
      const vehicle = entity.vehicle;
      const position = vehicle?.position;

      if (
        !vehicle ||
        typeof position?.latitude !== "number" ||
        typeof position.longitude !== "number"
      ) {
        return null;
      }

      const routeId = vehicle.trip?.route_id ?? null;

      if (!isTrainRoute(routeId, filterMode, trainRouteIds, configuredRouteIds)) {
        return null;
      }

      const timestamp = parseUnixTimestamp(vehicle.timestamp);
      const vehicleId = vehicle.vehicle?.id ?? vehicle.vehicle?.label ?? entity.id ?? "unknown";
      const vehicleName = vehicle.vehicle?.label?.trim() || null;
      const nextStop = vehicle.trip?.trip_id ? nextStopsByTripId.get(vehicle.trip.trip_id) : undefined;
      const tripId = vehicle.trip?.trip_id ?? null;

      return {
        id: entity.id ?? vehicleId,
        vehicleId,
        vehicleName,
        routeId,
        tripId,
        nextStopId: nextStop?.stopId ?? null,
        nextStopName: nextStop?.stopName ?? null,
        latitude: position.latitude,
        longitude: position.longitude,
        bearing: typeof position.bearing === "number" ? position.bearing : null,
        timestamp,
        ageSeconds: timestamp === null ? null : Math.max(0, Math.round(now.getTime() / 1000 - timestamp))
      };
    })
    .filter((vehicle): vehicle is TrainVehicle => vehicle !== null)
    .sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));

  return {
    generatedAt: now.toISOString(),
    sourceTimestamp: parseUnixTimestamp(feed.header?.timestamp),
    filterMode,
    vehicles
  };
}

function resolveFilterMode(options: {
  trainRouteIds: Set<string>;
  configuredRouteIds: Set<string>;
  hasRouteMetadata: boolean;
}): NormalizedVehicleResponse["filterMode"] {
  if (options.trainRouteIds.size > 0 && options.hasRouteMetadata) {
    return "gtfs-routes";
  }

  if (options.configuredRouteIds.size > 0) {
    return "configured-routes";
  }

  if (!options.hasRouteMetadata) {
    return "route-heuristic";
  }

  return "unfiltered";
}

function isTrainRoute(
  routeId: string | null,
  filterMode: NormalizedVehicleResponse["filterMode"],
  trainRouteIds: Set<string>,
  configuredRouteIds: Set<string>
): boolean {
  if (filterMode === "gtfs-routes") {
    return routeId !== null && trainRouteIds.has(routeId);
  }

  if (filterMode === "configured-routes") {
    return routeId !== null && configuredRouteIds.has(routeId);
  }

  if (filterMode === "route-heuristic") {
    if (!routeId) {
      return false;
    }

    const normalized = routeId.toLowerCase();
    return AUCKLAND_RAIL_HINTS.some((hint) => normalized.includes(hint));
  }

  return true;
}

function parseUnixTimestamp(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractNextStopsByTripId(feed: GtfsRealtimeTripUpdatesFeed, stopNames: Map<string, string>) {
  const nextStops = new Map<string, { stopId: string; stopName: string | null }>();

  for (const entity of feed.entity ?? []) {
    const tripUpdate = entity.trip_update;
    const tripId = tripUpdate?.trip?.trip_id;
    const stu = tripUpdate?.stop_time_update;
    const firstStop = Array.isArray(stu) ? stu[0] : stu;
    const stopId = firstStop?.stop_id;

    if (!tripId || !stopId) {
      continue;
    }

    nextStops.set(tripId, {
      stopId,
      stopName: stopNames.get(stopId) ?? null
    });
  }

  return nextStops;
}
