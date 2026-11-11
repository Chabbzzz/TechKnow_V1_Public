// Keep a single inline image below Firestore's 1 MiB document limit, with
// enough room for review text and metadata (the product image budget).
const MAX_PROOF_SIZE = 5 * 1024 * 1024;
const MAX_INLINE_PROOF_SIZE = 700 * 1024;

function proofError(message) {
  return Object.assign(new Error(message), { code: "validation/invalid-proof" });
}

function proofFields(proof) {
  const empty = { proofFile: "", proofFileUrl: "", proofFileName: "", proofStoragePath: "" };
  if (!proof) return empty;
  const size = Number(proof.fileSize);
  if (!Number.isInteger(size) || size <= 0 || size >= MAX_PROOF_SIZE) {
    throw proofError("Choose a nonempty proof image under 5 MB.");
  }
  const dataUrl = proof.dataUrl;
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_INLINE_PROOF_SIZE) {
    throw proofError("The proof image could not be prepared. Please choose it again.");
  }
  const header = /^data:image\/(jpeg|png|webp|gif);base64,/.exec(dataUrl);
  const encoded = header ? dataUrl.slice(header[0].length) : "";
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw proofError("Choose a JPEG, PNG, WebP, or GIF receipt image.");
  }
  return {
    ...empty,
    // Store the image once. The admin proof viewer already accepts data URLs.
    proofFileUrl: dataUrl,
    proofFileName: String(proof.fileName || "receipt.jpg").slice(0, 160),
  };
}

module.exports = { MAX_PROOF_SIZE, MAX_INLINE_PROOF_SIZE, proofError, proofFields };
