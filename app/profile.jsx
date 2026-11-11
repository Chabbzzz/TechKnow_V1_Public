import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, SIZES, LAYOUT } from "../constants/theme";
import { auth, db } from "../backend/firebase";
import reservationPolicy from "../backend/domain/reservations";
import { GlassModal, ModalAction } from "../components/GlassModal";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

const ACCOUNT_FIELDS = [
  {
    key: "username",
    label: "Username",
    icon: "at-outline",
  },
  {
    key: "fullName",
    label: "Full name",
    icon: "person-outline",
  },
  {
    key: "email",
    label: "Email",
    icon: "mail-outline",
  },
  {
    key: "password",
    label: "Password",
    value: "••••••••",
    icon: "lock-closed-outline",
    secure: true,
  },
  {
    key: "address",
    label: "Address",
    icon: "location-outline",
  },
];

const DEFAULT_ACCOUNT = {
  username: null,
  fullName: "Loading profile...",
  email: "Loading...",
  password: "********",
  address: "Loading...",
};

const maskEmail = (email) => {
  const value = String(email || "");
  const separator = value.lastIndexOf("@");
  if (separator < 1 || separator === value.length - 1) return value;
  const localPart = Array.from(value.slice(0, separator));
  [1, 3, 5].forEach((index) => {
    if (localPart[index]) localPart[index] = "•";
  });
  return `${localPart.join("")}@${value.slice(separator + 1)}`;
};

