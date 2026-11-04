// 覆盖列表写入的边界：越界追加、0 和负数下标、NaN、小数下标、覆盖文本、写入非数字。
onStart(() => { warp(() => {
  appendList("l", "文本");
  appendList("l", 2);
  setVar("box", 7);
  for (let i = 0; i < 2000; i++) {
    replaceListItem("l", "any", i % 5 + 1, i);
    replaceListItem("l", "any", 0, i + 1);
    replaceListItem("l", "any", -3, i + 2);
    replaceListItem("l", "any", 2.5, i + 3);
    replaceListItem("l", "any", 0 / 0 + 1, i + 4);
    replaceListItem("l", "any", (i % 3) + 1, getVar("box") as number);
    if (i === 1000) setVar("box", "文字");
    if (i === 1500) setVar("box", 9);
    appendList("m", i * 2);
    appendList("m", getVar("box") as number);
  }
  for (let i = 0; i < 2000; i++) {
    replaceListItem("l", "any", i % 4 + 1, listItem("m", "any", i + 1));
    replaceListItem("m", "any", i + 1, listItem("l", "any", i % 7 + 1));
    replaceListItem("m", "any", i + 2, listItem("l", "any", 0 / 0 + 1));
  }
  setVar("sum", 0);
  for (let i = 1; i <= 4000; i++) changeVar("sum", listItem("m", "any", i) as number);
  setVar("first", listItem("l", "any", 1));
  setVar("len", listLength("l"));
}); });
