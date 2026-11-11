import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../backend/firebase";
import { setFavorite, watchFavorites } from "../backend/services/favorites";
import { FavoriteCard } from "../components/FavoriteCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, LAYOUT, SIZES } from "../constants/theme";

export default function FavoritesScreen() {
  const [favorites, setFavorites] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [removingIds, setRemovingIds] = useState(new Set());
  const [removedFavorite, setRemovedFavorite] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const pendingRemovals = useRef(new Set());
  const hiddenFavoriteIds = useRef(new Set());
  const favoriteActionSequence = useRef(new Map());
  const restoring = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let unsubscribeFavorites = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeFavorites();
      const current = ++generation.current;
      pendingRemovals.current = new Set();
      hiddenFavoriteIds.current = new Set();
      favoriteActionSequence.current = new Map();
      restoring.current = false;
      setFavorites([]);
      setRemovingIds(new Set());
      setRemovedFavorite(null);
      setIsRestoring(false);
      setLoadError("");
      setActionError("");
      setIsLoading(Boolean(user));
      if (!user) {
        router.replace("/");
        return;
      }
      unsubscribeFavorites = watchFavorites(user.uid, (items) => {
        if (generation.current !== current || auth.currentUser?.uid !== user.uid) return;
        setFavorites(items.filter((item) => !hiddenFavoriteIds.current.has(item.id)));
        setIsLoading(false);
      }, (error) => {
        if (generation.current !== current || auth.currentUser?.uid !== user.uid) return;
        console.error("Favorites could not be loaded", error);
        setLoadError("Unable to load your favorites. Please try again.");
        setIsLoading(false);
      });
    });
    return () => {
      ++generation.current;
      unsubscribeAuth();
      unsubscribeFavorites();
    };
  }, [retryVersion]);

  const removeFavorite = async (item) => {
    if (auth.currentUser?.uid !== item.userId || pendingRemovals.current.has(item.id)) return;
    const current = generation.current;
    const action = (favoriteActionSequence.current.get(item.id) || 0) + 1;
    favoriteActionSequence.current.set(item.id, action);
    pendingRemovals.current.add(item.id);
    hiddenFavoriteIds.current.add(item.id);
    setRemovingIds(new Set(pendingRemovals.current));
    setFavorites((items) => items.filter((favorite) => favorite.id !== item.id));
    setRemovedFavorite(item);
    setActionError("");
    try {
      await setFavorite(item.productId, {}, false);
    } catch (error) {
      console.error("Favorite could not be removed", error);
      if (generation.current === current && favoriteActionSequence.current.get(item.id) === action) {
        hiddenFavoriteIds.current.delete(item.id);
        setFavorites((items) => items.some((favorite) => favorite.id === item.id) ? items : [item, ...items]);
        setRemovedFavorite((latest) => latest?.id === item.id ? null : latest);
        setActionError("Could not remove this favorite. Please try again.");
      }
    } finally {
      if (generation.current === current) {
        pendingRemovals.current.delete(item.id);
        setRemovingIds(new Set(pendingRemovals.current));
      }
    }
  };

  const undoRemoval = async () => {
    const item = removedFavorite;
    if (!item || restoring.current || auth.currentUser?.uid !== item.userId) return;
    const current = generation.current;
    const action = (favoriteActionSequence.current.get(item.id) || 0) + 1;
    favoriteActionSequence.current.set(item.id, action);
    restoring.current = true;
    setIsRestoring(true);
    hiddenFavoriteIds.current.delete(item.id);
    setFavorites((items) => items.some((favorite) => favorite.id === item.id) ? items : [item, ...items]);
    setRemovedFavorite(null);
    setActionError("");
    try {
      await setFavorite(item.productId, {
        title: item.product, shopName: item.shop, price: item.price, imageUrl: item.imageUrl,
      }, true);
    } catch (error) {
      console.error("Favorite could not be restored", error);
      if (generation.current === current && favoriteActionSequence.current.get(item.id) === action) {
        hiddenFavoriteIds.current.add(item.id);
        setFavorites((items) => items.filter((favorite) => favorite.id !== item.id));
        setRemovedFavorite(item);
        setActionError("Could not restore this favorite. The product may no longer be available. Please try again.");
      }
    } finally {
      if (generation.current === current) {
        restoring.current = false;
        setIsRestoring(false);
      }
    }
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Favorites" onBack={() => router.canGoBack() ? router.back() : router.replace("/profile")} />
        <View style={styles.intro}>
          <Text style={styles.subtitle}>Your saved products, all in one place.</Text>
          {!isLoading && !loadError && <Text style={styles.count} accessibilityLiveRegion="polite">
            {favorites.length} {favorites.length === 1 ? "product" : "products"}
          </Text>}
        </View>
        {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
        {isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator size="large" color={COLORS.primary} accessibilityLabel="Loading favorites" />
            <Text style={styles.subtitle}>Loading your favorites…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.state}>
            <MaterialIcons name="cloud-off" size={40} color={COLORS.textMuted} />
            <Text accessibilityRole="alert" style={styles.stateText}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={() => setRetryVersion((value) => value + 1)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={favorites}
            keyExtractor={(item) => item.id}
            extraData={removingIds}
            style={styles.list}
            contentContainerStyle={[styles.listContent, favorites.length === 0 && styles.emptyList]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.state}>
                <View style={styles.emptyIcon}><MaterialIcons name="favorite-border" size={36} color={COLORS.primary} /></View>
                <Text style={styles.stateTitle}>No favorites yet</Text>
                <Text style={styles.stateText}>Tap the heart on a product to save it here.</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push("/search")}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <Text style={styles.primaryText}>Browse products</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <FavoriteCard item={item} isRemoving={removingIds.has(item.id)} onRemove={() => removeFavorite(item)} />
            )}
          />
        )}
        {removedFavorite && <View style={styles.notice}>
          <Text style={styles.noticeText} accessibilityLiveRegion="polite" numberOfLines={2}>
            {removedFavorite.product || "Product"} removed from favorites.
          </Text>
          <Pressable onPress={undoRemoval} disabled={isRestoring} accessibilityRole="button"
            accessibilityLabel="Undo removal from favorites" accessibilityState={{ disabled: isRestoring, busy: isRestoring }}
            style={({ pressed }) => [styles.noticeAction, pressed && styles.pressed]}>
            {isRestoring ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.removeText}>Undo</Text>}
          </Pressable>
          <Pressable onPress={() => setRemovedFavorite(null)} accessibilityRole="button" accessibilityLabel="Dismiss removal message"
            style={styles.noticeAction}>
            <MaterialIcons name="close" size={20} color={COLORS.textMuted} />
          </Pressable>
        </View>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  intro: { paddingHorizontal: SIZES.edgeMargin, paddingBottom: 16, gap: 8 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, color: COLORS.textMuted },
  count: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: COLORS.primary },
  list: { flex: 1 },
  listContent: { paddingHorizontal: SIZES.edgeMargin, paddingTop: 4, paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  separator: { height: 16 },
  removeText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: COLORS.primary },
  state: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  stateTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: COLORS.text, textAlign: "center" },
  stateText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22, color: COLORS.textMuted, textAlign: "center" },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primaryDim },
  primaryButton: { minHeight: 48, justifyContent: "center", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: COLORS.primary },
  primaryText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: COLORS.white, textAlign: "center" },
  error: { marginHorizontal: SIZES.edgeMargin, marginBottom: 12, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20, color: COLORS.error },
  notice: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: SIZES.edgeMargin, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: COLORS.outline, backgroundColor: COLORS.surface },
  noticeText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.text },
  noticeAction: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.65 },
});
