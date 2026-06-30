onStart(() => {
  setVar("len", 0);
  setVar("first", 0);
  setVar("found", 0);
  setVar("idx", 0);

  appendList("myList", 10);
  appendList("myList", 20);
  appendList("myList", 30);
  insertList("myList", 1, 15);
  replaceListItem("myList", "any", 2, 25);
  deleteListItem("myList", "any", 1);

  setVar("len", listLength("myList"));
  setVar("first", listItem("myList", "any", 1));
  setVar("found", listContains("myList", 25));
  setVar("idx", listIndexOf("myList", 30));
});
