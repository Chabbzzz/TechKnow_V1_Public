import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassModal, ModalAction } from './GlassModal';
import { ProductImage } from './ProductImage';
import { COLORS } from '../constants/theme';

export function ReservationPreviewModal({ visible, product, onClose, onContinue, onAfterClose }) {
  const [showDetails, setShowDetails] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const opening = useRef(false);
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;
  const hasProduct = Boolean(product);
  const quantity = product?.stockUnknown ? null : Number.parseInt(product?.stock, 10);
  const isOutOfStock = Number.isFinite(quantity) && quantity <= 0;
  const description = typeof product?.description === 'string' ? product.description.trim() : '';

  useEffect(() => {
    setShowDetails(false);
  }, [visible, product]);

  useEffect(() => {
    if (visible) {
      opening.current = false;
      setIsOpening(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !isOpening) return undefined;
    if (!hasProduct) {
      opening.current = false;
      setIsOpening(false);
      return undefined;
    }
    // Keep the feedback perceptible, then use the existing close-before-navigation flow.
    const timeout = setTimeout(() => continueRef.current?.(), 450);
    return () => clearTimeout(timeout);
  }, [visible, isOpening, hasProduct]);

  const handleContinue = () => {
    if (!visible || !product || opening.current) return;
    opening.current = true;
    setIsOpening(true);
  };

  return (
    <GlassModal visible={visible} onClose={onClose} onAfterClose={onAfterClose}
      title={isOutOfStock ? "Reserve on the waiting list?" : "Reserve this product?"}
      variant="alert" showIcon={false} busy={isOpening} spinnerOnly={isOpening}
      dismissOnBackdrop={false} backdropColor="rgba(14,29,55,0.42)"
      message={isOutOfStock ? "You can still submit a reservation while this product is out of stock." : "Choose your pickup details next."}
      footer={isOpening ? null : <>
        <ModalAction title="Cancel" onPress={onClose} secondary />
        <ModalAction title="Continue" onPress={handleContinue} divider disabled={!product} />
      </>}>
      {product && !isOpening ? <View style={styles.summary}>
        <View style={styles.product}>
          <View style={styles.image}>
            <ProductImage uri={product.imageUrl} storagePath={product.imagePath}
              resizeMode="contain" style={styles.imageContent}
              accessibilityLabel={`${product.title} product image`}
              fallback={<Ionicons name="image-outline" size={30} color={COLORS.textMuted} />} />
          </View>
          <View style={styles.productCopy}>
            <Text style={styles.productName}>{product.title}</Text>
            <Text style={styles.priceLabel}>Listed price</Text>
            <Text style={styles.price}>{product.price}</Text>
          </View>
        </View>
        {product.shopName ? <View style={styles.storeRow}>
          <Ionicons name="storefront-outline" size={18} color={COLORS.textDim} />
          <Text style={styles.store}>{product.shopName}</Text>
        </View> : null}
        {description ? <View style={styles.details}>
          <Pressable accessibilityRole="button" accessibilityLabel="Product details"
            aria-expanded={showDetails} onPress={() => setShowDetails(value => !value)}
            style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}>
            <Text style={styles.detailsLabel}>Product details</Text>
            <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.primary} />
          </Pressable>
          {showDetails ? <Text style={styles.description}>{description}</Text> : null}
        </View> : null}
        <View style={[styles.note, isOutOfStock && styles.waitlistNote]}>
          <Ionicons name={isOutOfStock ? 'time-outline' : 'information-circle-outline'} size={17}
            color={isOutOfStock ? COLORS.primary : COLORS.textDim} />
          <Text style={[styles.noteText, isOutOfStock && styles.waitlistText]}>
            {isOutOfStock ? 'Your reservation will be placed on the waiting list when you submit it. Pickup is subject to restocking and shop confirmation.'
              : 'Review and submit your reservation on the next screen.'}
          </Text>
        </View>
      </View> : null}
    </GlassModal>
  );
}

const regular = Platform.select({ ios: { fontWeight: '400' }, default: { fontFamily: 'Inter_400Regular' } });
const medium = Platform.select({ ios: { fontWeight: '500' }, default: { fontFamily: 'Inter_500Medium' } });
const semibold = Platform.select({ ios: { fontWeight: '600' }, default: { fontFamily: 'Inter_600SemiBold' } });

const styles = StyleSheet.create({
  summary: { gap: 16 },
  product: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  image: { width: 88, height: 88, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', padding: 6 },
  imageContent: { width: '100%', height: '100%' },
  productCopy: { flex: 1, minWidth: 0 },
  productName: { ...semibold, fontSize: 15, lineHeight: 21, color: COLORS.text },
  priceLabel: { ...regular, marginTop: 8, fontSize: 11, lineHeight: 16, color: COLORS.textDim },
  price: { ...semibold, fontSize: 18, lineHeight: 25, color: COLORS.text },
  storeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  store: { ...medium, flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.textDim },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8DDE5' },
  detailsToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  detailsLabel: { ...medium, flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.primary },
  description: { ...regular, paddingBottom: 4, fontSize: 13, lineHeight: 20, color: COLORS.textDim },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  noteText: { ...regular, flex: 1, fontSize: 12, lineHeight: 18, color: COLORS.textDim },
  waitlistNote: { padding: 10, borderRadius: 12, backgroundColor: COLORS.primaryDim },
  waitlistText: { color: COLORS.primary },
  pressed: { opacity: 0.65 },
});
