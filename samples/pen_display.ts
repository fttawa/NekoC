import { displayInit, displayPresent, displayWaitFrame, displaySetRefreshRate } from "../modules/pen-display/display";
import { displayClear, displayFillRect, displayPixel } from "../modules/pen-display/framebuffer";
import { rgb, pdState } from "../modules/pen-display/state";

// Change these values to try 32x18, 64x36 or 128x72 at 15/30/60 target Hz.
// Keep width*pixelSize <= 900 and height*pixelSize <= 562 for the bundled template.
onStart(() => {
  displayInit(32, 18, 12, -192, 108, 30);
  setVar("demo_frame", 0);
  forever(() => {
    displayWaitFrame();
    warp(() => {
      displayClear(rgb(8, 12, 24));
      for (let demoBand = 0; demoBand < 8; demoBand++) {
        displayFillRect(demoBand * 4, 0, 4, 5, rgb(demoBand * 36, 255 - demoBand * 36, 128));
      }
      displayFillRect(pdState("demo_frame") % 26, 8, 6, 6, rgb(255, 90, 40));
      displayPixel(pdState("demo_frame") % 32, 17, rgb(40, 220, 255));
      displayPresent();
    });
    changeVar("demo_frame", 1);
  });
});

onKey("49", () => { displaySetRefreshRate(15); });
onKey("50", () => { displaySetRefreshRate(30); });
onKey("51", () => { displaySetRefreshRate(60); });
