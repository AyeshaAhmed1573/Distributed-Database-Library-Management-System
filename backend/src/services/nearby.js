import { listBranches, getAvailabilityByIsbn } from "./coordinator.js";

const EARTH_RADIUS_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

export function distanceKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Returns { branches, nearestWithCopy }. nearestWithCopy is only set when an
// isbn is given, and it is picked from ALL branches before the limit applies.
export async function nearestBranches({ lat, lng, isbn = null, limit = 3 }) {
  const branches = await listBranches();
  const stock = isbn ? await getAvailabilityByIsbn(isbn) : [];
  const stockByBranch = new Map(stock.map((s) => [s.branch_id, s]));

  const sorted = branches
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => {
      const item = {
        branch_id: b.branch_id,
        code: b.code,
        name: b.name,
        city: b.city,
        distance_km:
          Math.round(distanceKm(lat, lng, Number(b.latitude), Number(b.longitude)) * 10) / 10,
      };
      if (isbn) {
        const s = stockByBranch.get(b.branch_id);
        item.available_copies = s ? s.available_copies : 0;
        item.total_copies = s ? s.total_copies : 0;
      }
      return item;
    })
    .sort((a, b) => a.distance_km - b.distance_km);

  return {
    branches: sorted.slice(0, limit),
    nearestWithCopy: isbn ? sorted.find((b) => b.available_copies > 0) || null : null,
  };
}