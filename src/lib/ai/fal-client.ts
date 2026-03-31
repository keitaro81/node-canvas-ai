import { fal } from "@fal-ai/client";

let initialized = false;

export function initFalClient(): void {
  if (initialized) return;

  const key = import.meta.env.VITE_FAL_KEY;
  if (!key) {
    console.warn("VITE_FAL_KEY is not set. Video generation will not work.");
    return;
  }

  fal.config({
    credentials: key,
  });

  initialized = true;
  console.log("fal.ai client initialized");
}

export { fal };
