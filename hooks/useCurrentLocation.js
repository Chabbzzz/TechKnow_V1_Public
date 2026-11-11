import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { normalizeLocationReading, subscribeToCurrentLocation } from "../backend/services/current-location";

export function useCurrentLocation(initialLocation = null) {
  const latest = useRef(normalizeLocationReading(initialLocation));
  const [location, setLocation] = useState(latest.current);
  const [message, setMessage] = useState("Finding your location...");
  const [status, setStatus] = useState("checking");
  const [attempt, setAttempt] = useState(0);
  const focused = useRef(false);
  const promptingServices = useRef(false);
  const prompted = useRef(new Set());
  const currentStatus = useRef("checking");
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  const openSettings = useCallback(async (services = false) => {
    try {
      if (Platform.OS === "android" && services) await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
      else if (Platform.OS !== "web") await Linking.openSettings();
      else setMessage("Allow location access in this site's permissions, then try again.");
    } catch {
      setMessage("Open your device Settings, turn on location and allow TechKnow access, then return to the map.");
    }
  }, []);

  const updateStatus = useCallback(value => {
    currentStatus.current = value;
    setStatus(value);
    const needsSettings = value === "permission-blocked" || (value === "services-disabled" && Platform.OS === "ios");
    if (Platform.OS === "web" || !needsSettings || prompted.current.has(value)) return;
    prompted.current.add(value);
    Alert.alert(value === "services-disabled" ? "Turn on Location Services" : "Allow location access",
      value === "services-disabled"
        ? "Turn on Location Services in Settings > Privacy & Security > Location Services, then allow TechKnow to use your location. Return here to see your position on the map."
        : "Allow TechKnow to use your location while using the app to see your position and nearby computer shops.",
      [{ text: "Not now", style: "cancel" }, { text: "Open settings", onPress: () => openSettings(value === "services-disabled") }]);
  }, [openSettings]);

  const requestEnableServices = useCallback(async () => {
    promptingServices.current = true;
    try { await Location.enableNetworkProviderAsync(); }
    finally { promptingServices.current = false; }
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    prompted.current.clear();
    return () => { focused.current = false; };
  }, []));

  useFocusEffect(useCallback(() => subscribeToCurrentLocation({
    provider: Location,
    initialLocation: latest.current,
    onLocation: (reading) => { latest.current = reading; setLocation(reading); },
    onMessage: setMessage,
    onStatus: updateStatus,
    requestEnableServices: Platform.OS === "android" ? requestEnableServices : undefined,
  }), [attempt, requestEnableServices, updateStatus]));

  // A quick-settings toggle may not background the app. Resume automatically
  // when location is turned on while this screen remains open.
  useFocusEffect(useCallback(() => {
    if (status !== "services-disabled") return;
    let active = true, timer;
    const check = async () => {
      const enabled = await Location.hasServicesEnabledAsync().catch(() => false);
      if (!active) return;
      if (enabled) refresh();
      else timer = setTimeout(check, 2000);
    };
    timer = setTimeout(check, 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [status, refresh]));

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (state) => {
      const resumed = previous !== "active" && state === "active";
      previous = state;
      if (resumed && focused.current && !promptingServices.current
        && !["checking", "enabling-services"].includes(currentStatus.current)) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const enableLocation = useCallback(() => {
    if (status === "services-disabled" || status === "permission-blocked") openSettings(status === "services-disabled");
    else refresh();
  }, [status, openSettings, refresh]);

  return { location, message, status, refresh, enableLocation };
}
