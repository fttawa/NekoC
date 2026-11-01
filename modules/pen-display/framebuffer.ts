import { pdState, pdItem, pdFloor, pdMin, pdMax } from "./state";

/** Clear the back buffer; the visible image changes only at displayPresent(). */
export function displayClear(color: number): void {
  warp(() => {
    setVar("__pd_fill_color", color);
    for (let pdClearIndex = 1; pdClearIndex <= pdState("__pd_width") * pdState("__pd_height"); pdClearIndex++) {
      replaceListItem("__pd_back", "any", pdClearIndex, pdState("__pd_fill_color"));
    }
  });
}

/** Top-left origin, integer pixels; out-of-bounds writes are clipped. */
export function displayPixel(x: number, y: number, color: number): void {
  setVar("__pd_px", pdFloor(x));
  setVar("__pd_py", pdFloor(y));
  if (pdState("__pd_px") >= 0 && pdState("__pd_px") < pdState("__pd_width")
      && pdState("__pd_py") >= 0 && pdState("__pd_py") < pdState("__pd_height")) {
    replaceListItem("__pd_back", "any", pdState("__pd_py") * pdState("__pd_width") + pdState("__pd_px") + 1, color);
  }
}

// Caller must supply in-bounds coordinates for reads.
export function displayGetPixel(x: number, y: number): number {
  return pdItem("__pd_back", pdFloor(y) * pdState("__pd_width") + pdFloor(x) + 1);
}

/** Fill a clipped rectangle in the back buffer. */
export function displayFillRect(x: number, y: number, width: number, height: number, color: number): void {
  warp(() => {
    setVar("__pd_fill_color", color);
    setVar("__pd_left", pdMax(0, pdFloor(x)));
    setVar("__pd_top", pdMax(0, pdFloor(y)));
    setVar("__pd_right", pdMin(pdState("__pd_width"), pdFloor(x + width)));
    setVar("__pd_bottom", pdMin(pdState("__pd_height"), pdFloor(y + height)));
    for (let pdRectY = pdState("__pd_top"); pdRectY < pdState("__pd_bottom"); pdRectY++) {
      for (let pdRectX = pdState("__pd_left"); pdRectX < pdState("__pd_right"); pdRectX++) {
        replaceListItem("__pd_back", "any", pdRectY * pdState("__pd_width") + pdRectX + 1, pdState("__pd_fill_color"));
      }
    }
  });
}
