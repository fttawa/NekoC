import { pdState } from "./state";
import { pfBorder } from "./raster-border";

// A 28-unit capsule fills the centre; 8- and 2-unit inset perimeters fill
// its corner gaps, leaving only the same subpixel rounding as a 2-unit pen.
export function pfRaster28Vertical(): void {
  setPenSize(28);
  moveTo(pdState("__pf_x0") + 14, pdState("__pf_y0") - 14);
  penDown();
  moveTo(pdState("__pf_x0") + 14, pdState("__pf_y1") + 14);
  penUp();
  pfBorder(8, 4);
  pfBorder(2, 1);
}
export function pfRaster28Horizontal(): void {
  setPenSize(28);
  moveTo(pdState("__pf_x0") + 14, pdState("__pf_y0") - 14);
  penDown();
  moveTo(pdState("__pf_x1") - 14, pdState("__pf_y0") - 14);
  penUp();
  pfBorder(8, 4);
  pfBorder(2, 1);
}
