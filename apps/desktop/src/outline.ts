export function outlineRows(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const text = line.replace(/^\s*[-*#\d.]+\s*/, "").trim(),
        start = text.indexOf("["),
        middle = text.indexOf("](", start);
      if (start < 0 || middle < 0) return { text, anchor: null };
      let depth = 0,
        end = middle + 2;
      for (; end < text.length; end++) {
        if (text[end] === "(") depth++;
        else if (text[end] === ")") {
          if (!depth) break;
          depth--;
        }
      }
      const target = text.slice(middle + 2, end);
      if (!target.startsWith("#") || target.length > 768)
        return { text, anchor: null };
      try {
        return {
          text: text.slice(start + 1, middle),
          anchor: decodeURIComponent(target.slice(1)).slice(0, 256),
        };
      } catch {
        return { text, anchor: null };
      }
    });
}
