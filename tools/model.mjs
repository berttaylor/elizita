// The sentence model, shared by the build tools. The page loads the same model and settings
// (see MODEL in index.html), so vectors made here match the ones made in the browser.
import { pipeline } from "@huggingface/transformers";

export const MODEL = "Xenova/all-MiniLM-L6-v2";
const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
export const embed = async text => (await extractor(text, { pooling: "mean", normalize: true })).data;
