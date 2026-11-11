import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Animated,
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { COLORS, SIZES, RADIUS, LAYOUT } from "../constants/theme";
import { ScrollToTopButton } from "../components/ScrollToTopButton";
import { useProducts } from "../hooks/useProducts";
import { useProductGrid } from "../hooks/useProductGrid";
import { ProductCard } from "../components/ProductCard";
import { toProductCard, toReservationParams } from "../constants/products";
import { useReservationPreview } from "../hooks/useReservationPreview";
import { ReservationPreviewModal } from "../components/ReservationPreviewModal";

const CATEGORIES = [
  "All",
  "Components",
  "Peripherals",
  "Laptops",
  "Monitors",
  "Storage",
  "Networking",
  "Accessories",
  "Computer Parts",
];
const RECENT_SEARCHES_KEY = "techknow.recent-searches.v1";

const productKey = (item) => item.id;
const openCompare = (item) => {
  router.push({ pathname: "/compare", params: { ...toReservationParams(item, "/search"), returnTo: "/search" } });
};

const SearchProductCell = React.memo(function SearchProductCell({ item, width, onReserve }) {
  return (
    <View style={[styles.productCell, { width }]}>
      <ProductCard
        productId={item.id} title={item.title} price={item.price} rating={item.rating}
        stock={item.stock} shopName={item.shopName} variant={item.variant}
        imageUrl={item.imageUrl} imagePath={item.imagePath} showCompare
        onPress={() => openCompare(item)} onCompare={() => openCompare(item)}
        onReserve={() => onReserve(item, "/search")} />
    </View>
  );
});

