import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ScreenHeader } from "../components/ScreenHeader";
import { BacolodAddressField } from "../components/BacolodAddressField";
import { COLORS, SIZES, LAYOUT } from "../constants/theme";
import { auth, db } from "../backend/firebase";
import { GlassModal, ModalAction } from "../components/GlassModal";
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";

const initialsFromName = (value) =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const DEFAULT_FORM = {
  fullName: "",
  username: "",
  usernameLower: "",
  email: "",
  address: "",
};

const PASSWORD_FIELDS = [
  { key: "current", label: "Current password", placeholder: "Current password", icon: "key-outline" },
  { key: "next", label: "New password", placeholder: "At least 6 characters", icon: "lock-closed-outline" },
  { key: "confirm", label: "Confirm new password", placeholder: "Repeat new password", icon: "lock-closed-outline" },
];

function AccountField({ label, icon, trailing, first = false, ...inputProps }) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.fieldRow, !first && styles.fieldDivider]}>
      <View style={[styles.fieldIcon, focused && styles.fieldIconFocused]}>
        <Ionicons name={icon} size={18} color={focused ? COLORS.primary : COLORS.textDim} />
      </View>
      <View style={styles.fieldCopy}>
        <Text style={[styles.fieldLabel, focused && styles.fieldLabelFocused]}>{label}</Text>
        <TextInput
          {...inputProps}
          accessibilityLabel={label}
          placeholderTextColor={COLORS.textMuted}
          style={[styles.input, inputProps.multiline && styles.multilineInput,
            inputProps.editable === false && styles.disabledInput]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </View>
      {trailing}
    </View>
  );
}

