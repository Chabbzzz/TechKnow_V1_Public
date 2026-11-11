import React, { useEffect, useRef, useState } from "react";
import {
  Animated, Easing, Keyboard, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { COLORS } from "../constants/theme";

export function TimeSlotPickerSheet({ visible, groups, selectedSlot, onSelect, onClose }) {
  const [presented, setPresented] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
          role="dialog" aria-label="Choose a time slot" aria-modal
          pointerEvents={visible ? "auto" : "none"}
          style={[styles.sheet, {
            maxHeight: Math.min(560, height * 0.75, height - insets.top - 24),
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
              <Text accessibilityRole="header" style={styles.title}>Choose a time slot</Text>
              <Text style={styles.subtitle}>Select a preferred time for your drop-off.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close time picker" onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <View style={styles.closeCircle}>
                <MaterialIcons name="close" size={20} color="#636366" />
              </View>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator persistentScrollbar>
            {groups.map((group) => (
              <View key={group.label} style={styles.group}>
                <Text accessibilityRole="header" style={styles.groupLabel}>{group.label}</Text>
                <View style={styles.options}>
                  {group.slots.map((slot, index) => {
                    const selected = selectedSlot === slot;
                    return (
                      <View key={slot}>
                        {index > 0 ? <View style={styles.separator} /> : null}
                        <Pressable accessibilityRole="button" accessibilityState={{ selected }}
                          onPress={() => onSelect(slot)}
                          style={({ pressed }) => [styles.option, pressed && styles.rowPressed]}>
                          <View style={[styles.timeIcon, selected && styles.timeIconSelected]}>
                            <MaterialIcons name="schedule" size={21} color={selected ? COLORS.primary : "#636366"} />
                          </View>
                          <Text style={[styles.slotText, selected && styles.selectedText]}>{slot}</Text>
                          <View style={styles.check}>
                            {selected ? <MaterialIcons name="check" size={24} color={COLORS.primary} /> : null}
                          </View>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
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
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 16, gap: 16 },
  group: { gap: 8 },
  groupLabel: { ...semibold, fontSize: 12, lineHeight: 18, color: "#636366", paddingHorizontal: 4 },
  options: { borderRadius: 16, borderCurve: "continuous", overflow: "hidden", backgroundColor: COLORS.white },
  option: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 13 },
  timeIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: "#F2F2F7",
    alignItems: "center", justifyContent: "center" },
  timeIconSelected: { backgroundColor: "#EAF2FF" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 64, backgroundColor: "#D1D1D6" },
  slotText: { flex: 1, ...regular, fontSize: 14, lineHeight: 21, color: "#1C1C1E" },
  selectedText: { ...semibold },
  check: { width: 24, alignItems: "center" },
  pressed: { opacity: 0.6 },
  rowPressed: { backgroundColor: "#E5E5EA" },
});
