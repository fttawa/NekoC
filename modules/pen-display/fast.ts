import { pdState, pdFloor, pdNow, pdMin, pdMax, pdItem } from "./state";
import { pfPaint } from "./paint";
import { pdFrameFinished } from "./stats";

/** Command-buffer backend. Use after displayInit; do not mix with framebuffer presenters. */
export function displayFastInit(): void {
  warp(() => {
    deleteListItem("__pf_commands", "all", 1);
    setVar("__pf_last_color", -1);
    penUp();
  });
}

/** Queue a clipped, opaque RGB rectangle. Rectangle order is preserved. */
export function displayQueueRect(x: number, y: number, width: number, height: number, color: number): void {
  setVar("__pf_left", pdMax(0, pdFloor(x)));
  setVar("__pf_top", pdMax(0, pdFloor(y)));
  setVar("__pf_right", pdMin(pdState("__pd_width"), pdFloor(x + width)));
  setVar("__pf_bottom", pdMin(pdState("__pd_height"), pdFloor(y + height)));
  if (pdState("__pf_right") > pdState("__pf_left") && pdState("__pf_bottom") > pdState("__pf_top")) {
    appendList("__pf_commands", pdState("__pf_left"));
    appendList("__pf_commands", pdState("__pf_top"));
    appendList("__pf_commands", pdState("__pf_right"));
    appendList("__pf_commands", pdState("__pf_bottom"));
    appendList("__pf_commands", color);
  }
}

/** Rasterize queued areas with a capsule and nested inset borders. */
export function displayPresentFast(): void {
  warp(() => {
    setVar("__pd_runs", 0);
    // Native range loops may traverse descending bounds; guard the empty queue.
    if ((listLength("__pf_commands") as number) > 0) {
      for (let pfCommand = 1; pfCommand <= (listLength("__pf_commands") as number); pfCommand += 5) {
        setVar("__pf_x0", pdState("__pd_left_stage") + pdItem("__pf_commands", pfCommand) * pdState("__pd_scale"));
        setVar("__pf_y0", pdState("__pd_top_stage") - pdItem("__pf_commands", pfCommand + 1) * pdState("__pd_scale"));
        setVar("__pf_x1", pdState("__pd_left_stage") + pdItem("__pf_commands", pfCommand + 2) * pdState("__pd_scale"));
        setVar("__pf_y1", pdState("__pd_top_stage") - pdItem("__pf_commands", pfCommand + 3) * pdState("__pd_scale"));
        setVar("__pf_color", pdItem("__pf_commands", pfCommand + 4));
        pfPaint();
      }
    }
    deleteListItem("__pf_commands", "all", 1);
    pdFrameFinished();
  });
}
