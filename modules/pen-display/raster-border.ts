import { pdState } from "./state";

/** Closed inset perimeter. Round joins stay inside the requested rectangle. */
export function pfBorder(borderSize: number, borderInset: number): void {
  setPenSize(borderSize);
  moveTo(pdState("__pf_x0") + borderInset, pdState("__pf_y0") - borderInset);
  penDown();
  moveTo(pdState("__pf_x1") - borderInset, pdState("__pf_y0") - borderInset);
  moveTo(pdState("__pf_x1") - borderInset, pdState("__pf_y1") + borderInset);
  moveTo(pdState("__pf_x0") + borderInset, pdState("__pf_y1") + borderInset);
  moveTo(pdState("__pf_x0") + borderInset, pdState("__pf_y0") - borderInset);
  penUp();
}
