import { TAGLISH_HILIGAYNON_LEXICON } from "./lexicon.js";

const DEFAULT_NEGATIONS = new Set(["indi", "hindi", "wala", "not"]);
const DEFAULT_INTENSIFIERS = new Set(["gid", "grabe", "sobrang", "super", "very"]);

const normalize = (text) =>
  text
    .toLocaleLowerCase("en-PH")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const createLookup = (lexicon) =>
  new Map(lexicon.map((entry) => [normalize(entry.term), entry]));

const getCandidateTerms = (tokens, index) => [
  tokens[index],
  [tokens[index], tokens[index + 1]].filter(Boolean).join(" "),
  [tokens[index], tokens[index + 1], tokens[index + 2]].filter(Boolean).join(" "),
];

export const createLexicon = (entries = TAGLISH_HILIGAYNON_LEXICON) => {
  const lookup = createLookup(entries);

  return {
    entries,

    find(term) {
      return lookup.get(normalize(term)) ?? null;
    },

    score(text) {
      const tokens = normalize(text).split(" ").filter(Boolean);
      const matches = [];
      let total = 0;
      let weight = 0;

      for (let index = 0; index < tokens.length; index += 1) {
        const match = getCandidateTerms(tokens, index)
          .reverse()
          .map((candidate) => lookup.get(candidate))
          .find(Boolean);

        if (!match) continue;

        const span = normalize(match.term).split(" ").length;
        const previousToken = tokens[index - 1];
        const isNegated =
          DEFAULT_NEGATIONS.has(previousToken) &&
          !match.tags.includes("negation");
        const isIntensified =
          DEFAULT_INTENSIFIERS.has(previousToken) &&
          !match.tags.includes("intensifier");
        const direction = isNegated ? -1 : 1;
        const multiplier = isIntensified ? 1.25 : 1;
        const contribution = match.polarity * match.intensity * direction * multiplier;

        matches.push({
          ...match,
          contribution,
          negated: isNegated,
          intensified: isIntensified,
        });
        total += contribution;
        weight += match.intensity;
        index += span - 1;
      }

      const normalizedScore = weight ? total / weight : 0;

      return {
        score: Math.max(-1, Math.min(1, normalizedScore)),
        label:
          normalizedScore > 0.15
            ? "positive"
            : normalizedScore < -0.15
              ? "negative"
              : "neutral",
        matches,
      };
    },
  };
};

export const taglishHiligaynonLexicon = createLexicon();

export { normalize };
