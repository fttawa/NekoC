import { pdState } from "./state";

/** Constant RGB888 -> native color field, with no runtime HSV conversion. */
export function displayUseConstantColor(constantRGB: number): void {
  setPenColor(constantRGB);
  setVar("__pf_last_color", constantRGB);
}

/** Prepare positive, in-bounds integer logical rectangle coordinates.
 * Follow with pfRaster, preferably in one shared zero-argument native procedure.
 */
export function displayRectBounds(dx: number, dy: number, dw: number, dh: number): void {
  setVar("__pf_x0", pdState("__pd_left_stage") + dx * pdState("__pd_scale"));
  setVar("__pf_y0", pdState("__pd_top_stage") - dy * pdState("__pd_scale"));
  setVar("__pf_x1", pdState("__pf_x0") + dw * pdState("__pd_scale"));
  setVar("__pf_y1", pdState("__pf_y0") - dh * pdState("__pd_scale"));
}
