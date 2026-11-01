// Native costume/audio player. tools/build-eisei-pv.py supplies embedded assets.
// State: 0 preparing, 1 ready, 2 playing, 3 ended.
defineProc("PV status", [], () => {
  clearDrawing();
  penUp();
  setPenColor("#e9f5ff");
  moveTo(0, 90);
  stampText("衛星 / ASCII PV", 42, "center");
  moveTo(0, 20);
  stampText(getVar("pv_message"), 24, "center");
  moveTo(0, -65);
  setPenColor("#51d9ec");
  stampText("音乐・作词・作曲：柿崎ユウタ", 20, "center");
  moveTo(0, -105);
  stampText("Kitten N · NekoC 原生积木移植", 18, "center");
  moveTo(0, 0);
});
onStart(() => {
  hide();
  hideTimer();
  stopAudio("eisei-song");
  setVar("pv_state", 0);
  setVar("pv_fps", 10); // BUILD_FPS
  setVar("pv_frames", 1435); // BUILD_FRAMES
  setVar("pv_duration", 143.5); // BUILD_DURATION
  setVar("pv_frame", 0);
  setVar("pv_progress", 0);
  setVar("pv_message", "初始化：正在准备造型索引…");
  callProc("PV status");
  // The editor loads images before starting scripts. Visit the native style
  // indices in bounded batches; the displayed percentage counts these visits.
  for (let frame = 1; frame <= (getVar("pv_frames") as number); frame++) {
    setStyle(frame);
    if (frame % 50 === 0) {
      setVar("pv_progress", floor(frame * 100 / (getVar("pv_frames") as number)));
      setVar("pv_message", join("准备造型索引：", getVar("pv_progress"), "%"));
      callProc("PV status");
      wait(0);
    }
  }
  setStyle(1);
  setVar("pv_progress", 100);
  // The soundtrack has a 3-second silent prefix. Warm its native audio cache
  // while the initialization screen is visible, then stop before the music.
  setVar("pv_message", "初始化：准备音频…");
  callProc("PV status");
  playAudio("eisei-song");
  wait(2);
  stopAudio("eisei-song");
  setVar("pv_state", 1);
  setVar("pv_message", "准备完成 · 按 Enter 开始");
  callProc("PV status");
  forever(() => {
    if ((getVar("pv_state") as number) === 2) {
      setVar("pv_time", (timerValue() as number) - (getVar("pv_origin") as number) - 3);
      if ((getVar("pv_time") as number) >= 0) {
        clearDrawing();
        show();
        setVar("pv_target", floor((getVar("pv_time") as number) * (getVar("pv_fps") as number)) + 1);
        if ((getVar("pv_target") as number) <= (getVar("pv_frames") as number)) {
          if ((getVar("pv_target") as number) !== (getVar("pv_frame") as number)) {
            setStyle(getVar("pv_target"));
            setVar("pv_frame", getVar("pv_target"));
          }
        }
        if ((getVar("pv_time") as number) >= (getVar("pv_duration") as number)) {
          stopAudio("eisei-song");
          hide();
          setVar("pv_state", 3);
          setVar("pv_message", "播放结束 · 按 Enter 重播");
          callProc("PV status");
        }
      }
    }
  });
});
onKey("13", () => {
  warp(() => {
  if ((getVar("pv_state") as number) % 2 === 1) {
    hide();
    setStyle(1);
    setVar("pv_frame", 0);
    setVar("pv_time", -3);
    setVar("pv_message", "即将开始…");
    callProc("PV status");
    timerStart();
    setVar("pv_origin", timerValue());
    playAudio("eisei-song");
    setVar("pv_state", 2);
  }
  });
});
onKey("81", () => {
  warp(() => {
  if ((getVar("pv_state") as number) === 2) {
    stopAudio("eisei-song");
    hide();
    setVar("pv_state", 1);
    setVar("pv_message", "已停止 · 按 Enter 从头播放");
    callProc("PV status");
  }
  });
});
