import React from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Text,
  Image,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { COLORS, SIZES, RADIUS, LAYOUT } from "../constants/theme";
import { ProductCard } from "../components/ProductCard";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { LinearGradient } from "expo-linear-gradient";
import { useProductGrid } from "../hooks/useProductGrid";
import { useProducts } from "../hooks/useProducts";
import { useReservationCounts } from "../hooks/useReservationCounts";
import { useRecommendations } from "../hooks/useRecommendations";
import { useReservationPreview } from "../hooks/useReservationPreview";
import { ReservationPreviewModal } from "../components/ReservationPreviewModal";
import { toProductCard, toReservationParams } from "../constants/products";
import { auth, db } from "../backend/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import teamLogo from "../teamlogo-clean.png";

const initialsFromName = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const aggregateMostReservedProducts = (products, reservationCounts) => {
  const groups = new Map();

  products.forEach((product) => {
    const productName = String(product.name || product.title || "Unnamed product").trim();
    const category = String(product.category || "Other").trim().toLowerCase();
    const key = `${productName.toLowerCase()}::${category}`;
    const storedCount = Math.max(0, Number(product.reservationCount || 0));
    const reservationCount = reservationCounts
      ? reservationCounts[product.id] || 0
      : storedCount;
    const shopKey = String(product.storeId || product.shopName || product.id);
    const existing = groups.get(key);

    if (existing) {
      existing.reservationCount += reservationCount;
      existing.shopKeys.add(shopKey);
      if (reservationCount > existing.representativeReservationCount) {
        existing.representative = product;
        existing.representativeReservationCount = reservationCount;
      }
      return;
    }

    groups.set(key, {
      representative: product,
      representativeReservationCount: reservationCount,
      reservationCount,
      shopKeys: new Set([shopKey]),
    });
  });

  return Array.from(groups.values())
    .filter((group) => group.reservationCount > 5)
    .sort((left, right) => right.reservationCount - left.reservationCount)
    .slice(0, 10)
    .map((group) => ({
      ...group.representative,
      reservationCount: group.reservationCount,
      shopCount: group.shopKeys.size,
      shopName: group.representative.shopName,
      reservationShopName: group.representative.shopName,
    }));
};

