import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import teamLogo from "../teamlogo-clean.png";
import { COLORS } from "../constants/theme";
import { useReducedMotion } from "../hooks/useReducedMotion";

const SLIDES = [
  {
    label: "Discover", color: "#0B5BD3", tint: "#EAF2FF",
    title: "Your next upgrade\nstarts nearby.",
    description: "Discover local computer shops and compare products to find the right fit for your setup.",
    note: "Explore shops. Compare your options.",
  },
  {
    label: "Reserve", color: "#6546C4", tint: "#F0ECFB",
    title: "Find it. Reserve it.\nMake it yours.",
    description: "Check product availability, send a reservation, and follow its status before visiting the shop.",
    note: "Less guesswork before you head out.",
  },
  {
    label: "Share", color: "#16745C", tint: "#E5F4EE",
    title: "Your experience\nhelps others choose.",
    description: "Add a receipt for store review and share honest feedback to help other shoppers decide.",
    note: "A better shopping experience, together.",
  },
];

// Decorative previews use native views to stay crisp on every device.
function Illustration({ step, color, tint, compact }) {
  return (
    <View style={[styles.art, { backgroundColor: tint }, compact && styles.artCompact]}
      pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.orbit, { borderColor: `${color}18` }]} />
      <View style={[styles.orbitSmall, { borderColor: `${color}18` }]} />
      <View style={[styles.spark, { backgroundColor: color }]} />
      <View style={[styles.artComposition, compact && styles.compositionCompact]}>
        {step === 0 ? (
          <>
            <View style={[styles.previewCard, styles.shopCard]}>
              <View style={[styles.shopRoof, { backgroundColor: color }]}>
                {[0, 1, 2, 3, 4, 5].map((stripe) => (
                  <View key={stripe} style={[styles.awningStripe, stripe % 2 === 0 && styles.awningLight]} />
                ))}
              </View>
              <View style={styles.shopInside}>
                <View style={styles.row}>
                  <MaterialIcons name="storefront" size={17} color={color} />
                  <Text style={styles.cardHeading}>Your local tech shop</Text>
                </View>
                <View style={styles.productDisplay}>
                  <View style={[styles.productTile, { backgroundColor: tint }]}>
                    <MaterialIcons name="laptop-mac" size={48} color={color} />
                  </View>
                  <View style={[styles.productTile, { backgroundColor: tint }]}>
                    <MaterialIcons name="headphones" size={42} color={color} />
                  </View>
                </View>
                <View style={styles.row}>
                  <MaterialIcons name="place" size={15} color={color} />
                  <Text style={styles.cardCaption}>Discover shops around you</Text>
                </View>
              </View>
            </View>
            <View style={[styles.floatingBadge, styles.bottomBadge]}>
              <MaterialIcons name="compare-arrows" size={20} color={color} />
              <Text style={styles.badgeText}>Find your best fit</Text>
            </View>
          </>
        ) : step === 1 ? (
          <>
            <View style={[styles.previewCard, styles.detailCard]}>
              <View style={styles.spread}>
                <Text style={styles.cardHeading}>Your reservation</Text>
                <MaterialIcons name="bookmark" size={20} color={color} />
              </View>
              <View style={[styles.reservationProduct, { backgroundColor: tint }]}>
                <MaterialIcons name="laptop-mac" size={48} color={color} />
                <View style={styles.productCopy}>
                  <Text style={styles.cardHeading}>Your next laptop</Text>
                  <Text style={styles.cardCaption}>A setup that fits you</Text>
                </View>
              </View>
              <View style={styles.timeline}>
                {["Request", "Store review", "Pick up"].map((label, index) => (
                  <View key={label} style={styles.timelineStep}>
                    <View style={[styles.timelineDot, { backgroundColor: index === 0 ? color : tint }]}>
                      <MaterialIcons name={index === 0 ? "check" : index === 1 ? "schedule" : "shopping-bag"}
                        size={15} color={index === 0 ? "#FFFFFF" : color} />
                    </View>
                    <Text style={styles.timelineLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.floatingBadge, styles.bottomBadge]}>
              <MaterialIcons name="notifications-active" size={19} color={color} />
              <Text style={styles.badgeText}>Stay up to date</Text>
            </View>
          </>
        ) : (
          <>
            <View style={[styles.previewCard, styles.receiptCard]}>
              <View style={[styles.receiptIcon, { backgroundColor: tint }]}>
                <MaterialIcons name="receipt-long" size={32} color={color} />
              </View>
              <Text style={styles.receiptTitle}>Proof of purchase</Text>
              <View style={styles.receiptDivider} />
              {[100, 74, 88].map((width) => (
                <View key={width} style={[styles.receiptLine, { width: `${width}%` }]} />
              ))}
              <View style={[styles.receiptStatus, { backgroundColor: tint }]}>
                <MaterialIcons name="image" size={16} color={color} />
                <Text style={[styles.statusText, { color }]}>Receipt attached</Text>
              </View>
            </View>
            <View style={[styles.floatingBadge, styles.ratingBadge]}>
              <View style={styles.stars}>
                {[0, 1, 2, 3, 4].map((star) => <MaterialIcons key={star} name="star" size={19} color="#B77912" />)}
              </View>
              <Text style={styles.badgeText}>Share your experience</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

export default function OnboardingSplash({ onComplete }) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const { height, width, fontScale } = useWindowDimensions();
  const compact = height < 740 || width < 360;
  const slide = SLIDES[step];
  const isLastStep = step === SLIDES.length - 1;

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (reducedMotion) {
      fade.setValue(1);
      return undefined;
    }
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fade, reducedMotion, step]);

  const finish = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try { await onComplete(); }
    finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Image source={teamLogo} style={styles.logo} resizeMode="contain" accessible accessibilityLabel="TechKnow logo" />
          <Pressable onPress={finish} disabled={finishing} accessibilityRole="button"
            accessibilityLabel="Skip introduction" style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
            <Illustration step={step} color={slide.color} tint={slide.tint} compact={compact || fontScale > 1.3} />
            <View style={[styles.copy, compact && styles.copyCompact]} accessibilityLiveRegion="polite">
              <View style={styles.row}>
                <View style={[styles.stepTag, { backgroundColor: slide.tint }]}>
                  <Text style={[styles.eyebrow, { color: slide.color }]}>{slide.label.toUpperCase()}</Text>
                </View>
                <Text style={styles.stepCount}>0{step + 1} / 03</Text>
              </View>
              <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>{slide.title}</Text>
              <Text style={styles.description}>{slide.description}</Text>
            </View>
          </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.progress} accessible accessibilityRole="progressbar"
            accessibilityLabel="Introduction progress" accessibilityValue={{ min: 1, max: 3, now: step + 1, text: `Step ${step + 1} of 3` }}>
            {SLIDES.map((item, index) => <View key={item.label} style={[styles.progressTrack, index <= step && { backgroundColor: slide.color }]} />)}
          </View>
          <View style={styles.actions}>
            {step > 0 && <Pressable onPress={() => setStep((current) => Math.max(0, current - 1))}
              disabled={finishing} accessibilityRole="button" accessibilityLabel="Previous introduction screen"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <MaterialIcons name="arrow-back" size={22} color={COLORS.text} />
            </Pressable>}
            <Pressable disabled={finishing} accessibilityRole="button" accessibilityState={{ disabled: finishing, busy: finishing }}
              onPress={() => isLastStep ? finish() : setStep((current) => Math.min(2, current + 1))}
              style={({ pressed }) => [styles.nextButton, { backgroundColor: slide.color }, (pressed || finishing) && styles.pressed]}>
              <Text style={styles.nextText}>{finishing ? "Opening…" : isLastStep ? "Get started" : "Continue"}</Text>
              <MaterialIcons name="arrow-forward" size={21} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text style={styles.footerNote}>{slide.note}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#FFFFFF" },
  container: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 10 },
  logo: { width: 56, height: 56 },
  skipButton: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  skipText: { color: COLORS.textMuted, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  art: { height: 294, borderRadius: 30, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  artCompact: { height: 228 },
  orbit: { position: "absolute", width: 320, height: 320, borderWidth: 1, borderRadius: 160, top: -100, right: -90 },
  orbitSmall: { position: "absolute", width: 220, height: 220, borderWidth: 1, borderRadius: 110, bottom: -100, left: -80 },
  spark: { position: "absolute", top: 30, left: 27, width: 7, height: 7, borderRadius: 4, opacity: 0.35 },
  artComposition: { width: 276, height: 252, justifyContent: "center", alignItems: "center" },
  compositionCompact: { transform: [{ scale: 0.8 }] },
  previewCard: { backgroundColor: "#FFFFFF", borderRadius: 18, borderWidth: 1, borderColor: "#FFFFFF", shadowColor: "#253B60", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.09, shadowRadius: 16, elevation: 3 },
  shopCard: { width: 236, overflow: "hidden", transform: [{ rotate: "-4deg" }] },
  shopRoof: { height: 42, flexDirection: "row", paddingHorizontal: 8 },
  awningStripe: { flex: 1, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  awningLight: { backgroundColor: "#FFFFFF35" },
  shopInside: { padding: 15, gap: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardHeading: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: COLORS.text, flexShrink: 1 },
  cardCaption: { fontFamily: "Inter_400Regular", fontSize: 10, color: COLORS.textMuted, flexShrink: 1 },
  productDisplay: { flexDirection: "row", gap: 10 },
  productTile: { flex: 1, height: 76, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  floatingBadge: { position: "absolute", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8, shadowColor: "#253B60", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.09, shadowRadius: 14, elevation: 5 },
  bottomBadge: { bottom: 3, right: 0 },
  badgeText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: COLORS.text },
  detailCard: { width: 250, padding: 16, gap: 18, transform: [{ rotate: "-3deg" }] },
  reservationProduct: { borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  productCopy: { flex: 1, gap: 5 },
  timeline: { flexDirection: "row", justifyContent: "space-between" },
  timelineStep: { alignItems: "center", gap: 7 },
  timelineDot: { width: 29, height: 29, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  timelineLabel: { fontFamily: "Inter_500Medium", fontSize: 9, color: COLORS.textDim },
  receiptCard: { width: 194, padding: 18, alignItems: "center", gap: 10, transform: [{ rotate: "-6deg" }], marginLeft: -24 },
  receiptIcon: { height: 48, width: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  receiptTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: COLORS.text },
  receiptDivider: { alignSelf: "stretch", borderBottomWidth: 1, borderColor: COLORS.outline, borderStyle: "dashed", marginVertical: 2 },
  receiptLine: { height: 5, borderRadius: 3, backgroundColor: "#E6EBEF", alignSelf: "flex-start" },
  receiptStatus: { flexDirection: "row", gap: 5, borderRadius: 7, padding: 8, alignItems: "center", marginTop: 4 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  ratingBadge: { right: 0, bottom: 5, flexDirection: "column", alignItems: "flex-start" },
  stars: { flexDirection: "row", gap: 2 },
  copy: { paddingTop: 28 },
  copyCompact: { paddingTop: 20 },
  stepTag: { borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
  eyebrow: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.6 },
  stepCount: { fontFamily: "Inter_500Medium", fontSize: 11, color: COLORS.textMuted, marginLeft: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 30, lineHeight: 38, letterSpacing: -0.9, color: COLORS.text, marginTop: 14 },
  titleCompact: { fontSize: 27, lineHeight: 34 },
  description: { fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 24, color: COLORS.textDim, marginTop: 12 },
  footer: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 12, gap: 16, backgroundColor: "#FFFFFF" },
  progress: { flexDirection: "row", gap: 5, alignSelf: "center" },
  progressTrack: { height: 4, width: 28, borderRadius: 2, backgroundColor: "#E6EBF1" },
  actions: { flexDirection: "row", gap: 10 },
  backButton: { width: 56, minHeight: 56, borderRadius: 16, borderWidth: 1, borderColor: COLORS.outline, justifyContent: "center", alignItems: "center" },
  nextButton: { flex: 1, minHeight: 56, paddingVertical: 15, paddingHorizontal: 16, borderRadius: 16, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12 },
  nextText: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: "#FFFFFF", flexShrink: 1 },
  footerNote: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 17, color: COLORS.textMuted, textAlign: "center" },
  pressed: { opacity: 0.7 },
});
