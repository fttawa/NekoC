onStart(() => {
  setVar("decimal", 13);
  setVar("binary", "");
  repeatUntil(eq(getVar("decimal"), 0), () => {
    setVar("remainder", mod(getVar("decimal"), 2));
    setVar("binary", join(toString(getVar("remainder")), getVar("binary")));
    setVar("decimal", floor(div(getVar("decimal"), 2)));
  });
});
