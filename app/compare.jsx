import React, { useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, RADIUS, SIZES, LAYOUT } from "../constants/theme";
import { ProductImage } from "../components/ProductImage";
import { CompareLoadingOverlay } from "../components/CompareLoadingOverlay";
import { ReservationPreviewModal } from "../components/ReservationPreviewModal";
import { toProductCard, toReservationParams } from "../constants/products";
import { useProducts } from "../hooks/useProducts";

const valueFromParam = (value) => (Array.isArray(value) ? value[0] : value);

const normalizeProductName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const numericPrice = (value) => {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const stockQuantity = (product) => {
  if (product?.stockUnknown) return null;
  const value = Number.parseInt(String(product?.stock || ""), 10);
  return Number.isFinite(value) ? value : 0;
};

const stockState = (quantity) => {
  if (quantity === null) return { label: "Check availability", tone: "unknown" };
  if (quantity <= 0) return { label: "Out of stock", tone: "out" };
  if (quantity <= 2) return { label: `Only ${quantity} left`, tone: "low" };
  if (quantity <= 5) return { label: `Only ${quantity} left`, tone: "medium" };
  return { label: "In stock", tone: "healthy" };
};

const fallbackProductFromParams = (params) => {
  const title = valueFromParam(params.productName);
  if (!title) return null;

  return {
    id: valueFromParam(params.productId) || "selected-product",
    title,
    category: valueFromParam(params.productCategory) || "Other",
    shopName: valueFromParam(params.productShop) || "",
    price: valueFromParam(params.productPrice) || "Price unavailable",
    rating: "New",
    stock: "Availability unavailable",
    stockUnknown: true,
    imageUrl: valueFromParam(params.productImage) || "",
    imagePath: valueFromParam(params.productImagePath) || "",
    description: valueFromParam(params.productDescription) || "",
  };
};

const EmptyState = ({ title, message, onBack }) => (
  <View style={styles.emptyState}>
    <MaterialIcons name="compare-arrows" size={36} color={COLORS.primary} />
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyText}>{message}</Text>
    <TouchableOpacity style={styles.primaryButton} onPress={onBack} activeOpacity={0.85}>
      <Text style={styles.primaryButtonText}>Browse products</Text>
    </TouchableOpacity>
  </View>
);

const ProductSummary = ({ product, retailerCount }) => (
  <View style={styles.productSummary}>
    <View style={[styles.productImage, { backgroundColor: product.accent || "#eef3ff" }]}>
      <ProductImage
        uri={product.imageUrl}
        storagePath={product.imagePath}
        style={styles.productImageContent}
        resizeMode="cover"
        accessibilityLabel={`${product.title} product image`}
        fallback={(
          <View style={styles.noImageState}>
            <MaterialIcons name="image-not-supported" size={22} color={COLORS.textMuted} />
            <Text style={styles.noImageText}>No image</Text>
          </View>
        )}
      />
    </View>
    <View style={styles.productCopy}>
      <Text style={styles.productCategory}>{product.category.toUpperCase()}</Text>
      <Text style={styles.productName} numberOfLines={2}>{product.title}</Text>
      <Text style={styles.productDescription} numberOfLines={2}>
        {product.description || "Compare prices and availability from participating stores."}
      </Text>
      <View style={styles.summaryMeta}>
        <Text style={styles.productReviews}>
          {product.rating === "New" ? "New listing" : `${product.rating} rating`}
        </Text>
        <Text style={styles.storeCount}>{retailerCount} store{retailerCount === 1 ? "" : "s"}</Text>
      </View>
    </View>
  </View>
);