export default function EditProfileScreen() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [savedForm, setSavedForm] = useState(DEFAULT_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showNoChangesModal, setShowNoChangesModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [passwordVisibility, setPasswordVisibility] = useState({
    current: false,
    next: false,
    confirm: false,
  });
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const savedProfile = snapshot.exists() ? snapshot.data() : {};
        if (!isMounted) return;
        const nextForm = {
          fullName: savedProfile.fullName || user.displayName || "",
          username: savedProfile.username || "",
          usernameLower: savedProfile.usernameLower || savedProfile.username?.toLowerCase() || "",
          email: user.email || savedProfile.email || "",
          address: savedProfile.address || "",
        };
        setForm(nextForm);
        setSavedForm(nextForm);
      } catch (error) {
        console.error("Could not load the profile for editing", error);
        if (isMounted) setErrorMessage("Unable to load your account details. Please try again.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (errorMessage) setErrorMessage("");
  };

  const updatePasswordField = (field, value) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
    if (errorMessage) setErrorMessage("");
  };

  const togglePasswordVisibility = (field) => {
    setPasswordVisibility((current) => ({ ...current, [field]: !current[field] }));
  };

  const saveProfile = async () => {
    const user = auth.currentUser;
    const username = form.username.trim();
    const usernameLower = username.toLowerCase();
    const address = form.address.trim();
    const currentPassword = passwordForm.current;
    const nextPassword = passwordForm.next;
    const confirmPassword = passwordForm.confirm;
    const isChangingPassword = Boolean(currentPassword || nextPassword || confirmPassword);
    const usernameChanged = usernameLower !== (savedForm.usernameLower || savedForm.username.trim().toLowerCase());
    const hasProfileChanges = usernameChanged || address !== savedForm.address.trim();

    if (!user) return;
    if (address !== savedForm.address.trim() && !address) {
      setErrorMessage("Choose a barangay, street or subdivision, and house or unit details for your address.");
      return;
    }
    if (!hasProfileChanges && !isChangingPassword) {
      setShowNoChangesModal(true);
      return;
    }
    if (usernameChanged && !/^[a-zA-Z0-9._]{3,20}$/.test(username)) {
      setErrorMessage("Username must be 3-20 characters and use only letters, numbers, periods, or underscores.");
      return;
    }
    if (isChangingPassword) {
      if (!user.email) {
        setErrorMessage("Password changes are unavailable because this account has no email sign-in.");
        return;
      }
      if (!currentPassword || !nextPassword || !confirmPassword) {
        setErrorMessage("Enter your current password, new password, and confirmation.");
        return;
      }
      if (nextPassword.length < 6) {
        setErrorMessage("Your new password must be at least 6 characters.");
        return;
      }
      if (nextPassword !== confirmPassword) {
        setErrorMessage("The new password and confirmation do not match.");
        return;
      }
    }

    try {
      setIsSaving(true);
      setErrorMessage("");
      if (isChangingPassword) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
      }
      const profileReference = doc(db, "users", user.uid);
      const profileChanges = {
        uid: user.uid,
        email: user.email || form.email,
        address,
        updatedAt: serverTimestamp(),
      };
      if (usernameChanged) {
        const usernameReference = doc(db, "usernames", usernameLower);
        const oldUsernameLower = savedForm.usernameLower || savedForm.username.trim().toLowerCase();
        await runTransaction(db, async (transaction) => {
          let oldUsernameSnapshot = null;
          let oldUsernameReference = null;
          if (oldUsernameLower && oldUsernameLower !== usernameLower) {
            oldUsernameReference = doc(db, "usernames", oldUsernameLower);
            oldUsernameSnapshot = await transaction.get(oldUsernameReference);
          }

          transaction.set(usernameReference, { uid: user.uid, username });
          transaction.set(profileReference, {
            ...profileChanges,
            username,
            usernameLower,
          }, { merge: true });
          if (oldUsernameSnapshot?.exists() && oldUsernameSnapshot.data().uid === user.uid) {
            transaction.delete(oldUsernameReference);
          }
        });
      } else {
        await setDoc(profileReference, profileChanges, { merge: true });
      }
      if (isChangingPassword) await updatePassword(user, nextPassword);
      const nextForm = { ...form, username, usernameLower, address };
      setForm(nextForm);
      setSavedForm(nextForm);
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordVisibility({ current: false, next: false, confirm: false });
      setShowSuccessModal(true);
    } catch (error) {
      console.error("Could not save the user profile", error);
      if (error?.code === "auth/invalid-credential" || error?.code === "auth/wrong-password") {
        setErrorMessage("The current password is incorrect.");
      } else if (error?.code === "username/taken") {
        setErrorMessage(error.message);
      } else if (error?.code === "permission-denied") {
        setErrorMessage("That username may already be taken. Choose another one and try again.");
      } else if (error?.code === "auth/weak-password") {
        setErrorMessage("Your new password is too weak. Use at least 6 characters.");
      } else {
        setErrorMessage("Your changes could not be saved. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const initials = initialsFromName(form.fullName);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={[styles.container, LAYOUT.screen]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScreenHeader title="Edit account" onBack={() => { if (!isSaving) router.back(); }} />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.intro}>
            <View style={styles.avatar}>
              {initials ? <Text style={styles.avatarText}>{initials}</Text>
                : <Ionicons name="person-outline" size={28} color={COLORS.primary} />}
            </View>
            <View style={styles.introCopy}>
              <Text style={styles.introTitle} numberOfLines={2}>{form.fullName || "Your account"}</Text>
              <Text style={styles.introText}>Keep your details up to date.</Text>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading account details...</Text>
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>PERSONAL INFORMATION</Text>
                <View style={styles.formCard}>
                  <AccountField
                    first
                    label="Username"
                    icon="at-outline"
                    value={form.username}
                    onChangeText={(value) => updateField("username", value)}
                    placeholder="Choose a username"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    editable={!isSaving}
                  />
                  <AccountField
                    label="Full name"
                    icon="person-outline"
                    value={form.fullName}
                    editable={false}
                    trailing={<Ionicons name="lock-closed-outline" size={16} color={COLORS.textMuted} />}
                  />
                  <AccountField
                    label="Email address"
                    icon="mail-outline"
                    value={form.email}
                    editable={false}
                    autoCapitalize="none"
                    trailing={<Ionicons name="lock-closed-outline" size={16} color={COLORS.textMuted} />}
                  />
                  <BacolodAddressField
                    value={form.address}
                    onChangeText={(value) => updateField("address", value)}
                    editable={!isSaving}
                  />
                </View>
                <Text style={styles.helperText}>Choose 3-20 letters, numbers, periods, or underscores. Full name and email are locked.</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SECURITY</Text>
                <View style={styles.formCard}>
                  <View style={styles.passwordHeader}>
                    <View style={styles.passwordHeaderIcon}>
                      <Ionicons name="shield-checkmark-outline" size={22} color={COLORS.primary} />
                    </View>
                    <View style={styles.passwordHeaderCopy}>
                      <Text style={styles.passwordTitle}>Change password</Text>
                      <Text style={styles.passwordSubtitle}>Leave these fields blank to keep your current password.</Text>
                    </View>
                  </View>
                  {PASSWORD_FIELDS.map((field) => (
                    <AccountField
                      key={field.key}
                      label={field.label}
                      icon={field.icon}
                      value={passwordForm[field.key]}
                      onChangeText={(value) => updatePasswordField(field.key, value)}
                      placeholder={field.placeholder}
                      secureTextEntry={!passwordVisibility[field.key]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete={field.key === "current" ? "current-password" : "new-password"}
                      textContentType={field.key === "current" ? "password" : "newPassword"}
                      editable={!isSaving}
                      trailing={(
                        <TouchableOpacity
                          style={styles.passwordToggle}
                          onPress={() => togglePasswordVisibility(field.key)}
                          accessibilityRole="button"
                          accessibilityLabel={`${passwordVisibility[field.key] ? "Hide" : "Show"} ${field.label.toLowerCase()}`}
                          aria-pressed={passwordVisibility[field.key]}
                          disabled={isSaving}
                          activeOpacity={0.7}
                        >
                          <Ionicons name={passwordVisibility[field.key] ? "eye-off-outline" : "eye-outline"}
                            size={20} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      )}
                    />
                  ))}
                </View>
              </View>

              {errorMessage ? <Text role="alert" style={styles.errorText}>{errorMessage}</Text> : null}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.saveButton, isSaving && styles.saveButtonBusy]}
                  activeOpacity={0.85}
                  onPress={saveProfile}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Save changes"
                  aria-disabled={isSaving}
                  aria-busy={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : null}
                  <Text style={styles.saveText}>{isSaving ? "Saving changes..." : "Save changes"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cancelButton}
                  activeOpacity={0.8}
                  onPress={() => router.back()}
                  disabled={isSaving}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                  aria-disabled={isSaving}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
        <GlassModal
          visible={showNoChangesModal}
          variant="alert"
          onClose={() => setShowNoChangesModal(false)}
          title="No changes to save"
          message="Edit your account details, then tap Save changes."
          icon="edit-note"
          alertIcon="create-outline"
          footer={<ModalAction title="Okay" onPress={() => setShowNoChangesModal(false)} />}
        />
        <GlassModal
          visible={showSuccessModal}
          variant="alert"
          onClose={() => setShowSuccessModal(false)}
          title="Changes saved"
          message="Your account details have been updated."
          icon="check"
          alertIcon="checkmark"
          tone="success"
          footer={<ModalAction title="Done" onPress={() => {
            setShowSuccessModal(false);
            router.back();
          }} />}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: SIZES.edgeMargin, paddingTop: 4, paddingBottom: 24, gap: 16 },
  intro: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 14,
    backgroundColor: COLORS.white,
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
  },
  avatar: {
    width: 64,
    height: 64,
    flexShrink: 0,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryDim,
  },
  avatarText: { fontFamily: "Inter_700Bold", fontSize: 22, color: COLORS.primary },
  introCopy: { flex: 1, minWidth: 0, gap: 4 },
  introTitle: { fontFamily: "Inter_700Bold", fontSize: 20, lineHeight: 26, color: COLORS.text },
  introText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, color: COLORS.textMuted },
  section: { gap: 8 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
    color: COLORS.textMuted,
    paddingLeft: 4,
  },
  formCard: {
    paddingHorizontal: 14,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
  },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 76 },
  fieldDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.outline },
  fieldIcon: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceHighlight,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldIconFocused: { backgroundColor: COLORS.surfaceAlt },
  fieldCopy: { flex: 1, minWidth: 0, gap: 2 },
  fieldLabel: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 16, color: COLORS.textMuted },
  fieldLabelFocused: { color: COLORS.primary },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    paddingHorizontal: 0,
    paddingVertical: 6,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.text,
    ...Platform.select({ web: { outlineStyle: "none" }, default: {} }),
  },
  disabledInput: { color: COLORS.textMuted },
  multilineInput: { minHeight: 64 },
  passwordHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 16 },
  passwordHeaderIcon: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surfaceAlt,
  },
  passwordHeaderCopy: { flex: 1, minWidth: 0, gap: 4 },
  passwordTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 20, color: COLORS.text },
  passwordSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.textMuted },
  passwordToggle: { width: 44, minHeight: 44, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  helperText: { paddingHorizontal: 4, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: COLORS.textMuted },
  loadingState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
  },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 13, color: COLORS.textMuted },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 20, color: COLORS.error },
  actions: { gap: 8 },
  saveButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: COLORS.primary,
  },
  saveButtonBusy: { opacity: 0.78 },
  saveText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: COLORS.white },
  cancelButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.outline,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: COLORS.white,
  },
  cancelText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: COLORS.textDim },
});
