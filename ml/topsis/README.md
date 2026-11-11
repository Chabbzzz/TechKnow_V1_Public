# TechKnow TOPSIS ranking

TOPSIS ranks products or stores by measuring how close each candidate is to an
ideal candidate. It combines multiple weighted criteria and supports both
benefit criteria (`max`) and cost criteria (`min`).

```js
import rankCandidatesWithTopsis from "./ml/topsis";

const rankedProducts = rankCandidatesWithTopsis(
  products,
  {
    price: 0.4,
    distanceKm: 0.3,
    rating: 0.2,
    stockCount: 0.1,
  },
  {
    price: "min",
    distanceKm: "min",
    rating: "max",
    stockCount: "max",
  },
);
```

The returned array is sorted from best to worst and each item receives:

- `topsisScore`: relative closeness from `0` to `1`.
- `rank`: one-based rank after sorting.

The module also exports the normalization, weighting, ideal-solution,
distance, and relative-closeness stages for unit tests or more detailed UI
explanations.
