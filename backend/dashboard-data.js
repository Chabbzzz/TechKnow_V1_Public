/* Shared Firestore data layer for the store and super-admin pages. */
(async function () {
  const runtime = window.techKnowFirebase;
  const db = runtime.db;
  const isStoreAdmin = Boolean(document.getElementById("products-tbody"));
  const isSuperAdmin = Boolean(document.getElementById("stat-shops"));
  if (!isStoreAdmin && !isSuperAdmin) return;
  const session = await window.techKnowAdmin.resolveSession(runtime, isStoreAdmin ? "Store Admin" : "Super Admin");
  const loginPage = isSuperAdmin ? "superadmin-login.html" : "login.html";
  const storeService = isStoreAdmin ? window.techKnowAdmin.createStoreService(runtime, session) : null;
  if (storeService) {
    window.storeReviewActions = { approve: storeService.approveReview, report: storeService.reportReview };
  }
  const subscriptions = [];
  const subscribe = (reference, ...callbacks) => {
    const unsubscribe = reference.onSnapshot(...callbacks);
    subscriptions.push(unsubscribe);
    return unsubscribe;
  };
  const stopListeners = () => subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  const unsubscribeAuth = runtime.auth.onAuthStateChanged((user) => {
    if (user?.uid !== session.uid) {
      stopListeners();
      window.location.replace(loginPage);
    }
  });
  window.addEventListener("pagehide", () => { stopListeners(); unsubscribeAuth(); }, { once: true });
  window.addEventListener("pageshow", (event) => { if (event.persisted) window.location.reload(); });
  document.querySelectorAll(".admin-logout").forEach((button) => button.addEventListener("click", async () => {
    try {
      await runtime.presence?.leave();
      await runtime.auth.signOut();
      localStorage.removeItem("techknowStoreId");
      window.location.replace(loginPage);
    } catch (error) { notify(firestoreError(error, "Sign out"), "danger"); }
  }));
  const MAX_PRODUCT_STOCK = 10;
  const MAX_PRODUCT_IMAGE_SIZE = 10 * 1024 * 1024;
  const MAX_OPTIMIZED_UPLOAD_SIZE = 2.5 * 1024 * 1024;
  const MAX_OPTIMIZED_IMAGE_DIMENSION = 1600;
  const PRODUCT_IMAGE_UPLOAD_TIMEOUT = 30000;
  // Firestore documents are limited to 1 MiB. Keep the fallback image well
  // below that limit so the product fields and timestamps still fit.
  const MAX_FIRESTORE_IMAGE_SIZE = 700 * 1024;
  const ARCHIVE_RETENTION_DAYS = 30;
  const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function productStatus(product) {
    return window.techKnowReservations.productStatus(Number(product.stock || 0));
  }

  window.productStatusLabel = productStatus;

  function notify(message, type, title) {
    if (typeof window.showToast === "function") {
      const isError = type === "danger";
      window.showToast(
        type || "success",
        isError ? "fa-triangle-exclamation" : "fa-circle-check",
        title || (isError ? "Action unavailable" : "Update saved"),
        message,
      );
    } else {
      window.alert(message);
    }
  }

  function firestoreError(error, action) {
    if (error?.code === "permission-denied") {
      return `${action} could not be completed because this admin account is not authorized.`;
    }
    if (error?.code === "failed-precondition") {
      return `${action} could not be completed because the data service is not ready.`;
    }
    return `${action} could not be completed${error?.code ? ` (${error.code})` : ""}. ${error?.message || "Please try again."}`;
  }

  function records(collectionName) {
    return storeService.records(collectionName);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("The image could not be read."));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image could not be decoded."));
      image.src = dataUrl;
    });
  }

  async function createFirestoreImage(file) {
    const originalDataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(originalDataUrl);
    const originalWidth = Number(image.naturalWidth || image.width || 0);
    const originalHeight = Number(image.naturalHeight || image.height || 0);
    if (!originalWidth || !originalHeight) throw new Error("The image has no usable dimensions.");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the image.");

    let longestSide = Math.min(Math.max(originalWidth, originalHeight), 1280);
    const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32];
    while (longestSide >= 320) {
      const scale = longestSide / Math.max(originalWidth, originalHeight);
      canvas.width = Math.max(1, Math.round(originalWidth * scale));
      canvas.height = Math.max(1, Math.round(originalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of qualities) {
        const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
        if (compressedDataUrl.length <= MAX_FIRESTORE_IMAGE_SIZE) return compressedDataUrl;
      }
      longestSide = Math.floor(longestSide * 0.8);
    }

    throw new Error("The image could not be compressed small enough for Firestore.");
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be optimized."));
      }, type, quality);
    });
  }

  async function optimizeProductImage(file, onProgress) {
    if (Number(file.size || 0) <= MAX_OPTIMIZED_UPLOAD_SIZE) return file;
    if (typeof onProgress === "function") onProgress(3, "Reading image for faster upload...");

    const originalDataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(originalDataUrl);
    const originalWidth = Number(image.naturalWidth || image.width || 0);
    const originalHeight = Number(image.naturalHeight || image.height || 0);
    if (!originalWidth || !originalHeight) throw new Error("The image has no usable dimensions.");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot optimize the image.");
    const scale = Math.min(1, MAX_OPTIMIZED_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight));
    canvas.width = Math.max(1, Math.round(originalWidth * scale));
    canvas.height = Math.max(1, Math.round(originalHeight * scale));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof onProgress === "function") onProgress(7, "Optimizing image quality...");

    const qualities = [0.88, 0.82, 0.76, 0.7];
    let optimizedBlob = null;
    for (const quality of qualities) {
      optimizedBlob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (optimizedBlob.size <= MAX_OPTIMIZED_UPLOAD_SIZE) break;
    }
    if (!optimizedBlob) throw new Error("The image could not be optimized.");

    if (typeof File === "function") {
      return new File([optimizedBlob], "optimized-product-image.jpg", { type: "image/jpeg" });
    }
    return optimizedBlob;
  }

  async function uploadProductImage(file, storeId, onProgress) {
    if (!file) return null;
    if (Number(file.size || 0) > MAX_PRODUCT_IMAGE_SIZE) {
      throw new Error("Product images must be 10 MB or smaller.");
    }

    const safeStoreId = String(storeId || "unassigned").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeName = String(file.name || "product-image").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `product-images/${safeStoreId}/${Date.now()}-${safeName}`;
    let uploadFile = file;
    try {
      uploadFile = await optimizeProductImage(file, onProgress);
      if (typeof onProgress === "function") {
        const sizeInMegabytes = (Number(uploadFile.size || 0) / (1024 * 1024)).toFixed(1);
        onProgress(10, `Image optimized to ${sizeInMegabytes}MB. Starting upload...`);
      }
      if (!runtime.storage) throw new Error("Firebase Storage is not available.");
      const imageRef = runtime.storage.ref().child(path);
      const contentType = uploadFile.type || (/\.png$/i.test(safeName) ? "image/png" : "image/jpeg");
      const uploadTask = imageRef.put(uploadFile, { contentType });
      await new Promise((resolve, reject) => {
        const stateChanged = firebase.storage.TaskEvent?.STATE_CHANGED || "state_changed";
        const timeoutId = window.setTimeout(() => {
          uploadTask.cancel();
          reject(new Error("Image upload timed out. Preparing a faster fallback."));
        }, PRODUCT_IMAGE_UPLOAD_TIMEOUT);
        uploadTask.on(
          stateChanged,
          (snapshot) => {
            const totalBytes = Number(snapshot.totalBytes || uploadFile.size || 0);
            const transferredBytes = Number(snapshot.bytesTransferred || 0);
            const uploadPercent = totalBytes ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 0;
            const percent = 10 + Math.round(uploadPercent * 0.9);
            if (typeof onProgress === "function") onProgress(percent, `Uploading image... ${uploadPercent}%`);
          },
          (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          },
          () => {
            window.clearTimeout(timeoutId);
            resolve();
          },
        );
      });
      if (typeof onProgress === "function") onProgress(100, "Image uploaded. Finalizing image link...");
      return { url: await imageRef.getDownloadURL(), path };
    } catch (storageError) {
      // Preserve the existing compressed-image fallback when Storage is
      // unavailable. The final product write still requires store authorization.
      console.warn("Firebase Storage image upload failed; using Firestore fallback", storageError);
      if (typeof onProgress === "function") onProgress(90, "Preparing image for secure Firestore storage...");
      const firestoreImage = await createFirestoreImage(file);
      if (typeof onProgress === "function") onProgress(100, "Image is ready to save with the product.");
      return { url: firestoreImage, path: null };
    }
  }

  function setAdminStats() {
    const activeProducts = products.filter((product) => product.archived !== true);
    const available = activeProducts.filter((product) => product.stock > 0).length;
    const reserved = reservations.pending.length + reservations.accepted.length;
    const rating = reviews.length ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(1) : "-";
    const values = {
      "admin-stat-products": activeProducts.length,
      "admin-stat-available": available,
      "admin-stat-reserved": reserved,
      "admin-stat-pending": reservations.pending.length,
      "admin-stat-accepted": reservations.accepted.length,
      "admin-stat-waiting": reservations.waiting.length,
      "admin-stat-rating": rating,
      "admin-stat-reviews": reviews.length,
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    });
    const productCount = document.getElementById("product-count");
    if (productCount) productCount.textContent = activeProducts.length;
    const pendingReservationCount = document.getElementById("pending-reservation-count");
    if (pendingReservationCount) pendingReservationCount.textContent = reservations.pending.length;
    const waitingReservationCount = document.getElementById("waiting-reservation-count");
    if (waitingReservationCount) waitingReservationCount.textContent = reservations.waiting.length;
  }

  function refreshStoreAlerts() {
    if (!isStoreAdmin || typeof window.setAdminAlerts !== "function") return;

    const alerts = [];
    const activeProducts = products.filter((product) => product.archived !== true);
    activeProducts.forEach((product) => {
      const stock = Number(product.stock || 0);
      if (stock <= 0) {
        alerts.push({
          type: "danger",
          icon: "fa-box-open",
          title: "Product out of stock",
          desc: `${product.name || "A product"} needs a stock update before customers can reserve it.`,
          time: "Inventory alert",
        });
      } else if (stock <= 4) {
        alerts.push({
          type: "warning",
          icon: "fa-triangle-exclamation",
          title: "Low stock warning",
          desc: `${product.name || "A product"} has only ${stock} unit${stock === 1 ? "" : "s"} remaining.`,
          time: "Inventory alert",
        });
      }
    });

    reservations.pending.slice(0, 5).forEach((reservation) => {
      const productName = reservation.product || reservation.productName || "a product";
      const customerName = reservation.customerName || reservation.userName || reservation.customer || "A customer";
      alerts.push({
        type: "warning",
        icon: "fa-calendar-check",
        title: "Pending reservation",
        desc: `${customerName} requested ${productName}.`,
        time: "Reservation alert",
      });
    });

    reservations.waiting.slice(0, 5).forEach((reservation) => {
      const productName = reservation.product || reservation.productName || "a product";
      alerts.push({
        type: "info",
        icon: "fa-clock",
        title: "Waiting-list request",
        desc: `A customer is waiting for ${productName}.`,
        time: "Reservation alert",
      });
    });

    reviews
      .filter((review) => Number(review.rating || 0) > 0 && Number(review.rating || 0) <= 2)
      .slice(0, 5)
      .forEach((review) => {
        alerts.push({
          type: "danger",
          icon: "fa-star-half-stroke",
          title: "Review needs attention",
          desc: `A customer left a ${Number(review.rating)}-star review.`,
          time: "Review alert",
        });
      });

    if (!alerts.length) {
      alerts.push({
        type: "success",
        icon: "fa-circle-check",
        title: "Store is all clear",
        desc: `${activeProducts.length} active product${activeProducts.length === 1 ? " is" : "s are"} currently listed with no urgent alerts.`,
        time: "Current store status",
      });
    }

    window.setAdminAlerts(alerts.slice(0, 12));
  }

  function recordTimestamp(record) {
    const value = record.createdAt || record.updatedAt;
    if (value?.toDate) return value.toDate();
    if (value?.toMillis) return new Date(value.toMillis());
    if (value?.seconds) return new Date(Number(value.seconds) * 1000);
    const parsed = Date.parse(value || record.date || "");
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  function archiveTimestamp(product) {
    const value = product.archivedAt;
    if (value?.toDate) return value.toDate();
    if (value?.toMillis) return new Date(value.toMillis());
    if (value?.seconds) return new Date(Number(value.seconds) * 1000);
    return recordTimestamp(product);
  }

  function isArchiveExpired(product) {
    const archivedOn = archiveTimestamp(product);
    return Boolean(archivedOn && Date.now() - archivedOn.getTime() >= ARCHIVE_RETENTION_MS);
  }

  async function purgeExpiredArchivedProducts(records) {
    const expired = records.filter((product) => product.archived === true && isArchiveExpired(product));
    if (!expired.length) return;
    await Promise.all(expired.map((product) => storeService.deleteProduct(String(product.id), { expiredBefore: Date.now() - ARCHIVE_RETENTION_MS })));
    console.info(`${expired.length} archived product${expired.length === 1 ? "" : "s"} expired after ${ARCHIVE_RETENTION_DAYS} days.`);
  }

  function refreshAdminCharts() {
    if (typeof window.updateStoreAdminCharts !== "function") return;

    const allReservations = Object.values(reservations).flat();
    const reservationCounts = allReservations.reduce((counts, reservation) => {
      const label = String(reservation.product || reservation.productName || "Unnamed product");
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {});
    const productEntries = Object.entries(reservationCounts)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 10);

    const weekCount = 6;
    const weeklyValues = Array(weekCount).fill(0);
    const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;
    const currentWeekStart = new Date();
    currentWeekStart.setHours(0, 0, 0, 0);
    const dayOffset = (currentWeekStart.getDay() + 6) % 7;
    currentWeekStart.setDate(currentWeekStart.getDate() - dayOffset);
    const firstWeekStart = new Date(currentWeekStart.getTime() - (weekCount - 1) * weekMilliseconds);
    const weekLabels = Array.from({ length: weekCount }, (_, index) => {
      const start = new Date(firstWeekStart.getTime() + index * weekMilliseconds);
      return start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    });
    allReservations.forEach((reservation) => {
      const timestamp = recordTimestamp(reservation);
      if (!timestamp) return;
      const weekIndex = Math.floor((timestamp.getTime() - firstWeekStart.getTime()) / weekMilliseconds);
      if (weekIndex >= 0 && weekIndex < weekCount) weeklyValues[weekIndex] += 1;
    });

    window.updateStoreAdminCharts({
      productLabels: productEntries.map(([label]) => label),
      productValues: productEntries.map(([, value]) => value),
      weekLabels,
      weeklyValues,
    });
  }

  function renderStoreProducts(list) {
    window.renderInventoryTable(list);
  }

  function renderStoreArchivedProducts(list) {
    window.renderInventoryTable(list, true);
  }

  async function updateStoreProduct(id, changes) {
    try {
      await window.storeAdminProductUpdate(String(id), changes);
      if (typeof window.closeModal === "function") window.closeModal("modal-edit-product");
      if (typeof window.showToast === "function") window.showToast("success", "fa-circle-check", "Product Updated", "Your product details have been updated successfully.");
      return true;
    } catch (error) {
      console.error(error);
      notify(firestoreError(error, "Product update"), "danger", "Product not updated");
      return false;
    }
  }

  function applyReservations(snapshot) {
    Object.keys(reservations).forEach((status) => { reservations[status] = []; });
    const statusMap = {
      ongoing: "accepted",
      completed: "accepted",
      cancelled: "rejected",
      waitlisted: "waiting",
      "waiting-list": "waiting",
      "waiting list": "waiting",
    };
    snapshot.forEach((doc) => {
      const reservation = { ...doc.data(), id: doc.id };
      const rawKey = String(reservation.status || "Pending").toLowerCase();
      const key = statusMap[rawKey] || rawKey;
      if (key === "accepted" && rawKey !== "completed") reservation.status = "Accepted";
      if (key === "rejected" && rawKey !== "cancelled" && rawKey !== "canceled") reservation.status = "Rejected";
      if (key === "waiting") reservation.status = "Waiting List";
      (reservations[key] || reservations.pending).push(reservation);
    });
    const reservationTime = (value) => {
      if (value?.toMillis) return value.toMillis();
      if (value?.seconds) return Number(value.seconds) * 1000;
      const parsed = Date.parse(value || "");
      return Number.isFinite(parsed) ? parsed : 0;
    };
    reservations.waiting.sort((left, right) => reservationTime(left.createdAt) - reservationTime(right.createdAt));
    setAdminStats();
    if (typeof window.renderReservations === "function") window.renderReservations(window.currentResTab || "pending");
    if (typeof window.renderAnalytics === "function") window.renderAnalytics();
    refreshAdminCharts();
    refreshStoreAlerts();
  }

  async function changeReservationStatus(id, nextStatus) {
    return storeService.changeReservationStatus(id, nextStatus);
  }

  function applyReviews(snapshot) {
    reviews.length = 0;
    snapshot.forEach((doc) => reviews.push({ ...doc.data(), id: doc.id }));
    window.storeReviews = reviews.slice();
    if (typeof window.refreshNlpSummary === "function") window.refreshNlpSummary(reviews.slice());
    setAdminStats();
    if (typeof window.renderReviews === "function") window.renderReviews();
    if (typeof window.renderAnalytics === "function") window.renderAnalytics();
    refreshAdminCharts();
    refreshStoreAlerts();
  }

  if (isStoreAdmin) {
    const storeId = session.storeId;
    window.mountStorePermits({ runtime, session, subscribe, escapeHTML });
    if (typeof window.setAdminAlertHistoryScope === "function") window.setAdminAlertHistoryScope(storeId);
    let pendingProductImageUpload = null;
    let pendingProductImageUploadPromise = null;
    let pendingProductImageUploadToken = 0;
    if (storeId) localStorage.setItem("techknowStoreId", storeId);
    window.storeAdminProductCreate = storeService.createProduct;
    window.storeAdminProductUpdate = storeService.updateProduct;
    window.storeAdminProductArchive = storeService.archiveProduct;
    window.storeAdminProductRestore = storeService.restoreProduct;
    window.storeAdminProductDelete = storeService.deleteProduct;
    window.clearPendingProductImageUpload = () => {
      pendingProductImageUploadToken += 1;
      pendingProductImageUpload = null;
      pendingProductImageUploadPromise = null;
    };
    window.prepareProductImageUpload = (file) => {
      window.clearPendingProductImageUpload();
      const uploadToken = pendingProductImageUploadToken;
      if (!file) return Promise.resolve(null);
      if (typeof window.setAddProductImageStatus === "function") {
        window.setAddProductImageStatus("uploading", "Starting secure image upload...", 0);
      }

      const uploadPromise = uploadProductImage(file, storeId, (percent, message) => {
        if (uploadToken !== pendingProductImageUploadToken) return;
        if (typeof window.setAddProductImageStatus === "function") {
          window.setAddProductImageStatus("uploading", message, percent);
        }
      }).then((uploadedImage) => {
        if (uploadToken !== pendingProductImageUploadToken) return null;
        pendingProductImageUpload = uploadedImage;
        pendingProductImageUploadPromise = null;
        if (typeof window.setAddProductImageStatus === "function") {
          window.setAddProductImageStatus("ready", "Image uploaded and ready to be added.", 100);
        }
        return uploadedImage;
      }).catch((error) => {
        if (uploadToken === pendingProductImageUploadToken) {
          pendingProductImageUpload = null;
          pendingProductImageUploadPromise = null;
          if (typeof window.setAddProductImageStatus === "function") {
            window.setAddProductImageStatus("error", error?.message || "The image upload failed. Please select it again.");
          }
        }
        console.error("Product image could not be prepared", error);
        return null;
      });

      pendingProductImageUploadPromise = uploadPromise;
      return uploadPromise;
    };
    let favoriteRequest = null;
    let favoritesStopped = false;
    const analyticsVisible = () => !document.hidden && document.getElementById('page-analytics')?.classList.contains('active');
    window.refreshStoreFavoriteCounts = () => {
      if (favoritesStopped) return Promise.resolve();
      if (favoriteRequest) return favoriteRequest;
      window.storeFavoriteCounts = { status: 'loading', counts: [] };
      window.renderAnalytics?.();
      favoriteRequest = (async () => {
        try {
          const counts = await storeService.getFavoriteCounts();
          if (!favoritesStopped) window.storeFavoriteCounts = { status: 'ready', counts };
        } catch (error) {
          console.error('Favorite counts could not be loaded', error);
          if (!favoritesStopped) window.storeFavoriteCounts = { status: 'error', counts: [] };
        } finally {
          favoriteRequest = null;
          if (!favoritesStopped) window.renderAnalytics?.();
        }
      })();
      return favoriteRequest;
    };
    const refreshVisibleFavorites = () => { if (analyticsVisible()) window.refreshStoreFavoriteCounts(); };
    const analyticsNav = document.querySelector('[data-page="analytics"]');
    analyticsNav?.addEventListener('click', refreshVisibleFavorites);
    document.addEventListener('visibilitychange', refreshVisibleFavorites);
    const favoriteTimer = window.setInterval(refreshVisibleFavorites, 30000);
    subscriptions.push(() => {
      favoritesStopped = true;
      window.clearInterval(favoriteTimer);
      analyticsNav?.removeEventListener('click', refreshVisibleFavorites);
      document.removeEventListener('visibilitychange', refreshVisibleFavorites);
    });
    window.refreshStoreFavoriteCounts();

    window.refreshStoreAdminDashboard = async () => {
      const [productSnapshot, reservationSnapshot, reviewSnapshot] = await Promise.all([
        records("products", storeId).get({ source: "server" }),
        records("reservations", storeId).get({ source: "server" }),
        records("reviews", storeId).get({ source: "server" }),
        window.refreshStoreFavoriteCounts(),
      ]);

      products = productSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
      await purgeExpiredArchivedProducts(products);
      archivedProducts = products.filter((product) => product.archived === true && !isArchiveExpired(product));
      const activeProducts = products.filter((product) => product.archived !== true);
      window.renderProducts = renderStoreProducts;
      window.renderArchivedProducts = renderStoreArchivedProducts;
      renderStoreProducts(activeProducts);
      renderStoreArchivedProducts(archivedProducts);
      const archiveCount = document.getElementById("archived-product-count");
      if (archiveCount) archiveCount.textContent = archivedProducts.length;

      applyReservations(reservationSnapshot);
      applyReviews(reviewSnapshot);
      setAdminStats();
      if (typeof window.renderAnalytics === "function") window.renderAnalytics();
      refreshAdminCharts();
      refreshStoreAlerts();
    };
    window.updateReservationStatus = async (id, nextStatus) => {
      try {
        await changeReservationStatus(id, nextStatus);
        const accepted = nextStatus === "Accepted";
        notify(
          accepted
            ? "The reservation was accepted and inventory was updated."
            : nextStatus === "Completed"
              ? "The reservation was marked as claimed."
            : nextStatus === "Rejected" && reservations.waiting.some((item) => String(item.id) === String(id))
              ? "The waiting-list request was rejected."
            : "The reservation was rejected. The product quantity remains available.",
          "success",
          accepted ? "Reservation accepted" : nextStatus === "Completed" ? "Reservation claimed" : "Request rejected",
        );
      } catch (error) {
        console.error(error);
        notify(firestoreError(error, "Reservation update"), "danger", "Reservation not updated");
      }
    };

    subscribe(records("products", storeId), (snapshot) => {
      products = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
      purgeExpiredArchivedProducts(products).catch((error) => console.error("Expired archived products could not be removed", error));
      archivedProducts = products.filter((product) => product.archived === true && !isArchiveExpired(product));
      const activeProducts = products.filter((product) => product.archived !== true);
      window.renderProducts = renderStoreProducts;
      window.renderArchivedProducts = renderStoreArchivedProducts;
      renderStoreProducts(activeProducts);
      renderStoreArchivedProducts(archivedProducts);
      const archiveCount = document.getElementById("archived-product-count");
      if (archiveCount) archiveCount.textContent = archivedProducts.length;
      setAdminStats();
      if (typeof window.renderAnalytics === "function") window.renderAnalytics();
      refreshStoreAlerts();
    }, (error) => { console.error(error); notify(firestoreError(error, "Product loading"), "danger", "Products unavailable"); });
    subscribe(records("reservations", storeId), applyReservations, (error) => {
      console.error(error);
      notify(firestoreError(error, "Reservation loading"), "danger", "Reservations unavailable");
    });
    subscribe(records("reviews", storeId), applyReviews, console.error);

    window.editProduct = (id) => {
      const product = products.find((item) => String(item.id) === String(id));
      if (!product) return;
      window.currentEditId = String(id);
      document.getElementById("edit-name").value = product.name || "";
      document.getElementById("edit-category").value = product.category || "";
      document.getElementById("edit-price").value = product.price || 0;
      document.getElementById("edit-stock").value = product.stock || 0;
      document.getElementById("edit-status").value = productStatus(product);
      document.getElementById("edit-description").value = product.description || "";
      document.getElementById("edit-product-image").value = "";
      const imagePreview = document.getElementById("edit-product-image-preview");
      const imagePreviewSource = document.getElementById("edit-product-preview-src");
      const imagePreviewName = document.getElementById("edit-product-image-name");
      if (product.imageUrl) {
        imagePreviewSource.src = product.imageUrl;
        imagePreviewName.textContent = "Current product image";
        imagePreview.style.display = "block";
      } else {
        imagePreviewSource.removeAttribute("src");
        imagePreview.style.display = "none";
      }
      window.openModal("modal-edit-product");
    };
    window.saveEdit = async () => {
      const existingProduct = products.find((item) => String(item.id) === String(window.currentEditId));
      const name = document.getElementById("edit-name").value.trim();
      const category = document.getElementById("edit-category").value;
      const price = Number(document.getElementById("edit-price").value);
      const stock = Number(document.getElementById("edit-stock").value);
      if (!name || !category || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || stock > MAX_PRODUCT_STOCK) {
        notify(`Enter a valid name, category, non-negative price, and stock quantity from 0 to ${MAX_PRODUCT_STOCK}.`, "danger", "Check product details");
        return;
      }
      const changes = {
        name,
        category,
        price,
        stock,
        status: productStatus({ ...existingProduct, stock }),
        description: document.getElementById("edit-description").value.trim(),
      };
      const imageFile = document.getElementById("edit-product-image")?.files?.[0];
      if (imageFile) {
        try {
          const uploadedImage = await uploadProductImage(imageFile, storeId);
          changes.imageUrl = uploadedImage.url;
          changes.imagePath = uploadedImage.path;
        } catch (error) {
          notify("The product details were not saved because the new image could not be uploaded.", "danger", "Image upload failed");
          return;
        }
      }
      return updateStoreProduct(window.currentEditId, changes);
    };
    window.archiveProduct = (id, name) => {
      const product = products.find((item) => String(item.id) === String(id));
      window.currentArchiveId = String(id);
      document.getElementById("archive-product-name").textContent = name || product?.name || "this product";
      window.openModal("modal-archive");
    };
    window.confirmArchive = async () => {
      try {
        await window.storeAdminProductArchive(window.currentArchiveId);
        window.closeModal("modal-archive");
        if (typeof window.showToast === "function") window.showToast("success", "fa-box-archive", "Product Archived", "The product was moved to Archived Products.");
      } catch (error) {
        console.error(error);
        notify(firestoreError(error, "Product archiving"), "danger", "Product not archived");
      }
    };
    window.restoreProduct = async (id) => {
      try {
        await window.storeAdminProductRestore(String(id));
        if (typeof window.showToast === "function") window.showToast("success", "fa-box-open", "Product Restored", "The product is back in your active catalog.");
      } catch (error) {
        console.error(error);
        notify(firestoreError(error, "Product restoration"), "danger", "Product not restored");
      }
    };
    window.deleteArchivedProduct = (id, name) => {
      const product = products.find((item) => String(item.id) === String(id));
      if (!product || product.archived !== true) {
        notify("Only archived products can be permanently deleted.", "danger", "Product cannot be deleted");
        return;
      }
      window.currentDeleteArchivedId = String(id);
      window.currentDeleteArchivedName = name || product.name || "this product";
      const nameElement = document.getElementById("delete-archived-product-name");
      if (nameElement) nameElement.textContent = window.currentDeleteArchivedName;
      window.openModal("modal-delete-archived-product");
    };
    window.confirmDeleteArchivedProduct = async () => {
      const id = window.currentDeleteArchivedId;
      if (!id) return;
      const deleteButton = document.getElementById("confirm-delete-archived-product");
      if (deleteButton) {
        deleteButton.disabled = true;
        deleteButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Deleting...';
      }
      try {
        await window.storeAdminProductDelete(id);
        window.closeModal("modal-delete-archived-product");
        if (typeof window.showToast === "function") window.showToast("success", "fa-trash-can", "Product Deleted", `${window.currentDeleteArchivedName || "The product"} was permanently deleted.`);
      } catch (error) {
        console.error(error);
        notify(firestoreError(error, "Product deletion"), "danger", "Product not deleted");
      } finally {
        if (deleteButton) {
          deleteButton.disabled = false;
          deleteButton.innerHTML = '<i class="fa fa-trash-can"></i> Delete permanently';
        }
      }
    };
    window.addProduct = async () => {
      const data = {
        name: document.getElementById("add-product-name").value.trim(),
        category: document.getElementById("add-product-category").value,
        price: Number(document.getElementById("add-product-price").value.replace(/,/g, "")),
        stock: Number(document.getElementById("add-product-stock").value),
        description: document.querySelector("#modal-add-product textarea").value.trim(),
        views: 0,
        favorites: 0,
        recommendations: 0,
        reservationCount: 0,
      };
      if (!data.name || !data.category || !Number.isFinite(data.price) || data.price < 0 || !Number.isInteger(data.stock) || data.stock < 0 || data.stock > MAX_PRODUCT_STOCK) {
        notify(`Enter a product name, category, non-negative price, and stock quantity from 0 to ${MAX_PRODUCT_STOCK}.`, "danger", "Check product details");
        return;
      }
      data.totalQuantity = data.stock;
      data.status = productStatus(data);
      if (pendingProductImageUploadPromise) {
        notify("Please wait until the image upload reaches 100% before adding the product.", "warning", "Image upload in progress");
        return;
      }
      if (pendingProductImageUpload?.url) {
        data.imageUrl = pendingProductImageUpload.url;
        data.imagePath = pendingProductImageUpload.path || null;
      }
      const hasProductImage = Boolean(pendingProductImageUpload?.url);
      const submitButton = document.getElementById("add-product-submit");
      const originalSubmitLabel = submitButton?.innerHTML;
      if (submitButton) submitButton.disabled = true;
      if (submitButton) submitButton.dataset.productSubmitting = "true";
      try {
        if (submitButton) submitButton.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Adding product...';
        await window.storeAdminProductCreate(data);

        window.pendingProductImage = null;
        window.clearPendingProductImageUpload?.();
        window.closeModal("modal-add-product");
        if (typeof window.showToast === "function") {
          window.showToast(
            "success",
            "fa-circle-check",
            "Product Listed",
            hasProductImage
              ? "Your product and image have been added to the store catalog."
              : "Your product has been added to the store catalog.",
          );
        }
      } catch (error) {
        console.error(error);
        notify(firestoreError(error, "Product creation"), "danger", "Product not added");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.dataset.productSubmitting = "false";
          if (originalSubmitLabel) submitButton.innerHTML = originalSubmitLabel;
        }
      }
    };
  }

  if (isSuperAdmin) {
    window.mountSuperAdmin({ db, session, subscribe, escapeHTML });
  }
})().catch((error) => {
  console.error("Admin portal could not start", error);
  window.alert(error?.code === "permission-denied" ? error.message : "The admin portal could not load. Please sign in and try again.");
  window.location.replace(document.getElementById("stat-shops") ? "superadmin-login.html" : "login.html");
});
