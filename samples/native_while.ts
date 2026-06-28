let count = 0;

onStart(() => {
  while (count < 3) {
    console.log(count);
    count = count + 1;
  }
});
