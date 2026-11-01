import { pdState, pdMin, pdMax, pdFloor } from "./state";
import { pfRaster28Vertical, pfRaster28Horizontal } from "./raster28";
import { pfBorder } from "./raster-border";

/** Internal stage-space rectangle using the current pen color. */
export function pfRaster(): void {
  if (pdState("__pf_x1") - pdState("__pf_x0") === 28 && pdState("__pf_y0") - pdState("__pf_y1") >= 28) {
    pfRaster28Vertical();
  } else if (pdState("__pf_y0") - pdState("__pf_y1") === 28 && pdState("__pf_x1") - pdState("__pf_x0") >= 28) {
    pfRaster28Horizontal();
  } else {
    setVar("__pf_brush", pdMin(pdState("__pf_x1") - pdState("__pf_x0"), pdState("__pf_y0") - pdState("__pf_y1")));
    // A capsule spans the long axis. Each inset border fills the previous
    // rounded corner gaps; quarter-size widths overlap until a 2-unit edge.
    setPenSize(pdState("__pf_brush"));
    moveTo(pdState("__pf_x0") + pdState("__pf_brush") / 2, pdState("__pf_y0") - pdState("__pf_brush") / 2);
    penDown();
    moveTo(pdState("__pf_x1") - pdState("__pf_brush") / 2, pdState("__pf_y1") + pdState("__pf_brush") / 2);
    penUp();
    while (pdState("__pf_brush") > 2) {
      setVar("__pf_brush", pdMax(2, pdFloor(pdState("__pf_brush") / 4)));
      pfBorder(pdState("__pf_brush"), pdState("__pf_brush") / 2);
    }
  }
  changeVar("__pd_runs", 1);
}
