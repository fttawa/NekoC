import { pdState, pdItem, pdFloor, pdNow, pdMin, pdMax } from "./state";
import { pdPenRGB } from "./color";
import { displayConfigure } from "./config";
import { pdFrameFinished } from "./stats";

/** Configure dimensions independently of the on-stage pixel size. Reinitializes buffers. */
export function displayInit(width: number, height: number, pixelSize: number, left: number, top: number, fps: number): void {
  displayConfigure(width, height, pixelSize, left, top, fps);
  warp(() => {
    // Explicit indices preserve connections when loaded into the official editor.
    while ((listLength("__pd_back") as number) > 0) deleteListItem("__pd_back", "any", listLength("__pd_back"));
    while ((listLength("__pd_front") as number) > 0) deleteListItem("__pd_front", "any", listLength("__pd_front"));
    for (let pdInitIndex = 0; pdInitIndex < pdState("__pd_width") * pdState("__pd_height"); pdInitIndex++) {
      appendList("__pd_back", 0);
      appendList("__pd_front", -1);
    }
  });
}

export function displaySetRefreshRate(fps: number): void {
  setVar("__pd_fps", pdMin(60, pdMax(1, fps)));
  setVar("__pd_deadline", pdNow());
}

/** Deadline-based pacing. Over-budget frames rebase rather than queue catch-up frames. */
export function displayWaitFrame(): void {
  setVar("__pd_wait", pdState("__pd_deadline") - pdNow());
  if (pdState("__pd_wait") > 0) wait(pdState("__pd_wait"));
  setVar("__pd_deadline", pdNow() + 1 / pdState("__pd_fps"));
}

/** Paint changed horizontal runs. Front buffer records the image already drawn. */
export function displayPresent(): void {
  setVar("__pd_changed", 0);
  setVar("__pd_runs", 0);
  warp(() => {
    for (let pdScanY = 0; pdScanY < pdState("__pd_height"); pdScanY++) {
      setVar("__pd_scan_x", 0);
      while (pdState("__pd_scan_x") < pdState("__pd_width")) {
        setVar("__pd_index", pdScanY * pdState("__pd_width") + pdState("__pd_scan_x") + 1);
        setVar("__pd_color", pdItem("__pd_back", pdState("__pd_index")));
        if (pdState("__pd_color") !== pdItem("__pd_front", pdState("__pd_index"))) {
          setVar("__pd_run_start", pdState("__pd_scan_x"));
          setVar("__pd_run_end", pdState("__pd_scan_x") + 1);
          setVar("__pd_extend", 1);
          while (pdState("__pd_run_end") < pdState("__pd_width") && pdState("__pd_extend") === 1) {
            if (pdItem("__pd_back", pdScanY * pdState("__pd_width") + pdState("__pd_run_end") + 1) === pdState("__pd_color")) {
              changeVar("__pd_run_end", 1);
            } else {
              setVar("__pd_extend", 0);
            }
          }
          pdPenRGB(pdState("__pd_color"));
          // Full-cell scanlines overwrite old edge antialiasing on subsequent frames.
          setPenSize(1);
          for (let pdSubY = 0; pdSubY < pdState("__pd_scale"); pdSubY++) {
            penUp();
            moveTo(pdState("__pd_left_stage") + pdState("__pd_run_start") * pdState("__pd_scale"),
              pdState("__pd_top_stage") - pdScanY * pdState("__pd_scale") - pdSubY - 0.5);
            penDown();
            moveTo(pdState("__pd_left_stage") + pdState("__pd_run_end") * pdState("__pd_scale"),
              pdState("__pd_top_stage") - pdScanY * pdState("__pd_scale") - pdSubY - 0.5);
            penUp();
          }
          for (let pdCommitX = pdState("__pd_run_start"); pdCommitX < pdState("__pd_run_end"); pdCommitX++) {
            replaceListItem("__pd_front", "any", pdScanY * pdState("__pd_width") + pdCommitX + 1, pdState("__pd_color"));
          }
          setVar("__pd_changed", pdState("__pd_changed") + pdState("__pd_run_end") - pdState("__pd_run_start"));
          changeVar("__pd_runs", 1);
          setVar("__pd_scan_x", pdState("__pd_run_end"));
        } else {
          changeVar("__pd_scan_x", 1);
        }
      }
    }
  });
  pdFrameFinished();
}
