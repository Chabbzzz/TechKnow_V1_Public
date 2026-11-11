(function initializeTechKnowFirebase() {
  if (!window.firebase) {
    throw new Error("Firebase SDK failed to load.");
  }

  const firebaseConfig = window.techKnowFirebaseConfig;
  if (!firebaseConfig) throw new Error("Load backend/config/firebase-config.js first.");

  // LOCAL Auth persistence is shared across tabs for the same Firebase app name.
  // Keep portal identities separate from each other and the default customer app.
  const appName = document.body?.dataset.authPortal === "superadmin"
    ? "techknow-superadmin-portal"
    : "techknow-store-portal";
  const app = firebase.apps.find((candidate) => candidate.name === appName)
    || firebase.initializeApp(firebaseConfig, appName);
  const auth = app.auth();
  const persistenceReady = auth
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch((error) => {
      console.warn("Firebase auth persistence could not be enabled.", error);
    });
  // Compat Auth exposes onAuthStateChanged, not the modular authStateReady API.
  const authReady = persistenceReady.then(() => new Promise((resolve, reject) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      resolve(user);
    }, reject);
  }));

  window.techKnowFirebase = {
    app,
    auth,
    db: app.firestore(),
    storage: typeof app.storage === "function" ? app.storage() : null,
    persistenceReady,
    authReady,
    serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
    deleteField: () => firebase.firestore.FieldValue.delete(),
  };
})();
