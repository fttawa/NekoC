import { pdState, pdNow } from "./state";

/** Average completed frames over >=1 second, tolerating the native 50ms timer. */
export function pdFrameFinished(): void {
  changeVar("__pd_frames", 1);
  setVar("__pd_finished", pdNow());
  if (pdState("__pd_finished") < pdState("__pd_stats_time")) {
    setVar("__pd_stats_time", pdState("__pd_finished"));
    setVar("__pd_stats_frames", pdState("__pd_frames"));
  }
  if (pdState("__pd_finished") - pdState("__pd_stats_time") >= 1) {
    setVar("__pd_actual_fps", (pdState("__pd_frames") - pdState("__pd_stats_frames")) / (pdState("__pd_finished") - pdState("__pd_stats_time")));
    setVar("__pd_stats_time", pdState("__pd_finished"));
    setVar("__pd_stats_frames", pdState("__pd_frames"));
  }
}
