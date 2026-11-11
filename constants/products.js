export const formatPeso = (value) => {
  const amount = Number(value);
  return `₱${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const variantForCategory = (category = "") => {
  const value = category.toLowerCase();
  if (value.includes("monitor") || value.includes("display")) return "display";
  if (value.includes("keyboard") || value.includes("peripheral")) return "keyboard";
  return "monitor";
};

const visualsForVariant = (variant) => ({
  monitor: { accent: "#edf5f8", image: "#d8e8ee" },
  display: { accent: "#f3f0fb", image: "#ddd7ee" },
  keyboard: { accent: "#eef6ef", image: "#d6e8d9" },
}[variant] || { accent: "#f0f1f3", image: "#d6d9dd" });

const imageValue = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return "";

  return [value.url, value.downloadURL, value.downloadUrl, value.src]
    .find((candidate) => typeof candidate === "string" && candidate.trim())
    ?.trim() || "";
};

const storagePathValue = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return "";

  return [value.path, value.fullPath, value.storagePath]
    .find((candidate) => typeof candidate === "string" && candidate.trim())
    ?.trim() || "";
};

const isRemoteImageUri = (value) => /^(https?:|data:image\/|file:|content:|asset:)/i.test(value);

export const getProductImageUrl = (product = {}) => {
  const imageCandidates = [
    product.imageUrl,
    product.imageURL,
    product.image_url,
    product.image,
    product.photoUrl,
    product.productImage,
  ];
  return imageCandidates.map(imageValue).find(Boolean) || "";
};

export const getProductImagePath = (product = {}) => {
  const pathCandidates = [
    product.imagePath,
    product.image_path,
    product.storagePath,
    product.storage_path,
  ];
  return pathCandidates
    .map(storagePathValue)
    .find((value) => value && !isRemoteImageUri(value)) || "";
};

export const toProductCard = (product) => {
  const stock = Number(product.stock || 0);
  const variant = variantForCategory(product.category);
  const imageUrl = getProductImageUrl(product);
  const imagePath = getProductImagePath(product);
  return {
    ...product,
    id: String(product.id),
    imageUrl,
    imagePath,
    title: product.name || "Unnamed product",
    price: formatPeso(product.price),
    rating: product.rating ? `${product.rating}★` : "New",
    stock: `${stock} in stock`,
    shopName: product.storeName || product.shopName || "",
    category: product.category || "Other",
    variant,
    ...visualsForVariant(variant),
  };
};

export const toReservationParams = (product, returnTo = "/home") => ({
  productId: String(product.id || ""),
  productStoreId: String(product.storeId || ""),
  productName: String(product.title || product.name || "Unnamed product"),
  productPrice: typeof product.price === "string" ? product.price : formatPeso(product.price),
  productCategory: String(product.category || "Other"),
  productShop: String(product.shopName || product.storeName || ""),
  productImage: getProductImageUrl(product),
  productImagePath: getProductImagePath(product),
  productDescription: String(product.description || ""),
  returnTo,
});
