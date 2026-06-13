import { describe, expect, it } from "vitest";
import { extractTrainRouteIds, normalizeVehicleFeed, parseRouteIds } from "../server/normalize";

describe("parseRouteIds", () => {
  it("parses comma-separated route IDs", () => {
    expect([...parseRouteIds("EAST, WEST, ,SOUTH")]).toEqual(["EAST", "WEST", "SOUTH"]);
  });
});

describe("extractTrainRouteIds", () => {
  it("extracts GTFS train route_type 2 route IDs", () => {
    const ids = extractTrainRouteIds({
      data: [
        { id: "EAST", attributes: { route_type: 2 } },
        { id: "BUS-1", attributes: { route_type: 3 } },
        { id: "WEST", attributes: { route_type: "2" } }
      ]
    });

    expect([...ids]).toEqual(["EAST", "WEST"]);
  });
});

describe("normalizeVehicleFeed", () => {
  it("keeps only GTFS train route vehicles when route metadata is available", () => {
    const payload = normalizeVehicleFeed(
      {
        header: { timestamp: 1_735_689_600 },
        entity: [
          vehicleEntity("1", "train-1", "EAST", -36.84, 174.76),
          vehicleEntity("2", "bus-1", "BUS-1", -36.85, 174.77)
        ]
      },
      {
        now: new Date("2025-01-01T00:01:00Z"),
        hasRouteMetadata: true,
        trainRouteIds: new Set(["EAST"])
      }
    );

    expect(payload.filterMode).toBe("gtfs-routes");
    expect(payload.sourceTimestamp).toBe(1_735_689_600);
    expect(payload.vehicles).toHaveLength(1);
    expect(payload.vehicles[0]).toMatchObject({
      id: "1",
      vehicleId: "train-1",
      vehicleName: "Te Maki",
      routeId: "EAST",
      ageSeconds: 60
    });
  });

  it("uses configured route IDs when GTFS metadata is unavailable", () => {
    const payload = normalizeVehicleFeed(
      {
        entity: [
          vehicleEntity("1", "train-1", "WEST", -36.84, 174.76),
          vehicleEntity("2", "bus-1", "BUS-1", -36.85, 174.77)
        ]
      },
      {
        configuredRouteIds: new Set(["WEST"])
      }
    );

    expect(payload.filterMode).toBe("configured-routes");
    expect(payload.vehicles.map((vehicle) => vehicle.vehicleId)).toEqual(["train-1"]);
  });

  it("falls back to conservative Auckland rail route heuristics", () => {
    const payload = normalizeVehicleFeed({
      entity: [
        vehicleEntity("1", "train-1", "SOUTH", -36.84, 174.76),
        vehicleEntity("2", "bus-1", "NX1", -36.85, 174.77)
      ]
    });

    expect(payload.filterMode).toBe("route-heuristic");
    expect(payload.vehicles.map((vehicle) => vehicle.routeId)).toEqual(["SOUTH"]);
  });
});

function vehicleEntity(
  id: string,
  vehicleId: string,
  routeId: string,
  latitude: number,
  longitude: number
) {
  return {
    id,
    vehicle: {
      trip: {
        route_id: routeId,
        trip_id: `${routeId}-trip`
      },
      vehicle: {
        id: vehicleId,
        label: vehicleId === "train-1" ? "Te Maki" : ""
      },
      position: {
        latitude,
        longitude,
        bearing: 90
      },
      timestamp: 1_735_689_600
    }
  };
}
