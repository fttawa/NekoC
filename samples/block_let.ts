onStart(() => {
  let total = 0;

  for (let i = 0; i < 3; i = i + 1) {
    total = total + i;
  }

  console.log(total);
});
