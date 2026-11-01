// Dropdown values verified against Kitten N's 0.27.4 project format.
export function mathFunctionCode(operation) {
  return ({ sqrt: "0", abs: "1", neg: "2", ln: "3", log: "4", exp: "5", pow10: "6" })[operation] ?? operation;
}

export function keyboardCode(key) {
  const aliases = {
    space: "32", " ": "32", enter: "13", escape: "27", esc: "27",
    arrowleft: "37", left: "37", arrowup: "38", up: "38",
    arrowright: "39", right: "39", arrowdown: "40", down: "40",
  };
  const alias = aliases[key.toLowerCase()];
  if (alias) return alias;
  if (/^[a-z]$/i.test(key)) return String(key.toUpperCase().charCodeAt(0));
  return key;
}

export function effectCode(effect) {
  const aliases = {
    color: "0", hue: "0", ghost: "1", transparency: "1", alpha: "1",
    brightness: "2", pixelate: "3", displacement: "4", mosaic: "4",
    twist: "5", whirl: "5", grey: "6", grayscale: "6",
  };
  return aliases[effect.toLowerCase()] ?? effect;
}
