import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { COLORS } from "../constants/theme";

export const STORE_SHEET_PEEK = 112;

export function StoreListSheet({ height, open, onOpenChange, subtitle, children }) {
  const sheetHeight = Math.max(STORE_SHEET_PEEK, height * 0.64);
  const collapsedOffset = sheetHeight - STORE_SHEET_PEEK;
  const offset = useRef(new Animated.Value(open ? 0 : collapsedOffset)).current;
  const dragStart = useRef(0);
  const snap = useCallback((expanded) => {
    Animated.spring(offset, {
      toValue: expanded ? 0 : collapsedOffset,
      damping: 28, stiffness: 240, mass: 1, overshootClamping: true,
      useNativeDriver: true,
    }).start();
  }, [offset, collapsedOffset]);

  useEffect(() => {
    snap(open);
    return () => offset.stopAnimation();
  }, [open, snap, offset]);

  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => Math.abs(state.dy) > 6 && Math.abs(state.dy) > Math.abs(state.dx),
    onPanResponderGrant: () => {
      dragStart.current = open ? 0 : collapsedOffset;
      offset.stopAnimation(value => { dragStart.current = value; });
    },
    onPanResponderMove: (_, state) => offset.setValue(Math.max(0, Math.min(collapsedOffset, dragStart.current + state.dy))),
    onPanResponderRelease: (_, state) => {
      const expanded = Math.abs(state.vy) > 0.4 ? state.vy < 0
        : dragStart.current + state.dy < collapsedOffset / 2;
      onOpenChange(expanded);
      snap(expanded);
    },
    onPanResponderTerminate: () => snap(open),
  }), [open, collapsedOffset, offset, onOpenChange, snap]);

  return <Animated.View style={[styles.sheet, { height: sheetHeight, transform: [{ translateY: offset }] }]}>
    <View {...gesture.panHandlers}>
      <Pressable style={styles.header} onPress={() => onOpenChange(!open)}
        accessibilityRole="button" accessibilityLabel={open ? "Collapse store list" : "Expand store list"}
        accessibilityState={{ expanded: open }} accessibilityHint="You can also drag this handle up or down">
        <View style={styles.handle} />
        <View style={styles.heading}>
          <View style={styles.copy}>
            <Text style={styles.title}>Nearby stores</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          </View>
          <View style={styles.toggle}><MaterialIcons name={open ? "keyboard-arrow-down" : "keyboard-arrow-up"} size={24} color={COLORS.primary} /></View>
        </View>
      </Pressable>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
      nestedScrollEnabled scrollEnabled={open} pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"}>
      {children}
    </ScrollView>
  </Animated.View>;
}

const styles = StyleSheet.create({
  sheet: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: COLORS.white,
    borderTopLeftRadius: 26, borderTopRightRadius: 26, borderCurve: "continuous",
    shadowColor: "#1C3050", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 },
  header: { minHeight: STORE_SHEET_PEEK, paddingHorizontal: 20, paddingBottom: 16, paddingTop: 10 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: "#CCD2DB", alignSelf: "center", marginBottom: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: COLORS.text },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, marginTop: 4, color: COLORS.textMuted },
  toggle: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#EFF4FB", alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 28 },
});
