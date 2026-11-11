import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ProductImage } from "./ProductImage";
import { COLORS } from "../constants/theme";

function savedPrice(price) {
  if (typeof price === "number" && Number.isFinite(price)) {
    return `₱${price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(price ?? "").trim() || "Price unavailable";
}

export function FavoriteCard({ item, isRemoving = false, onRemove }) {
  const title = item.product || "Unnamed product";

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <View style={styles.imageTile}>
          <ProductImage uri={item.imageUrl} style={styles.image} resizeMode="contain"
            accessibilityLabel={`${title} product image`}
            fallback={<Ionicons name="laptop-outline" size={32} color="#8B95A5" />} />
        </View>
        <View style={styles.details}>
          <Text style={styles.title} numberOfLines={3}>{title}</Text>
          {item.shop ? <View style={styles.shopRow}>
            <Ionicons name="storefront-outline" size={13} color="#858D9B" style={styles.shopIcon} />
            <Text style={styles.shop} numberOfLines={2}>{item.shop}</Text>
          </View> : null}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.price}>{savedPrice(item.price)}</Text>
        <Pressable onPress={onRemove} disabled={isRemoving}
          accessibilityRole="button" accessibilityLabel={`Remove ${title} from favorites`}
          accessibilityHint="You can undo this after removing the product."
          accessibilityState={{ disabled: isRemoving, busy: isRemoving }}
          style={({ pressed }) => [styles.removeButton, pressed && styles.removePressed, isRemoving && styles.disabled]}>
          {isRemoving ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Ionicons name="heart" size={18} color={COLORS.primary} />}
          <Text style={styles.removeText}>{isRemoving ? "Removing…" : "Remove"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(25, 39, 60, 0.06)",
    shadowColor: "#172B48",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.045,
    shadowRadius: 14,
    elevation: 2,
  },
  body: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 16 },
  imageTile: {
    width: 84, height: 84, padding: 8, borderRadius: 18, borderCurve: "continuous",
    backgroundColor: "#F3F5F8", alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
  details: { flex: 1, minWidth: 0, gap: 8 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, lineHeight: 22, letterSpacing: -0.35, color: "#1C2432" },
  shopRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  shopIcon: { marginTop: 2 },
  shop: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: "#727C8B" },
  footer: {
    flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EDF0F4", paddingTop: 11,
  },
  price: { flexGrow: 1, flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 18, lineHeight: 26, letterSpacing: -0.45, color: "#1C2432" },
  removeButton: {
    minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginLeft: "auto", paddingHorizontal: 13, paddingVertical: 10, borderRadius: 22, backgroundColor: COLORS.primaryDim,
  },
  removeText: { fontFamily: "Inter_600SemiBold", fontSize: 12, lineHeight: 18, color: COLORS.primary },
  removePressed: { backgroundColor: COLORS.surfaceAlt },
  disabled: { opacity: 0.6 },
});
