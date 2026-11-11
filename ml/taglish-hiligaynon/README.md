# Hybrid review sentiment analysis

`index.js` exposes the Taglish-Hiligaynon lexicon used by the admin NLP Summary.
The admin combines its language-specific sentiment cues with multilingual BERT
predictions and uses the review rating as a secondary signal and conflict check.

The lexicon supports Taglish, Hiligaynon, Tagalog, and common English review
terms. Its entries are curated seed annotations, not a complete vocabulary or
ground-truth dataset. Extend and validate terms with native speakers and real,
consented review examples before relying on them as a standalone classifier.

Sarcasm is not reliably solved by general sentiment models. The admin flags
explicit sarcasm markers, mixed/contrastive sentiment, rating-text conflicts,
and strong BERT/lexicon disagreements for human follow-up. These flags are
review aids, not definitive sarcasm labels or proof that a concern is resolved.
