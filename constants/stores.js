// Public details supplied by the project owner for existing test shops whose
// storeDirectory migration is pending. Never include account/contact fields.
const EXISTING_SHOPS = [
  { id: "nDOOet6nFOg6ghFTnJzao8zdXRH2", name: "Alpha Tech Test Store",
    address: "Lacson Street, Bacolod City", latitude: 10.6752692, longitude: 122.9526878,
    locationAccuracy: "street", locationSource: "OpenStreetMap / Nominatim" },
  { id: "dowcWevyZwOY4n71X2q1igTgLj33", name: "Beta Computer Test Store",
    address: "Araneta Street, Bacolod City", latitude: 10.6681998, longitude: 122.9458233,
    locationAccuracy: "street", locationSource: "OpenStreetMap / Nominatim" },
];

export function getStoreListings(documents = []) {
  const listings = new Map(EXISTING_SHOPS.map(store => [store.id, { ...store }]));
  for (const document of documents) {
    const store = mapStoreAccount(document);
    // A live restricted/invalid record must suppress the bundled fallback too.
    if (store) listings.set(document.id, store);
    else listings.delete(document.id);
  }
  return [...listings.values()];
}

export const mapStoreAccount = (document) => {
  if (!document?.data || typeof document.data !== "function") return null;

  const store = document.data();
  const id = String(document.id || store.id || "").trim();
  const name = String(store.name || store.storeName || store.businessName || "").trim();
  const isLegacyNumericId = /^\d+$/.test(id);
  const status = String(store.status || "Active").trim().toLowerCase();

  if (!id || !name || isLegacyNumericId || ["suspended", "banned", "disabled"].includes(status)) return null;

  return {
    id,
    name,
    address: typeof store.address === "string" && store.address.trim()
      ? store.address.trim() : [store.street, store.barangay, store.city].filter(value => typeof value === "string" && value.trim()).join(", "),
    type: store.type || store.category || "Computer store",
    latitude: store.latitude ?? store.location?.latitude ?? store.coordinates?.latitude ?? store.lat,
    longitude: store.longitude ?? store.location?.longitude ?? store.coordinates?.longitude ?? store.lng ?? store.lon,
    locationAccuracy: store.locationAccuracy || null,
    locationSource: store.locationSource || null,
  };
};
