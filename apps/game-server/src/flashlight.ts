import { FLASHLIGHT_SECONDS } from "@third-space/config";

type Flashlight = { flashlightBattery: number; flashlightOn: boolean };

/** Consume only enabled runtime. OFF preserves the exact stored charge. */
export function stepFlashlight(
  flashlight: Flashlight,
  elapsedSeconds: number,
): Flashlight {
  if (!flashlight.flashlightOn || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0)
    return flashlight;

  const remaining = flashlight.flashlightBattery - elapsedSeconds / FLASHLIGHT_SECONDS;
  // Repeated 60 Hz subtraction can leave a positive rounding residue at 30s.
  // This tolerance is less than a nanosecond of runtime, not another frame.
  const flashlightBattery = remaining <= 1e-12 ? 0 : remaining;
  return { flashlightBattery, flashlightOn: flashlightBattery > 0 };
}
