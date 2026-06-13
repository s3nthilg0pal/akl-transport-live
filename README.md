# Auckland Live Train Map

Local-first OpenStreetMap app for viewing live Auckland train locations from Auckland Transport realtime data.

## Setup

1. Sign up for an Auckland Transport developer subscription key.
2. Copy `.env.example` to `.env`.
3. Fill in:
   - `AT_SUBSCRIPTION_KEY`
   - `AT_REALTIME_ENDPOINT`, for example `https://api.at.govt.nz/realtime/legacy/vehiclelocations`
   - optional `AT_TRIP_UPDATES_ENDPOINT`, defaults to `https://api.at.govt.nz/realtime/legacy/tripupdates`
   - optional `AT_GTFS_ZIP_URL`, defaults to `https://gtfs.at.govt.nz/gtfs.zip`
   - optional `AT_GTFS_ROUTES_ENDPOINT`
   - optional `TRAIN_ROUTE_IDS`, comma-separated, if the route endpoint is unavailable.
4. Install dependencies and start the app:

```sh
npm install
npm run dev
```

Open `http://localhost:5173`.

## Runtime Shape

- Vite serves the React frontend.
- Express runs on `PORT` defaulting to `5174`.
- The browser calls `/api/vehicles`.
- The backend calls Auckland Transport with `Ocp-Apim-Subscription-Key`, so the key is not exposed in browser requests.

The frontend polls every 3 seconds. AT's realtime feed is documented as updating at least every 30 seconds, so some polls may return unchanged vehicle positions.
