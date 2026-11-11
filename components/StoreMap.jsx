import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MapSurface } from "./MapSurface";
import { mapPayload, storeMapDocument } from "../constants/store-map-document";
import { COLORS } from "../constants/theme";

export function StoreMap({ location = null, shops = [], routes = {}, selectedShopId = null, onSelectShop, style }) {
  const surface = useRef(null);
  const [status, setStatus] = useState("loading");
  const [retry, setRetry] = useState(0);
  const [nearest, setNearest] = useState(null);
  const html = useMemo(storeMapDocument, []);
  const payload = useMemo(() => mapPayload(location, shops), [location, shops]);
  const latest = useRef(payload);
  latest.current = payload;
  const send = useCallback(() => surface.current?.send(latest.current), []);
  useEffect(send, [payload, send]);
  useEffect(() => {
    const timer = setTimeout(() => setStatus(current => current === "loading" ? "error" : current), 20000);
    return () => clearTimeout(timer);
  }, [retry]);
  const onMessage = useCallback(raw => {
    try {
      const message = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (message?.channel !== "techknow-map") return;
      if (message.type === "boot") send();
      if (message.type === "ready") send();
      if (message.type === "background-ready") setStatus("ready");
      if (message.type === "error") setStatus("error");
      if (message.type === "match") setNearest(message.value && Number.isFinite(message.value.distanceKm) ? message.value : null);
      if (message.type === "select" && latest.current.shops.some(shop => shop.id === message.value)) onSelectShop?.(message.value);
    } catch (_) { /* Ignore malformed frame messages. */ }
  }, [send, onSelectShop]);
  return <View style={[styles.container, style]} testID="store-map">
    <MapSurface key={retry} ref={surface} html={html} onMessage={onMessage} onError={() => setStatus("error")} />
    {nearest ? <View pointerEvents="none" style={styles.nearestCard} accessibilityLiveRegion="polite">
      <Text style={styles.nearestLabel}>Nearest store in range</Text>
      <Text numberOfLines={1} style={styles.nearestName}>{nearest.name}</Text>
      <Text style={styles.nearestDistance}>{nearest.distanceKm.toFixed(1)} km away</Text>
    </View> : null}
    {status !== "ready" ? <View style={styles.notice}>
      <Text style={styles.noticeText}>{status === "loading" ? "Loading map…"
        : "Map background unavailable. Shop distances are available in the store list."}</Text>
      {status === "error" ? <Pressable accessibilityRole="button" accessibilityLabel="Retry map background"
        onPress={() => { setStatus("loading"); setRetry(value => value + 1); }} style={styles.retry}>
        <Text style={styles.retryText}>Reload map</Text>
      </Pressable> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { overflow: "hidden", backgroundColor: "#e8eef1", position: "relative" },
  notice: { position: "absolute", top: 8, left: 8, right: 48, padding: 10, backgroundColor: "#ffffffed", borderRadius: 8 },
  noticeText: { color: COLORS.text, fontSize: 12, lineHeight: 17 },
  retry: { paddingVertical: 10 }, retryText: { color: COLORS.primary, fontWeight: "700", fontSize: 12 },
  nearestCard: { position: "absolute", left: 12, right: 60, bottom: 14, padding: 12, borderRadius: 14,
    backgroundColor: "#ffffffF2", shadowColor: "#10243e", shadowOpacity: 0.16, shadowRadius: 10, elevation: 4 },
  nearestLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  nearestName: { marginTop: 3, fontSize: 15, fontWeight: "700", color: COLORS.text },
  nearestDistance: { marginTop: 3, fontSize: 12, color: COLORS.primary, fontWeight: "600" },
});
