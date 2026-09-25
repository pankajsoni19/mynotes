import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildFtsQuery, cleanIndexText, searchText, toSegments } from "../server/search";

describe("buildFtsQuery", () => {
  test("quotes every term, joins them with implicit AND, and prefixes the word being typed", () => {
    expect(buildFtsQuery("hello")).toBe('"hello"*');
    expect(buildFtsQuery("Hello World")).toBe('"hello" "world"*');
    expect(buildFtsQuery("hello ")).toBe('"hello"');
    expect(buildFtsQuery("foo!")).toBe('"foo"');
  });

  test("never passes FTS5 operators or column filters through", () => {
    expect(buildFtsQuery("title:secret")).toBe('"title" "secret"*');
    expect(buildFtsQuery("NEAR(alpha beta, 2)")).toBe('"near" "alpha" "beta"');
    expect(buildFtsQuery("foo AND bar OR baz NOT qux")).toBe('"foo" "and" "bar" "or" "baz" "not" "qux"*');
    expect(buildFtsQuery("-foo +bar ^baz")).toBe('"foo" "bar" "baz"*');
    expect(buildFtsQuery("col:val {a b} (x OR y)")).toBe('"col" "val" "or"');
    expect(buildFtsQuery("foo*")).toBe('"foo"');
    expect(buildFtsQuery("***")).toBeNull();
    expect(buildFtsQuery('""')).toBeNull();
  });

  test("keeps up to four quoted phrases; unterminated quotes are separators", () => {
    expect(buildFtsQuery('"Exact phrase" more')).toBe('"exact phrase" "more"*');
    expect(buildFtsQuery('"unterminated phrase')).toBe('"unterminated" "phrase"*');
    expect(buildFtsQuery('say "hi" "there" "you" "all" "extra"')).toBe('"hi" "there" "you" "all" "say" "extra"');
    expect(buildFtsQuery('end "quoted"')).toBe('"quoted" "end"');
  });

  test("applies NFKC and lowercase, and handles emoji, diacritics, and non-Latin scripts", () => {
    expect(buildFtsQuery("ＦＵＬＬ")).toBe('"full"*');
    expect(buildFtsQuery("Café")).toBe('"café"*');
    expect(buildFtsQuery("🎉 party 🎉")).toBe('"party"');
    expect(buildFtsQuery("🎉🎉")).toBeNull();
    // Combining vowel signs stay inside the word, as unicode61 tokenizes them.
    expect(buildFtsQuery("योग अभ्यास")).toBe('"योग" "अभ्यास"*');
  });

  test("enforces the length and count caps", () => {
    expect(buildFtsQuery("")).toBeNull();
    expect(buildFtsQuery("x")).toBeNull();
    expect(buildFtsQuery("a b c")).toBeNull();
    expect(buildFtsQuery("a".repeat(200))).toBeNull();
    expect(buildFtsQuery(`${"a".repeat(64)} ok`)).toBe(`"${"a".repeat(64)}" "ok"*`);
    expect(buildFtsQuery("word ".repeat(30) + "x".repeat(1))).toBe(Array(8).fill('"word"').join(" "));
    expect(buildFtsQuery("x".repeat(201))).toBeNull();
    const nine = "one two three four five six seven eight nine";
    expect(buildFtsQuery(nine)).toBe('"one" "two" "three" "four" "five" "six" "seven" "eight"');
  });

  test("every built query is valid FTS5 syntax", () => {
    const db = new Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(title, body, tokenize='unicode61 remove_diacritics 2', prefix='2 3')");
    db.query("INSERT INTO t (title, body) VALUES (?, ?)").run("Crème brûlée", "notes about the NEAR future and title fields");
    const inputs = ["title:x", "NEAR(a b)", '"unterminated', "***", "a\"b\"c", "AND OR NOT", "{col}: *", "creme", "BRUL", "near fut"];
    for (const input of inputs) {
      const query = buildFtsQuery(input);
      if (query === null) continue;
      expect(() => db.query("SELECT rowid FROM t WHERE t MATCH ?").all(query)).not.toThrow();
    }
    expect(db.query("SELECT rowid FROM t WHERE t MATCH ?").all(buildFtsQuery("creme BRUL")!)).toHaveLength(1);
    // "title:x" is the plain word "title", not a column filter on the title column.
    expect(buildFtsQuery("title:x")).toBe('"title"');
    expect(db.query("SELECT rowid FROM t WHERE t MATCH ?").all(buildFtsQuery("title:x")!)).toHaveLength(1);
    db.close();
  });
});

describe("searchText", () => {
  test("keeps headings, text, link text, alt text, and code, and strips markup and URLs", () => {
    const markdown = [
      "# Title here #",
      "",
      "Some **bold** and _it_ text snake_case with [link text](https://example.com/secret-path) and ![alt words](/api/files/1/content).",
      "",
      "```ts",
      "const answer = 42; // see https://hidden.example/path",
      "```",
      "",
      "| head a | head b |",
      "| --- | :---: |",
      "| cell c | cell d |",
      "",
      "- [ ] task item",
      "1. first",
      "> quote <b>html</b> https://bare.example/y <https://auto.example>",
      "",
      "[ref]: https://reference.example",
      "---",
      "Escaped \\*star\\* and `inline code`"
    ].join("\n");
    const text = searchText(markdown);
    expect(text).toContain("Title here");
    expect(text).toContain("Some bold and it text snake_case with link text and alt words");
    expect(text).toContain("const answer = 42; //");
    expect(text).toContain("head a head b");
    expect(text).toContain("cell c cell d");
    expect(text).toContain("task item");
    expect(text).toContain("first");
    expect(text).toContain("quote html");
    expect(text).toContain("Escaped star and inline code");
    for (const removed of ["https", "example.com", "secret-path", "hidden.example", "/api/files", "<b>", "**", "```", "---", "reference", "[", "]", "#"]) {
      expect(text).not.toContain(removed);
    }
  });

  test("strips control characters, including the highlight markers", () => {
    expect(searchText("a\u0002b\u0003c\u200Bd")).toBe("abcd");
    expect(cleanIndexText("Ti\u0002tle\u0003")).toBe("Title");
    expect(searchText("")).toBe("");
  });
});

describe("toSegments", () => {
  test("turns highlight markers into text/hit segments", () => {
    expect(toSegments("a \u0002b\u0003 c")).toEqual([{ text: "a ", hit: false }, { text: "b", hit: true }, { text: " c", hit: false }]);
    expect(toSegments("\u0002x\u0003\u0002y\u0003")).toEqual([{ text: "xy", hit: true }]);
    expect(toSegments("<img src=x onerror=alert(1)>")).toEqual([{ text: "<img src=x onerror=alert(1)>", hit: false }]);
    expect(toSegments("")).toEqual([]);
  });
});
