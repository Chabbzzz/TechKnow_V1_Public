import React, { useRef, useState } from "react";
import { View, StyleSheet, Text, Pressable, Keyboard } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { COLORS } from "../constants/theme";
import { Input } from "../components/Input";
import { BacolodAddressField } from "../components/BacolodAddressField";
import { PrimaryButton } from "../components/PrimaryButton";
import { AuthLayout, AuthSwitch, authStyles } from "../components/AuthLayout";
import { TermsModal } from "../components/TermsModal";
import { createUserWithEmailAndPassword, deleteUser, signOut, updateProfile } from "firebase/auth";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../backend/firebase";

export default function SignupScreen() {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsChecked, setTermsChecked] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailInput = useRef(null);
  const usernameInput = useRef(null);
  const addressInput = useRef(null);
  const passwordInput = useRef(null);
  const confirmInput = useRef(null);
  const signupScroll = useRef(null);
  const confirmPasswordFocused = useRef(false);
  const signupScrollOffset = useRef(0);
  const preKeyboardScrollOffset = useRef(0);
  const updateSignupField = (setter, value) => {
    setter(value);
    if (errorMessage) setErrorMessage("");
  };
  const fullNameValid = fullName.trim().length >= 2;
  const usernameValid = /^[a-zA-Z0-9._]{3,20}$/.test(username.trim());
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 6;
  const confirmPasswordValid = Boolean(confirmPassword && password === confirmPassword);
  const canCreateAccount = Boolean(
    fullName.trim()
    && username.trim()
    && email.trim()
    && address.trim()
    && password
    && confirmPassword
    && agreeTerms
  );

  const scrollConfirmPasswordIntoView = () => {
    signupScroll.current?.scrollToEnd({ animated: true });
  };

  React.useEffect(() => {
    const keyboardDidShow = Keyboard.addListener("keyboardDidShow", () => {
      if (confirmPasswordFocused.current) {
        requestAnimationFrame(scrollConfirmPasswordIntoView);
      }
    });
    const keyboardDidHide = Keyboard.addListener("keyboardDidHide", () => {
      if (confirmPasswordFocused.current) {
        confirmPasswordFocused.current = false;
        signupScroll.current?.scrollTo({ y: preKeyboardScrollOffset.current, animated: true });
      }
    });
    return () => {
      keyboardDidShow.remove();
      keyboardDidHide.remove();
    };
  }, []);

  const handleSignup = async () => {
    if (isSubmitting) return;
    setErrorMessage("");

    if (!fullName.trim() || !username.trim() || !email.trim() || !address.trim() || !password || !confirmPassword) {
      setErrorMessage("Complete all fields.");
      return;
    }

    const cleanUsername = username.trim();
    const usernameLower = cleanUsername.toLowerCase();
    if (!/^[a-zA-Z0-9._]{3,20}$/.test(cleanUsername)) {
      setErrorMessage("Username must be 3–20 characters and use only letters, numbers, periods, or underscores.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (!agreeTerms) {
      setErrorMessage("Accept the Terms and Conditions to continue.");
      return;
    }

    try {
      setIsSubmitting(true);
      const usernameReference = doc(db, "usernames", usernameLower);
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      try {
        await updateProfile(credential.user, { displayName: fullName.trim() });
        await runTransaction(db, async (transaction) => {
          transaction.set(doc(db, "users", credential.user.uid), {
            uid: credential.user.uid,
            fullName: fullName.trim(),
            username: cleanUsername,
            usernameLower,
            email: email.trim(),
            address: address.trim(),
            createdAt: serverTimestamp(),
          });
          transaction.set(usernameReference, {
            uid: credential.user.uid,
            username: cleanUsername,
          });
        });
      } catch (profileError) {
        await deleteUser(credential.user).catch(() => {});
        throw profileError;
      }

      // Firebase signs a new user in automatically. Sign out so the user
      // follows the intended create-account-then-login flow.
      await signOut(auth);
      router.replace("/");
    } catch (error) {
      if (error.code === "auth/email-already-in-use") {
        setErrorMessage("An account already exists for this email.");
      } else if (error.code === "username/taken") {
        setErrorMessage(error.message);
      } else if (error.code === "permission-denied") {
        setErrorMessage("That username may already be taken. Choose another one and try again.");
      } else if (error.code === "auth/invalid-email") {
        setErrorMessage("Enter a valid email address.");
      } else if (error.code === "auth/weak-password") {
        setErrorMessage("Use a stronger password.");
      } else {
        setErrorMessage("Unable to create your account. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout compact title="Create account" subtitle="Find your next upgrade with TechKnow."
      scrollViewRef={signupScroll}
      onScroll={(event) => { signupScrollOffset.current = event.nativeEvent.contentOffset.y; }}>
      <View style={authStyles.form}>
        <View style={authStyles.section}>
          <Text style={authStyles.sectionTitle}>YOUR DETAILS</Text>
          <View style={authStyles.fieldsCard}>
            <Input first label="Full name" icon="person-outline" placeholder="Enter your full name"
              autoCapitalize="words" autoCorrect={false} autoComplete="name" textContentType="name"
              value={fullName} onChangeText={(value) => updateSignupField(setFullName, value)} editable={!isSubmitting}
              returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => usernameInput.current?.focus()} />
            {fullName ? <FieldCheck valid={fullNameValid} message={fullNameValid ? "Name looks good." : "Enter at least 2 characters."} /> : null}
            <Input label="Username" icon="at-outline" placeholder="Choose a username"
              inputRef={usernameInput} autoCapitalize="none" autoCorrect={false} autoComplete="username"
              textContentType="username" value={username} onChangeText={(value) => updateSignupField(setUsername, value)} editable={!isSubmitting}
              returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => emailInput.current?.focus()} />
            {username ? <FieldCheck valid={usernameValid} message={usernameValid ? "Username format is valid." : "Use 3–20 letters, numbers, periods, or underscores."} /> : null}
            <Input label="Email address" icon="mail-outline" placeholder="you@example.com"
              inputRef={emailInput} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              autoComplete="email" textContentType="emailAddress"
              value={email} onChangeText={(value) => updateSignupField(setEmail, value)} editable={!isSubmitting}
              returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => addressInput.current?.focus()} />
            {email ? <FieldCheck valid={emailValid} message={emailValid ? "Email format is valid." : "Enter an email like name@example.com."} /> : null}
            <BacolodAddressField
              inputRef={addressInput}
              value={address}
              onChangeText={(value) => updateSignupField(setAddress, value)}
              editable={!isSubmitting}
              onSubmitEditing={() => passwordInput.current?.focus()}
            />
          </View>
        </View>

        <View style={authStyles.section}>
          <Text style={authStyles.sectionTitle}>PASSWORD</Text>
          <View style={authStyles.fieldsCard}>
            <Input first label="Password" icon="lock-closed-outline" placeholder="Create password"
              inputRef={passwordInput} secureTextEntry showPasswordToggle
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
              value={password} onChangeText={(value) => updateSignupField(setPassword, value)} editable={!isSubmitting}
              returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => confirmInput.current?.focus()} />
            {password ? <FieldCheck valid={passwordValid} message={passwordValid ? "Password has at least 6 characters." : `Add ${6 - password.length} more character${6 - password.length === 1 ? "" : "s"}.`} /> : null}
            <Input label="Confirm password" icon="lock-closed-outline" placeholder="Repeat password"
              inputRef={confirmInput} secureTextEntry showPasswordToggle
              autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword"
              value={confirmPassword} onChangeText={(value) => updateSignupField(setConfirmPassword, value)} editable={!isSubmitting}
              onFocus={() => {
                preKeyboardScrollOffset.current = signupScrollOffset.current;
                confirmPasswordFocused.current = true;
                requestAnimationFrame(scrollConfirmPasswordIntoView);
              }}
              returnKeyType="done" onSubmitEditing={handleSignup} />
            {confirmPassword ? <FieldCheck valid={confirmPasswordValid} message={confirmPasswordValid ? "Passwords match." : "Passwords do not match yet."} /> : null}
          </View>
        </View>

        <View style={styles.termsRow}>
          <Pressable style={styles.checkboxButton} onPress={() => {
            if (agreeTerms) {
              setTermsChecked(false);
              setAgreeTerms(false);
            } else {
              setTermsChecked(true);
              setShowTerms(true);
            }
            if (errorMessage) setErrorMessage("");
          }}
            disabled={isSubmitting} accessibilityRole="checkbox" aria-checked={termsChecked}
            accessibilityLabel="Agree to the Terms and Conditions">
            <Ionicons name={termsChecked ? "checkbox" : "square-outline"} size={24}
              color={termsChecked ? COLORS.primary : COLORS.textMuted} />
          </Pressable>
          <Pressable style={styles.termsButton} onPress={() => setShowTerms(true)}
            disabled={isSubmitting} accessibilityRole="button" accessibilityLabel="Read Terms and Conditions">
            <Text style={styles.termsText}>I agree to the <Text style={styles.termsLink}>Terms and Conditions</Text></Text>
          </Pressable>
        </View>

        {errorMessage ? <Text role="alert" style={authStyles.errorText}>{errorMessage}</Text> : null}
        <PrimaryButton title={isSubmitting ? "Creating account..." : "Create account"}
          onPress={handleSignup} disabled={isSubmitting || !canCreateAccount} loading={isSubmitting} />
      </View>

      <AuthSwitch prompt="Already have an account?" label="Sign in" href="/" disabled={isSubmitting} />
      <TermsModal visible={showTerms} onClose={() => {
        setShowTerms(false);
        if (!agreeTerms) setTermsChecked(false);
      }} onAgree={() => {
        setTermsChecked(true);
        setAgreeTerms(true);
        setShowTerms(false);
        if (errorMessage) setErrorMessage("");
      }} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  fieldCheck: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 42, marginRight: 4, marginTop: -3, marginBottom: 8 },
  fieldCheckText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  termsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  checkboxButton: { width: 44, minHeight: 44, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  termsButton: { flex: 1, minHeight: 44, justifyContent: "center" },
  termsText: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20, color: COLORS.textMuted },
  termsLink: { fontFamily: "Inter_600SemiBold", color: COLORS.primary },
});

function FieldCheck({ valid, message }) {
  return (
    <View style={styles.fieldCheck} accessibilityLiveRegion="polite">
      <Ionicons name={valid ? "checkmark-circle" : "alert-circle-outline"} size={15}
        color={valid ? COLORS.success : COLORS.error} />
      <Text style={[styles.fieldCheckText, { color: valid ? COLORS.success : COLORS.error }]}>{message}</Text>
    </View>
  );
}
