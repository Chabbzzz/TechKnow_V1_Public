import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { COLORS } from '../constants/theme';

export const PrimaryButton = ({ title, onPress, style, disabled = false, loading = false, ...props }) => (
  <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button"
    aria-disabled={disabled || loading} aria-busy={loading} {...props}
    style={({ pressed }) => [styles.container, style, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
    {loading ? <ActivityIndicator size="small" color={COLORS.white} /> : null}
    <Text style={styles.text}>{title}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  container: { minHeight: 54, borderRadius: 18, borderCurve: 'continuous', paddingVertical: 14,
    paddingHorizontal: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    width: '100%', backgroundColor: COLORS.primary },
  text: { color: COLORS.white, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.65 },
});
