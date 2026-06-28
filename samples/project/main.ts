import { double, greet } from "./lib/math";

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(21));
});
