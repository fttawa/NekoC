function greet(name) {
  consoleLog(join("hi ", name));
}

function double(x) {
  return mul(x, 2);
}

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(21));
});
