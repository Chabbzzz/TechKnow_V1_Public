import React, { useRef, useState } from "react";
import { View, Platform, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Input } from "../components/Input";
import { PrimaryButton } from "../components/PrimaryButton";
import { AuthLayout, AuthSwitch, authStyles } from "../components/AuthLayout";
import { signInCustomer } from "../backend/services/customer-auth";
import OnboardingSplash from "../components/OnboardingSplash";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_STORAGE_KEY = "@techknow/onboarding-complete";

export default function LoginScreen() {
  const isMobile = Platform.OS !== "web";
  const [onboardingVisible, setOnboardingVisible] = useState(isMobile);
  const [onboardingReady, setOnboardingReady] = useState(!isMobile);

  React.useEffect(() => {
    if (!isMobile) return undefined;

    let active = true;
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)
      .then((value) => {
        if (!active) return;
        setOnboardingVisible(value !== "true");
        setOnboardingReady(true);
      })
      .catch((error) => {
        console.warn("Onboarding state could not be loaded", error);
        if (active) setOnboardingReady(true);
      });

    return () => {
      active = false;
    };
  }, [isMobile]);

  const finishOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch (error) {
      console.warn("Onboarding state could not be saved", error);
    } finally {
      setOnboardingVisible(false);
    }
  };

  if (!onboardingReady) return null;
  if (onboardingVisible) return <OnboardingSplash onComplete={finishOnboarding} />;
  return <LoginForm onShowIntroduction={isMobile ? () => setOnboardingVisible(true) : undefined} />;
}

function LoginForm({ onShowIntroduction }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordInput = useRef(null);

  const handleLogin = async () => {
    if (isSubmitting) return;
    setErrorMessage("");

    if (!identifier.trim() || !password) {
      setErrorMessage("Enter your email and password.");
      return;
    }

    try {
      setIsSubmitting(true);
      await signInCustomer(identifier.trim(), password);
      router.replace("/home");
    } catch (error) {
      if (error.code === 'auth/account-suspended') {
        setErrorMessage(error.message);
      } else if (error.code === 'auth/user-disabled') {
        setErrorMessage('Your account has been suspended. Please contact TechKnow support.');
      } else if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
        setErrorMessage("The email or password is incorrect.");
      } else if (error.code === "auth/invalid-email") {
        setErrorMessage("Enter a valid email address.");
      } else {
        setErrorMessage("Unable to sign in. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your TechKnow account.">
      <View style={authStyles.form}>
        <View style={authStyles.fieldsCard}>
          <Input first label="Email address" icon="mail-outline" placeholder="Enter your email address"
            autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
            autoComplete="email" textContentType="emailAddress"
            value={identifier} onChangeText={setIdentifier} editable={!isSubmitting}
            returnKeyType="next" submitBehavior="submit"
            onSubmitEditing={() => passwordInput.current?.focus()} />
          <Input label="Password" icon="lock-closed-outline" placeholder="Enter password"
            inputRef={passwordInput} secureTextEntry showPasswordToggle
            autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" textContentType="password"
            value={password} onChangeText={setPassword} editable={!isSubmitting}
            returnKeyType="go" onSubmitEditing={handleLogin} />
        </View>
        {errorMessage ? <Text role="alert" style={authStyles.errorText}>{errorMessage}</Text> : null}
        <PrimaryButton title={isSubmitting ? "Signing in..." : "Sign in"}
          onPress={handleLogin} disabled={isSubmitting} loading={isSubmitting} />
      </View>
      <View>
        <AuthSwitch prompt="Don't have an account?" label="Create account" href="/signup" disabled={isSubmitting} />
        {onShowIntroduction ? (
          <Pressable onPress={onShowIntroduction} accessibilityRole="button"
            disabled={isSubmitting} style={authStyles.introductionButton}>
            <Text style={authStyles.linkText}>View introduction</Text>
          </Pressable>
        ) : null}
      </View>
    </AuthLayout>
  );
}