const RecentRow = ({ label, onPress, onRemove }) => (
  <View style={styles.recentRow}>
    <TouchableOpacity style={styles.recentSelect} onPress={onPress} activeOpacity={0.7}
      accessibilityRole="button" accessibilityLabel={`Search for ${label}`}>
      <MaterialIcons name="history" size={18} color={COLORS.textMuted} />
      <Text style={styles.recentText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.removeButton}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${label} from recent searches`}
      onPress={onRemove}
    >
      <MaterialIcons name="close" size={15} color={COLORS.textMuted} />
    </TouchableOpacity>
  </View>
);

const RecentSearchDropdown = ({ visible, children }) => {
  const [mounted, setMounted] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

  React.useEffect(() => {
    if (visible) setMounted(true);
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, progress]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.recentDropdown, {
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
};

export default function SearchScreen() {
  const listRef = React.useRef(null);
  const [showScrollToTop, setShowScrollToTop] = React.useState(false);
  const { columns, cardWidth } = useProductGrid();
  React.useEffect(() => setShowScrollToTop(false), [columns]);
  const { openReservation, reservationPreviewProps } = useReservationPreview("/search");
  const params = useLocalSearchParams();
  const returnTo = params.returnTo || "/home";
  const [selectedCategory, setSelectedCategory] = React.useState("All");
  const [appliedCategory, setAppliedCategory] = React.useState("All");
  const [isCategoryPending, startCategoryTransition] = React.useTransition();
  const [searchText, setSearchText] = React.useState("");
  const [recentSearches, setRecentSearches] = React.useState([]);
  const [showRecentDropdown, setShowRecentDropdown] = React.useState(false);
  const recentSearchesLoaded = React.useRef(false);
  const { products, isLoading, error } = useProducts();
  const cardProducts = React.useMemo(() => products.map(toProductCard), [products]);
  const selectCategory = React.useCallback((category) => {
    // Acknowledge the tap immediately; render the matching grid at lower priority.
    setSelectedCategory(category);
    startCategoryTransition(() => setAppliedCategory(category));
  }, []);
  const normalizedSearch = React.useDeferredValue(searchText.trim().toLowerCase());
  const renderProduct = React.useCallback(({ item }) => (
    <SearchProductCell item={item} width={cardWidth} onReserve={openReservation} />
  ), [cardWidth, openReservation]);

  React.useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((storedSearches) => {
        if (!isMounted) return;
        const parsedSearches = storedSearches ? JSON.parse(storedSearches) : [];
        setRecentSearches(Array.isArray(parsedSearches) ? parsedSearches.slice(0, 3) : []);
      })
      .catch((storageError) => console.warn("Recent searches could not be loaded", storageError))
      .finally(() => {
        recentSearchesLoaded.current = true;
      });
    return () => { isMounted = false; };
  }, []);

  React.useEffect(() => {
    if (!recentSearchesLoaded.current) return;
    AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches))
      .catch((storageError) => console.warn("Recent searches could not be saved", storageError));
  }, [recentSearches]);

  const saveSearch = (value) => {
    const query = value.trim();
    if (!query) return;
    setRecentSearches((currentSearches) => [
      query,
      ...currentSearches.filter((search) => search.toLowerCase() !== query.toLowerCase()),
    ].slice(0, 3));
  };

  const removeRecentSearch = (value) => {
    setRecentSearches((currentSearches) =>
      currentSearches.filter((search) => search !== value),
    );
  };

  const filteredProducts = React.useMemo(() =>
    appliedCategory === "All"
      ? cardProducts
      : cardProducts.filter(
          (product) => product.category.toLowerCase() === appliedCategory.toLowerCase(),
        ), [cardProducts, appliedCategory]);
  const searchedProducts = React.useMemo(() => !normalizedSearch ? filteredProducts : filteredProducts.filter((product) =>
    [product.title, product.category, product.shopName, product.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
  ), [filteredProducts, normalizedSearch]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.catalog]}>
        <View style={styles.scrollContainer}>
          <FlatList
            ref={listRef}
            onScroll={({ nativeEvent }) => setShowScrollToTop(nativeEvent.contentOffset.y > 200)}
            scrollEventThrottle={16}
            key={`search-${columns}`}
            data={searchedProducts}
            accessibilityState={{ busy: isLoading || isCategoryPending }}
            keyExtractor={productKey}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={7}
            numColumns={columns}
            columnWrapperStyle={columns > 1 ? styles.productRow : undefined}
            contentContainerStyle={styles.contentContainer}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            renderItem={renderProduct}
            ListHeaderComponent={<View>
              <Text style={styles.pageTitle}>Find your next upgrade</Text>
            <View style={styles.searchHeader}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.replace(returnTo)}
                activeOpacity={0.7}
              >
                <MaterialIcons
                  name="arrow-back"
                  size={22}
                  color={COLORS.primary}
                />
              </TouchableOpacity>
              <View style={styles.searchBar}>
                <MaterialIcons name="search" size={21} color={COLORS.textMuted} />
                <TextInput
                  placeholder="Search"
                  placeholderTextColor={COLORS.textMuted}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  value={searchText}
                  onChangeText={setSearchText}
                  onFocus={() => setShowRecentDropdown(true)}
                  onBlur={() => setShowRecentDropdown(false)}
                  onSubmitEditing={() => saveSearch(searchText)}
                  returnKeyType="search"
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearchText("")}
                  hitSlop={8}
                >
                  <MaterialIcons name="close" size={15} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.nearbyIconButton}
                accessibilityLabel="Open nearby shops map"
                onPress={() =>
                  router.push({ pathname: "/nearby", params: { returnTo: "/search" } })
                }
                activeOpacity={0.8}
              >
                <MaterialIcons name="map" size={19} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            {recentSearches.length > 0 ? (
              <RecentSearchDropdown visible={showRecentDropdown}>
                <Text style={styles.recentDropdownTitle}>Recent searches</Text>
                {recentSearches.slice(0, 3).map((search) => (
                  <RecentRow
                    key={search}
                    label={search}
                    onPress={() => {
                      setSearchText(search);
                      setShowRecentDropdown(false);
                    }}
                    onRemove={() => removeRecentSearch(search)}
                  />
                ))}
              </RecentSearchDropdown>
            ) : null}

            <TouchableOpacity
              style={styles.nearbyButton}
              activeOpacity={0.85}
              onPress={() =>
                router.push({ pathname: "/nearby", params: { returnTo: "/search" } })
              }
            >
              <MaterialIcons name="near-me" size={18} color={COLORS.white} />
              <Text style={styles.nearbyButtonText}>
                Find computer shops near me
              </Text>
              <MaterialIcons
                name="chevron-right"
                size={20}
                color={COLORS.white}
              />
            </TouchableOpacity>

            <Text style={styles.sectionLabel}>Categories</Text>
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
                    selectedCategory === category && styles.categoryChipActive,
                  ]}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedCategory === category }}
                  accessibilityLabel={`Show ${category.toLowerCase()} products`}
                  onPress={() => selectCategory(category)}
                >
                  <Text
                    style={[
                      styles.categoryText,
                      selectedCategory === category && styles.categoryTextActive,
                    ]}
                  >
                    {category}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.resultsHeading}>
              <Text style={[styles.sectionTitle, styles.resultsTitle]}>
                {normalizedSearch ? "Search results" : appliedCategory === "All" ? "Browse products" : appliedCategory}
              </Text>
              <View style={styles.categoryProgress}>
                {isCategoryPending ? <ActivityIndicator size="small" color={COLORS.primary}
                  accessibilityLabel={`Updating ${selectedCategory.toLowerCase()} products`} /> : null}
              </View>
            </View>
            </View>}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                {isLoading ? <ActivityIndicator size="large" color={COLORS.primary} />
                  : <MaterialIcons name="search-off" size={36} color={COLORS.primary} />}
                <Text style={styles.emptyStateText}>
                  {isLoading ? "Loading products..." : error || (normalizedSearch || appliedCategory !== "All"
                    ? "No matching products. Try another search or category."
                    : "No products have been listed yet.")}
                </Text>
              </View>
            }
          />

          <ScrollToTopButton
            visible={showScrollToTop}
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityLabel="Scroll search results to top"
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
  contentContainer: { padding: SIZES.edgeMargin, paddingBottom: 80 },
  pageTitle: { fontFamily: "Inter_700Bold", fontSize: 26, lineHeight: 33, color: COLORS.text, marginBottom: 18 },
  searchHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  backButton: { width: 44, height: 48, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: 14 },
  searchBar: { flex: 1, minHeight: 50, flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.outline, paddingHorizontal: 10 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, marginHorizontal: 7, paddingVertical: 10,
    fontFamily: "Inter_400Regular", fontSize: 13, color: COLORS.text },
  nearbyIconButton: { width: 44, height: 48, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", backgroundColor: "#e7efff" },
  sectionLabel: { fontFamily: "Inter_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 },
  categoryList: { gap: 8, paddingBottom: 20 },
  categoryChip: { minHeight: 44, justifyContent: "center", backgroundColor: "#fff", borderRadius: RADIUS.pill,
    paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.outline },
  categoryChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  categoryText: { fontFamily: "Inter_500Medium", fontSize: 12, color: COLORS.textDim },
  categoryTextActive: { color: "#fff" },
  nearbyButton: { marginBottom: 24, minHeight: 54, flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, paddingHorizontal: 16, paddingVertical: 12 },
  nearbyButtonText: { flex: 1, marginLeft: 10, fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 20, color: "#fff" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 27, color: COLORS.text },
  recentDropdown: { width: "100%", marginTop: -8, marginBottom: 16, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: COLORS.white, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.outline,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  recentDropdownTitle: { paddingVertical: 6, fontFamily: "Inter_600SemiBold", fontSize: 11, color: COLORS.textMuted },
  recentRow: { minHeight: 44, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: COLORS.outline },
  recentSelect: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center" },
  recentText: { flex: 1, marginLeft: 9, fontFamily: "Inter_400Regular", fontSize: 13, color: COLORS.textDim },
  removeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  resultsHeading: { flexDirection: "row", alignItems: "center", marginTop: 24, marginBottom: 14 },
  resultsTitle: { flex: 1 },
  categoryProgress: { width: 24, height: 24, marginLeft: 8, justifyContent: "center" },
  productRow: { gap: 12, alignItems: "stretch", justifyContent: "flex-start" },
  productCell: { marginBottom: 16, alignSelf: "stretch" },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 40, paddingHorizontal: 20,
    borderWidth: 1, borderColor: COLORS.outline, borderRadius: RADIUS.lg, backgroundColor: "#fff" },
  emptyStateText: { marginTop: 14, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22, color: COLORS.textMuted, textAlign: "center" },
});
