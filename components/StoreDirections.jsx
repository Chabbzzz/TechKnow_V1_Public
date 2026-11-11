import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../constants/theme";

export function StoreDirections({ store, location, routing, onClose }) {
  const [mode, setMode] = useState("walking");
  const [linkError, setLinkError] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  useEffect(() => { setMode("walking"); setLinkError(""); setShowSteps(false); }, [store.id]);
  const route = routing.result?.routes[0];
  return <View style={styles.panel} testID="store-directions">
    <View style={styles.heading}><Text style={styles.title}>Directions to {store.name}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close directions" onPress={onClose} style={styles.close}><Text>✕</Text></Pressable></View>
    <Text style={styles.copy}>{store.address || "No saved store address"}</Text>
    <View style={styles.row}>{["walking", "driving"].map(value => <Pressable key={value}
      accessibilityRole="button" accessibilityState={{ selected: mode === value }}
      onPress={() => setMode(value)} style={[styles.chip, mode === value && styles.active]}>
      <Text style={styles.chipText}>{value === "walking" ? "Walking" : "Driving"}</Text>
    </Pressable>)}</View>
    <Pressable accessibilityRole="button" disabled={routing.busy || !store.address}
      accessibilityLabel="Find store address" onPress={routing.findAddresses} style={styles.secondary}>
      <Text style={styles.chipText}>{routing.result ? "Find address again" : "Find store address"}</Text>
    </Pressable>
    {routing.busy ? <View style={styles.row}><ActivityIndicator color={COLORS.primary} /><Text style={styles.copy}>Loading directions…</Text></View> : null}
    {routing.addresses.length ? <View>
      <Text style={styles.title}>Choose the matching destination</Text>
      <Text style={styles.note}>Confirm the street or building before starting. A street match is approximate.</Text>
      {routing.addresses.map((address, index) => <Pressable key={`${address.latitude},${address.longitude}`}
        accessibilityRole="button" accessibilityLabel={`Route to address ${index + 1}`} disabled={routing.busy || !location}
        onPress={() => routing.getRoute(address, mode)} style={styles.address}>
        <Text style={styles.copy}>{address.label}</Text>
        <Text style={styles.chipText}>{address.approximate ? "Approximate street location · " : ""}Use for {mode} route</Text>
      </Pressable>)}
      {!location ? <Text style={styles.error}>Allow location access to calculate a route from your position.</Text> : null}
    </View> : null}
    {route ? <View testID="route-summary">
      <Text style={styles.title}>{routing.result.mode === "walking" ? "Walking" : "Driving"}: {route.distanceKm.toFixed(1)} km · about {Math.max(1, Math.ceil(route.durationSeconds / 60))} min</Text>
      <Text style={styles.copy}>To: {routing.result.destination.label}</Text>
      <Text style={styles.note}>Quickest estimate among the returned {routing.result.mode} routes. No live traffic or road-hazard assessment.</Text>
      {routing.result.destination.approximate ? <Text style={styles.note}>Street destination: confirm the shop entrance with the store.</Text> : null}
      <Text style={styles.saved}>{routing.saved ? "Directions saved on this device" : "Directions not saved"} · {new Date(routing.result.savedAt).toLocaleString()}</Text>
      {routing.restored || routing.stale ? <Text style={styles.error}>Saved route from a previous starting point. Refresh when connected before following it.</Text> : null}
      {mode !== routing.result.mode ? <Text style={styles.note}>Showing the saved {routing.result.mode} route. Refresh to calculate {mode} directions.</Text> : null}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={routing.busy || !location} onPress={() => routing.getRoute(routing.result.destination, mode)} style={styles.secondary}>
          <Text style={styles.chipText}>Refresh route</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setShowSteps(value => !value)} style={styles.secondary}>
          <Text style={styles.chipText}>{showSteps ? "Hide steps" : "Read saved steps"}</Text>
        </Pressable>
      </View>
      {showSteps ? <View testID="route-steps">
        <Text style={styles.note}>Text directions stay available without map tiles. A new route needs internet.</Text>
        {route.steps.length ? route.steps.map((step, index) => <Text key={index} style={styles.step}>{index + 1}. {step.instruction} · {Math.round(step.distanceMeters)} m</Text>)
          : <Text style={styles.note}>No step instructions were returned for this route.</Text>}
      </View> : null}
      <Pressable accessibilityRole="button" onPress={routing.forget} style={styles.secondary}><Text style={styles.chipText}>Remove saved directions</Text></Pressable>
    </View> : null}
    {routing.error || linkError ? <Text accessibilityRole="alert" style={styles.error}>{routing.error || linkError}</Text> : null}
    <Text style={styles.note}>Routes: OSRM / FOSSGIS · Addresses: Photon · © OpenStreetMap contributors</Text>
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL("https://www.openstreetmap.org/fixthemap").catch(() => setLinkError("Could not open map feedback."))}>
      <Text style={styles.note}>Report a map issue ↗</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  panel: { paddingTop: 8, gap: 7 }, heading: { flexDirection: "row", alignItems: "center" },
  title: { flexShrink: 1, fontSize: 13, lineHeight: 19, fontWeight: "700", color: COLORS.text },
  close: { marginLeft: "auto", padding: 12 }, copy: { fontSize: 12, lineHeight: 18, color: COLORS.text },
  note: { fontSize: 11, lineHeight: 16, color: COLORS.textMuted }, row: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" },
  chip: { padding: 10, borderRadius: 8, backgroundColor: "#f0f3f7", borderWidth: 1, borderColor: "#dbe2ec" },
  active: { borderColor: COLORS.primary, backgroundColor: "#e7efff" }, chipText: { color: COLORS.primary, fontSize: 12, fontWeight: "600" },
  secondary: { paddingVertical: 12, paddingHorizontal: 5 }, address: { padding: 10, borderWidth: 1, borderColor: "#dbe2ec", borderRadius: 8, marginTop: 7, gap: 4 },
  error: { color: "#92400e", fontSize: 12, lineHeight: 18 }, saved: { color: "#11633b", fontSize: 11, lineHeight: 16 },
  step: { color: COLORS.text, fontSize: 12, lineHeight: 19, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#edf0f5" },
});
