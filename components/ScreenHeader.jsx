import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, SIZES } from '../constants/theme';

export function ScreenHeader({ title, onBack, right }) {
  return (
    <View style={styles.header}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back"
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
        <MaterialIcons name="arrow-back" size={23} color={COLORS.text} />
      </Pressable> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: SIZES.edgeMargin, paddingVertical: 10, backgroundColor: COLORS.background },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 15,
    borderWidth: 1, borderColor: COLORS.outline, backgroundColor: '#fff' },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 21, lineHeight: 28, color: COLORS.text },
});
