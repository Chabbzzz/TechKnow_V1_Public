// Public Firebase web configuration, shared by Expo and the static dashboards.
// This is not an Admin SDK credential. Authorization belongs in Firebase Rules.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.techKnowFirebaseConfig = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze({
    apiKey: "AIzaSyA-Ozyzc8eCNZdkC3siUfspbZmA6u8Fssc",
    authDomain: "techknowcapstone.firebaseapp.com",
    projectId: "techknowcapstone",
    storageBucket: "techknowcapstone.firebasestorage.app",
    messagingSenderId: "1044483117837",
    appId: "1:1044483117837:web:997e47f5f4a635ec755644",
    measurementId: "G-VLKM38SHEY",
  });
});
