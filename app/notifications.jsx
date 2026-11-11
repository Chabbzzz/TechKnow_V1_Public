import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, RADIUS, SIZES, LAYOUT } from "../constants/theme";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { useProductNotifications } from "../hooks/useProductNotifications";
import { markNotificationsRead, notificationTimestamp } from "../backend/services/notifications";
import { toReservationParams } from "../constants/products";
import { auth, db } from "../backend/firebase";
import reviewNotifications from "../backend/domain/review-notifications";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

const toneStyles = {
  blue: { backgroundColor: COLORS.primaryDim, color: COLORS.primary },
  green: { backgroundColor: "#e1f3e5", color: "#218739" },
  orange: { backgroundColor: "#FFF3DF", color: "#99620A" },
  gray: { backgroundColor: "#eef0f3", color: COLORS.textMuted },
  red: { backgroundColor: "#ffe8e5", color: "#c62828" },
};

const CATEGORIES = ["All", "Reservations", "Reviews", "System", "Alerts"];

const timestampToMillis = notificationTimestamp;

const relativeTime = (value) => {
  const timestamp = timestampToMillis(value);
  if (!timestamp) return "Recently";

  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(timestamp).toLocaleDateString();
};

const notificationFromReservation = (document) => {
  const reservation = document.data();
  const status = String(reservation.status || "pending").toLowerCase();
  const product = reservation.product || "your reservation";
  const legacyStoreId = /^\d+$/.test(String(reservation.storeId || ""));
  const shop = legacyStoreId ? "the shop" : reservation.shop || "the shop";
  const statusDetails = {
    pending: {
      icon: "schedule",
      title: "Reservation submitted",
      message: `Your reservation for ${product} at ${shop} is waiting for confirmation.`,
      tone: "orange",
    },
    accepted: {
      icon: "event-available",
      title: "Reservation accepted",
      message: `${shop} accepted your reservation for ${product}.`,
      tone: "blue",
    },
    ongoing: {
      icon: "event-available",
      title: "Reservation accepted",
      message: `${shop} accepted your reservation for ${product}.`,
      tone: "blue",
    },
    completed: {
      icon: "check-circle",
      title: "Reservation completed",
      message: `Your visit to ${shop} for ${product} was completed.`,
      tone: "gray",
    },
    rejected: {
      icon: "cancel",
      title: "Reservation rejected",
      message: reservation.rejectionReason === "unclaimed-after-24-hours"
        ? `Your reservation for ${product} at ${shop} expired after 24 hours and was automatically rejected.`
        : `${shop} rejected your reservation for ${product}.`,
      tone: "red",
    },
    cancelled: {
      icon: "cancel",
      title: "Reservation cancelled",
      message: reservation.cancellationReason === "unclaimed-after-24-hours"
        ? `Your reservation for ${product} at ${shop} expired after 24 hours and was returned to available stock.`
        : `Your reservation for ${product} at ${shop} was cancelled.`,
      tone: "red",
    },
  };
  const details = statusDetails[status] || statusDetails.pending;
  const timestamp = reservation.updatedAt || reservation.createdAt;

  return {
    id: `${document.id}:${status}`,
    reservationId: document.id,
    category: "Reservations",
    timestamp: timestampToMillis(timestamp),
    time: relativeTime(timestamp),
    ...details,
  };
};

const notificationFromReview = (document) => {
  const { timestampSource, ...details } = reviewNotifications.reviewNotificationDetails(document.data(), document.id);
  const timestamp = timestampToMillis(timestampSource);
  return {
    ...details,
    timestamp,
    time: relativeTime(timestamp),
  };
};

