import { displaySetRefreshRate } from "../modules/pen-display/display";
import { displayConfigure } from "../modules/pen-display/config";
import { displayFastInit } from "../modules/pen-display/fast";
import { rgb, pdState } from "../modules/pen-display/state";
import { displayUseConstantColor, displayRectBounds } from "../modules/pen-display/direct";
import { pfRaster } from "../modules/pen-display/raster";
import { pdFrameFinished } from "../modules/pen-display/stats";
import { pdPenRGB } from "../modules/pen-display/color";

// Single actor, 896x560 stage area. Static background is drawn once.
defineProc("raster rectangle", [], () => { pfRaster(); });
defineProc("print FPS", [], () => {
  // Bottom-right, above the moving pixel's bottom row. Erase the old stamp.
  displayUseConstantColor(rgb(8, 12, 24));
  displayRectBounds(24, 17, 8, 2);
  callProc("raster rectangle");
  displayUseConstantColor(rgb(220, 240, 255));
  penUp();
  moveTo(430, -224);
  setVar("fast_fps_tenths", floor(pdState("__pd_actual_fps") * 10 + 0.5));
  stampText(join("FPS: ", floor(pdState("fast_fps_tenths") / 10), ".", pdState("fast_fps_tenths") % 10), 24, "right");
  setVar("fast_fps_stamp_time", pdState("__pd_stats_time"));
});
function drawRectangle(x: number, y: number, w: number, h: number): void {
  displayRectBounds(x, y, w, h);
  callProc("raster rectangle");
}
onStart(() => {
  displayConfigure(32, 20, 28, -448, 280, 60);
  displayFastInit();
  warp(() => {
    displayUseConstantColor(rgb(8, 12, 24));
    drawRectangle(0, 0, 32, 20);
    for (let fastBand = 0; fastBand < 8; fastBand++) {
      setVar("__pf_last_color", rgb(fastBand * 36, 255 - fastBand * 36, 128));
      pdPenRGB(pdState("__pf_last_color"));
      drawRectangle(fastBand * 4, 0, 4, 6);
    }
    displayUseConstantColor(rgb(255, 90, 40));
    drawRectangle(0, 10, 6, 6);
    displayUseConstantColor(rgb(40, 220, 255));
    drawRectangle(0, 19, 1, 1);
    callProc("print FPS");
    pdFrameFinished();
    setVar("fast_x", 0);
    setVar("fast_dot", 0);
    setVar("fast_phase", 0);
  });
  forever(() => {
    // Scheduler divider, not a wall-clock Hz cap: browsers may run above 60Hz.
    // The visible timer updates every 50ms; statistics use >=1-second windows.
    setVar("fast_phase", pdState("fast_phase") + pdState("__pd_fps"));
    if (pdState("fast_phase") >= 60) {
    changeVar("fast_phase", -60);
    warp(() => {
      setVar("__pf_update_start", timerValue());
      // Only erase the trailing strip and paint the leading strip.
      if (pdState("fast_x") < 26) {
        displayUseConstantColor(rgb(8, 12, 24));
        drawRectangle(pdState("fast_x"), 10, 1, 6);
        displayUseConstantColor(rgb(255, 90, 40));
        drawRectangle(pdState("fast_x") + 6, 10, 1, 6);
        changeVar("fast_x", 1);
      } else {
        displayUseConstantColor(rgb(8, 12, 24));
        drawRectangle(26, 10, 6, 6);
        displayUseConstantColor(rgb(255, 90, 40));
        drawRectangle(0, 10, 6, 6);
        setVar("fast_x", 0);
      }
      displayUseConstantColor(rgb(8, 12, 24));
      drawRectangle(pdState("fast_dot"), 19, 1, 1);
      setVar("fast_dot", (pdState("fast_dot") + 1) % 32);
      displayUseConstantColor(rgb(40, 220, 255));
      drawRectangle(pdState("fast_dot"), 19, 1, 1);
      setVar("__pf_update_seconds", (timerValue() as number) - pdState("__pf_update_start"));
      pdFrameFinished();
      if (pdState("__pd_stats_time") !== pdState("fast_fps_stamp_time")) {
        callProc("print FPS");
      }
      setVar("__pf_total_seconds", (timerValue() as number) - pdState("__pf_update_start"));
    });
    }
  });
});
onKey("49", () => { displaySetRefreshRate(15); });
onKey("50", () => { displaySetRefreshRate(30); });
onKey("51", () => { displaySetRefreshRate(60); });
