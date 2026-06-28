onStart(() => {
  appendList("items", 1);
  insertList("items", 1, "hello");
  replaceListItem("items", "any", 1, 2);
  deleteListItem("items", "last", 1);
  copyList("items", "backup");
  showList("items");
  hideList("items");
  setVar("all", getList("items"));
  setVar("first", listItem("items", "any", 1));
  setVar("length", listLength("items"));
  setVar("index", listIndexOf("items", "hello"));
  setVar("has", listContains("items", "hello"));
  setVar("tmp", tempList(1, 2, 3));
});
