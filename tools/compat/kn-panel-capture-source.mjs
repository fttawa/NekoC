// 官方源码只读定位器；第三方字节只保存在 dist。
import fs from "node:fs/promises";
const source = await fs.readFile("dist/kn-panel-capture/main.8ccf2442.js", "utf8");
for (const anchor of process.argv.slice(2)) {
  let index = -1, count = 0;
  while ((index = source.indexOf(anchor, index + 1)) >= 0 && count++ < 12) {
    console.log(`\n${anchor} @ ${Buffer.byteLength(source.slice(0, index))}\n${source.slice(Math.max(0, index - 180), index + 3000)}`);
  }
}
