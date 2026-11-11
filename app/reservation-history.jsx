import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, RADIUS, SIZES, LAYOUT } from "../constants/theme";
import { auth, db } from "../backend/firebase";
import reservationPolicy from "../backend/domain/reservations";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";

const statusStyles = {
  pending: { backgroundColor: "#fff4d6", color: "#9a6800", icon: "schedule" },
  confirmed: { backgroundColor: "#e1f3e5", color: "#218739", icon: "check-circle" },
  completed: { backgroundColor: "#e7efff", color: COLORS.primary, icon: "check-circle" },
  declined: { backgroundColor: "#ffe8e5", color: "#c62828", icon: "cancel" },
};

const { statusForReservation } = reservationPolicy;

const reservationTime = (value) => {
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return Number(value.seconds) * 1000;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const reservationSortTime = (reservation) => {
  const createdAt = reservationTime(reservation.createdAt);
  if (createdAt) return createdAt;

  const clientCreatedAt = reservationTime(reservation.createdAtMs);
  if (clientCreatedAt) return clientCreatedAt;

  const updatedAt = reservationTime(reservation.updatedAt);
  if (updatedAt) return updatedAt;

  return reservationTime(
    [reservation.date, reservation.time].filter(Boolean).join(" "),
  );
};

const sortReservationsNewestFirst = (items) =>
  [...items].sort((left, right) => {
    const timeDifference = reservationSortTime(right) - reservationSortTime(left);
    if (timeDifference !== 0) return timeDifference;
    return String(right.id || "").localeCompare(String(left.id || ""));
  });

const filterOptions = [
  { value: "all", label: "All", statusTypes: null },
  { value: "pending", label: "Pending", statusTypes: ["pending"] },
  { value: "confirmed", label: "Confirmed", statusTypes: ["confirmed", "completed"] },
  { value: "declined", label: "Declined", statusTypes: ["declined"] },
];

const filterColors = {
  all: { color: COLORS.primary, activeBackgroundColor: COLORS.primary },
  pending: { color: "#9a6800", activeBackgroundColor: "#9a6800" },
  confirmed: { color: "#218739", activeBackgroundColor: "#218739" },
  declined: { color: "#c62828", activeBackgroundColor: "#c62828" },
};

const FilterButton = ({ value, label, selected, onSelect }) => {
  const colors = filterColors[value] || filterColors.all;
  const buttonStyle = selected
    ? [styles.filterActive, { backgroundColor: colors.activeBackgroundColor }]
    : [styles.filter, { borderColor: colors.color }];
  const textStyle = selected
    ? [styles.filterActiveText, { color: COLORS.white }]
    : [styles.filterText, { color: colors.color }];

  return (
    <TouchableOpacity
      style={buttonStyle}
      activeOpacity={0.8}
      onPress={() => onSelect(value)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} reservations`}
    >
      <Text style={textStyle} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const ReservationCard = ({ reservation }) => {
  const status = statusStyles[reservation.statusType] || statusStyles.pending;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.productIcon}>
          <MaterialIcons name="computer" size={20} color={COLORS.primary} />
        </View>
        <View style={styles.productCopy}>
          <Text style={styles.productName}>{reservation.product}</Text>
          <Text style={styles.shopName}>{reservation.shop}</Text>
        </View>
        <Text style={styles.price}>{reservation.price || "—"}</Text>
      </View>

      <View style={styles.divider} />
      <View style={styles.detailRow}>
        <View style={styles.detailItem}>
          <MaterialIcons name="event" size={16} color={COLORS.textMuted} />
          <Text style={styles.detailText}>{reservation.date || "Not specified"}</Text>
        </View>
        <View style={styles.detailItem}>
          <MaterialIcons name="schedule" size={16} color={COLORS.textMuted} />
          <Text style={styles.detailText}>{reservation.time || "Not specified"}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={[styles.statusPill, { backgroundColor: status.backgroundColor }]}>
          <MaterialIcons name={status.icon} size={14} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{reservation.status}</Text>
        </View>
        {reservation.note ? (
          <Text style={styles.noteText} numberOfLines={2}>Note: {reservation.note}</Text>
        ) : null}
      </View>
    </View>
  );
};

export default function ReservationHistoryScreen() {
  const params = useLocalSearchParams();
  const returnTo = params.returnTo || "/reservation";
  const [reservations, setReservations] = useState([]);
  const requestedFilter = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const selectedFilter = filterOptions.some((option) => option.value === requestedFilter) ? requestedFilter : "all";
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let unsubscribeReservations = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeReservations) unsubscribeReservations();
      setReservations([]);
      if (!user) {
        setIsLoading(false);
        router.replace("/");
        return;
      }

      setIsLoading(true);
      setErrorMessage("");
      const reservationsQuery = query(
        collection(db, "reservations"),
        where("userId", "==", user.uid),
      );

      unsubscribeReservations = onSnapshot(
        reservationsQuery,
        (snapshot) => {
          if (auth.currentUser?.uid !== user.uid) return;
          const nextReservations = snapshot.docs
            .map((document) => {
              const data = document.data();
              const status = statusForReservation(data.status);
              return {
                id: document.id,
                ...data,
                shop: /^\d+$/.test(String(data.storeId || "")) ? "the shop" : data.shop || "the shop",
                status: status.label,
                statusType: status.type,
              };
            });

          setReservations(sortReservationsNewestFirst(nextReservations));
          setIsLoading(false);
        },
        (error) => {
          if (auth.currentUser?.uid !== user.uid) return;
          console.error("Reservation history could not be loaded", error);
          setErrorMessage("Unable to load reservation history. Please try again.");
          setIsLoading(false);
        },
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeReservations) unsubscribeReservations();
    };
  }, []);

  const visibleReservations = reservations.filter((reservation) => {
    const selectedOption = filterOptions.find((option) => option.value === selectedFilter);
    return !selectedOption?.statusTypes || selectedOption.statusTypes.includes(reservation.statusType);
  });

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Reservations" onBack={() => router.replace(returnTo)} />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitle}>Track your current and past reservations.</Text>
            <View style={styles.sortHint}>
              <MaterialIcons name="sort" size={13} color={COLORS.primary} />
              <Text style={styles.sortHintText}>Newest first</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {filterOptions.map((option) => (
              <FilterButton
                key={option.value}
                value={option.value}
                label={option.label}
                selected={selectedFilter === option.value}
                onSelect={(filter) => router.setParams({ filter })}
              />
            ))}
          </ScrollView>
          {isLoading ? <Text style={styles.emptyText}>Loading reservations...</Text> : null}
          {!isLoading && errorMessage ? <Text style={styles.emptyText}>{errorMessage}</Text> : null}
          {!isLoading && !errorMessage && visibleReservations.length === 0 ? (
            <Text style={styles.emptyText}>No reservations found.</Text>
          ) : null}
          {!isLoading && !errorMessage && visibleReservations.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} />
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },

  content: { padding: SIZES.edgeMargin, paddingBottom: 24 },
  subtitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 },
  subtitle: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: COLORS.textMuted },
  sortHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  sortHintText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: COLORS.primary },
  filterRow: { flexDirection: "row", gap: 8, paddingBottom: 16 },
  filterActive: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  filterActiveText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: COLORS.white },
  filter: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.outline },
  filterText: { fontFamily: "Inter_500Medium", fontSize: 12, color: COLORS.textDim },
  card: { backgroundColor: COLORS.white, borderRadius: RADIUS.md, padding: 12, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.035, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  productIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: COLORS.primaryDim },
  productCopy: { flex: 1, marginLeft: 10 },
  productName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: COLORS.text },
  shopName: { marginTop: 3, fontFamily: "Inter_400Regular", fontSize: 12, color: COLORS.textMuted },
  price: { flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 14, color: COLORS.primary },
  divider: { height: 1, backgroundColor: COLORS.outline, marginVertical: 11 },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  detailItem: { flexDirection: "row", alignItems: "center" },
  detailText: { marginLeft: 5, fontFamily: "Inter_400Regular", fontSize: 12, color: COLORS.textDim },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  statusPill: { flexDirection: "row", alignItems: "center", borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 5 },
  statusText: { marginLeft: 5, fontFamily: "Inter_600SemiBold", fontSize: 11 },
  noteText: { flex: 1, marginLeft: 10, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.textMuted, textAlign: "right" },
  emptyText: { paddingVertical: 28, fontFamily: "Inter_400Regular", fontSize: 14, color: COLORS.textMuted, textAlign: "center" },
});
