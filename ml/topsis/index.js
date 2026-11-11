/**
 * TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution)
 * ranking for TechKnow products or stores.
 *
 * TOPSIS is useful when a decision depends on several criteria at once. For
 * example, a product can be ranked using price, distance, rating, and stock
 * instead of sorting by price alone. The implementation is intentionally
 * independent from React, Expo, and Firebase so it can be used by a hook,
 * screen, API route, or background job.
 */

const WEIGHT_SUM_TOLERANCE = 1e-6;
const ZERO_TOLERANCE = 1e-12;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toFiniteNumber = (value, label) => {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return numberValue;
};

const validateCriteria = (criteria) => {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new TypeError("At least one decision criterion is required.");
  }

  if (new Set(criteria).size !== criteria.length) {
    throw new TypeError("Decision criteria must be unique.");
  }
};

const validateWeights = (weights) => {
  if (!isPlainObject(weights)) {
    throw new TypeError("weights must be an object keyed by criterion.");
  }

  const criteria = Object.keys(weights);
  validateCriteria(criteria);

  const totalWeight = criteria.reduce(
    (total, criterion) =>
      total + toFiniteNumber(weights[criterion], `Weight for ${criterion}`),
    0,
  );

  if (criteria.some((criterion) => weights[criterion] < 0)) {
    throw new RangeError("Weights cannot be negative.");
  }

  if (Math.abs(totalWeight - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new RangeError(
      `Weights must sum to 1.0; received ${totalWeight}.`,
    );
  }

  return criteria;
};

const validateImpacts = (impacts, criteria) => {
  if (!isPlainObject(impacts)) {
    throw new TypeError("impacts must be an object keyed by criterion.");
  }

  criteria.forEach((criterion) => {
    if (impacts[criterion] !== "min" && impacts[criterion] !== "max") {
      throw new RangeError(
        `Impact for ${criterion} must be either \"min\" or \"max\".`,
      );
    }
  });
};

const createDecisionMatrix = (candidates, criteria) =>
  candidates.map((candidate, candidateIndex) => {
    if (!isPlainObject(candidate)) {
      throw new TypeError(`Candidate at index ${candidateIndex} must be an object.`);
    }

    return criteria.map((criterion) =>
      toFiniteNumber(
        candidate[criterion],
        `Candidate ${candidateIndex} criterion ${criterion}`,
      ),
    );
  });

const validateMatrix = (matrix, criteria, matrixName) => {
  if (!Array.isArray(matrix)) {
    throw new TypeError(`${matrixName} must be a two-dimensional array.`);
  }

  matrix.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== criteria.length) {
      throw new TypeError(
        `${matrixName} row ${rowIndex} must contain ${criteria.length} values.`,
      );
    }

    row.forEach((value, columnIndex) =>
      toFiniteNumber(value, `${matrixName} value ${rowIndex}:${columnIndex}`),
    );
  });
};

const normalizeMatrix = (decisionMatrix, criteria) => {
  const norms = criteria.map((_, criterionIndex) =>
    Math.sqrt(
      decisionMatrix.reduce(
        (sum, row) => sum + row[criterionIndex] ** 2,
        0,
      ),
    ),
  );

  return decisionMatrix.map((row) =>
    row.map((value, criterionIndex) => {
      const norm = norms[criterionIndex];

      // A column containing only zeroes has no differentiating information.
      // Returning zero keeps the matrix finite and makes its ideal values tie.
      return norm <= ZERO_TOLERANCE ? 0 : value / norm;
    }),
  );
};

/**
 * Creates the vector-normalized decision matrix.
 *
 * @param {Array<object>} candidates Candidate objects.
 * @param {string[]} criteria Criterion property names in matrix-column order.
 * @returns {number[][]} Normalized matrix.
 */
export const normalizeDecisionMatrix = (candidates, criteria) => {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array.");
  }

  if (candidates.length === 0) return [];

  validateCriteria(criteria);
  const decisionMatrix = createDecisionMatrix(candidates, criteria);
  return normalizeMatrix(decisionMatrix, criteria);
};

/**
 * Applies each criterion weight to a normalized decision matrix.
 *
 * @param {number[][]} normalizedMatrix Vector-normalized matrix.
 * @param {object} weights Criterion weights that sum to 1.0.
 * @returns {number[][]} Weighted normalized matrix.
 */
export const calculateWeightedNormalizedMatrix = (
  normalizedMatrix,
  weights,
) => {
  const criteria = validateWeights(weights);
  validateMatrix(normalizedMatrix, criteria, "normalizedMatrix");

  return normalizedMatrix.map((row) =>
    row.map((value, criterionIndex) =>
      value * toFiniteNumber(
        weights[criteria[criterionIndex]],
        `Weight for ${criteria[criterionIndex]}`,
      ),
    ),
  );
};

/**
 * Finds the ideal best and ideal worst vectors from a weighted matrix.
 *
 * @param {number[][]} weightedMatrix Weighted normalized matrix.
 * @param {object} impacts Criterion directions: "min" or "max".
 * @param {string[]} criteria Criterion names in matrix-column order.
 * @returns {{ idealBest: number[], idealWorst: number[] }} Ideal vectors.
 */