export default function HomeScreen() {
  const listRef = React.useRef(null);
  const [showScrollToTop, setShowScrollToTop] = React.useState(false);
  const { fontScale } = useWindowDimensions();
  const { columns, cardWidth } = useProductGrid();
  React.useEffect(() => setShowScrollToTop(false), [columns]);
  const { products, isLoading, error } = useProducts();
  const { openReservation, reservationPreviewProps } = useReservationPreview("/home");
  const reservationCounts = useReservationCounts();
  const cardProducts = products.map(toProductCard);
  const {
    recommendations,
    isLoading: recommendationsLoading,
    hasPersonalizedSignals,
  } = useRecommendations(cardProducts, reservationCounts);
  const [profileInitials, setProfileInitials] = React.useState("");
  const mostReservedProducts = aggregateMostReservedProducts(cardProducts, reservationCounts);
  const recommendedProducts = recommendations.length ? recommendations : cardProducts.slice(0, 6);
  const reservationParamsFor = (item) =>
    toReservationParams(
      { ...item, shopName: item.reservationShopName || item.shopName },
      "/home",
    );

  const openCompare = (item) => {
    router.push({ pathname: "/compare", params: { ...reservationParamsFor(item), returnTo: "/home" } });
  };

  const renderItem = ({ item }) => (
    <View style={[styles.gridItem, { width: cardWidth }]}>
      <ProductCard
        productId={item.id}
        title={item.title}
        price={item.price}
        rating={item.rating}
        stock={item.stock}
        shopName={item.shopName}
        variant={item.variant}
        imageUrl={item.imageUrl}
        imagePath={item.imagePath}
        onPress={() => openCompare(item)}
        onReserve={() => openReservation(item, "/home")}
      />
    </View>
  );

  const renderMostReservedItem = (item) => (
      <ProductCard
        productId={item.id}
        title={item.title}
        price={item.price}
        rating={item.rating}
        stock={item.stock}
        shopName={item.shopName}
        variant={item.variant}
        imageUrl={item.imageUrl}
        imagePath={item.imagePath}
        showCompare
        onPress={() => openCompare(item)}
        onCompare={() => openCompare(item)}
        onReserve={() => openReservation(item, "/home")}
      />
  );

  const renderRecommendedItem = (item) => (
    <View key={`recommendation-${item.id}`} style={[styles.gridItem, styles.recommendationGridItem, { width: cardWidth }]}>
      <ProductCard
        productId={item.id}
        title={item.title}
        price={item.price}
        rating={item.rating}
        stock={item.stock}
        shopName={item.shopName}
        variant={item.variant}
        imageUrl={item.imageUrl}
        imagePath={item.imagePath}
        onPress={() => openCompare(item)}
        onReserve={() => openReservation(item, "/home")}
      />
      <Text style={[styles.recommendationReason, { minHeight: 32 * fontScale }]} numberOfLines={2}>
        {item.recommendationReason || "Recommended from current store listings"}
      </Text>
    </View>
  );

  const recommendedSection = (
    <View>
      <LinearGradient colors={["#103a79", "#0b5bd3", "#297fdc"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroBadge}>
          <MaterialIcons name="auto-awesome" size={15} color="#c9e5ff" />
          <Text style={styles.heroEyebrow}>YOUR NEXT UPGRADE</Text>
        </View>
        <Text style={styles.heroTitle}>Great tech.{"\n"}Closer to you.</Text>
        <Text style={styles.heroText}>Discover local listings, compare your options, and reserve with confidence.</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/search")}
          activeOpacity={0.8} style={styles.heroAction}>
          <Text style={styles.heroActionText}>Explore products</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>
      <Text style={styles.sectionTitle}>Picked for you</Text>
      <Text style={styles.recommendationSubtitle}>
        {hasPersonalizedSignals
          ? "Personalized from your favorites and reservations"
          : "Popular picks while we learn your preferences"}
      </Text>
      {recommendationsLoading && !recommendations.length ? (
        <Text style={styles.recommendationLoading}>Loading your recommendations...</Text>
      ) : recommendedProducts.length ? (
        <View style={styles.mostReservedGrid}>
          {recommendedProducts.map(renderRecommendedItem)}
        </View>
      ) : (
        <Text style={styles.mostReservedEmpty}>No recommendations yet.</Text>
      )}
      <Text style={styles.sectionTitle}>Explore all products</Text>
    </View>
  );

  const mostReservedSection = (
    <View>
      <Text style={styles.sectionTitle}>Popular with shoppers</Text>
      {mostReservedProducts.length ? (
        <View style={styles.mostReservedGrid}>
          {mostReservedProducts.map((item) => (
            <View key={`reserved-${item.id}`} style={[styles.gridItem, styles.mostReservedGridItem, { width: cardWidth }]}>
              {renderMostReservedItem(item)}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.mostReservedEmpty}>
          Your community’s most-reserved products will appear here.
        </Text>
      )}
      <View style={styles.listFooter} />
    </View>
  );

  React.useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (isMounted) setProfileInitials("");
        return;
      }

      let name = user.displayName || user.email?.split("@")[0] || "User";
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        name = snapshot.data()?.fullName || name;
      } catch (profileError) {
        console.error("Could not load the home profile initials", profileError);
      }
      if (isMounted) setProfileInitials(initialsFromName(name) || "U");
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.catalog]}>
        <View style={styles.header}>
          <View>
            <Image source={teamLogo} resizeMode="contain" style={styles.brandLogo}
              accessibilityLabel="TechKnow logo" />
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            activeOpacity={0.8}
            onPress={() => router.push("/profile")}
            accessibilityRole="button"
            accessibilityLabel="Open account profile"
          >
            <Text style={styles.profileInitials}>{profileInitials || "?"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.searchBar}
          activeOpacity={0.8}
          onPress={() =>
            router.replace({ pathname: "/search", params: { returnTo: "/home" } })
          }
        >
          <MaterialIcons name="search" size={22} color={COLORS.textMuted} />
          <Text style={styles.searchPlaceholder}>Search</Text>
        </TouchableOpacity>

        <View style={styles.scrollContainer}>
          <FlatList
            ref={listRef}
            onScroll={({ nativeEvent }) => setShowScrollToTop(nativeEvent.contentOffset.y > 200)}
            scrollEventThrottle={16}
            key={`catalog-${columns}`}
            data={cardProducts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ListHeaderComponent={recommendedSection}
            numColumns={columns}
            columnWrapperStyle={columns > 1 ? styles.row : undefined}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                {isLoading ? <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 16 }} /> : <MaterialIcons name="inventory-2" size={36} color={COLORS.primary} />}
                <Text style={styles.emptyTitle}>{isLoading ? "Loading products..." : "No products have been listed yet."}</Text>
                <Text style={styles.emptyText}>{error || "Products added by stores will appear here."}</Text>
              </View>
            }
            ListFooterComponent={mostReservedSection}
          />
          <ScrollToTopButton
            visible={showScrollToTop}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityLabel="Scroll home to top"
          />
        </View>

        <ReservationPreviewModal {...reservationPreviewProps} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContainer: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SIZES.edgeMargin, paddingTop: 10, paddingBottom: 10 },
  brandLogo: { width: 126, height: 43, alignSelf: "flex-start", marginBottom: 3 },
  pageTitle: { fontFamily: "Inter_700Bold", fontSize: 28, lineHeight: 34, color: COLORS.text },
  profileButton: { width: 46, height: 46, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "#e4eeff", borderWidth: 1, borderColor: "#fff" },
  profileInitials: { fontFamily: "Inter_700Bold", fontSize: 14, color: COLORS.primary },
  searchBar: { marginHorizontal: SIZES.edgeMargin, marginBottom: 8, flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: RADIUS.lg, paddingHorizontal: 16, minHeight: 52, borderWidth: 1, borderColor: COLORS.outline },
  searchPlaceholder: { marginLeft: 10, flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: COLORS.textMuted },
  hero: { marginTop: 12, marginBottom: 4, borderRadius: RADIUS.xl, padding: 24, overflow: "hidden" },
  heroBadge: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroEyebrow: { fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 1.6, color: "#d6eaff" },
  heroTitle: { marginTop: 15, fontFamily: "Inter_700Bold", fontSize: 29, lineHeight: 35, color: "#fff" },
  heroText: { maxWidth: 430, marginTop: 10, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 21, color: "#dfecff" },
  heroAction: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 12,
    marginTop: 18, minHeight: 44, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.15)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", borderRadius: 14 },
  heroActionText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#fff" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 27, color: COLORS.text, marginTop: 26, marginBottom: 12 },
  listContent: { paddingHorizontal: SIZES.edgeMargin, paddingBottom: 80 },
  row: { gap: 12, alignItems: "stretch", justifyContent: "flex-start" },
  gridItem: { marginBottom: 16, alignSelf: "stretch" },
  mostReservedGrid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", justifyContent: "flex-start", gap: 12 },
  mostReservedGridItem: { marginBottom: 0 },
  recommendationGridItem: { marginBottom: 0 },
  recommendationSubtitle: { marginTop: -5, marginBottom: 14, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.textMuted },
  recommendationReason: { marginTop: 7, paddingHorizontal: 4, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, color: COLORS.textMuted },
  recommendationLoading: { marginBottom: 10, fontFamily: "Inter_400Regular", fontSize: 13, color: COLORS.textMuted },
  mostReservedEmpty: { marginBottom: 2, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, color: COLORS.textMuted },
  listFooter: { height: 10 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 40, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: COLORS.text, textAlign: "center" },
  emptyText: { marginTop: 8, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, color: COLORS.textMuted, textAlign: "center" },
});
