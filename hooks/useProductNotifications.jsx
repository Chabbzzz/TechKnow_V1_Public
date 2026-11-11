import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../backend/firebase";
import { productNotifications, moderationNotification } from "../backend/services/notifications";
import { useProducts } from "./useProducts";

const ProductNotificationsContext = createContext({
  notifications: [], moderationNotifications: [], unreadCount: 0, isLoading: false, error: "",
});

export function ProductNotificationsProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [readIds, setReadIds] = useState(new Set());
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [moderationNotifications, setModerationNotifications] = useState([]);
  const [moderationLoaded, setModerationLoaded] = useState(false);
  const [moderationError, setModerationError] = useState('');
  const { products, isLoading, error } = useProducts(null, Boolean(customer));

  useEffect(() => {
    let unsubscribeProfile = () => {};
    let unsubscribeModeration = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile();
      unsubscribeModeration();
      setModerationNotifications([]);
      setModerationLoaded(false);
      setModerationError('');
      setCustomer(user ? { uid: user.uid, createdAt: user.metadata.creationTime } : null);
      setReadIds(new Set());
      setProfileLoaded(false);
      setProfileError("");
      if (!user) return;
      unsubscribeModeration = onSnapshot(query(collection(db, 'moderationNotifications'), where('userId', '==', user.uid)), snapshot => {
        if (auth.currentUser?.uid !== user.uid) return;
        setModerationNotifications(snapshot.docs.map(item => moderationNotification(item.id, item.data())));
        setModerationLoaded(true);
        setModerationError('');
      }, () => {
        if (auth.currentUser?.uid !== user.uid) return;
        setModerationLoaded(true);
        setModerationError('Unable to load account notices. Please try again.');
      });
      unsubscribeProfile = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
        if (auth.currentUser?.uid !== user.uid) return;
        const savedIds = snapshot.data()?.notificationReadIds;
        setReadIds(new Set(Array.isArray(savedIds) ? savedIds : []));
        setProfileLoaded(true);
        setProfileError("");
      }, (failure) => {
        if (auth.currentUser?.uid !== user.uid) return;
        console.warn("Product notification read state could not be loaded", failure);
        setProfileError("Unable to load notification read status. Please try again.");
        setProfileLoaded(true);
      });
    });
    return () => { unsubscribeAuth(); unsubscribeProfile(); unsubscribeModeration(); };
  }, []);

  const notifications = useMemo(
    () => customer ? productNotifications(products, customer.createdAt) : [],
    [products, customer],
  );
  const value = {
    notifications,
    moderationNotifications,
    unreadCount: customer && profileLoaded && !profileError
      ? [...notifications, ...moderationNotifications].filter((notification) => !readIds.has(notification.id)).length : 0,
    isLoading: Boolean(customer) && (isLoading || !profileLoaded || !moderationLoaded),
    error: customer ? error || profileError || moderationError : "",
  };
  return <ProductNotificationsContext.Provider value={value}>{children}</ProductNotificationsContext.Provider>;
}

export const useProductNotifications = () => useContext(ProductNotificationsContext);
