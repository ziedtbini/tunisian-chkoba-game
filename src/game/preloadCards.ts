import { ALL_CARDS, backSrc, cardSrc } from "./cards";

export function preloadAllCards(): void {
  const sources = [...ALL_CARDS.map((id) => cardSrc(id)), backSrc];

  for (const src of sources) {
    const img = new Image();
    img.onload = () => {};
    img.onerror = () => {
      console.error(`[preloadAllCards] Missing card asset: ${src}`);
    };
    img.src = src;
  }
}
