export type GtfsRealtimeFeed = {
  header?: {
    timestamp?: string | number;
  };
  entity?: GtfsRealtimeEntity[];
};

export type LegacyVehicleLocationsResponse = {
  status?: string;
  response?: GtfsRealtimeFeed;
};

export type LegacyTripUpdatesResponse = {
  status?: string;
  response?: GtfsRealtimeTripUpdatesFeed;
};

export type GtfsRealtimeEntity = {
  id?: string;
  vehicle?: {
    trip?: {
      trip_id?: string;
      route_id?: string;
      start_time?: string;
      start_date?: string;
      schedule_relationship?: number;
    };
    vehicle?: {
      id?: string;
      label?: string;
      license_plate?: string;
    };
    position?: {
      latitude?: number;
      longitude?: number;
      bearing?: number;
    };
    timestamp?: string | number;
  };
};

export type GtfsRealtimeTripUpdatesFeed = {
  header?: {
    timestamp?: string | number;
  };
  entity?: GtfsRealtimeTripUpdateEntity[];
};

export type GtfsRealtimeTripUpdateEntity = {
  id?: string;
  trip_update?: {
    trip?: {
      trip_id?: string;
      route_id?: string;
      start_time?: string;
      start_date?: string;
      schedule_relationship?: number;
      direction_id?: number;
    };
    stop_time_update?: {
      stop_sequence?: number;
      stop_id?: string;
      schedule_relationship?: number;
      arrival?: {
        delay?: number;
        time?: number;
        uncertainty?: number;
      };
      departure?: {
        delay?: number;
        time?: number;
        uncertainty?: number;
      };
    } | {
      stop_sequence?: number;
      stop_id?: string;
      schedule_relationship?: number;
      arrival?: {
        delay?: number;
        time?: number;
        uncertainty?: number;
      };
      departure?: {
        delay?: number;
        time?: number;
        uncertainty?: number;
      };
    }[];
    vehicle?: {
      id?: string;
      label?: string;
    };
    timestamp?: string | number;
    delay?: number;
  };
  is_deleted?: boolean;
};

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

export type NormalizedVehicleResponse = {
  generatedAt: string;
  sourceTimestamp: number | null;
  filterMode: "gtfs-routes" | "configured-routes" | "route-heuristic" | "unfiltered";
  vehicles: TrainVehicle[];
};

export type JsonApiRoutesResponse = {
  data?: Array<{
    id?: string;
    attributes?: {
      route_type?: number | string;
      route_short_name?: string;
      route_long_name?: string;
      route_color?: string;
    };
  }>;
};
