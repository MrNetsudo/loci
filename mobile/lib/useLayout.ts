/**
 * Responsive layout helpers for phone + iPad
 */
import { useWindowDimensions, Platform } from 'react-native';

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const isLandscape = width > height;

  // For iPad: cap content width and center it
  const contentMaxWidth = isTablet ? 680 : width;
  const contentPaddingH = isTablet ? Math.max(0, (width - contentMaxWidth) / 2) : 0;

  return {
    width,
    height,
    isTablet,
    isLandscape,
    contentMaxWidth,
    contentPaddingH,
    // Responsive values
    r: <T>(phone: T, tablet: T): T => (isTablet ? tablet : phone),
  };
}
