const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "your",
  "product",
  "store",
]);

const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export const normalizeRecommendationText = (value) =>
  String(value || "")
    .toLocaleLowerCase("en-PH")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokensFor = (item = {}) =>
  new Set(
    normalizeRecommendationText(
      [
        item.title || item.name,
        item.product,
        item.category,
        item.description,
      ]
        .filter(Boolean)
        .join(" "),
    )
      .split(" ")
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );

const categoryFor = (item = {}) =>
  normalizeRecommendationText(item.category || "other") || "other";

const productKeyFor = (item = {}) => {
  if (item.id || item.productId) return String(item.id || item.productId);
  return normalizeRecommendationText(item.title || item.name || item.product);
};

const titleFor = (item = {}) => item.title || item.name || item.product || "";

const numberFromValue = (value) => {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return null;
  const numericValue = rawValue.replace(/[^0-9.-]/g, "");
  if (!numericValue) return null;
  const parsed = Number(numericValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const ratingFor = (item = {}) => {
  const rating = numberFromValue(item.rating);
  return rating === null ? 0.5 : clamp(rating / 5);
};

const stockFor = (item = {}) => {
  if (item.stockUnknown) return null;
  const stock = Number.parseInt(String(item.stock ?? ""), 10);
  return Number.isFinite(stock) ? stock : 0;
};

const popularityFor = (product, reservationCounts = {}) => {
  const storedCount = Math.max(0, numberFromValue(product.reservationCount) || 0);
  const liveCount = Math.max(0, numberFromValue(reservationCounts?.[product.id]) || 0);
  return Math.max(storedCount, liveCount);
};

const productFromInteraction = (interaction, productsById, productsByName) => {
  const interactionId = String(interaction?.productId || "");
  if (interactionId && productsById.has(interactionId)) {
    return productsById.get(interactionId);
  }

  const name = normalizeRecommendationText(
    interaction?.product || interaction?.productName || interaction?.title,
  );
  return productsByName.get(name) || interaction;
};

const addInteractionToProfile = (profile, interaction, weight) => {
  const category = categoryFor(interaction);
  profile.categoryWeights.set(
    category,
    (profile.categoryWeights.get(category) || 0) + weight,
  );

  tokensFor(interaction).forEach((token) => {
    profile.tokenWeights.set(
      token,
      (profile.tokenWeights.get(token) || 0) + weight,
    );
  });

  const price = numberFromValue(interaction.price);
  if (price !== null && price >= 0) {
    profile.prices.push(price);
  }
};

const buildUserProfile = (products, favorites, reservations) => {
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const productsByName = new Map(
    products.map((product) => [normalizeRecommendationText(titleFor(product)), product]),
  );
  const profile = {
    categoryWeights: new Map(),
    tokenWeights: new Map(),
    prices: [],
    interactedKeys: new Set(),
  };

  favorites.forEach((favorite) => {
    const item = productFromInteraction(favorite, productsById, productsByName);
    profile.interactedKeys.add(productKeyFor(item));
    addInteractionToProfile(profile, item, 2);
  });

  reservations.forEach((reservation) => {
    const item = productFromInteraction(reservation, productsById, productsByName);
    profile.interactedKeys.add(productKeyFor(item));
    addInteractionToProfile(profile, item, 3);
  });

  return profile;
};

const affinityFor = (product, profile) => {
  const categoryWeights = Array.from(profile.categoryWeights.values());
  const maxCategoryWeight = Math.max(...categoryWeights, 1);
  const categoryAffinity =
    (profile.categoryWeights.get(categoryFor(product)) || 0) / maxCategoryWeight;

  const productTokens = tokensFor(product);
  const totalTokenWeight = Array.from(profile.tokenWeights.values()).reduce(
    (total, weight) => total + weight,
    0,
  );
  const matchingTokenWeight = Array.from(productTokens).reduce(
    (total, token) => total + (profile.tokenWeights.get(token) || 0),
    0,
  );
  const keywordAffinity = totalTokenWeight
    ? clamp(matchingTokenWeight / totalTokenWeight)
    : 0;

  const price = numberFromValue(product.price);
  const averagePrice = profile.prices.length
    ? profile.prices.reduce((total, value) => total + value, 0) / profile.prices.length
    : null;
  const priceAffinity = price === null || averagePrice === null
    ? 0.5
    : clamp(1 - (Math.abs(price - averagePrice) / Math.max(price, averagePrice, 1)) * 1.5);

  return { categoryAffinity, keywordAffinity, priceAffinity };
};

const reasonFor = ({ categoryAffinity, keywordAffinity, popularityAffinity }, product) => {
  if (categoryAffinity >= 0.55) {
    return `Based on your interest in ${product.category || "this category"}`;
  }
  if (keywordAffinity >= 0.12) return "Matches products you interacted with";
  if (popularityAffinity >= 0.7) return "Popular with other customers";
  return "Recommended from current store listings";
};

/**
 * Hybrid recommendation model:
 * - content-based affinity from category and product text;
 * - implicit feedback, where reservations weigh more than favorites;
 * - popularity, rating, and stock signals for cold-start users.
 */
export const recommendProducts = (
  products = [],
  {
    favorites = [],
    reservations = [],
    reservationCounts = {},
    limit = 6,
  } = {},
) => {
  if (!products.length) return [];

  const profile = buildUserProfile(products, favorites, reservations);
  const popularityValues = products.map((product) =>
    popularityFor(product, reservationCounts),
  );
  const maximumPopularity = Math.max(...popularityValues, 1);
  const personalized = profile.categoryWeights.size > 0 || profile.tokenWeights.size > 0;

  const ranked = products
    .map((product, index) => {
      const { categoryAffinity, keywordAffinity, priceAffinity } = affinityFor(product, profile);
      const popularityAffinity = clamp(
        Math.log1p(popularityValues[index]) / Math.log1p(maximumPopularity),
      );
      const stock = stockFor(product);
      const availabilityAffinity = stock === null ? 0.5 : stock > 0 ? 1 : 0;
      const qualityAffinity = ratingFor(product);
      const score = personalized
        ? categoryAffinity * 0.38
          + keywordAffinity * 0.27
          + priceAffinity * 0.15
          + popularityAffinity * 0.12
          + qualityAffinity * 0.04
          + availabilityAffinity * 0.04
        : popularityAffinity * 0.55
          + qualityAffinity * 0.25
          + availabilityAffinity * 0.2;

      return {
        ...product,
        recommendationScore: Number(score.toFixed(4)),
        recommendationReason: reasonFor(
          { categoryAffinity, keywordAffinity, popularityAffinity },
          product,
        ),
        _recommendationPopularity: popularityAffinity,
        _recommendationStock: availabilityAffinity,
      };
    })
    .sort((left, right) =>
      right.recommendationScore - left.recommendationScore
      || right._recommendationPopularity - left._recommendationPopularity
      || right._recommendationStock - left._recommendationStock
      || titleFor(left).localeCompare(titleFor(right)),
    );

  const available = ranked.filter((product) => _isAvailable(product));
  const candidates = available.length ? available : ranked;
  const unseen = candidates.filter(
    (product) => !profile.interactedKeys.has(productKeyFor(product)),
  );
  const selected = unseen.length ? unseen : candidates;

  return selected.slice(0, limit).map(({ _recommendationPopularity, _recommendationStock, ...product }) => product);
};

const _isAvailable = (product) => {
  const stock = stockFor(product);
  return stock === null || stock > 0;
};
