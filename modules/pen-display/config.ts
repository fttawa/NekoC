import { pdState, pdFloor, pdMin, pdMax } from "./state";

/** Configure pen/display state without allocating framebuffer lists. */
export function displayConfigure(cfgWidth: number, cfgHeight: number, cfgSize: number, cfgLeft: number, cfgTop: number, cfgFps: number): void {
  penUp();
  hide();
  clearDrawing();
  setVar("__pd_width", pdMax(1, pdFloor(cfgWidth)));
  setVar("__pd_height", pdMax(1, pdFloor(cfgHeight)));
  setVar("__pd_scale", pdMax(1, pdFloor(cfgSize)));
  setVar("__pd_left_stage", cfgLeft);
  setVar("__pd_top_stage", cfgTop);
  setVar("__pd_fps", pdMin(60, pdMax(1, cfgFps)));
  setVar("__pd_frames", 0);
  setVar("__pd_actual_fps", 0);
  setVar("__pd_deadline", 0);
  setVar("__pd_stats_time", timerValue());
  setVar("__pd_stats_frames", 0);
  setPenColor("#ffffff");
  setPenEffect("alpha", 0);
  timerStart();
}
