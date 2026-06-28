function scoreBonus(score) {
  const doubled = score * 2;
  const shifted = doubled + 1;
  return shifted;
}

onStart(() => {
  let result = scoreBonus(10);
  console.log(result);
});
