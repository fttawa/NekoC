import { displayConfigure } from "../modules/pen-display/config";
import { pdFrameFinished } from "../modules/pen-display/stats";
import { pdState, pdItem, pdMin, pdMax } from "../modules/pen-display/state";
import { pfRaster } from "../modules/pen-display/raster";
import { pfBorder } from "../modules/pen-display/raster-border";
import { buildPlatonic } from "../modules/pen-display/platonic";
import { buildPlatonicFaces } from "../modules/pen-display/platonic-faces";

// The five convex regular polyhedra: 4, 6, 8, 12 and 20 faces.
// The model is rasterized onto a real, switchable logical pixel grid.
defineProc("poly rectangle", [], () => { warp(() => { pfRaster(); }); });
function rect(rx: number, ry: number, rw: number, rh: number): void {
  setVar("__pf_x0", rx);
  setVar("__pf_y0", ry);
  setVar("__pf_x1", rx + rw);
  setVar("__pf_y1", ry - rh);
  callProc("poly rectangle");
}
defineProc("poly reset", [], () => {
  setVar("poly_solid", 2);
  setVar("poly_yaw", 25);
  setVar("poly_pitch", 20);
  setVar("poly_speed", 25);
  setVar("poly_zoom", 100);
  setVar("poly_camera", 600);
  setVar("poly_auto", 1);
  setVar("poly_wireframe", 0);
  setVar("poly_mode", 4);
  setVar("poly_rebuild", 1);
  setVar("poly_configure", 1);
});
defineProc("poly configure", [], () => {
  warp(() => {
  setVar("poly_configured_mode", pdState("poly_mode"));
  setVar("poly_width", 64);
  setVar("poly_height", 40);
  setVar("poly_scale", 14);
  setVar("poly_border", 4);
  if (pdState("poly_configured_mode") === 1) {
    setVar("poly_width", 32); setVar("poly_height", 20); setVar("poly_scale", 28);
    setVar("poly_border", 8);
  }
  if (pdState("poly_configured_mode") === 3) {
    setVar("poly_width", 128); setVar("poly_height", 80); setVar("poly_scale", 7);
    setVar("poly_border", 2);
  }
  if (pdState("poly_configured_mode") === 4) {
    setVar("poly_width", 256); setVar("poly_height", 160); setVar("poly_scale", 3.5);
    setVar("poly_border", 1);
  }
  if (pdState("poly_configured_mode") === 5) {
    setVar("poly_width", 448); setVar("poly_height", 280); setVar("poly_scale", 2);
    setVar("poly_border", 0);
  }
  if (pdState("poly_configured_mode") === 6) {
    setVar("poly_width", 896); setVar("poly_height", 560); setVar("poly_scale", 1);
    setVar("poly_border", 0);
  }
  displayConfigure(pdState("poly_width"), pdState("poly_height"), pdState("poly_scale"), -448, 280, 60);
  setVar("poly_last_time", timerValue());
  setVar("poly_visible_edges", -1);
  setVar("poly_presented_mode", -1);
  setVar("poly_presented_solid", -1);
  setVar("poly_configure", 0);
  setPenColor("#080c18"); rect(-448, 280, 896, 560);
  deleteListItem("poly_active", "all", 1); deleteListItem("poly_next", "all", 1);
  // Sparse single-ink framebuffers: native list membership deduplicates only
  // occupied cells, rather than allocating width*height entries in two lists.
  setVar("poly_pixel_count", 0);
  setVar("poly_hud_time", -1);
  });
});
defineProc("poly build", [], () => {
  warp(() => {
  buildPlatonic();
  buildPlatonicFaces();
  setVar("poly_rebuild", 0);
  });
});
defineProc("poly project", [], () => {
  warp(() => {
  deleteListItem("poly_px", "all", 1); deleteListItem("poly_py", "all", 1);
  setVar("poly_cy", trig("cos", pdState("poly_yaw")));
  setVar("poly_sy", trig("sin", pdState("poly_yaw")));
  setVar("poly_cp", trig("cos", pdState("poly_pitch")));
  setVar("poly_sp", trig("sin", pdState("poly_pitch")));
  // Native trig is rounded to two decimals. Renormalize each pair so rotation
  // remains orthonormal and inverse-camera face tests match the projection.
  setVar("poly_yaw_norm", mathFunc("sqrt", pdState("poly_cy")*pdState("poly_cy")+pdState("poly_sy")*pdState("poly_sy")));
  setVar("poly_cy", pdState("poly_cy")/pdState("poly_yaw_norm"));
  setVar("poly_sy", pdState("poly_sy")/pdState("poly_yaw_norm"));
  setVar("poly_pitch_norm", mathFunc("sqrt", pdState("poly_cp")*pdState("poly_cp")+pdState("poly_sp")*pdState("poly_sp")));
  setVar("poly_cp", pdState("poly_cp")/pdState("poly_pitch_norm"));
  setVar("poly_sp", pdState("poly_sp")/pdState("poly_pitch_norm"));
  // Camera is (0,0,-distance), looking along +Z; nearer Z has larger scale.
  // Transform that point back into model space, then test outward planes.
  setVar("poly_eye_x", pdState("poly_camera")*pdState("poly_cp")*pdState("poly_sy"));
  setVar("poly_eye_y", 0-pdState("poly_camera")*pdState("poly_sp"));
  setVar("poly_eye_z", 0-pdState("poly_camera")*pdState("poly_cp")*pdState("poly_cy"));
  deleteListItem("poly_face_visible", "all", 1);
  for (let faceIndex = 1; faceIndex <= pdState("poly_faces"); faceIndex++) {
    setVar("poly_facing", pdItem("poly_fnx",faceIndex)*pdState("poly_eye_x")+pdItem("poly_fny",faceIndex)*pdState("poly_eye_y")+pdItem("poly_fnz",faceIndex)*pdState("poly_eye_z")-pdItem("poly_fh",faceIndex));
    if(pdState("poly_facing")>0.000001) appendList("poly_face_visible",1);
    else appendList("poly_face_visible",0);
  }
  for (let projectIndex = 1; projectIndex <= pdState("poly_vertex_count"); projectIndex++) {
    setVar("poly_x", pdItem("poly_vx", projectIndex));
    setVar("poly_y", pdItem("poly_vy", projectIndex));
    setVar("poly_z", pdItem("poly_vz", projectIndex));
    setVar("poly_tx", pdState("poly_x") * pdState("poly_cy") + pdState("poly_z") * pdState("poly_sy"));
    setVar("poly_tz", pdState("poly_z") * pdState("poly_cy") - pdState("poly_x") * pdState("poly_sy"));
    setVar("poly_ty", pdState("poly_y") * pdState("poly_cp") - pdState("poly_tz") * pdState("poly_sp"));
    setVar("poly_depth", pdState("poly_y") * pdState("poly_sp") + pdState("poly_tz") * pdState("poly_cp"));
    setVar("poly_perspective", pdState("poly_camera") / (pdState("poly_camera") + pdState("poly_depth")) * pdState("poly_zoom") / 100);
    // Model viewport is right of the parameter panel; logical-grid coordinates.
    appendList("poly_px", floor((130 + pdState("poly_tx") * pdState("poly_perspective") + 448) / pdState("poly_scale")));
    appendList("poly_py", floor((280 - (-20 + pdState("poly_ty") * pdState("poly_perspective"))) / pdState("poly_scale")));
  }
  });
});
defineProc("poly line", [], () => {
  warp(() => {
  setVar("poly_ax", pdItem("poly_px", pdState("poly_edge_a")));
  setVar("poly_ay", pdItem("poly_py", pdState("poly_edge_a")));
  setVar("poly_dx", pdItem("poly_px", pdState("poly_edge_b")) - pdState("poly_ax"));
  setVar("poly_dy", pdItem("poly_py", pdState("poly_edge_b")) - pdState("poly_ay"));
  setVar("poly_steps", pdMax(mathFunc("abs", pdState("poly_dx")) as number, mathFunc("abs", pdState("poly_dy")) as number));
  setVar("poly_steps", pdMax(1, pdState("poly_steps")));
  for (let lineStep = 0; lineStep <= pdState("poly_steps"); lineStep++) {
    setVar("poly_pixel_x", floor(pdState("poly_ax") + pdState("poly_dx") * lineStep / pdState("poly_steps") + 0.5));
    setVar("poly_pixel_y", floor(pdState("poly_ay") + pdState("poly_dy") * lineStep / pdState("poly_steps") + 0.5));
    // Clip to the model viewport, preserving HUD margins even at high zoom.
    if (pdState("poly_pixel_x") * pdState("poly_scale") >= 280 && pdState("poly_pixel_x") < pdState("poly_width") - 1 && pdState("poly_pixel_y") * pdState("poly_scale") >= 56 && pdState("poly_pixel_y") * pdState("poly_scale") < 476) {
      setVar("poly_address", pdState("poly_pixel_y") * pdState("poly_width") + pdState("poly_pixel_x") + 1);
      if (!listContains("poly_next", pdState("poly_address"))) {
        appendList("poly_next", pdState("poly_address"));
      }
    }
  }
  });
});
defineProc("poly present", [], () => {
  warp(() => {
    setVar("poly_redraw", 0);
    if ((listLength("poly_active") as number) !== (listLength("poly_next") as number)) setVar("poly_redraw", 1);
    setPenColor("#080c18");
    // Cover the entire old square, including its antialiased corners, with a
    // circumscribed dark disk. Redraw current pixels afterwards to repair any
    // neighbours touched by the wider erase brush, without blanking the model.
    setPenSize(pdState("poly_scale") * 1.4142135623730951 + 4);
    if ((listLength("poly_active") as number) > 0) {
    for (let dirtyIndex = 1; dirtyIndex <= (listLength("poly_active") as number); dirtyIndex++) {
      setVar("poly_address", pdItem("poly_active", dirtyIndex));
      if (!listContains("poly_next", pdState("poly_address"))) {
        setVar("poly_redraw", 1);
          setVar("poly_erase_x", -448 + ((pdState("poly_address") - 1) % pdState("poly_width") + 0.5) * pdState("poly_scale"));
          setVar("poly_erase_y", 280 - (floor((pdState("poly_address") - 1) / pdState("poly_width")) + 0.5) * pdState("poly_scale"));
          moveTo(pdState("poly_erase_x"), pdState("poly_erase_y"));
          penDown();
          moveTo(pdState("poly_erase_x"), pdState("poly_erase_y"));
          penUp();
      }
    }
    }
    if (pdState("poly_redraw") === 1 && (listLength("poly_next") as number) > 0) {
      setPenColor("#62e6ff");
      for (let drawIndex = 1; drawIndex <= (listLength("poly_next") as number); drawIndex++) {
        setVar("poly_address", pdItem("poly_next", drawIndex));
        setVar("__pf_x0", -448 + ((pdState("poly_address") - 1) % pdState("poly_width")) * pdState("poly_scale"));
        setVar("__pf_y0", 280 - floor((pdState("poly_address") - 1) / pdState("poly_width")) * pdState("poly_scale"));
        setVar("__pf_x1", pdState("__pf_x0") + pdState("poly_scale"));
        setVar("__pf_y1", pdState("__pf_y0") - pdState("poly_scale"));
        // Fixed-size pixel with no procedure call or inner border loop.
        setPenSize(pdState("poly_scale"));
        moveTo(pdState("__pf_x0") + pdState("poly_scale") / 2, pdState("__pf_y0") - pdState("poly_scale") / 2);
        penDown();
        moveTo(pdState("__pf_x0") + pdState("poly_scale") / 2, pdState("__pf_y0") - pdState("poly_scale") / 2);
        penUp();
        if (pdState("poly_border") > 2) pfBorder(pdState("poly_border"), pdState("poly_border") / 2);
        // A two-unit border would overshoot the one-unit maximum-resolution
        // cells. Small cells use only their centre dot (or a one-unit inset).
        if (pdState("poly_border") >= 2) pfBorder(2, 1);
        if (pdState("poly_border") === 1) pfBorder(1, 0.5);
      }
    }
    copyList("poly_next", "poly_active");
    setVar("poly_pixel_count", listLength("poly_active"));
  });
});
function label(lx: number, ly: number, text: NekoValue, size: number): void {
  penUp(); moveTo(lx, ly); stampText(text, size, "left");
}
defineProc("poly HUD", [], () => {
  warp(() => {
  setPenColor("#080c18"); rect(-448, 280, 280, 560); rect(-168, -210, 616, 70);
  setPenColor("#ecf5ff");
   label(-426, 244, getVar("poly_name"), 23);
  setPenColor("#62e6ff");
  label(-426, 204, join("Faces N: ", pdState("poly_faces")), 22);
  setPenColor("#b7c9df");
   label(-426, 172, join("Vertices: ", pdState("poly_vertex_count"), "   Edges: ", pdState("poly_edge_count")), 17);
  label(-426, 138, join("Grid: ", pdState("poly_width"), " x ", pdState("poly_height")), 21);
  label(-426, 104, join("Yaw: ", floor(pdState("poly_yaw")), "   Pitch: ", floor(pdState("poly_pitch"))), 18);
  label(-426, 72, join("Zoom: ", pdState("poly_zoom"), "%"), 18);
  label(-426, 40, join("Camera: ", pdState("poly_camera")), 18);
  label(-426, 8, join("Speed: ", pdState("poly_speed"), " deg/s"), 18);
  if (pdState("poly_auto") === 1) { label(-426, -24, "Rotation: AUTO", 18); }
  else { label(-426, -24, "Rotation: PAUSED", 18); }
  setPenColor("#7289a8");
   label(-426, -76, "Q/E  previous/next solid", 17);
  label(-426, -102, "Arrows  rotate", 17);
  label(-426, -128, "W/S  zoom    A/D  speed", 17);
   label(-426, -154, "Z/X perspective  H x-ray", 17);
   label(-426, -180, "1-6  grid (max 896x560)", 17);
  label(-426, -206, "Space  pause    R  reset", 17);
  setPenColor("#62e6ff");
   label(-426, -250, "REGULAR SOLIDS: 4 / 6 / 8 / 12 / 20", 16);
   if(pdState("poly_wireframe")===1) label(-130,-224,"X-RAY: ALL EDGES",12);
   else label(-130,-224,"HIDDEN EDGES REMOVED",12);
  setPenColor("#ecf5ff");
  penUp(); moveTo(426, -250);
  stampText(join("FPS: ", floor(pdState("__pd_actual_fps") * 10) / 10), 22, "right");
  });
});
onStart(() => {
  callProc("poly reset");
  forever(() => {
    warp(() => {
      if (pdState("poly_configure") === 1) callProc("poly configure");
      if (pdState("poly_rebuild") === 1) callProc("poly build");
      setVar("poly_now", timerValue());
      setVar("poly_dt", pdMin(1, pdMax(0, pdState("poly_now") - pdState("poly_last_time"))));
      setVar("poly_last_time", pdState("poly_now"));
      if (pdState("poly_auto") === 1) setVar("poly_yaw", pdState("poly_yaw") + pdState("poly_speed") * pdState("poly_dt"));
      setVar("poly_yaw", (pdState("poly_yaw") + 360) % 360);
      callProc("poly project");
      deleteListItem("poly_next", "all", 1);
      setVar("poly_drawn_edges", 0);
      for (let modelEdge = 1; modelEdge <= pdState("poly_edge_count"); modelEdge++) {
        setVar("poly_edge_face_a",pdItem("poly_efa",modelEdge));
        setVar("poly_edge_face_b",pdItem("poly_efb",modelEdge));
        if (pdState("poly_wireframe")===1 || pdItem("poly_face_visible",pdState("poly_edge_face_a"))===1 || pdItem("poly_face_visible",pdState("poly_edge_face_b"))===1) {
          changeVar("poly_drawn_edges",1);
          setVar("poly_edge_a", pdItem("poly_ea", modelEdge));
          setVar("poly_edge_b", pdItem("poly_eb", modelEdge));
          callProc("poly line");
        }
      }
      callProc("poly present");
      setVar("poly_visible_edges",pdState("poly_drawn_edges"));
      // A key release can queue a new mode while this slow frame is drawing.
      // Report the configured grid, not the pending control value.
      setVar("poly_presented_mode", pdState("poly_configured_mode"));
      setVar("poly_presented_solid", pdState("poly_built_solid"));
      if (pdState("poly_now") - pdState("poly_hud_time") >= 0.2) {
        callProc("poly HUD");
        setVar("poly_hud_time", pdState("poly_now"));
      }
      pdFrameFinished();
    });
  });
});
// Key handlers mutate only control state; geometry is rebuilt at a frame boundary.
// Discrete actions use release events: native key-down handlers repeat while held.
onKey("81", "up", () => { setVar("poly_solid", pdMax(1, pdState("poly_solid") - 1)); setVar("poly_rebuild", 1); });
onKey("69", "up", () => { setVar("poly_solid", pdMin(5, pdState("poly_solid") + 1)); setVar("poly_rebuild", 1); });
onKey("37", () => { changeVar("poly_yaw", -10); });
onKey("39", () => { changeVar("poly_yaw", 10); });
onKey("38", () => { setVar("poly_pitch", pdMin(80, pdState("poly_pitch") + 10)); });
onKey("40", () => { setVar("poly_pitch", pdMax(-80, pdState("poly_pitch") - 10)); });
onKey("87", () => { setVar("poly_zoom", pdMin(130, pdState("poly_zoom") + 10)); });
onKey("83", () => { setVar("poly_zoom", pdMax(40, pdState("poly_zoom") - 10)); });
onKey("65", () => { setVar("poly_speed", pdMax(0, pdState("poly_speed") - 5)); });
onKey("68", () => { setVar("poly_speed", pdMin(90, pdState("poly_speed") + 5)); });
onKey("90", () => { setVar("poly_camera", pdMax(450, pdState("poly_camera") - 50)); });
onKey("88", () => { setVar("poly_camera", pdMin(1200, pdState("poly_camera") + 50)); });
onKey("32", "up", () => { setVar("poly_auto", 1 - pdState("poly_auto")); });
onKey("72", "up", () => {
  setVar("poly_wireframe", 1 - pdState("poly_wireframe"));
});
onKey("49", "up", () => { setVar("poly_mode", 1); setVar("poly_configure", 1); });
onKey("50", "up", () => { setVar("poly_mode", 2); setVar("poly_configure", 1); });
onKey("51", "up", () => { setVar("poly_mode", 3); setVar("poly_configure", 1); });
onKey("52", "up", () => { setVar("poly_mode", 4); setVar("poly_configure", 1); });
onKey("53", "up", () => { setVar("poly_mode", 5); setVar("poly_configure", 1); });
onKey("54", "up", () => { setVar("poly_mode", 6); setVar("poly_configure", 1); });
onKey("82", "up", () => { callProc("poly reset"); });
