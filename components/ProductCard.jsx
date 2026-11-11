import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { useFavorite } from '../hooks/useFavorite';
import { ProductImage } from './ProductImage';

export const ProductCard = ({
  title, productId, price, rating, stock, shopName = '', onPress, onReserve,
  style, variant = 'monitor', showImage = true, imageUrl = '', imagePath = '',
  showCompare = false, onCompare,
}) => {
  const { fontScale } = useWindowDimensions();
  const { isFavorite, isSaving, toggleFavorite } = useFavorite(productId, { title, shopName, price, imageUrl });
  const quantity = Number.parseInt(stock, 10);
  const ratingLabel = String(rating ?? '').replace(/[★⭐]/g, '').trim();
  const stockColor = Number.isNaN(quantity) ? '#727C8B' : quantity <= 2 ? '#AD493F' : quantity <= 5 ? '#87631D' : '#287451';
  const stockBackground = Number.isNaN(quantity) ? '#F3F5F8' : quantity <= 2 ? '#FFF1EE' : quantity <= 5 ? '#FBF5E8' : '#EDF7F1';
  const hasRating = Number.isFinite(Number.parseFloat(ratingLabel));
  const placeholderIcon = { monitor: 'laptop-outline', display: 'desktop-outline', keyboard: 'keypad-outline' }[variant] || 'laptop-outline';

  return (
    <View style={[styles.container, style]}>
      <View style={styles.imageWrap}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`View ${title}`}
          style={styles.imageLink}>
          {showImage && <ProductImage uri={imageUrl} storagePath={imagePath} style={styles.image} resizeMode="contain"
            accessibilityLabel={`${title} product image`}
            fallback={<View style={styles.noImage}>
              <Ionicons name={placeholderIcon} size={32} color="#8B95A5" />
              <Text style={styles.noImageText}>Image unavailable</Text>
            </View>} />}
        </Pressable>
        <Pressable onPress={toggleFavorite} accessibilityRole="button"
          accessibilityLabel={isFavorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
          accessibilityState={{ selected: isFavorite, busy: isSaving }}
          style={({ pressed }) => [styles.favorite, isFavorite && styles.favoriteActive, pressed && styles.pressed]}>
          <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={20}
            color={isFavorite ? COLORS.primary : COLORS.textMuted} />
        </Pressable>
      </View>
      <View style={styles.info}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`View ${title}`}>
          <Text style={[styles.title, { minHeight: 42 * fontScale }]} numberOfLines={2}>{title}</Text>
        </Pressable>
        {shopName ? <View style={[styles.shopRow, { minHeight: 32 * fontScale }]}>
          <Ionicons name="storefront-outline" size={12} color="#858D9B" style={styles.shopIcon} />
          <Text style={styles.shop} numberOfLines={2}>{shopName}</Text>
        </View> : null}
        <Text style={styles.price}>{price}</Text>
        <View style={styles.meta}>
          {stock ? <View style={[styles.stockBadge, { backgroundColor: stockBackground }]}>
            <Text style={[styles.stock, { color: stockColor }]}>{stock}</Text>
          </View> : null}
          {ratingLabel ? <View style={styles.ratingRow}>
            {hasRating && <Ionicons name="star" size={12} color="#B88628" />}
            <Text style={styles.rating}>{ratingLabel}</Text>
          </View> : null}
        </View>
        <View style={styles.actions}>
          {showCompare && <Pressable onPress={onCompare} accessibilityRole="button" accessibilityLabel={`Compare ${title}`}
            style={({ pressed }) => [styles.button, styles.compareButton, pressed && styles.pressed]}>
            <Ionicons name="swap-horizontal-outline" size={17} color="#526174" />
            <Text style={[styles.buttonText, styles.compareText]}>Compare</Text>
          </Pressable>}
          <Pressable onPress={onReserve || onPress} accessibilityRole="button" accessibilityLabel={`Reserve ${title}`}
            style={({ pressed }) => [styles.button, styles.reserveButton, pressed && styles.pressed]}>
            <Ionicons name="bag-handle-outline" size={16} color="#fff" />
            <Text style={styles.buttonText}>Reserve</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.white, borderRadius: 24, borderCurve: 'continuous', padding: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(25, 39, 60, 0.06)',
    flexGrow: 1, flexShrink: 0, minWidth: 0,
    shadowColor: '#172B48', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.045, shadowRadius: 14, elevation: 2,
  },
  imageWrap: { width: '100%', aspectRatio: 1.15, borderRadius: 18, borderCurve: 'continuous', backgroundColor: '#F3F5F8', overflow: 'hidden' },
  imageLink: { width: '100%', height: '100%', padding: 12 },
  image: { width: '100%', height: '100%' },
  noImage: { width: '100%', height: '100%', alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8 },
  noImageText: { flexShrink: 1, fontSize: 10, lineHeight: 15, color: '#858D9B', fontFamily: 'Inter_400Regular', textAlign: 'center' },
  favorite: { position: 'absolute', top: 5, right: 5, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(25, 39, 60, 0.04)' },
  favoriteActive: { backgroundColor: COLORS.primaryDim, borderColor: COLORS.primaryDim },
  info: { flex: 1, paddingHorizontal: 4, paddingTop: 14, paddingBottom: 4 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21, letterSpacing: -0.3, color: '#1C2432' },
  shopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 7, marginBottom: 12 },
  shopIcon: { marginTop: 2 },
  shop: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, color: '#727C8B' },
  price: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 26, letterSpacing: -0.45, color: '#1C2432', flexShrink: 1 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 10, marginBottom: 12 },
  stockBadge: { maxWidth: '100%', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  stock: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, flexShrink: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
  rating: { fontFamily: 'Inter_500Medium', fontSize: 11, color: '#727C8B' },
  actions: { gap: 8, marginTop: 'auto', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EDF0F4', paddingTop: 12 },
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 22 },
  reserveButton: { backgroundColor: COLORS.primary },
  compareButton: { backgroundColor: '#F3F5F8' },
  buttonText: { flexShrink: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 18, color: '#fff' },
  compareText: { color: '#526174' },
  pressed: { opacity: 0.72 },
});