export const calculateIdealSolutions = (
  weightedMatrix,
  impacts,
  criteria = Object.keys(impacts || {}),
) => {
  validateCriteria(criteria);
  validateImpacts(impacts, criteria);
  validateMatrix(weightedMatrix, criteria, "weightedMatrix");

  if (weightedMatrix.length === 0) {
    return {
      idealBest: criteria.map(() => 0),
      idealWorst: criteria.map(() => 0),
    };
  }

  return criteria.reduce(
    (solutions, criterion, criterionIndex) => {
      const column = weightedMatrix.map((row) => row[criterionIndex]);
      const maximum = Math.max(...column);
      const minimum = Math.min(...column);

      if (impacts[criterion] === "max") {
        solutions.idealBest.push(maximum);
        solutions.idealWorst.push(minimum);
      } else {
        solutions.idealBest.push(minimum);
        solutions.idealWorst.push(maximum);
      }

      return solutions;
    },
    { idealBest: [], idealWorst: [] },
  );
};

/**
 * Calculates each candidate's Euclidean distance from both ideal vectors.
 *
 * @param {number[][]} weightedMatrix Weighted normalized matrix.
 * @param {number[]} idealBest Ideal best vector.
 * @param {number[]} idealWorst Ideal worst vector.
 * @returns {Array<{distanceToIdealBest: number, distanceToIdealWorst: number}>}
 */
export const calculateIdealDistances = (
  weightedMatrix,
  idealBest,
  idealWorst,
) => {
  if (!Array.isArray(idealBest) || !Array.isArray(idealWorst)) {
    throw new TypeError("Ideal solutions must be arrays.");
  }

  if (idealBest.length !== idealWorst.length) {
    throw new TypeError("Ideal solution vectors must have equal length.");
  }

  idealBest.forEach((value, index) =>
    toFiniteNumber(value, `Ideal best value at index ${index}`),
  );
  idealWorst.forEach((value, index) =>
    toFiniteNumber(value, `Ideal worst value at index ${index}`),
  );

  validateMatrix(
    weightedMatrix,
    idealBest.map((_, index) => String(index)),
    "weightedMatrix",
  );

  return weightedMatrix.map((row) => ({
    distanceToIdealBest: Math.sqrt(
      row.reduce(
        (sum, value, index) => sum + (value - idealBest[index]) ** 2,
        0,
      ),
    ),
    distanceToIdealWorst: Math.sqrt(
      row.reduce(
        (sum, value, index) => sum + (value - idealWorst[index]) ** 2,
        0,
      ),
    ),
  }));
};

/**
 * Converts ideal distances into relative-closeness scores between 0 and 1.
 * When both distances are zero, the candidate is indistinguishable from both
 * ideals, so 0.5 represents a neutral tie instead of returning NaN.
 *
 * @param {Array<{distanceToIdealBest: number, distanceToIdealWorst: number}>} distances
 * @returns {number[]} Relative-closeness scores.
 */
export const calculateRelativeCloseness = (distances) => {
  if (!Array.isArray(distances)) {
    throw new TypeError("distances must be an array.");
  }

  return distances.map((distance, index) => {
    const distanceToIdealBest = toFiniteNumber(
      distance?.distanceToIdealBest,
      `Distance to ideal best at index ${index}`,
    );
    const distanceToIdealWorst = toFiniteNumber(
      distance?.distanceToIdealWorst,
      `Distance to ideal worst at index ${index}`,
    );
    const totalDistance = distanceToIdealBest + distanceToIdealWorst;

    if (totalDistance <= ZERO_TOLERANCE) return 0.5;

    return distanceToIdealWorst / totalDistance;
  });
};

/**
 * Ranks TechKnow candidates with TOPSIS.
 *
 * @param {Array<object>} candidates Candidate objects.
 * @param {object} weights Criterion weights; values must sum to 1.0.
 * @param {object} impacts Criterion directions: "min" or "max".
 * @returns {Array<object>} New candidate objects sorted by descending score.
 */
export const rankCandidatesWithTopsis = (
  candidates,
  weights,
  impacts,
) => {
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array.");
  }

  // An empty catalog has no ranking, and should not fail because there is no
  // decision matrix from which to calculate norms or ideal solutions.
  if (candidates.length === 0) return [];

  const criteria = validateWeights(weights);
  validateImpacts(impacts, criteria);

  const decisionMatrix = createDecisionMatrix(candidates, criteria);
  const normalizedMatrix = normalizeMatrix(decisionMatrix, criteria);
  const weightedMatrix = calculateWeightedNormalizedMatrix(
    normalizedMatrix,
    weights,
  );
  const { idealBest, idealWorst } = calculateIdealSolutions(
    weightedMatrix,
    impacts,
    criteria,
  );
  const distances = calculateIdealDistances(
    weightedMatrix,
    idealBest,
    idealWorst,
  );
  const scores = calculateRelativeCloseness(distances);

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      topsisScore: scores[index],
    }))
    .sort(
      (left, right) =>
        right.topsisScore - left.topsisScore || left.index - right.index,
    )
    .map(({ candidate, topsisScore }, index) => ({
      ...candidate,
      topsisScore,
      rank: index + 1,
    }));
};

export default rankCandidatesWithTopsis;
