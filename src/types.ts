export type TrainVehicle = {
  id: string;
  vehicleId: string;
  vehicleName: string | null;
  routeId: string | null;
  tripId: string | null;
  nextStopId: string | null;
  nextStopName: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  timestamp: number | null;
  ageSeconds: number | null;
};

export type VehicleResponse = {
  generatedAt: string;
  sourceTimestamp: number | null;
  filterMode: "gtfs-routes" | "configured-routes" | "route-heuristic" | "unfiltered";
  vehicles: TrainVehicle[];
};
