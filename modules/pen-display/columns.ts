import { pdState, pdItem, pdFloor, pdNow } from "./state";
import { pdFrameFinished } from "./stats";

/** Called by the controller, outside warp. The broadcast is a frame barrier. */
export function displayPresentColumns(): void {
  broadcastAndWait("__pd_render_columns");
  pdFrameFinished();
}

/** One actor owns one column. Scratch variable names MUST be unique per actor.
 * tools/pen-display-columns.mjs supplies these names at build time.
 * Never call the single-actor pdPenRGB here: its scratch variables are shared.
 */
export function displayRenderColumn(column: number, cy: string, ce: string, cc: string,
    cr: string, cg: string, cb: string, cmax: string, cmin: string,
    cd: string, ch: string, cs: string, extend: string): void {
  if (column < pdState("__pd_width")) {
    warp(() => {
      hide();
      penUp();
      setPenSize(1);
      setPenEffect("alpha", 0);
      setVar(cy, 0);
      while (pdState(cy) < pdState("__pd_height")) {
        setVar(cc, pdItem("__pd_back", pdState(cy) * pdState("__pd_width") + column + 1));
        if (pdState(cc) !== pdItem("__pd_front", pdState(cy) * pdState("__pd_width") + column + 1)) {
          setVar(ce, pdState(cy) + 1);
          setVar(extend, 1);
          while (pdState(ce) < pdState("__pd_height") && pdState(extend) === 1) {
            if (pdItem("__pd_back", pdState(ce) * pdState("__pd_width") + column + 1) === pdState(cc)) {
              changeVar(ce, 1);
            } else {
              setVar(extend, 0);
            }
          }
          setVar(cr, pdFloor(pdState(cc) / 65536) % 256);
          setVar(cg, pdFloor(pdState(cc) / 256) % 256);
          setVar(cb, pdState(cc) % 256);
          setVar(cmax, pdState(cr));
          setVar(cmin, pdState(cr));
          if (pdState(cg) > pdState(cmax)) setVar(cmax, pdState(cg));
          if (pdState(cb) > pdState(cmax)) setVar(cmax, pdState(cb));
          if (pdState(cg) < pdState(cmin)) setVar(cmin, pdState(cg));
          if (pdState(cb) < pdState(cmin)) setVar(cmin, pdState(cb));
          setVar(cd, pdState(cmax) - pdState(cmin));
          setVar(ch, 0);
          setVar(cs, 0);
          if (pdState(cd) > 0) {
            setVar(cs, 100 * pdState(cd) / pdState(cmax));
            if (pdState(cmax) === pdState(cr)) {
              setVar(ch, 60 * (pdState(cg) - pdState(cb)) / pdState(cd));
            } else if (pdState(cmax) === pdState(cg)) {
              setVar(ch, 120 + 60 * (pdState(cb) - pdState(cr)) / pdState(cd));
            } else {
              setVar(ch, 240 + 60 * (pdState(cr) - pdState(cg)) / pdState(cd));
            }
            if (pdState(ch) < 0) changeVar(ch, 360);
          }
          // The native brush stores HSL: setting HSV saturation while still
          // black loses it. Establish nonblack brightness before H/S.
          setPenEffect("brightness", pdState(cmax) * 100 / 255);
          setPenEffect("hue", pdState(ch));
          setPenEffect("saturation", pdState(cs));
          // Vertical runs: one actor never writes another column's cache entries.
          for (let pcSubX = 0; pcSubX < pdState("__pd_scale"); pcSubX++) {
            penUp();
            moveTo(pdState("__pd_left_stage") + column * pdState("__pd_scale") + pcSubX + 0.5,
              pdState("__pd_top_stage") - pdState(cy) * pdState("__pd_scale"));
            penDown();
            moveTo(pdState("__pd_left_stage") + column * pdState("__pd_scale") + pcSubX + 0.5,
              pdState("__pd_top_stage") - pdState(ce) * pdState("__pd_scale"));
            penUp();
          }
          for (let pcCommitY = pdState(cy); pcCommitY < pdState(ce); pcCommitY++) {
            replaceListItem("__pd_front", "any", pcCommitY * pdState("__pd_width") + column + 1, pdState(cc));
          }
          setVar(cy, pdState(ce));
        } else {
          changeVar(cy, 1);
        }
      }
    });
  }
}
