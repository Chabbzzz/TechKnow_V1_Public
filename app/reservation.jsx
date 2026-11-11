import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { MaterialIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { COLORS, RADIUS, SIZES, LAYOUT } from "../constants/theme";
import { GlassModal, ModalAction } from "../components/GlassModal";
import { ShopPickerModal } from "../components/ShopPickerModal";
import { TimeSlotPickerSheet } from "../components/TimeSlotPickerSheet";
import { ProductImage } from "../components/ProductImage";
import { auth, db } from "../backend/firebase";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { createReservation as saveReservation } from "../backend/services/reservations";
import { getStoreListings } from "../constants/stores";

const webDateTimeInputStyle = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  backgroundColor: "transparent",
  fontFamily: "Inter_400Regular",
  fontSize: 13,
  color: COLORS.text,
};

const TIME_SLOT_GROUPS = [
  { label: "Morning Slots", slots: [
    "09:00 AM – 10:00 AM",
    "10:00 AM – 11:00 AM",
    "11:00 AM – 12:00 PM",
  ] },
  { label: "Afternoon Slots", slots: [
    "01:00 PM – 02:00 PM",
    "02:00 PM – 03:00 PM",
    "03:00 PM – 04:00 PM",
    "04:00 PM – 05:00 PM",
    "05:00 PM – 06:00 PM",
  ] },
];

