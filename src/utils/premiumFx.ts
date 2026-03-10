type FxEvent = "button" | "card" | "capture" | "chkoba" | "roundEnd" | "victory";

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

function tone(freq: number, durationMs: number, type: OscillatorType, gainValue: number, at = 0) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function setupAudioUnlock() {
  if (typeof window === "undefined" || unlocked) return;
  const unlock = () => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.resume().catch(() => {});
    unlocked = true;
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
}

export function haptic(kind: "light" | "medium" | "strong" = "light") {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  const pattern =
    kind === "light" ? 12 :
    kind === "medium" ? [16, 12, 16] :
    [26, 18, 26];
  try {
    navigator.vibrate(pattern as any);
  } catch {}
}

export function playFx(event: FxEvent) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  switch (event) {
    case "button":
      tone(620, 90, "triangle", 0.03);
      break;
    case "card":
      tone(480, 80, "sine", 0.025);
      break;
    case "capture":
      tone(520, 80, "triangle", 0.03);
      tone(720, 110, "triangle", 0.03, 0.08);
      break;
    case "chkoba":
      tone(540, 100, "square", 0.04);
      tone(760, 120, "square", 0.04, 0.09);
      tone(980, 140, "square", 0.04, 0.2);
      break;
    case "roundEnd":
      tone(390, 120, "sine", 0.03);
      tone(520, 140, "sine", 0.03, 0.12);
      break;
    case "victory":
      tone(523, 120, "triangle", 0.04);
      tone(659, 130, "triangle", 0.04, 0.1);
      tone(784, 150, "triangle", 0.05, 0.22);
      break;
  }
}

export function feedback(event: FxEvent) {
  playFx(event);
  if (event === "button" || event === "card") haptic("light");
  else if (event === "capture" || event === "roundEnd") haptic("medium");
  else haptic("strong");
}

