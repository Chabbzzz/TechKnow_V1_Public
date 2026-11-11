import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Easing, Keyboard, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { COLORS } from "../constants/theme";

export function ShopPickerModal({ visible, loading, stores, selectedStoreId, onSelect, onClose }) {
  const [presented, setPresented] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      setPresented(true);
    }
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reducedMotion ? 0 : visible ? 300 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setPresented(false);
    });
    return () => animation.stop();
  }, [visible, progress, reducedMotion]);

  return (
    <Modal visible={presented} transparent animationType="none" presentationStyle="overFullScreen"
      statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: progress }]} />
        <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={onClose} />
        <Animated.View accessibilityViewIsModal onAccessibilityEscape={onClose}
          role="dialog" aria-label="Choose a shop" aria-modal
          pointerEvents={visible ? "auto" : "none"}
          style={[styles.sheet, {
            maxHeight: Math.max(120, height - insets.top - 24),
            paddingBottom: Math.max(insets.bottom, 16),
            paddingLeft: insets.left,
            paddingRight: insets.right,
            opacity: reducedMotion ? progress : 1,
            transform: [{ translateY: progress.interpolate({
              inputRange: [0, 1], outputRange: [reducedMotion ? 0 : height, 0],
            }) }],
          }]}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>Choose a shop</Text>
              <Text style={styles.subtitle}>Select a shop for your pickup.</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close shop picker"
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <View style={styles.closeCircle}>
                <Ionicons name="close" size={20} color="#636366" />
              </View>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={COLORS.primary} />
                <Text style={styles.emptyMessage}>Loading shops…</Text>
              </View>
            ) : stores.length ? (
              <View style={styles.group}>
                {stores.map((store, index) => {
                  const selected = String(selectedStoreId || "") === String(store.id);
                  return (
                    <View key={store.id}>
                      {index > 0 ? <View style={styles.separator} /> : null}
                      <Pressable onPress={() => onSelect(store)} accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${store.name}${store.address ? `, ${store.address}` : ""}`}
                        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                        <View style={[styles.shopIcon, selected && styles.shopIconSelected]}>
                          <Ionicons name="storefront-outline" size={21}
                            color={selected ? COLORS.primary : "#636366"} />
                        </View>
                        <View style={styles.shopCopy}>
                          <Text style={styles.shopName}>{store.name}</Text>
                          {store.address ? <Text style={styles.shopAddress}>{store.address}</Text> : null}
                        </View>
                        <View style={styles.selection}>
                          {selected ? <Ionicons name="checkmark" size={24} color={COLORS.primary} /> : null}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="storefront-outline" size={32} color="#8E8E93" />
                <Text style={styles.emptyMessage}>No shops are available yet.</Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const regular = Platform.select({ ios: { fontWeight: "400" }, default: { fontFamily: "Inter_400Regular" } });
const semibold = Platform.select({ ios: { fontWeight: "600" }, default: { fontFamily: "Inter_600SemiBold" } });

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: {
    width: "100%", maxWidth: 560, alignSelf: "center", flexShrink: 1,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: "continuous",
    backgroundColor: "#F2F2F7", overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12,
    shadowRadius: 24, elevation: 16,
  },
  header: { flexDirection: "row", alignItems: "flex-start", paddingLeft: 22, paddingRight: 12,
    paddingTop: 22, paddingBottom: 20, gap: 8 },
  heading: { flex: 1, paddingTop: 2 },
  title: { ...semibold, fontSize: 22, lineHeight: 28, color: "#1C1C1E", letterSpacing: -0.4 },
  subtitle: { ...regular, fontSize: 14, lineHeight: 20, color: "#636366", marginTop: 5 },
  closeButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#E5E5EA",
    alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.6 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 16 },
  group: { borderRadius: 16, borderCurve: "continuous", backgroundColor: COLORS.white, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 76, paddingHorizontal: 14,
    paddingVertical: 16, gap: 12 },
  rowPressed: { backgroundColor: "#E5E5EA" },
  shopIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#F2F2F7",
    alignItems: "center", justifyContent: "center" },
  shopIconSelected: { backgroundColor: "#EAF2FF" },
  shopCopy: { flex: 1, minWidth: 0 },
  shopName: { ...semibold, fontSize: 16, lineHeight: 22, color: "#1C1C1E" },
  shopAddress: { ...regular, marginTop: 4, fontSize: 13, lineHeight: 18, color: "#636366" },
  selection: { width: 24, alignItems: "center" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 64, backgroundColor: "#D1D1D6" },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 32 },
  emptyMessage: { ...regular, fontSize: 15, lineHeight: 21, color: "#636366", textAlign: "center" },
});
