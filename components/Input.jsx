import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

export const Input = ({
  label, icon, first = false, style, inputRef, secureTextEntry = false,
  showPasswordToggle = false, onFocus, onBlur, ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const canTogglePassword = secureTextEntry && showPasswordToggle;
  const fieldLabel = label || props.accessibilityLabel || props.placeholder;

  return (
    <View style={[styles.wrapper, !first && styles.divider, style]}>
      {icon ? (
        <View style={[styles.icon, isFocused && styles.iconFocused]}>
          <Ionicons name={icon} size={19} color={isFocused ? COLORS.primary : COLORS.textDim} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text style={[styles.label, isFocused && styles.labelFocused]}>{fieldLabel}</Text>
        <TextInput
          {...props}
          ref={inputRef}
          accessibilityLabel={props.accessibilityLabel || fieldLabel}
          style={styles.input}
          placeholderTextColor={COLORS.textMuted}
          selectionColor={COLORS.primary}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          onFocus={(event) => { setIsFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setIsFocused(false); onBlur?.(event); }}
        />
      </View>
      {canTogglePassword ? (
        <TouchableOpacity style={styles.passwordToggle}
          onPress={() => setIsPasswordVisible((value) => !value)}
          disabled={props.editable === false} activeOpacity={0.7}
          accessibilityRole="button" aria-pressed={isPasswordVisible}
          accessibilityLabel={`${isPasswordVisible ? 'Hide' : 'Show'} ${fieldLabel.toLowerCase()}`}>
          <Ionicons name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
            size={20} color={COLORS.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 74 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.outline },
  icon: { width: 32, height: 32, flexShrink: 0, borderRadius: 10, backgroundColor: COLORS.surfaceHighlight,
    alignItems: 'center', justifyContent: 'center' },
  iconFocused: { backgroundColor: COLORS.surfaceAlt },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 16, color: COLORS.textMuted },
  labelFocused: { color: COLORS.primary },
  input: { minWidth: 0, minHeight: 34, paddingHorizontal: 0, paddingVertical: 5,
    fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, color: COLORS.text,
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }) },
  passwordToggle: { width: 44, minHeight: 44, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
