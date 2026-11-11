import { Platform } from "react-native";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import proofPolicy from "../domain/review-proofs";

const { MAX_PROOF_SIZE, MAX_INLINE_PROOF_SIZE, proofError } = proofPolicy;

export async function prepareProofImage(asset) {
  if (!asset?.uri || (asset.type && asset.type !== "image")) {
    throw proofError("Choose a receipt image before submitting.");
  }
  const size = Number(Platform.OS === "web" ? asset.file?.size ?? asset.fileSize : new File(asset.uri).size);
  if (!Number.isInteger(size) || size <= 0 || size >= MAX_PROOF_SIZE) {
    throw proofError("Choose a nonempty proof image under 5 MB.");
  }
  const width = Number(asset.width), height = Number(asset.height);
  if (!(width > 0 && height > 0)) throw proofError("The image has no usable dimensions.");

  // Keep the entire receipt and its aspect ratio. Follow the product image
  // JPEG/base64 approach, reducing quality and dimensions only as needed.
  for (let longest = Math.min(Math.max(width, height), 1280); longest >= Math.min(320, Math.max(width, height)); longest = Math.floor(longest * 0.8)) {
    const context = ImageManipulator.manipulate(asset.uri);
    let image;
    try {
      context.resize(width >= height ? { width: longest } : { height: longest });
      image = await context.renderAsync();
      for (const compress of [0.85, 0.7, 0.55, 0.4, 0.25]) {
        const result = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
        if (!result.base64) continue;
        const dataUrl = `data:image/jpeg;base64,${result.base64}`;
        if (dataUrl.length > MAX_INLINE_PROOF_SIZE) continue;
        const proof = {
          uri: result.uri,
          dataUrl,
          fileSize: size,
          fileName: String(asset.fileName || "receipt").replace(/\.[^.]+$/, "") + ".jpg",
        };
        proofPolicy.proofFields(proof);
        return proof;
      }
    } finally {
      image?.release();
      context.release();
    }
  }
  throw proofError("This image could not be prepared for your review. Please choose another image.");
}
