import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { COLORS } from '../constants/theme';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { ProductNotificationsProvider } from '../hooks/useProductNotifications';
import { usePresence } from '../hooks/usePresence';
import { useAccountAccess } from '../hooks/useAccountAccess';
import { BottomNav } from '../components/BottomNav';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  usePresence();
  const reducedMotion = useReducedMotion();
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  useAccountAccess(Boolean(loaded || error));

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <ProductNotificationsProvider>
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: COLORS.background },
              animation: reducedMotion ? 'none' : 'default',
              gestureEnabled: true,
            }}
          >
            {['index', 'home', 'search', 'reservation', 'notifications', 'profile'].map(name => (
              <Stack.Screen key={name} name={name}
                options={{
                  animation: reducedMotion ? 'none' : 'fade',
                  animationDuration: 180,
                  gestureEnabled: false,
                }} />
            ))}
          </Stack>
        </View>
        <BottomNav reducedMotion={reducedMotion} />
      </View>
    </ProductNotificationsProvider>
  );
}
