import { coordinateNumber, normalizeCoordinates } from "../../constants/nearby";

export const LOCATION_MAX_AGE_MS = 60000;

export function normalizeLocationReading(value, now = Date.now()) {
  const coordinates = normalizeCoordinates(value);
  const timestamp = coordinateNumber(value?.timestamp);
  const accuracy = coordinateNumber(value?.accuracy);
  if (!coordinates || timestamp === null || timestamp > now + 5000
    || now - timestamp >= LOCATION_MAX_AGE_MS) return null;
  return { ...coordinates, timestamp, accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null };
}

// One foreground subscription per focused screen. No background location access.
export function subscribeToCurrentLocation({ provider, initialLocation, onLocation, onMessage,
  onStatus = () => {}, requestEnableServices }) {
  let active = true;
  let subscription;
  let expiryTimer;
  let latest = normalizeLocationReading(initialLocation);
  let hasLiveFix = false;
  let waitingTimer;

  const expire = () => {
    clearTimeout(expiryTimer);
    if (!latest) return;
    expiryTimer = setTimeout(() => {
      if (!active) return;
      latest = null;
      onLocation(null);
      onMessage("Your last GPS reading expired. Waiting for a fresh location...");
      onStatus("waiting");
    }, Math.max(0, latest.timestamp + LOCATION_MAX_AGE_MS - Date.now()));
  };
  const unavailable = (message, status = "error") => {
    if (!active) return;
    clearTimeout(waitingTimer);
    clearTimeout(expiryTimer);
    latest = null;
    onLocation(null);
    onMessage(message);
    onStatus(status);
  };
  const receive = (position, cached = false) => {
    if (!active) return;
    const reading = normalizeLocationReading({ ...position?.coords, timestamp: position?.timestamp });
    if (!reading || (latest && reading.timestamp < latest.timestamp)) return;
    latest = reading;
    onLocation(reading);
    onStatus("ready");
    expire();
    if (cached) { onMessage("Using a recent GPS reading while your location updates..."); return; }
    hasLiveFix = true;
    clearTimeout(waitingTimer);
    onMessage(reading.accuracy === null
      ? "Straight-line distances. GPS accuracy is unavailable."
      : `GPS accuracy: ±${Math.ceil(reading.accuracy)} m. ${reading.accuracy > 100 ? "Approximate" : "Straight-line"} distances.`);
  };

  onLocation(latest);
  onMessage(latest ? "Refreshing your GPS location..." : "Finding your location...");
  onStatus("checking");
  expire();

  (async () => {
    try {
      const permission = await provider.requestForegroundPermissionsAsync();
      if (!active) return;
      if (permission.status !== "granted") {
        // iOS can report denied permission when global Location Services is off.
        const servicesEnabled = await provider.hasServicesEnabledAsync();
        if (!active) return;
        if (!servicesEnabled) {
          unavailable("Turn on location services to show your position and nearby shops.", "services-disabled");
          return;
        }
        unavailable("Allow location access to see each shop's distance from you.",
          permission.canAskAgain === false ? "permission-blocked" : "permission-denied");
        return;
      }
      let enabled = await provider.hasServicesEnabledAsync();
      if (!active) return;
      if (!enabled && requestEnableServices) {
        onStatus("enabling-services");
        await requestEnableServices().catch(() => {});
        if (!active) return;
        enabled = await provider.hasServicesEnabledAsync();
        if (!active) return;
      }
      if (!enabled) {
        unavailable("Turn on location services to show your position and nearby shops.", "services-disabled");
        return;
      }
      onStatus("locating");
      waitingTimer = setTimeout(() => {
        if (active && !hasLiveFix) {
          onMessage("Waiting for GPS. Check location services or try again.");
          onStatus("waiting");
        }
      }, 15000);
      // A cache failure must not prevent a fresh GPS subscription.
      const cached = await provider.getLastKnownPositionAsync({
        maxAge: 30000, requiredAccuracy: 100,
      }).catch(() => null);
      if (!active) return;
      if (cached) receive(cached, true);
      // Start the live watch even if the one-shot GPS request is slow or fails.
      provider.getCurrentPositionAsync({ accuracy: provider.Accuracy.Highest }).then(
        position => receive(position),
        () => { if (active && !hasLiveFix) onMessage("Waiting for GPS. Keep location on or try again."); },
      );
      subscription = await provider.watchPositionAsync({
        accuracy: provider.Accuracy.Highest,
        distanceInterval: 0,
        timeInterval: 5000,
      }, (position) => receive(position), () => unavailable("GPS is unavailable. Check location services and refresh."));
      if (!active) subscription.remove();
    } catch {
      unavailable("Location is unavailable. Check location access and refresh.");
    }
  })();

  return () => {
    active = false;
    clearTimeout(waitingTimer);
    clearTimeout(expiryTimer);
    subscription?.remove();
  };
}
