let score = 0;

onStart(() => {
  score = score + 1;

  if (score > 10) {
    console.log("win");
  } else {
    console.log("keep going");
  }
});
