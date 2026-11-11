import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, RADIUS, SIZES, LAYOUT } from "../constants/theme";
import { GlassModal } from "../components/GlassModal";
import { auth, db } from "../backend/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { submitReview as saveReview } from "../backend/services/reviews";
import { prepareProofImage } from "../backend/services/review-proof-image";
import { getStoreListings } from "../constants/stores";

export default function ReviewsScreen() {
  const params = useLocalSearchParams();
  const returnTo = params.returnTo || "/profile";

  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [feedbackFocused, setFeedbackFocused] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [isPreparingProof, setIsPreparingProof] = useState(false);
  const preparingProof = useRef(false);
  const [stores, setStores] = useState([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [showShopPicker, setShowShopPicker] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");
  const selectedStore = stores.find((store) => store.id === selectedStoreId) || null;

  const canSubmit = Boolean(!storesLoading && !storesError && selectedStore && rating > 0 && feedback.trim().length > 0 && proofFile);
  const submitDisabled = !canSubmit || isSubmitting || isPreparingProof || submitted;

  useEffect(() => {
    let unsubscribeStores;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeStores?.();
      setStores([]);
      setStoresError("");
      setStoresLoading(Boolean(user));
      if (!user) {
        setSelectedStoreId("");
        setStoresError("Please sign in to choose a shop and write a review.");
        return;
      }
      unsubscribeStores = onSnapshot(
        collection(db, "storeDirectory"),
        (snapshot) => {
          const availableStores = getStoreListings(snapshot.docs);
          setStores(availableStores);
          setSelectedStoreId((currentId) =>
            availableStores.some((store) => store.id === currentId)
              ? currentId : availableStores[0]?.id || "",
          );
          setStoresError("");
          setStoresLoading(false);
        },
        (storeError) => {
          console.warn("Stores could not be loaded for review submission", storeError?.code || storeError);
          setStores([]);
          setSelectedStoreId("");
          setStoresError("Shops could not be loaded. Check your connection and reopen Reviews.");
          setStoresLoading(false);
        },
      );
    });
    return () => { unsubscribeAuth(); unsubscribeStores?.(); };
  }, []);

  useEffect(() => {
    if (!submitted) return undefined;

    const returnTimer = setTimeout(() => router.replace("/profile"), 2500);
    return () => clearTimeout(returnTimer);
  }, [submitted]);

  const submitReview = async () => {
    if (!proofFile) {
      setErrorMessage("Attach proof of purchase before submitting your review.");
      return;
    }
    if (!canSubmit || submitting.current || preparingProof.current) return;

    const user = auth.currentUser;
    if (!user) {
      setErrorMessage("Please sign in before submitting a review.");
      return;
    }

    if (!selectedStore) {
      setErrorMessage("Choose an available store account before submitting your review.");
      return;
    }

    setErrorMessage("");
    submitting.current = true;
    setIsSubmitting(true);

    try {
      await saveReview({
        storeId: selectedStore.id,
        rating,
        feedback,
        proofFile: proofFile || "",
      });
      setSubmitted(true);
    } catch (error) {
      console.error("Review could not be saved to Firestore", {
        stage: error?.reviewStage || "unknown",
        code: error?.code,
        storeId: selectedStore.id,
        hasProof: Boolean(proofFile),
      }, error);
      setErrorMessage(
        error?.code === "permission-denied"
          ? error?.reviewStage === "store-lookup"
            ? "The selected store could not be verified. Please reopen Reviews and choose a shop again."
            : "This review was blocked by the current Firestore permissions. Please contact support."
          : ["validation/invalid-input", "validation/invalid-proof"].includes(error?.code)
            ? error.message : "Unable to submit your review. Please try again.",
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  const chooseProofImage = async () => {
    if (preparingProof.current || submitting.current || submitted) return;
    preparingProof.current = true;
    setIsPreparingProof(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const preparedProof = await prepareProofImage(asset);
      setErrorMessage("");
      setProofFile(preparedProof);
    } catch (error) {
      console.error("Proof image could not be selected", error);
      setErrorMessage(error?.code === "validation/invalid-proof" ? error.message
        : "Unable to prepare the selected receipt image. Please choose it again.");
    } finally {
      preparingProof.current = false;
      setIsPreparingProof(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Write a review" onBack={() => router.replace(returnTo)} />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.introCard}>
              <Text style={styles.introTitle}>How was your visit?</Text>
              <Text style={styles.introText}>
                Help other shoppers find a shop they can trust.
              </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shop</Text>
            <TouchableOpacity
              style={styles.selectField}
              onPress={() => setShowShopPicker(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Choose a shop"
            >
              <View style={styles.fieldIcon}>
                <Ionicons name="storefront-outline" size={20} color={COLORS.primary} />
              </View>
              <Text style={[styles.selectText, !selectedStore && { color: COLORS.textMuted }]}>
                {selectedStore?.name || (storesLoading ? "Loading store accounts..." : "Choose a store")}
              </Text>
              <Ionicons
                name="chevron-down"
                size={18}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
            {storesError ? <Text role="alert" style={styles.errorText}>{storesError}</Text> : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your rating</Text>
            <View style={styles.ratingCard}>
              <View style={styles.starsRow} role="radiogroup" accessibilityLabel="Shop rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    style={styles.starButton}
                    onPress={() => setRating(star)}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    aria-checked={rating === star}
                    accessibilityLabel={`${star} star${star > 1 ? "s" : ""}`}
                  >
                    <Ionicons
                      name={star <= rating ? "star" : "star-outline"}
                      size={32}
                      color={
                        star <= rating ? "#C9860C" : "#8B96A7"
                      }
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.ratingHint, rating > 0 && styles.ratingHintSelected]} accessibilityLiveRegion="polite">
                {rating
                  ? `${rating} out of 5 stars`
                  : "Tap a star to rate this shop"}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your review</Text>
            <View style={[styles.feedbackField, feedbackFocused && styles.feedbackFieldFocused]}>
              <TextInput
                value={feedback}
                onChangeText={setFeedback}
                onFocus={() => setFeedbackFocused(true)}
                onBlur={() => setFeedbackFocused(false)}
                accessibilityLabel="Your review"
                placeholder="What went well? What could be better?"
                placeholderTextColor={COLORS.textMuted}
                multiline
                textAlignVertical="top"
                style={styles.feedbackInput}
                maxLength={500}
              />
              <Text style={styles.characterCount}>{feedback.length} / 500</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Proof of purchase</Text>
              <Text style={styles.optionalText}>Required</Text>
            </View>
            <TouchableOpacity
              style={[styles.uploadCard, proofFile && styles.uploadCardSelected]}
              onPress={chooseProofImage}
              disabled={isSubmitting || isPreparingProof || submitted}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={proofFile ? "Change proof of purchase image" : "Add required proof of purchase image"}
            >
              <View style={styles.uploadIcon}>
                <Ionicons
                  name={proofFile ? "checkmark" : "receipt-outline"}
                  size={21}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.uploadCopy}>
                <Text style={styles.uploadTitle} numberOfLines={1}>
                  {isPreparingProof ? "Preparing image..." : proofFile ? proofFile.fileName || "Receipt attached" : "Attach a receipt"}
                </Text>
                <Text style={styles.uploadText}>
                  {proofFile
                    ? "Tap to choose a different image"
                    : "Receipt or invoice image, under 5 MB"}
                </Text>
              </View>
              {isPreparingProof
                ? <ActivityIndicator size="small" color={COLORS.primary} accessibilityLabel="Preparing proof image" />
                : <Ionicons name={proofFile ? "swap-horizontal" : "add"} size={20} color={COLORS.primary} />}
            </TouchableOpacity>
            {proofFile?.uri ? (
              <View style={styles.proofAttachment}>
                <Image source={{ uri: proofFile.uri }} resizeMode="contain" style={styles.proofPreview} accessibilityLabel="Selected proof of purchase" />
                <TouchableOpacity style={styles.removeProofButton} onPress={() => setProofFile(null)}
                  disabled={isSubmitting || isPreparingProof || submitted}
                  accessibilityRole="button" accessibilityLabel="Remove proof of purchase" activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={18} color={COLORS.error} />
                  <Text style={styles.removeProofText}>Remove attachment</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {errorMessage ? <Text role="alert" style={styles.errorText}>{errorMessage}</Text> : null}

          {submitted && (
            <View style={styles.successBox}>
              <MaterialIcons
                name="check-circle"
                size={19}
                color={COLORS.success}
              />
              <Text style={styles.successText}>
                Review submitted. Returning to your profile...
              </Text>
            </View>
          )}

          <View style={styles.submitSection}>
            <TouchableOpacity
              style={[
                styles.submitButton,
                !canSubmit && styles.submitButtonDisabled,
              ]}
              activeOpacity={0.85}
              disabled={submitDisabled}
              accessibilityRole="button"
              accessibilityLabel="Submit review"
              aria-disabled={submitDisabled}
              aria-busy={isSubmitting}
              onPress={submitReview}
            >
              {isSubmitting ? <ActivityIndicator color={COLORS.white} size="small" /> : null}
              <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>
                {isSubmitting
                  ? "Submitting..."
                  : submitted
                    ? "Review submitted"
                    : "Submit review"}
              </Text>
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Reviews should be honest, respectful, and based on a real shop
              experience.
            </Text>
          </View>
        </ScrollView>

        <Modal visible={isSubmitting} transparent animationType="fade"
          statusBarTranslucent onRequestClose={() => {}}>
          <View style={styles.savingOverlay} accessibilityLiveRegion="polite">
            <View style={styles.savingCard}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.savingTitle}>Saving your review...</Text>
              <Text style={styles.savingDetail}>
                {proofFile ? "Saving the review and proof image together." : "Saving the review to Firestore."}
              </Text>
            </View>
          </View>
        </Modal>

        <GlassModal
          visible={showShopPicker}
          onClose={() => setShowShopPicker(false)}
          title="Choose a shop"
          icon="storefront"
          dismissOnBackdrop
          showClose
        >
          {storesLoading ? (
            <Text style={styles.shopOptionText}>Loading store accounts...</Text>
          ) : storesError ? (
            <Text role="alert" style={styles.errorText}>{storesError}</Text>
          ) : stores.length ? stores.map((store) => {
            const isSelected = store.id === selectedStoreId;
            return (
              <TouchableOpacity key={store.id} style={styles.shopOption} activeOpacity={0.8}
                accessibilityRole="button" accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  setSelectedStoreId(store.id);
                  setShowShopPicker(false);
                }}>
                <MaterialIcons name="storefront" size={22} color={isSelected ? COLORS.primary : COLORS.textMuted} />
                <Text style={styles.shopOptionText}>{store.name}</Text>
                <MaterialIcons name={isSelected ? "check-circle" : "chevron-right"} size={22}
                  color={isSelected ? COLORS.primary : COLORS.textMuted} />
              </TouchableOpacity>
            );
          }) : (
            <Text style={styles.shopOptionText}>No store accounts are available.</Text>
          )}
        </GlassModal>

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
  introCard: {
    gap: 5,
    paddingVertical: 4,
  },
  introTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 19,
    lineHeight: 25,
    color: COLORS.text,
  },
  introText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.textMuted,
  },
  section: { gap: 8 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.textDim,
    lineHeight: 18,
    paddingLeft: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionalText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: COLORS.textMuted,
  },
  selectField: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    borderRadius: 18,
    borderCurve: "continuous",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  fieldIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center" },
  selectText: {
    flex: 1,
    minWidth: 0,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
  },
  
  ratingCard: {
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    padding: 16,
    gap: 8,
  },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 4 },
  starButton: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  ratingHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  ratingHintSelected: { color: COLORS.text, fontFamily: "Inter_500Medium" },
  uploadCard: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    borderRadius: 18,
    borderCurve: "continuous",
    padding: 12,
    gap: 10,
  },
  uploadCardSelected: {
    borderColor: COLORS.success,
    backgroundColor: "#f2fbf5",
  },
  proofPreview: {
    width: "100%",
    height: 180,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceHighlight,
  },
  proofAttachment: { padding: 8, backgroundColor: COLORS.white, borderRadius: 18, gap: 4 },
  removeProofButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  removeProofText: { fontFamily: "Inter_500Medium", fontSize: 13, color: COLORS.error },
  uploadIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceAlt,
  },
  uploadCopy: { flex: 1, minWidth: 0, gap: 3 },
  uploadTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.text,
  },
  uploadText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.textMuted,
  },
  feedbackField: {
    minHeight: 144,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: 18,
    borderCurve: "continuous",
    padding: 14,
    gap: 8,
  },
  feedbackFieldFocused: { borderColor: COLORS.primary },
  feedbackInput: {
    flex: 1,
    minHeight: 90,
    padding: 0,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.text,
  },
  characterCount: {
    alignSelf: "flex-end",
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
    color: COLORS.textMuted,
  },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e5f6eb",
    borderRadius: RADIUS.md,
    padding: 11,
  },
  successText: {
    flex: 1,
    marginLeft: 8,
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: "#218739",
  },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.error,
    textAlign: "center",
  },
  submitSection: { gap: 10 },
  submitButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    borderCurve: "continuous",
    gap: 8,
  },
  submitButtonDisabled: { backgroundColor: COLORS.surfaceHighlight },
  submitText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: COLORS.white,
  },
  submitTextDisabled: { color: COLORS.textMuted },
  helperText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 17,
    color: COLORS.textMuted,
    textAlign: "center",
  },
  savingOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(15, 31, 58, 0.42)",
  },
  savingCard: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    gap: 12,
    padding: 24,
    borderRadius: 20,
    backgroundColor: COLORS.white,
  },
  savingTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: COLORS.text,
  },
  savingDetail: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
    textAlign: "center",
  },

  shopOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: COLORS.outline,
  },
  shopOptionText: {
    flex: 1,
    marginLeft: 10,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: COLORS.text,
  },
});
