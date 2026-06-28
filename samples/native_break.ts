let count = 0;

onStart(() => {
  while (true) {
    count = count + 1;

    if (count > 3) {
      break;
    }

    console.log(count);
  }
});