export default function NotificationsScreen() {
  const scrollViewRef = useRef(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const { notifications: productAlerts, moderationNotifications = [], isLoading: productsLoading, error: productError } = useProductNotifications();
  const [activeCategory, setActiveCategory] = useState("All");
  const [reservationNotifications, setReservationNotifications] = useState([]);
  const [reviewNotifications, setReviewNotifications] = useState([]);
  const [readNotificationIds, setReadNotificationIds] = useState(new Set());
  const [currentUserId, setCurrentUserId] = useState("");
  const [sourcesLoaded, setSourcesLoaded] = useState({
    reservations: false,
    reviews: false,
    profile: false,
  });
  const [errorMessage, setErrorMessage] = useState("");
  const notifications = [...reservationNotifications, ...reviewNotifications,
    ...moderationNotifications.map(notification => ({ ...notification, time: relativeTime(notification.timestamp) })),
    ...productAlerts.map((notification) => ({ ...notification, time: relativeTime(notification.timestamp) })),
  ].sort(
    (left, right) => right.timestamp - left.timestamp,
  );
  const isLoading = !sourcesLoaded.reservations || !sourcesLoaded.reviews || !sourcesLoaded.profile || productsLoading;

  useEffect(() => {
    let unsubscribeReservations = () => {};
    let unsubscribeReviews = () => {};
    let unsubscribeProfile = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeReservations();
      unsubscribeReviews();
      unsubscribeProfile();

      setReservationNotifications([]);
      setReviewNotifications([]);
      setReadNotificationIds(new Set());

      if (!user) {
        setCurrentUserId("");
        setSourcesLoaded({ reservations: true, reviews: true, profile: true });
        router.replace("/");
        return;
      }

      setCurrentUserId(user.uid);
      setErrorMessage("");
      setSourcesLoaded({ reservations: false, reviews: false, profile: false });

      unsubscribeProfile = onSnapshot(doc(db, "users", user.uid),
        (snapshot) => {
          if (auth.currentUser?.uid !== user.uid) return;
          const savedReadIds = snapshot.data()?.notificationReadIds;
          setReadNotificationIds(new Set(Array.isArray(savedReadIds) ? savedReadIds : []));
          setSourcesLoaded((current) => ({ ...current, profile: true }));
        },
        (error) => {
          if (auth.currentUser?.uid !== user.uid) return;
          console.error("Notification read state could not be loaded", error);
          setErrorMessage("Unable to load notification read status. Please try again.");
          setSourcesLoaded((current) => ({ ...current, profile: true }));
        });

      const reservationsQuery = query(
        collection(db, "reservations"),
        where("userId", "==", user.uid),
      );

      unsubscribeReservations = onSnapshot(
        reservationsQuery,
        (snapshot) => {
          if (auth.currentUser?.uid !== user.uid) return;
          setReservationNotifications(snapshot.docs.map(notificationFromReservation));
          setSourcesLoaded((current) => ({ ...current, reservations: true }));
        },
        (error) => {
          if (auth.currentUser?.uid !== user.uid) return;
          console.error("Notifications could not be loaded", error);
          setErrorMessage("Unable to load notifications. Please try again.");
          setSourcesLoaded((current) => ({ ...current, reservations: true }));
        },
      );

      const reviewsQuery = query(
        collection(db, "reviews"),
        where("userId", "==", user.uid),
      );

      unsubscribeReviews = onSnapshot(
        reviewsQuery,
        (snapshot) => {
          if (auth.currentUser?.uid !== user.uid) return;
          setReviewNotifications(snapshot.docs.map(notificationFromReview));
          setSourcesLoaded((current) => ({ ...current, reviews: true }));
        },
        (error) => {
          if (auth.currentUser?.uid !== user.uid) return;
          console.error("Review notifications could not be loaded", error);
          setErrorMessage("Unable to load review notifications. Please try again.");
          setSourcesLoaded((current) => ({ ...current, reviews: true }));
        },
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeReservations();
      unsubscribeReviews();
      unsubscribeProfile();
    };
  }, []);

  const visibleNotifications =
    activeCategory === "All"
      ? notifications
      : notifications.filter(
          (notification) => notification.category === activeCategory,
        );
  const unreadCount = notifications.filter(
    (notification) => !readNotificationIds.has(notification.id),
  ).length;

  const markAllAsRead = () => {
    markNotificationsRead(currentUserId, notifications.map((notification) => notification.id))
      .catch((error) => {
        console.error("Notification read state could not be saved", error);
        setErrorMessage("Unable to mark notifications as read. Please try again.");
      });
  };

  const openNotification = (notification) => {
    markNotificationsRead(currentUserId, [notification.id]).catch((error) => {
      console.error("Notification read state could not be saved", error);
      setErrorMessage("Unable to mark the notification as read. Please try again.");
    });
    if (notification.category === "Reviews") return;
    if (notification.product) {
      router.push({ pathname: "/compare", params: toReservationParams(notification.product, "/notifications") });
      return;
    }
    router.push({
      pathname: notification.category === "Reviews" ? "/reviews" : "/reservation-history",
      params: { returnTo: "/notifications" },
    });
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Notifications" right={
          <TouchableOpacity style={styles.markAction} onPress={markAllAsRead} disabled={unreadCount === 0}
            accessibilityRole="button" accessibilityLabel="Mark all notifications as read">
            <MaterialIcons name="done-all" size={24} color={unreadCount ? COLORS.primary : COLORS.textMuted} />
          </TouchableOpacity>
        } />

        <View style={styles.scrollContainer}>
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            onScroll={({ nativeEvent }) => {
              setShowScrollToTop(nativeEvent.contentOffset.y > 200);
            }}
            scrollEventThrottle={16}
          >
            <View style={styles.introRow}>
              <Text style={styles.subtitle}>
                Your activity, all in one place.
              </Text>
              <View style={styles.countPill}>
                <Text style={styles.countText}>{unreadCount} new</Text>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryList}
            >
              {CATEGORIES.map((category) => (
                <TouchableOpacity
                  key={category}
                  style={[
                    styles.categoryChip,
                    activeCategory === category && styles.categoryChipActive,
                  ]}
                  onPress={() => setActiveCategory(category)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activeCategory === category }}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      activeCategory === category && styles.categoryTextActive,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {isLoading ? <Text style={styles.emptyText}>Loading notifications...</Text> : null}
            {!isLoading && (errorMessage || productError) ? (
              <Text style={styles.emptyText}>{errorMessage || productError}</Text>
            ) : null}
            {!isLoading && !errorMessage && !productError && visibleNotifications.length === 0 ? (
              <Text style={styles.emptyText}>
                {notifications.length === 0
                  ? "You do not have any notifications yet."
                  : "No notifications in this category."}
              </Text>
            ) : null}
            {!isLoading && visibleNotifications.length > 0 ? (
              <View style={styles.notificationList}>
                {visibleNotifications.map((notification) => {
                  const tone = toneStyles[notification.tone] || toneStyles.gray;
                  const isUnread = !readNotificationIds.has(notification.id);
                  return (
                    <TouchableOpacity
                      key={notification.id}
                      style={[styles.notificationRow, isUnread && styles.notificationUnread]}
                      activeOpacity={0.72}
                      onPress={() => openNotification(notification)}
                      accessibilityRole="button"
                      accessibilityLabel={`${isUnread ? "Unread. " : ""}${notification.title}. ${notification.message}. ${notification.time}`}
                      accessibilityHint={notification.category === "Reviews" ? "Marks this notification as read" : "Opens notification details"}
                    >
                      <View style={styles.notificationMeta}>
                        <View style={[styles.notificationIcon, { backgroundColor: tone.backgroundColor }]}>
                          <MaterialIcons name={notification.icon} size={18} color={tone.color} />
                        </View>
                        <Text style={styles.notificationCategory}>
                          {notification.category}
                        </Text>
                        <Text style={styles.notificationTime}>{notification.time}</Text>
                      </View>
                      <View style={styles.notificationCopy}>
                        <View style={styles.titleRow}>
                          <Text style={[styles.notificationTitle, isUnread && styles.notificationTitleUnread]}>
                            {notification.title}
                          </Text>
                          {isUnread && <View style={styles.unreadDot} />}
                        </View>
                        <Text style={styles.notificationMessage}>
                          {notification.message}
                        </Text>
                        <View style={styles.notificationFooter}>
                          {notification.statusLabel ? (
                            <View style={[styles.statusBadge, { backgroundColor: tone.backgroundColor }]}>
                              <Text style={[styles.notificationStatus, { color: tone.color }]}>
                                {notification.statusLabel}
                              </Text>
                            </View>
                          ) : null}
                          <MaterialIcons name="chevron-right" size={19} color="#A4ACB8" style={styles.notificationChevron} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>
          <ScrollToTopButton
            visible={showScrollToTop}
            onPress={() => scrollViewRef.current?.scrollTo({ y: 0, animated: true })}
            accessibilityLabel="Scroll notifications to top"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContainer: { flex: 1 },

  markAction: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },

  content: {
    paddingHorizontal: SIZES.edgeMargin,
    paddingTop: 12,
    paddingBottom: 80,
  },
  introRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  subtitle: {
    flex: 1,
    marginRight: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.textMuted,
  },
  countPill: {
    backgroundColor: COLORS.primaryDim,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: COLORS.primary,
  },
  categoryList: { gap: 6, paddingBottom: 22 },
  categoryChip: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: "#EDEFF3",
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryChipActive: {
    backgroundColor: COLORS.primary,
  },
  categoryText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: COLORS.textDim,
  },
  categoryTextActive: { color: COLORS.white, fontFamily: "Inter_600SemiBold" },
  notificationList: {
    gap: 12,
  },
  notificationRow: {
    padding: 16,
    backgroundColor: COLORS.white,
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E4E8EF",
    shadowColor: "#243653",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 1,
  },
  notificationUnread: { borderColor: "#CBDCF4", backgroundColor: "#FCFDFF" },
  notificationMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  notificationIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  notificationCopy: { minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center" },
  notificationCategory: {
    fontFamily: "Inter_600SemiBold",
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
  },
  notificationTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
  },
  notificationTitleUnread: { fontFamily: "Inter_700Bold" },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginLeft: 10,
  },
  notificationMessage: {
    marginTop: 6,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 21,
    color: COLORS.textDim,
  },
  notificationFooter: { flexDirection: "row", alignItems: "center", marginTop: 10, minHeight: 22 },
  notificationChevron: { marginLeft: "auto" },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, flexShrink: 1 },
  notificationStatus: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    lineHeight: 16,
  },
  notificationTime: {
    flexShrink: 1,
    textAlign: "right",
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.textMuted,
  },
  emptyText: {
    paddingVertical: 28,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: "center",
  },
});
