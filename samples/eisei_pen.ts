// Native text stamps, random-access row dictionary, dirty-row redraw.
defineProc("pen PV status", [], () => {
  clearDrawing(); penUp(); setPenColor("#c6ecff");
  moveTo(0,70); stampText("衛星 / PEN ASCII",32,"center");
  moveTo(0,10); stampText(getVar("ep_message"),20,"center");
  moveTo(0,-60); stampText("音乐：柿崎ユウタ · Enter 播放 / Q 停止",18,"center");
});
defineProc("pen PV reset rows", [], () => {
  deleteListItem("ep_previous","all",1);
  for(let r=1;r<=(getVar("ep_row_count") as number);r++) appendList("ep_previous",0);
  setVar("ep_last_color",-1);
});
defineProc("pen PV frame", [], () => { warp(() => {
  setVar("ep_row_base",((getVar("pv_target") as number)-1)*(getVar("ep_row_count") as number));
  for(let row=1;row<=(getVar("ep_row_count") as number);row++) {
    setVar("ep_row_id",listItem("ep_rows","any",(getVar("ep_row_base") as number)+row));
    if ((getVar("ep_row_id") as number)!==(listItem("ep_previous","any",row) as number)) {
      setVar("ep_y",(getVar("ep_height") as number)/2-row*20+10);
      // One horizontal capsule: round ends lie outside the visible stage.
      setPenColor("#060616"); setPenSize(20);
      moveTo(-(getVar("ep_width") as number)/2-12,getVar("ep_y"));penDown();
      moveTo((getVar("ep_width") as number)/2+12,getVar("ep_y"));penUp();
      setVar("ep_last_color",-1);
      setVar("ep_first",listItem("ep_first","any",getVar("ep_row_id")));
      setVar("ep_count",listItem("ep_count","any",getVar("ep_row_id")));
      if ((getVar("ep_count") as number)>0) {
        for(let cmd=(getVar("ep_first") as number);cmd<(getVar("ep_first") as number)+(getVar("ep_count") as number);cmd++) {
          setVar("ep_color",listItem("ep_color","any",cmd));
          if ((getVar("ep_color") as number)!==(getVar("ep_last_color") as number)) {
            setPenEffect("hue",listItem("ep_h","any",getVar("ep_color")));
            setPenEffect("saturation",listItem("ep_s","any",getVar("ep_color")));
            setPenEffect("brightness",listItem("ep_v","any",getVar("ep_color")));
            setVar("ep_last_color",getVar("ep_color"));
          }
          moveTo(listItem("ep_x","any",cmd),getVar("ep_y"));
          stampText(listItem("ep_text","any",cmd),listItem("ep_size","any",cmd),"center");
          changeVar("ep_stamps",1);
        }
      }
      replaceListItem("ep_previous","any",row,getVar("ep_row_id"));
    }
  }
  setVar("pv_frame",getVar("pv_target"));
  changeVar("ep_drawn",1);
}); });
onStart(()=>{
  hide();hideTimer();penUp(); stopAudio("eisei-song");
  setVar("pv_state",0);setVar("ep_row_count",0); // BUILD_ROWS
  setVar("pv_fps",0); // BUILD_FPS
  setVar("pv_frames",0); // BUILD_FRAMES
  setVar("pv_duration",0); // BUILD_DURATION
  setVar("ep_width",0); // BUILD_WIDTH
  setVar("ep_height",0); // BUILD_HEIGHT
  setVar("ep_message","初始化：建立字符行缓存…");callProc("pen PV status");
  callProc("pen PV reset rows");
  setVar("pv_progress",50);
  setVar("ep_message","初始化 50% · 预热音乐…");callProc("pen PV status");
  playAudio("eisei-song");wait(2);stopAudio("eisei-song");
  setVar("pv_progress",100);setVar("pv_state",1);setVar("pv_frame",0);
  setVar("ep_message","初始化 100% · 按 Enter 开始");callProc("pen PV status");
  forever(()=>{
    if ((getVar("pv_state") as number)===2) {
      setVar("pv_time",(timerValue() as number)-(getVar("pv_origin") as number)-3);
      if ((getVar("pv_time") as number)>=0) {
        setVar("pv_target",floor((getVar("pv_time") as number)*(getVar("pv_fps") as number))+1);
        if ((getVar("pv_target") as number)<=(getVar("pv_frames") as number)) {
          if ((getVar("pv_target") as number)!==(getVar("pv_frame") as number)) {
            if ((getVar("pv_frame") as number)===0) clearDrawing();
            callProc("pen PV frame");
          }
        } else {
          stopAudio("eisei-song");setVar("pv_state",3);
          setVar("ep_message","播放结束 · Enter 重播");callProc("pen PV status");
        }
      }
    }
  });
});
onKey("13",()=>{warp(()=>{
  if ((getVar("pv_state") as number)%2===1) {
    callProc("pen PV reset rows");setVar("pv_frame",0);setVar("pv_time",-3);
    setVar("ep_drawn",0);setVar("ep_stamps",0);
    setVar("ep_message","即将开始…");callProc("pen PV status");
    timerStart();setVar("pv_origin",timerValue());playAudio("eisei-song");setVar("pv_state",2);
  }
});});
onKey("81",()=>{warp(()=>{
  if ((getVar("pv_state") as number)===2) {
    stopAudio("eisei-song");setVar("pv_state",1);
    setVar("ep_message","已停止 · Enter 从头播放");callProc("pen PV status");
  }
});});
