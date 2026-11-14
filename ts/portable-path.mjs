// POSIX virtual paths for browser hosts. Node keeps its native path semantics.
function resolve(...parts) {
  const output = [];
  for (const part of parts) {
    if (part.startsWith("/")) output.length = 0;
    for (const item of part.replaceAll("\\", "/").split("/")) {
      if (item === "..") output.pop();
      else if (item && item !== ".") output.push(item);
    }
  }
  return `/${output.join("/")}`;
}
export const portablePath = {
  resolve,
  join: (...parts) => resolve(...parts),
  dirname: (name) => resolve(name, ".."),
};
