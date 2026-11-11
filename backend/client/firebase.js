import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import firebaseConfig from "../config/firebase-config";

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

const createAuth = () => {
  if (Platform.OS === "web") return getAuth(firebaseApp);

  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    if (error?.code === "auth/already-initialized") return getAuth(firebaseApp);
    throw error;
  }
};

export const auth = createAuth();
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

// Analytics is a browser-only Firebase web service; native imports should not
// attempt to initialize it.
export const analytics = Platform.OS === "web"
  ? isAnalyticsSupported().then((supported) =>
      supported ? getAnalytics(firebaseApp) : null
    ).catch((error) => {
      console.warn("Firebase Analytics is unavailable", error?.code || error);
      return null;
    })
  : Promise.resolve(null);

export { firebaseConfig };
