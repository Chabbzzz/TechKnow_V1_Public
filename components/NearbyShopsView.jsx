import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { COLORS } from "../constants/theme";
import { nearbyShopsInRange } from "../constants/nearby";
import { ROUTE_COLORS } from "../constants/store-map-document";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { useNearbyStores } from "../hooks/useNearbyStores";
import { useNearbyShopRoutes } from "../hooks/useNearbyShopRoutes";
import { StoreMap } from "./StoreMap";
import { ScreenHeader } from "./ScreenHeader";
import { StoreListSheet, STORE_SHEET_PEEK } from "./StoreListSheet";

export function NearbyShopsView({ expanded = false, initialStoreId = null, returnTo = "/search" }) {
  const [mapHeight, setMapHeight] = useState(600);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { location, message, status: locationStatus, refresh, enableLocation } = useCurrentLocation();
  const { stores, isLoading, error, isCached } = useNearbyStores();
  const shops = useMemo(() => nearbyShopsInRange(stores, location), [stores, location]);
  const { routes, retry } = useNearbyShopRoutes(location, shops);
  const [selectedId, setSelectedId] = useState(initialStoreId);
  const selected = shops.some(shop => shop.id === selectedId) ? selectedId : null;
  const anyRouteError = shops.some(shop => routes[shop.id]?.status === "error");
  const unavailablePins = stores.filter(shop => shop.latitude == null || shop.longitude == null).length;
  const status = !location ? message : isLoading ? "Loading computer shops…"
    : error && !shops.length ? error : !shops.length ? "There are no shops near you." : "";
  const locationBusy = ["checking", "enabling-services", "locating"].includes(locationStatus);
  const locationAction = locationStatus === "services-disabled" ? "Turn on location"
    : locationStatus === "permission-blocked" ? "Open settings"
      : locationStatus === "permission-denied" ? "Allow location" : "Try again";
  const locationTitle = locationStatus === "services-disabled" ? "Turn on your location"
    : locationStatus.startsWith("permission-") ? "Allow location access"
      : locationBusy ? "Finding your location" : "Location unavailable";

  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
    <ScreenHeader title={expanded ? "Shop routes" : "Nearby shops"}
      onBack={() => expanded && router.canGoBack() ? router.back() : router.replace(returnTo)}
      right={<TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Refresh current location"
        onPress={() => { refresh(); retry(); }}><MaterialIcons name="my-location" size={23} color={COLORS.primary} /></TouchableOpacity>} />
    <View style={styles.mapArea} onLayout={event => setMapHeight(event.nativeEvent.layout.height)}>
      <StoreMap location={location} shops={stores} routes={routes} selectedShopId={selected}
        onSelectShop={id => { setSelectedId(id); setSheetOpen(true); }} style={styles.mapBackground} />
      {!location ? <View style={styles.locationNotice} accessibilityLiveRegion="polite" testID="map-location-prompt">
        <View style={styles.locationHeading}>
          {locationBusy ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <MaterialIcons name="location-off" size={22} color={COLORS.primary} />}
          <Text style={styles.locationTitle}>{locationTitle}</Text>
        </View>
        <Text style={styles.caption}>{message}</Text>
        {!locationBusy ? <TouchableOpacity accessibilityRole="button" onPress={enableLocation} style={styles.locationButton}>
          <Text style={styles.locationButtonText}>{locationAction}</Text>
        </TouchableOpacity> : null}
      </View> : null}
      <StoreListSheet height={mapHeight} open={sheetOpen} onOpenChange={setSheetOpen}
        subtitle={!location ? "Enable location to find nearby shops" : isLoading ? "Loading stores…" : `${shops.length} ${shops.length === 1 ? "store" : "stores"} within 5–10 km`}>
      <Text style={styles.caption}>Using your current location. The range is measured in a straight line; driving distances may be longer.</Text>
      {status ? <View style={styles.empty} accessibilityLiveRegion="polite">
        <Text style={styles.emptyTitle}>{status}</Text>
        {location && !isLoading && !error && !shops.length ? <Text style={styles.caption}>No computer shops with a saved map location are between 5 and 10 km from you.</Text> : null}
        <TouchableOpacity style={styles.retry} accessibilityRole="button" onPress={refresh}><Text style={styles.link}>Refresh location</Text></TouchableOpacity>
      </View> : <>
        <Text style={styles.caption}>{message}</Text>
        <View style={styles.toolbar}>
          <Text style={styles.resultCount}>{shops.length} {shops.length === 1 ? "shop" : "shops"} in range</Text>
          {selected ? <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={() => setSelectedId(null)}><Text style={styles.link}>Show all routes</Text></TouchableOpacity> : null}
        </View>
        {shops.map((shop, index) => {
          const route = routes[shop.id];
          const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
          return <TouchableOpacity key={shop.id} style={[styles.card, selected === shop.id && styles.selected]}
            accessibilityRole="button" accessibilityLabel={`Show route to ${shop.name}`}
            accessibilityState={{ selected: selected === shop.id }} onPress={() => { setSelectedId(shop.id); setSheetOpen(false); }}>
            <View style={[styles.number, { backgroundColor: color }]}><Text style={styles.numberText}>{index + 1}</Text></View>
            <View style={styles.copy}>
              <Text style={styles.shopName}>{shop.name}</Text>
              {shop.address ? <Text style={styles.address}>{shop.address}</Text> : null}
              <Text style={styles.distance}>{shop.distance} · straight-line</Text>
              <Text style={route?.status === "error" ? styles.error : styles.route}>
                {route?.status === "ready" ? `${route.distanceKm.toFixed(1)} km driving · about ${Math.max(1, Math.ceil(route.durationSeconds / 60))} min`
                  : route?.status === "error" ? "Driving route unavailable. Distance from you is shown above." : "Finding driving route…"}
              </Text>
              {shop.locationAccuracy === "street" ? <Text style={styles.address}>Approximate shop pin; confirm the entrance.</Text> : null}
            </View>
            <MaterialIcons name="chevron-right" size={20} color={color} />
          </TouchableOpacity>;
        })}
        {anyRouteError ? <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={retry}><Text style={styles.link}>Retry driving routes</Text></TouchableOpacity> : null}
      </>}
      {isCached ? <Text style={styles.caption}>Showing saved shop details. Connect to refresh them.</Text> : null}
      {error && shops.length ? <Text style={styles.error}>{error}</Text> : null}
      {location && unavailablePins > 0 ? <Text style={styles.caption}>{unavailablePins} {unavailablePins === 1 ? "shop has" : "shops have"} no saved map pin and cannot be checked against the range.</Text> : null}
      </StoreListSheet>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  mapArea: { flex: 1, overflow: "hidden" },
  mapBackground: { position: "absolute", top: 0, left: 0, right: 0, bottom: STORE_SHEET_PEEK },
  locationNotice: { position: "absolute", left: 12, right: 12, bottom: STORE_SHEET_PEEK + 14,
    padding: 14, borderRadius: 14, backgroundColor: "#ffffffF2", elevation: 4,
    shadowColor: "#10243e", shadowOpacity: 0.14, shadowRadius: 8 },
  locationHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: COLORS.text },
  locationButton: { alignSelf: "flex-start", backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, marginTop: 10 },
  locationButtonText: { color: "white", fontSize: 13, fontWeight: "700" },
  caption: { fontSize: 12, lineHeight: 18, color: COLORS.textMuted, marginTop: 8 },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 14, marginTop: 12 },
  resultCount: { fontSize: 14, fontWeight: "700", color: COLORS.text, marginRight: "auto" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: "#e0e7f0", backgroundColor: "white" },
  selected: { borderColor: COLORS.primary, backgroundColor: "#f4f8ff" }, copy: { flex: 1 },
  number: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }, numberText: { color: "white", fontWeight: "700" },
  shopName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  address: { fontSize: 11, lineHeight: 17, color: COLORS.textMuted, marginTop: 4 },
  distance: { fontSize: 13, fontWeight: "700", color: COLORS.primary, marginTop: 8 },
  route: { fontSize: 12, lineHeight: 18, color: COLORS.text, marginTop: 4 },
  error: { fontSize: 12, lineHeight: 18, color: "#915414", marginTop: 5 },
  empty: { paddingVertical: 48, alignItems: "center" }, emptyTitle: { color: COLORS.text, fontSize: 18, textAlign: "center", fontWeight: "600" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  retry: { paddingVertical: 12 }, link: { fontSize: 13, color: COLORS.primary, fontWeight: "600" },
});
