import React, { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import BACOLOD_STREETS_BY_BARANGAY from "../web/bacolod-addresses";
import { COLORS } from "../constants/theme";

const BARANGAYS = Object.keys(BACOLOD_STREETS_BY_BARANGAY).sort((a, b) => a.localeCompare(b));
const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ");

function parseSavedAddress(address) {
  const parts = String(address || "").split(",").map((part) => part.trim()).filter(Boolean);
  const barangay = BARANGAYS.find((name) => parts.some((part) => {
    const candidate = normalize(part).replace(/^brgy\s+/, "barangay ");
    return candidate === normalize(name);
  })) || "";
  if (!barangay) return { barangay: "", street: "", details: "", legacyAddress: String(address || "") };

  const streets = BACOLOD_STREETS_BY_BARANGAY[barangay] || [];
  const street = streets.find((name) => parts.some((part) => normalize(part) === normalize(name))) || "";
  const details = parts.filter((part) => normalize(part) !== normalize(barangay)
    && (!street || normalize(part) !== normalize(street))
    && !["bacolod city", "negros occidental", "philippines"].includes(normalize(part))).join(", ");
  return { barangay, street, details };
}

function makeAddress(details, street, barangay) {
  const houseDetails = String(details || "").trim();
  if (!houseDetails || !street || !barangay) return "";
  return `${houseDetails}, ${street}, ${barangay}, Bacolod City`;
}

export function BacolodAddressField({ value, onChangeText, editable = true, first = false, inputRef, onSubmitEditing }) {
  const initialAddress = useMemo(() => parseSavedAddress(value), []);
  const [legacyAddress] = useState(initialAddress.legacyAddress || "");
  const [barangay, setBarangay] = useState(initialAddress.barangay);
  const [street, setStreet] = useState(initialAddress.street);
  const [details, setDetails] = useState(initialAddress.details);
  const [picker, setPicker] = useState("");
  const [filter, setFilter] = useState("");
  const streetOptions = barangay ? BACOLOD_STREETS_BY_BARANGAY[barangay] || [] : [];
  const options = picker === "barangay" ? BARANGAYS : streetOptions;
  const visibleOptions = options.filter((option) => normalize(option).includes(normalize(filter)));
  const addressComplete = Boolean(makeAddress(details, street, barangay));

  const updateAddress = (nextDetails, nextStreet, nextBarangay) => {
    onChangeText(makeAddress(nextDetails, nextStreet, nextBarangay));
  };

  const openPicker = (type) => {
    if (!editable) return;
    setPicker(type);
    setFilter("");
  };

  const selectOption = (option) => {
    if (picker === "barangay") {
      setBarangay(option);
      setStreet("");
      updateAddress(details, "", option);
    } else {
      setStreet(option);
      updateAddress(details, option, barangay);
    }
    setPicker("");
    setFilter("");
  };

  const updateDetails = (nextDetails) => {
    setDetails(nextDetails);
    updateAddress(nextDetails, street, barangay);
  };

  return (
    <View style={[styles.field, !first && styles.divider]}>
      <View style={styles.heading}>
        <View style={styles.icon}>
          <Ionicons name="location-outline" size={19} color={COLORS.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.label}>Bacolod City address</Text>
          <Text style={styles.helper}>Choose a barangay and its listed street or subdivision.</Text>
          {legacyAddress && !barangay ? (
            <Text style={styles.legacy}>Current saved address: {legacyAddress}. Select the listed location to update it.</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.selectorRow}>
        <Text style={styles.selectorLabel}>Barangay</Text>
        <Pressable style={styles.selector} onPress={() => openPicker("barangay")}
          disabled={!editable} accessibilityRole="button" accessibilityLabel="Select barangay">
          <Text numberOfLines={1} style={[styles.selectorText, !barangay && styles.placeholder]}>
            {barangay || "Select barangay"}
          </Text>
          <Ionicons name="chevron-down" size={17} color={COLORS.textMuted} />
        </Pressable>
      </View>

      <View style={styles.selectorRow}>
        <Text style={styles.selectorLabel}>Street / subdivision</Text>
        <Pressable style={[styles.selector, !barangay && styles.selectorDisabled]}
          onPress={() => openPicker("street")} disabled={!editable || !barangay}
          accessibilityRole="button" accessibilityLabel="Select street or subdivision">
          <Text numberOfLines={1} style={[styles.selectorText, !street && styles.placeholder]}>
            {street || (barangay ? "Select street or subdivision" : "Select a barangay first")}
          </Text>
          <Ionicons name="chevron-down" size={17} color={COLORS.textMuted} />
        </Pressable>
      </View>

      <View style={styles.detailsGroup}>
        <Text style={styles.selectorLabel}>House / unit details</Text>
        <TextInput
          ref={inputRef}
          value={details}
          onChangeText={updateDetails}
          editable={editable}
          placeholder="House number, unit, purok, or landmark"
          placeholderTextColor={COLORS.textMuted}
          selectionColor={COLORS.primary}
          accessibilityLabel="House, unit, purok, or landmark details"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={onSubmitEditing}
          style={[styles.detailsInput, !editable && styles.disabledText]}
        />
      </View>

      <Text style={styles.previewLabel}>Saved address</Text>
      <Text style={styles.preview}>
        {makeAddress(details, street, barangay) || "Complete all three address fields to continue."}
      </Text>
      <View style={styles.checkRow} accessibilityLiveRegion="polite">
        <Ionicons name={addressComplete ? "checkmark-circle" : "alert-circle-outline"} size={15}
          color={addressComplete ? COLORS.success : COLORS.error} />
        <Text style={[styles.checkText, { color: addressComplete ? COLORS.success : COLORS.error }]}>
          {addressComplete ? "Address is complete." : "Select a barangay and street, then enter house or unit details."}
        </Text>
      </View>

      <Modal visible={Boolean(picker)} transparent animationType="slide" onRequestClose={() => setPicker("")}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{picker === "barangay" ? "Choose a barangay" : "Choose a street or subdivision"}</Text>
              <Pressable onPress={() => setPicker("")} accessibilityRole="button" accessibilityLabel="Close address list">
                <Ionicons name="close" size={23} color={COLORS.textDim} />
              </Pressable>
            </View>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              autoFocus
              placeholder={`Search ${picker === "barangay" ? "barangays" : "streets"}`}
              placeholderTextColor={COLORS.textMuted}
              style={styles.searchInput}
              accessibilityLabel="Filter address list"
            />
            <FlatList
              data={visibleOptions}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.emptyText}>No matching address in this list.</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.option} onPress={() => selectOption(item)} accessibilityRole="button">
                  <Text style={styles.optionText}>{item}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { paddingVertical: 12, gap: 9 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.outline },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 32, height: 32, flexShrink: 0, borderRadius: 10, backgroundColor: COLORS.surfaceHighlight,
    alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, gap: 2 },
  label: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16, color: COLORS.text },
  helper: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, color: COLORS.textMuted },
  legacy: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, color: COLORS.textDim },
  selectorRow: { gap: 5 },
  selectorLabel: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16, color: COLORS.textDim },
  selector: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
    paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.outline, borderRadius: 12,
    backgroundColor: COLORS.white },
  selectorDisabled: { backgroundColor: COLORS.surfaceHighlight },
  selectorText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18, color: COLORS.text },
  placeholder: { color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  detailsGroup: { gap: 5 },
  detailsInput: { minHeight: 46, paddingHorizontal: 12, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline, borderRadius: 12, backgroundColor: COLORS.white, fontFamily: "Inter_400Regular",
    fontSize: 14, lineHeight: 20, color: COLORS.text },
  disabledText: { color: COLORS.textMuted },
  previewLabel: { marginTop: 2, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 15, color: COLORS.textMuted },
  preview: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.textDim },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15, 27, 45, 0.45)" },
  modalCard: { maxHeight: "82%", paddingTop: 18, paddingHorizontal: 20, paddingBottom: 24, borderTopLeftRadius: 24,
    borderTopRightRadius: 24, backgroundColor: COLORS.white },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 17, lineHeight: 23, color: COLORS.text },
  searchInput: { minHeight: 46, marginBottom: 8, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline, borderRadius: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: COLORS.text },
  option: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.outline },
  optionText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18, color: COLORS.text },
  emptyText: { paddingVertical: 18, fontFamily: "Inter_400Regular", fontSize: 13, color: COLORS.textMuted },
});
