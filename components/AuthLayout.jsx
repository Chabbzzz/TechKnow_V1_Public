import React from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { AuthBackdrop } from './AuthBackdrop';
import { COLORS, SIZES } from '../constants/theme';
import teamLogo from '../teamlogo-clean.png';

export function AuthLayout({ title, subtitle, compact = false, children, scrollViewRef, onScroll }) {
  return (
    <SafeAreaView style={authStyles.screen}>
      <AuthBackdrop />
      <KeyboardAvoidingView style={authStyles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={scrollViewRef} onScroll={onScroll} scrollEventThrottle={16}
          contentContainerStyle={authStyles.content} keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          <View style={authStyles.header}>
            <View style={[authStyles.logo, compact && authStyles.logoCompact]}>
              <Image source={teamLogo} resizeMode="contain" style={authStyles.logoImage}
                accessibilityLabel="TechKnow" />
            </View>
            <Text role="heading" style={authStyles.title}>{title}</Text>
            <Text style={authStyles.subtitle}>{subtitle}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthSwitch({ prompt, label, href, disabled }) {
  return (
    <View style={authStyles.footer}>
      <Text style={authStyles.footerText}>{prompt}</Text>
      <Link href={href} asChild>
        <Pressable style={authStyles.footerLink} disabled={disabled} accessibilityRole="link">
          <Text style={authStyles.linkText}>{label}</Text>
        </Pressable>
      </Link>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  keyboard: { flex: 1 },
  content: {
    flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', justifyContent: 'center',
    paddingHorizontal: SIZES.edgeMargin, paddingVertical: 24, gap: 24,
  },
  header: { alignItems: 'center', gap: 8 },
  logo: {
    width: 88, height: 88, padding: 8, marginBottom: 8, borderRadius: 24, borderCurve: 'continuous',
    backgroundColor: COLORS.white, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  logoCompact: { width: 68, height: 68, borderRadius: 20, marginBottom: 4 },
  logoImage: { width: '100%', height: '100%' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, lineHeight: 38, color: COLORS.text, textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, color: COLORS.textMuted, textAlign: 'center' },
  form: { gap: 16 },
  section: { gap: 8 },
  sectionTitle: { paddingLeft: 4, fontFamily: 'Inter_600SemiBold', fontSize: 11, lineHeight: 16,
    letterSpacing: 1, color: COLORS.textMuted },
  fieldsCard: { paddingHorizontal: 14, backgroundColor: COLORS.white, borderRadius: 20,
    borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.outline },
  helperText: { paddingHorizontal: 4, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, color: COLORS.textMuted },
  errorText: { padding: 12, borderRadius: 14, backgroundColor: '#FFF0F1', color: COLORS.error,
    fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 4 },
  footerText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20, color: COLORS.textMuted, textAlign: 'center' },
  footerLink: { minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  linkText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 20, color: COLORS.primary },
  introductionButton: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
});
