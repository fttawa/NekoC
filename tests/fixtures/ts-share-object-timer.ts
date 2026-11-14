const state = { value: 0, nested: { value: 1 }, enabled: true, items: [{ value: 2 }] };
const alias = state;
const interval = setInterval(() => {
  alias.value++;
  state.nested.value += 2;
  state.items[0].value++;
  if (state.value === 3) {
    clearInterval(interval);
    console.log(state.value);
    console.log(alias.nested.value);
    console.log(state.items[0].value);
    console.log(state.enabled);
  }
}, 20);
