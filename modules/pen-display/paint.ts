import { pdState } from "./state";
import { pdPenRGB } from "./color";
import { pfRaster } from "./raster";

/** Dynamic RGB path for the ordered rectangle queue. */
export function pfPaint(): void {
  if (pdState("__pf_color") !== pdState("__pf_last_color")) {
    pdPenRGB(pdState("__pf_color"));
    setVar("__pf_last_color", pdState("__pf_color"));
  }
  pfRaster();
}