export default function ReservationScreen() {
  const params = useLocalSearchParams();
  const returnTo = params.returnTo || "/home";
  const productName = params.productName || "Select product";
  const productId = params.productId || "";
  const productStoreId = (Array.isArray(params.productStoreId) ? params.productStoreId[0] : params.productStoreId) || "";
  const productShop = (Array.isArray(params.productShop) ? params.productShop[0] : params.productShop) || "";
  const productPrice = params.productPrice || "";
  const productCategory = params.productCategory || "Uncategorized";
  const productImage = params.productImage || "";
  const productImagePath = params.productImagePath || "";
  const productDescription = params.productDescription || "";
  const normalizedProductImage = typeof productImage === "string" ? productImage.trim() : "";
  const normalizedProductImagePath = typeof productImagePath === "string" ? productImagePath.trim() : "";
  const [shop, setShop] = useState(productShop);
  const [selectedStoreId, setSelectedStoreId] = useState(productStoreId);
  const [stores, setStores] = useState([]);
  const [storeDirectoryIds, setStoreDirectoryIds] = useState([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState("");
  const [note, setNote] = useState("");
  const [showShopPicker, setShowShopPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimeSlots, setShowTimeSlots] = useState(false);
  const activeAndroidPicker = useRef(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showPendingLimitModal, setShowPendingLimitModal] = useState(false);
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isExistingReservation, setIsExistingReservation] = useState(false);
  const submitted = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    submitted.current = false;
    setHasSubmitted(false);
    setIsExistingReservation(false);
  }, [productId]);

  useEffect(() => () => {
    const mode = activeAndroidPicker.current;
    activeAndroidPicker.current = null;
    if (mode) {
      DateTimePickerAndroid.dismiss(mode).catch((error) => {
        console.warn("Could not dismiss reservation picker", error);
      });
    }
  }, []);

  const openDatePicker = () => {
    Keyboard.dismiss();
    setShowTimeSlots(false);
    if (Platform.OS !== "android") {
      setShowDatePicker(true);
      return;
    }

    // Open once per tap; screen updates must not reopen the native dialog.
    if (activeAndroidPicker.current) return;
    activeAndroidPicker.current = "date";
    const now = new Date();
    DateTimePickerAndroid.open({
      mode: "date",
      value: date || now,
      minimumDate: now,
      onValueChange: (_event, value) => {
        if (activeAndroidPicker.current !== "date") return;
        activeAndroidPicker.current = null;
        if (value) setDate(value);
      },
      onDismiss: () => {
        activeAndroidPicker.current = null;
      },
      onError: (error) => {
        if (activeAndroidPicker.current !== "date") return;
        activeAndroidPicker.current = null;
        console.warn("Could not open reservation picker", error);
        setErrorMessage("Unable to open the date picker. Please try again.");
      },
    });
  };
  useEffect(() => {
    setShop(productShop);
    setSelectedStoreId(productStoreId);
  }, [productId, productShop, productStoreId]);

  useEffect(() => {
    if (productStoreId && !storesLoading && !storeDirectoryIds.includes(productStoreId)) {
      setShop(productShop || "Store");
      setSelectedStoreId(productStoreId);
      return;
    }
    if (!stores.length) {
      if (!storesLoading) {
        setShop("");
        setSelectedStoreId("");
      }
      return;
    }

    const selectedStore = stores.find((store) => store.id === productStoreId)
      || stores.find((store) => store.name === productShop)
      || stores[0];
    setShop(selectedStore.name);
    setSelectedStoreId(selectedStore.id);
  }, [stores, storeDirectoryIds, storesLoading, productStoreId, productShop]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "storeDirectory"),
      (snapshot) => {
        const availableStores = getStoreListings(snapshot.docs);
        setStores(availableStores);
        setStoreDirectoryIds([...new Set([...snapshot.docs.map((document) => document.id), ...availableStores.map(store => store.id)])]);
        setStoresLoading(false);
      },
      (storeError) => {
        console.warn("Stores could not be loaded for reservation", storeError?.code || storeError);
        setStoresLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const productStoreMissing = productStoreId && !storesLoading && !storeDirectoryIds.includes(productStoreId);
  const fallbackProductStore = productStoreMissing
    ? [{ id: productStoreId, name: productShop || "Store" }]
    : [];
  const storeOptions = productStoreId
    ? stores.filter((store) => store.id === productStoreId).concat(fallbackProductStore)
    : stores;

  useEffect(() => {
    if (!productId) return undefined;

    const productRef = doc(db, "products", String(productId));
    return onSnapshot(productRef, (snapshot) => {
      if (!snapshot.exists() || snapshot.data().archived === true) {
        router.replace(returnTo);
      }
    });
  }, [productId, returnTo]);

  const formatDate = (value) => value?.toLocaleDateString() || "";
  const formatTime = (value) =>
    value?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) || "";
  const dateInputValue = (value) => value
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : "";
  const timeInputValue = (value) => value
    ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`
    : "";

  const createReservation = async () => {
    if (submitting.current || submitted.current) return;
    const user = auth.currentUser;
    if (!user) {
      setErrorMessage("Please sign in before creating a reservation.");
      return;
    }

    if (!productId) {
      setErrorMessage("This product is unavailable. Please choose a product again.");
      return;
    }

    const selectedStore = stores.find((store) => store.id === selectedStoreId)
      || (productStoreMissing && selectedStoreId === productStoreId ? fallbackProductStore[0] : null);
    if (!selectedStore) {
      setErrorMessage("Choose one of the available store accounts before reserving.");
      return;
    }

    setErrorMessage("");
    submitting.current = true;
    setIsSubmitting(true);

    try {
      const { waitlisted } = await saveReservation({
        productId: String(productId),
        storeId: selectedStore.id,
        storeName: selectedStore.name,
        date: formatDate(date),
        time: Platform.OS === "web" ? formatTime(time) : selectedTimeSlot,
        note,
      });

      submitted.current = true;
      setHasSubmitted(true);
      setIsWaitlisted(waitlisted);
      setShowSuccessModal(true);
    } catch (error) {
      const errorCode = String(error?.code || "").replace(/^functions\//, "");
      if (errorCode === "resource-exhausted") {
        setShowPendingLimitModal(true);
        return;
      }
      if (errorCode === "already-exists") {
        submitted.current = true;
        setHasSubmitted(true);
        setIsExistingReservation(true);
        setErrorMessage("You already have an active reservation for this item. Check your reservations for updates.");
        return;
      }
      console.error("Reservation could not be saved to Firestore", error);
      const reservationServiceUnavailable = ["not-found", "unavailable", "deadline-exceeded"].includes(errorCode);
      setErrorMessage(
        ["permission-denied", "unauthenticated"].includes(errorCode)
          ? "You do not have permission to create this reservation. Please sign in again."
          : reservationServiceUnavailable
            ? "The reservation service is unavailable, so your request was not submitted. Please try again later."
          : ["validation/invalid-input", "failed-precondition", "invalid-argument"].includes(errorCode)
            ? error.message : "Unable to create the reservation. Please try again.",
      );
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={[styles.container, LAYOUT.screen]}>
        <ScreenHeader title="Reservation" onBack={() => {
          if (returnTo === "/compare" && router.canGoBack()) router.back();
          else router.replace(returnTo);
        }}
          right={<TouchableOpacity style={styles.historyIconButton} accessibilityRole="button"
            accessibilityLabel="Open reservation history" onPress={() => router.push({
              pathname: "/reservation-history", params: { returnTo: "/reservation" },
            })}><MaterialIcons name="history" size={23} color={COLORS.primary} /></TouchableOpacity>} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

          <View style={styles.productCard}>
            <View style={styles.productImage}>
              <ProductImage
                uri={normalizedProductImage}
                storagePath={normalizedProductImagePath}
                style={styles.productImageContent}
                resizeMode="contain"
                accessibilityLabel={`${productName} product image`}
                fallback={(
                  <View style={styles.noImageState} accessibilityLabel={productId ? `${productName} has no product image` : "No product selected"}>
                    <MaterialIcons name={productId ? "image-not-supported" : "shopping-bag"} size={30} color={COLORS.textMuted} />
                    {productId ? <Text style={styles.noImageText}>No image</Text> : null}
                  </View>
                )}
              />
            </View>
            <View style={styles.productCopy}>
              {productId ? <Text style={styles.productCategory} numberOfLines={1}>{productCategory.toUpperCase()}</Text> : null}
              <Text style={styles.productName} numberOfLines={2}>{productName}</Text>
              {productId ? (
                productPrice ? <Text style={styles.productPrice}>{productPrice}</Text> : null
              ) : (
                <Text style={styles.productHint}>Choose an item to reserve.</Text>
              )}
              <TouchableOpacity
                style={styles.changeItemButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={productId ? "Change reservation product" : "Browse products to reserve"}
                onPress={() => router.replace(returnTo)}
              >
                <Text style={styles.changeItemText}>{productId ? "Change item" : "Browse products"}</Text>
                <MaterialIcons name="chevron-right" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {productId ? (
            <View style={styles.descriptionCard}>
              <Text style={styles.descriptionTitle}>Product description</Text>
              <Text style={styles.descriptionText}>
                {productDescription || "No description was provided for this product."}
              </Text>
            </View>
          ) : null}

          <View>
            <Text style={styles.fieldLabel}>Shop</Text>
            <TouchableOpacity
              style={styles.inputWrap}
              onPress={() => {
                setShowTimeSlots(false);
                setShowDatePicker(false);
                setShowShopPicker(true);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Choose a shop"
            >
              <Text style={[styles.inputValue, !shop && styles.placeholder]}>
                {shop || (storesLoading ? "Loading store accounts..." : "Choose a store")}
              </Text>
              <MaterialIcons
                name="storefront"
                size={19}
                color={COLORS.textMuted}
              />
              <MaterialIcons
                name="expand-more"
                size={20}
                color={COLORS.textMuted}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.dateTimeRow}>
            <View style={styles.halfField}>
              <Text style={styles.fieldLabel}>Drop-off Date</Text>
              {Platform.OS === "web" ? (
                <View style={styles.inputWrap}>
                  <input
                    type="date"
                    aria-label="Drop-off date"
                    min={dateInputValue(new Date())}
                    value={dateInputValue(date)}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return setDate(null);
                      const [year, month, day] = value.split("-").map(Number);
                      setDate(new Date(year, month - 1, day));
                    }}
                    style={webDateTimeInputStyle}
                  />
                  <MaterialIcons name="calendar-today" size={16} color={COLORS.textMuted} />
                </View>
              ) : (
                <TouchableOpacity style={styles.inputWrap} onPress={openDatePicker} activeOpacity={0.8}
                  accessibilityRole="button" accessibilityLabel="Choose a drop-off date">
                  <Text style={[styles.inputValue, !date && styles.placeholder]}>{formatDate(date) || "mm/dd/yyyy"}</Text>
                  <MaterialIcons name="calendar-today" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
              {Platform.OS === "ios" && showDatePicker ? (
                <DateTimePicker
                  value={date || new Date()}
                  mode="date"
                  minimumDate={new Date()}
                  onValueChange={(_event, value) => {
                    if (value) setDate(value);
                    setShowDatePicker(false);
                  }}
                  onDismiss={() => setShowDatePicker(false)}
                />
              ) : null}
            </View>
            <View style={styles.halfField}>
              <Text style={styles.fieldLabel}>Preferred Time Slot</Text>
              {Platform.OS === "web" ? (
                <View style={styles.inputWrap}>
                  <input
                    type="time"
                    aria-label="Preferred time slot"
                    value={timeInputValue(time)}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return setTime(null);
                      const [hour, minute] = value.split(":").map(Number);
                      const selected = new Date();
                      selected.setHours(hour, minute, 0, 0);
                      setTime(selected);
                    }}
                    style={webDateTimeInputStyle}
                  />
                  <MaterialIcons name="schedule" size={17} color={COLORS.textMuted} />
                </View>
              ) : (
                <TouchableOpacity style={[styles.inputWrap, showTimeSlots && styles.timeInputExpanded]} onPress={() => {
                  Keyboard.dismiss();
                  setShowDatePicker(false);
                  setShowTimeSlots(true);
                }} activeOpacity={0.8} accessibilityRole="button"
                  accessibilityLabel="Choose a preferred time slot"
                  accessibilityState={{ expanded: showTimeSlots }}>
                  <MaterialIcons name="schedule" size={19} color={COLORS.textMuted} />
                  <Text style={[styles.inputValue, styles.timeInputValue, !selectedTimeSlot && styles.placeholder]}>
                    {selectedTimeSlot || "Select time slot"}
                  </Text>
                  <MaterialIcons name="expand-more" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View>
            <Text style={styles.fieldLabel}>Note to shop (optional)</Text>
            <View style={[styles.inputWrap, styles.noteWrap]}>
              <TextInput
                value={note}
                onFocus={() => {
                  setShowTimeSlots(false);
                  setShowDatePicker(false);
                }}
                onChangeText={setNote}
                placeholder="Any special requests or questions?"
                placeholderTextColor={COLORS.textMuted}
                style={[styles.input, styles.noteInput]}
                multiline
                textAlignVertical="top"
              />
            </View>
          </View>

          <View style={styles.infoBox}>
            <MaterialIcons name="info" size={19} color={COLORS.primary} />
            <View style={styles.infoCopy}>
              <Text style={styles.infoTitle}>Reservation policy</Text>
              <Text style={styles.infoText}>
                If an item is out of stock, your request will be placed on the waiting list in order.

The shop will notify you once new stock is available.

Reserved items are held for 24 hours only. If not claimed within that time, they will be released to the next customer.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.createButton, (isSubmitting || hasSubmitted) && styles.createButtonDisabled]}
            activeOpacity={0.85}
            onPress={createReservation}
            disabled={isSubmitting || hasSubmitted}
            accessibilityState={{ disabled: isSubmitting || hasSubmitted }}
          >
            <Text style={styles.createButtonText}>
              {isSubmitting ? "Saving Reservation..." : hasSubmitted
                ? isExistingReservation ? "Already Reserved" : "Reservation Submitted"
                : "Create Reservation"}
            </Text>
          </TouchableOpacity>
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </ScrollView>
        {Platform.OS !== "web" ? (
          <TimeSlotPickerSheet
            visible={showTimeSlots}
            groups={TIME_SLOT_GROUPS}
            selectedSlot={selectedTimeSlot}
            onClose={() => setShowTimeSlots(false)}
            onSelect={(slot) => {
              setSelectedTimeSlot(slot);
              setShowTimeSlots(false);
            }}
          />
        ) : null}
        <ShopPickerModal
          visible={showShopPicker}
          loading={storesLoading}
          stores={storeOptions}
          selectedStoreId={selectedStoreId}
          onClose={() => setShowShopPicker(false)}
          onSelect={(store) => {
            setShop(store.name);
            setSelectedStoreId(store.id);
            setShowShopPicker(false);
          }}
        />
        <GlassModal
          visible={showSuccessModal}
          variant="alert"
          actionLayout="stacked"
          onClose={() => setShowSuccessModal(false)}
          title={isWaitlisted ? "Added to waiting list" : "Reservation submitted"}
          message={isWaitlisted
            ? "This item is out of stock. Pickup depends on restocking and shop confirmation. Track updates in your reservations."
            : "Your request has been sent to the shop. Track its confirmation in your reservations."}
          alertIcon={isWaitlisted ? "time-outline" : "checkmark"}
          tone="primary"
          footer={<>
            <ModalAction title="View reservations" onPress={() => {
              setShowSuccessModal(false);
              router.push({ pathname: "/reservation-history", params: { returnTo: "/home" } });
            }} />
            <ModalAction title="Done" secondary divider onPress={() => {
              setShowSuccessModal(false);
              router.replace("/home");
            }} />
          </>}
        />
        <GlassModal
          visible={showPendingLimitModal}
          variant="alert"
          onClose={() => setShowPendingLimitModal(false)}
          title="Pending reservation limit reached"
          message="You can have up to 5 pending reservations at a time. Wait for a shop to respond before reserving another product."
          alertIcon="layers-outline"
          tone="primary"
          footer={<ModalAction title="Okay" onPress={() => setShowPendingLimitModal(false)} />}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: SIZES.edgeMargin, paddingBottom: 24, gap: 16 },

  productCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: COLORS.white,
    borderRadius: 22,
    borderCurve: "continuous",
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
  },
  productImage: {
    width: 104,
    height: 104,
    flexShrink: 0,
    padding: 4,
    borderRadius: 16,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: COLORS.surfaceHighlight,
  },
  productImageContent: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  noImageState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  noImageText: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: "center",
  },
  productCopy: { flex: 1, minWidth: 0, gap: 2 },
  productCategory: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: COLORS.textMuted,
  },
  productName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.text,
  },
  productPrice: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.primary,
  },
  productHint: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
  },
  descriptionCard: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    borderCurve: "continuous",
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
  },
  descriptionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 6,
  },
  descriptionText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 21,
    color: COLORS.textDim,
  },
  changeItemButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 2,
    minHeight: 44,
    paddingVertical: 6,
  },
  changeItemText: {
    flexShrink: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.primary,
  },
  fieldLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.textDim,
    marginBottom: 6,
  },
  inputWrap: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.outline,
    borderRadius: RADIUS.md,
    borderCurve: "continuous",
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 42,
    paddingVertical: 0,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: COLORS.text,
  },
  inputValue: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: COLORS.text,
  },
  placeholder: { color: COLORS.textMuted },
  dateTimeRow: { flexDirection: Platform.OS === "web" ? "row" : "column", gap: 16 },
  halfField: Platform.OS === "web" ? { flex: 1, minWidth: 120 } : { width: "100%" },
  timeInputValue: { fontSize: 14, lineHeight: 21 },
  timeInputExpanded: { borderColor: COLORS.primary },
  noteWrap: { minHeight: 96, alignItems: "stretch" },
  noteInput: { minHeight: 66 },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: COLORS.primaryDim,
    borderRadius: RADIUS.md,
    padding: 12,
  },
  infoCopy: { flex: 1, marginLeft: 9 },
  infoTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 3,
  },
  infoText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 19,
    color: COLORS.textDim,
  },
  createButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
  },
  createButtonText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: COLORS.white,
  },
  createButtonDisabled: { opacity: 0.65 },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 20,
    color: COLORS.error,
    textAlign: "center",
  },

  historyIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryDim,
  },

});