const RetailerRow = ({ product, isBestPrice, onReserve }) => {
  const quantity = stockQuantity(product);
  const availability = stockState(quantity);

  return (
    <View style={styles.retailerRow}>
      <View style={styles.retailerInfo}>
        <View style={styles.retailerIcon}>
          <MaterialIcons name="storefront" size={17} color={COLORS.primary} />
        </View>
        <View style={styles.retailerCopy}>
          <View style={styles.retailerTitleRow}>
            <Text style={styles.retailerName} numberOfLines={1}>
              {product.shopName}
            </Text>
            {isBestPrice ? (
              <Text style={styles.bestPriceBadge}>BEST PRICE</Text>
            ) : null}
          </View>
          <Text style={styles.retailerRating}>
            {product.rating === "New" ? "New store rating" : `${product.rating} rating`}
          </Text>
          <View style={[styles.stockPill, styles[`${availability.tone}Pill`]]}>
            <Text style={[styles.stockText, styles[`${availability.tone}Text`]]}>
              {availability.label}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.retailerAction}>
        <Text style={styles.retailerPrice}>{product.price}</Text>
        <TouchableOpacity
          style={styles.reserveButton}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${availability.tone === "out" ? "Reserve on the waiting list for" : "Reserve"} ${product.title} at ${product.shopName}`}
          onPress={onReserve}
        >
          <MaterialIcons name="shopping-cart" size={14} color={COLORS.white} />
          <Text style={styles.reserveText}>Reserve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function CompareScreen() {
  const params = useLocalSearchParams();
  const returnTo = valueFromParam(params.returnTo) || "/search";
  const selectedProductId = valueFromParam(params.productId) || "";
  const selectedProductName = valueFromParam(params.productName) || "";
  const {
    products: availableProducts,
    isLoading: productsLoading,
    error: productsError,
  } = useProducts();
  const isLoading = Boolean(selectedProductName) && productsLoading;
  const error = productsError;
  const [reservationProduct, setReservationProduct] = useState(null);
  const [showReservationPreview, setShowReservationPreview] = useState(false);
  const reservationDestination = useRef(null);
  const isContinuing = useRef(false);
  const openReservation = (product) => {
    if (isContinuing.current || !product) return;
    reservationDestination.current = null;
    setReservationProduct(product);
    setShowReservationPreview(true);
  };

  const fallbackProduct = useMemo(() => fallbackProductFromParams(params), [params]);
  const comparisonProducts = useMemo(() => {
    const selectedName = normalizeProductName(selectedProductName);
    if (!selectedName) return [];

    return availableProducts
      .filter((product) => normalizeProductName(product.name || product.title) === selectedName)
      .sort((left, right) =>
        String(left.storeName || left.shopName || "").localeCompare(
          String(right.storeName || right.shopName || ""),
        ) || numericPrice(left.price) - numericPrice(right.price),
      );
  }, [availableProducts, selectedProductName]);
  const cardProducts = useMemo(
    () => comparisonProducts.map(toProductCard),
    [comparisonProducts],
  );

  const selectedProduct = useMemo(() => {
    const productName = normalizeProductName(selectedProductName);
    return (
      cardProducts.find((product) => product.id === selectedProductId) ||
      cardProducts.find((product) => normalizeProductName(product.title) === productName) ||
      fallbackProduct
    );
  }, [cardProducts, fallbackProduct, selectedProductId, selectedProductName]);

  const comparableProducts = useMemo(() => {
    if (!selectedProduct) return [];
    const selectedName = normalizeProductName(selectedProduct.title);
    const matches = cardProducts.filter(
      (product) => normalizeProductName(product.title) === selectedName,
    );
    if (matches.length) return matches;
    return [selectedProduct];
  }, [cardProducts, selectedProduct]);

  const bestPrice = useMemo(
    () => {
      const availablePrices = comparableProducts
        .filter((product) => stockQuantity(product) !== 0)
        .map((product) => numericPrice(product.price));
      return Math.min(...availablePrices);
    },
    [comparableProducts],
  );

  const goBack = () => router.replace(returnTo);
  const previewProduct = comparableProducts.find(product => product.id === reservationProduct?.id) || reservationProduct;
  const closeReservationPreview = () => {
    if (isContinuing.current) return;
    reservationDestination.current = null;
    setShowReservationPreview(false);
  };
  const continueReservation = () => {
    if (isContinuing.current || !previewProduct) return;
    isContinuing.current = true;
    reservationDestination.current = toReservationParams(previewProduct, "/compare");
    setShowReservationPreview(false);
  };
  const finishReservationPreview = () => {
    const destination = reservationDestination.current;
    reservationDestination.current = null;
    isContinuing.current = false;
    setReservationProduct(null);
    if (destination) router.push({ pathname: "/reservation", params: destination });
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Compare stores" onBack={goBack} right={
          <TouchableOpacity style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            accessibilityRole="button" accessibilityLabel="Find another product"
            onPress={() => router.replace("/search")}>
            <MaterialIcons name="search" size={23} color={COLORS.primary} />
          </TouchableOpacity>
        } />

        {isLoading && !selectedProduct ? (
          <EmptyState
            title="Loading comparison"
            message="Fetching product listings from TechKnow stores."
            onBack={goBack}
          />
        ) : !selectedProduct ? (
          <EmptyState
            title="Choose a product first"
            message="Open Compare from a product card to see prices and availability from other stores."
            onBack={goBack}
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <ProductSummary product={selectedProduct} retailerCount={comparableProducts.length} />
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.sectionTitle}>Store comparison</Text>
                <Text style={styles.sectionSubtitle}>
                  Same product, current listings from TechKnow stores
                </Text>
              </View>
              <Text style={styles.resultCount}>{comparableProducts.length}</Text>
            </View>
            <View style={styles.divider} />

            {comparableProducts.map((product) => (
              <RetailerRow
                key={product.id}
                product={product}
                isBestPrice={numericPrice(product.price) === bestPrice && bestPrice !== Number.POSITIVE_INFINITY}
                onReserve={() => openReservation(product)}
              />
            ))}

            {error ? (
              <View style={styles.inlineWarning}>
                <MaterialIcons name="cloud-off" size={18} color="#b77900" />
                <Text style={styles.inlineWarningText}>{error}</Text>
              </View>
            ) : null}

            {!isLoading && comparableProducts.length === 1 ? (
              <View style={styles.noMatchesNote}>
                <MaterialIcons name="info-outline" size={18} color={COLORS.primary} />
                <Text style={styles.noMatchesText}>
                  No other store has this exact product yet. You can still reserve this listing.
                </Text>
              </View>
            ) : null}
          </ScrollView>
        )}

        <CompareLoadingOverlay
          visible={isLoading}
          title="Finding store listings"
          message="Checking prices and availability for this product."
        />
        <ReservationPreviewModal visible={showReservationPreview} product={previewProduct}
          onClose={closeReservationPreview} onContinue={continueReservation}
          onAfterClose={finishReservationPreview} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },

  content: { padding: SIZES.edgeMargin, paddingTop: 16, paddingBottom: 24 },
  productSummary: {
    flexDirection: "row",
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 2,
  },
  productImage: {
    width: 92,
    height: 92,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  productImageContent: { width: "100%", height: "100%" },
  noImageState: { alignItems: "center", justifyContent: "center", gap: 4 },
  noImageText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: COLORS.textMuted,
  },
  productCopy: { flex: 1, marginLeft: 11, justifyContent: "center" },
  productCategory: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: COLORS.primary,
    marginBottom: 4,
  },
  productName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
    lineHeight: 20,
    color: COLORS.text,
  },
  productDescription: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
    marginTop: 5,
  },
  summaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
  },
  productReviews: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: COLORS.textMuted,
  },
  storeCount: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: COLORS.primary,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: COLORS.text,
  },
  sectionSubtitle: {
    flexShrink: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 3,
  },
  resultCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryDim,
    color: COLORS.primary,
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    textAlign: "center",
    textAlignVertical: "center",
    paddingTop: 5,
  },
  divider: { height: 1, backgroundColor: "#e0dee7", marginBottom: 10 },
  retailerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  retailerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    minWidth: 180,
    minHeight: 62,
  },
  retailerIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#dce7ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  retailerCopy: { flex: 1, minWidth: 0 },
  retailerTitleRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 },
  retailerName: {
    flexShrink: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.text,
  },
  retailerRating: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  bestPriceBadge: {
    marginLeft: 5,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#e1f3e5",
    color: "#218739",
    fontFamily: "Inter_700Bold",
    fontSize: 9,
  },
  stockPill: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  unknownPill: { backgroundColor: "#eef3ff" },
  outPill: { backgroundColor: "#f0f1f3" },
  lowPill: { backgroundColor: "#ffe8e5" },
  mediumPill: { backgroundColor: "#fff3d6" },
  healthyPill: { backgroundColor: "#e1f3e5" },
  stockText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  unknownText: { color: COLORS.primary },
  outText: { color: COLORS.textMuted },
  lowText: { color: "#c62828" },
  mediumText: { color: "#b77900" },
  healthyText: { color: "#218739" },
  retailerAction: { flexGrow: 1, minWidth: 120, alignItems: "flex-end" },
  retailerPrice: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: COLORS.primary,
    marginBottom: 8,
  },
  reserveButton: {
    minHeight: 44,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  reserveText: {
    marginLeft: 5,
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: COLORS.white,
  },
  inlineWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    padding: 10,
    borderRadius: RADIUS.sm,
    backgroundColor: "#fff8e7",
  },
  inlineWarningText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#8a6200",
  },
  noMatchesNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 4,
    padding: 11,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primaryDim,
  },
  noMatchesText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.primaryDark,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
    paddingBottom: 40,
  },
  emptyTitle: {
    marginTop: 12,
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: COLORS.text,
    textAlign: "center",
  },
  emptyText: {
    marginTop: 6,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.textMuted,
    textAlign: "center",
  },
  primaryButton: {
    marginTop: 18,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.white,
  },
});
