import { pdState, pdFloor } from "./state";

// Dynamic RGB888 -> native HSV pen properties. Hue is in degrees, S/V in %.
export function pdPenRGB(packed: number): void {
  setVar("__pd_r", pdFloor(packed / 65536) % 256);
  setVar("__pd_g", pdFloor(packed / 256) % 256);
  setVar("__pd_b", packed % 256);
  setVar("__pd_max", pdState("__pd_r"));
  setVar("__pd_min", pdState("__pd_r"));
  if (pdState("__pd_g") > pdState("__pd_max")) setVar("__pd_max", pdState("__pd_g"));
  if (pdState("__pd_b") > pdState("__pd_max")) setVar("__pd_max", pdState("__pd_b"));
  if (pdState("__pd_g") < pdState("__pd_min")) setVar("__pd_min", pdState("__pd_g"));
  if (pdState("__pd_b") < pdState("__pd_min")) setVar("__pd_min", pdState("__pd_b"));
  setVar("__pd_delta", pdState("__pd_max") - pdState("__pd_min"));
  setVar("__pd_hue", 0);
  setVar("__pd_sat", 0);
  if (pdState("__pd_delta") > 0) {
    setVar("__pd_sat", 100 * pdState("__pd_delta") / pdState("__pd_max"));
    if (pdState("__pd_max") === pdState("__pd_r")) {
      setVar("__pd_hue", 60 * (pdState("__pd_g") - pdState("__pd_b")) / pdState("__pd_delta"));
    } else if (pdState("__pd_max") === pdState("__pd_g")) {
      setVar("__pd_hue", 120 + 60 * (pdState("__pd_b") - pdState("__pd_r")) / pdState("__pd_delta"));
    } else {
      setVar("__pd_hue", 240 + 60 * (pdState("__pd_r") - pdState("__pd_g")) / pdState("__pd_delta"));
    }
    if (pdState("__pd_hue") < 0) changeVar("__pd_hue", 360);
  }
  setPenEffect("hue", pdState("__pd_hue"));
  setPenEffect("saturation", pdState("__pd_sat"));
  setPenEffect("brightness", pdState("__pd_max") * 100 / 255);
}