export default function ProfileScreen() {
  const [account, setAccount] = useState(DEFAULT_ACCOUNT);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [activity, setActivity] = useState({ favorites: 0, reserves: 0, failed: 0 });

  useEffect(() => {
    let isMounted = true;
    let unsubscribeReservations = () => {};
    let unsubscribeFavorites = () => {};

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribeReservations();
      unsubscribeFavorites();
      setActivity({ favorites: 0, reserves: 0, failed: 0 });
      if (!user) {
        router.replace("/");
        return;
      }

      const userReservationsQuery = query(
        collection(db, "reservations"),
        where("userId", "==", user.uid),
      );
      const userFavoritesQuery = query(
        collection(db, "favorites"),
        where("userId", "==", user.uid),
      );

      unsubscribeReservations = onSnapshot(
        userReservationsQuery,
        (snapshot) => {
          const failed = snapshot.docs.filter((reservation) =>
            reservationPolicy.statusForReservation(reservation.data().status).type === "declined",
          ).length;
          if (isMounted && auth.currentUser?.uid === user.uid) {
            setActivity((current) => ({ ...current, reserves: snapshot.size, failed }));
          }
        },
        (error) => console.error("Could not load reservation activity", error),
      );

      unsubscribeFavorites = onSnapshot(
        userFavoritesQuery,
        (snapshot) => {
          if (isMounted && auth.currentUser?.uid === user.uid) {
            setActivity((current) => ({ ...current, favorites: snapshot.size }));
          }
        },
        (error) => console.error("Could not load favorite activity", error),
      );

      let savedProfile = {};
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        if (snapshot.exists()) savedProfile = snapshot.data();
      } catch (error) {
        console.error("Could not load the user profile", error);
      }

      if (!isMounted || auth.currentUser?.uid !== user.uid) return;
      setAccount({
        username: savedProfile.username || "",
        fullName: savedProfile.fullName || user.displayName || "Not provided",
        email: user.email || savedProfile.email || "Not provided",
        password: "********",
        address: savedProfile.address || "Not provided",
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
      unsubscribeReservations();
      unsubscribeFavorites();
    };
  }, []);

  const initials = account === DEFAULT_ACCOUNT ? "" : account.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const user = auth.currentUser;
      if (!user) return () => {};

      getDoc(doc(db, "users", user.uid))
        .then((snapshot) => {
          if (!isMounted) return;
          const savedProfile = snapshot.exists() ? snapshot.data() : {};
          setAccount({
            username: savedProfile.username || "",
            fullName: savedProfile.fullName || user.displayName || "Not provided",
            email: user.email || savedProfile.email || "Not provided",
            password: "********",
            address: savedProfile.address || "Not provided",
          });
        })
        .catch((error) => console.error("Could not refresh the user profile", error));

      return () => {
        isMounted = false;
      };
    }, []),
  );

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setShowLogoutModal(false);
      router.replace("/");
    } catch (error) {
      console.error("Could not log out", error);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Profile" />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileIntro}>
            <View style={styles.avatar}>
              {initials ? <Text style={styles.avatarText}>{initials}</Text>
                : <Ionicons name="person-outline" size={28} color={COLORS.primary} />}
            </View>
            <View style={styles.profileCopy}>
              <Text style={styles.profileName} numberOfLines={2}>{account.fullName}</Text>
              <Text style={styles.profileHandle} numberOfLines={2}>
                {account.username ? `@${account.username}` : maskEmail(account.email)}
              </Text>
            </View>
          </View>

          {account.username === "" ? (
            <TouchableOpacity style={styles.usernameNotice} activeOpacity={0.8}
              onPress={() => router.push("/edit-profile")} accessibilityRole="button"
              accessibilityLabel="Add a username to your account">
              <View style={styles.usernameNoticeIcon}>
                <Ionicons name="at-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.usernameNoticeCopy}>
                <Text style={styles.usernameNoticeTitle}>Choose your username</Text>
                <Text style={styles.usernameNoticeText}>Add a username so customers can recognize you.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>YOUR ACTIVITY</Text>
            <View style={styles.activityGrid}>
              {[
                { label: "Favorites", value: activity.favorites, icon: "heart-outline", color: "#C34C68",
                  destination: { pathname: "/favorites" } },
                { label: "Reservations", value: activity.reserves, icon: "bag-handle-outline", color: COLORS.primary,
                  destination: { pathname: "/reservation-history", params: { returnTo: "/profile", filter: "all" } } },
                { label: "Unsuccessful", value: activity.failed, icon: "close-circle-outline", color: COLORS.textMuted,
                  destination: { pathname: "/reservation-history", params: { returnTo: "/profile", filter: "declined" } } },
              ].map((item, index) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.activityCard, index > 0 && styles.activityDivider]}
                  activeOpacity={0.7}
                  onPress={() => router.push(item.destination)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.value} ${item.label.toLowerCase()}`}
                  accessibilityHint={`View your ${item.label.toLowerCase()}`}
                >
                  <Ionicons name={item.icon} size={20} color={item.color} />
                  <Text style={styles.activityValue}>
                    {item.value}
                  </Text>
                  <Text style={styles.activityLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.reviewButton}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Write a review"
            onPress={() =>
              router.push({ pathname: "/reviews", params: { returnTo: "/profile" } })
            }
          >
            <View style={styles.reviewIcon}>
              <Ionicons name="create-outline" size={22} color={COLORS.primary} />
            </View>
            <View style={styles.reviewButtonCopy}>
              <Text style={styles.reviewButtonTitle}>Write a review</Text>
              <Text style={styles.reviewButtonText}>
                Share your experience with a shop
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>ACCOUNT DETAILS</Text>
              <TouchableOpacity
                style={styles.editButton}
                accessibilityRole="button"
                accessibilityLabel="Edit account details"
                onPress={() => router.push("/edit-profile")}
                activeOpacity={0.75}
              >
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fieldsCard}>
              {ACCOUNT_FIELDS.map((field, index) => (
                <View key={field.key} style={[styles.fieldRow, index > 0 && styles.fieldDivider]}>
                  <View style={styles.fieldIcon}>
                    <Ionicons
                      name={field.icon}
                      size={18}
                      color={COLORS.textDim}
                    />
                  </View>
                  <View style={styles.fieldCopy}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldValue} accessibilityLabel={field.secure ? "Password hidden" : undefined}>
                      {field.key === "email" ? maskEmail(account.email)
                        : field.key === "username" ? account.username || "Not set"
                          : field.value || account[field.key]}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => setShowLogoutModal(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </ScrollView>
        <GlassModal
          variant="alert"
          visible={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          title="Log out of TechKnow?"
          message="You can sign in again anytime."
          icon="logout"
          alertIcon="log-out-outline"
          tone="danger"
          footer={<>
            <ModalAction title="Cancel" secondary onPress={() => setShowLogoutModal(false)} />
            <ModalAction title="Log out" danger divider onPress={handleLogout} />
          </>}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },

  content: {
    paddingHorizontal: SIZES.edgeMargin,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 16,
  },
  profileIntro: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    padding: 16,
    gap: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    flexShrink: 0,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryDim,
  },
  avatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: 22,
    color: COLORS.primary,
  },
  profileCopy: { flex: 1, minWidth: 0, gap: 4 },
  profileName: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    lineHeight: 26,
    color: COLORS.text,
  },
  profileHandle: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textMuted,
  },
  usernameNotice: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 76, padding: 14,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.primaryDim,
  },
  usernameNoticeIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center",
    borderRadius: 12, backgroundColor: COLORS.primaryDim },
  usernameNoticeCopy: { flex: 1, minWidth: 0, gap: 3 },
  usernameNoticeTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 19, color: COLORS.text },
  usernameNoticeText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, color: COLORS.textMuted },
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
    color: COLORS.textMuted,
    paddingLeft: 4,
  },
  editButton: { minWidth: 52, minHeight: 44, alignItems: "center", justifyContent: "center" },
  editText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: COLORS.primary,
  },
  activityGrid: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    paddingVertical: 14,
  },
  activityCard: {
    minWidth: 0,
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 6,
    gap: 4,
  },
  activityDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: COLORS.outline },
  activityValue: { fontFamily: "Inter_700Bold", fontSize: 24, lineHeight: 30, color: COLORS.text },
  activityLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textDim,
    textAlign: "center",
  },
  reviewButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    minHeight: 80,
    padding: 14,
    gap: 12,
  },
  reviewIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center" },
  reviewButtonCopy: { flex: 1, minWidth: 0, gap: 4 },
  reviewButtonTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.text,
  },
  reviewButtonText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
  },
  fieldsCard: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    paddingHorizontal: 14,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    minHeight: 68,
    gap: 12,
  },
  fieldDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.outline },
  fieldIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.surfaceHighlight,
    alignItems: "center", justifyContent: "center" },
  fieldCopy: { flex: 1, minWidth: 0, gap: 3 },
  fieldLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.textMuted,
  },
  fieldValue: {
    padding: 0,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  logoutButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: COLORS.white,
  },
  logoutText: {
    marginLeft: 7,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: COLORS.error,
  },

});
