import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SIZES } from '../constants/theme';

export function useProductGrid() {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = Math.min(width - insets.left - insets.right, 1120) - SIZES.edgeMargin * 2;
  const gap = 12;
  const minimumWidth = fontScale > 1.3 ? 240 : 150;
  const columns = Math.max(1, Math.min(4, Math.floor((availableWidth + gap) / (minimumWidth + gap))));
  return { columns, gap, cardWidth: (availableWidth - gap * (columns - 1)) / columns };
}
