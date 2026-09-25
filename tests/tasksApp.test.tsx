import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardList } from "../src/tasks/BoardList";
import { cardCountLabel, sharingLabel, validateBoardName, validateCardTitle, validateColumnName } from "../src/tasks/taskActions";

test("the board list starts with its loading state and a New board action", () => {
  const markup = renderToStaticMarkup(<BoardList onOpen={() => undefined} notify={() => undefined} />);
  expect(markup).toContain("Loading boards…");
  expect(markup).toContain(">New board</button>");
  expect(markup).toContain('<h1 id="tasks-title">Tasks</h1>');
});

test("name validation mirrors the server rules", () => {
  expect(validateBoardName("  Launch  ")).toEqual({ ok: true, name: "Launch", changed: true });
  expect(validateBoardName("Launch", "Launch")).toEqual({ ok: true, name: "Launch", changed: false });
  expect(validateBoardName("   ").ok).toBe(false);
  expect(validateBoardName("x".repeat(121)).ok).toBe(false);
  expect(validateBoardName("x".repeat(120)).ok).toBe(true);
  expect(validateColumnName("x".repeat(61)).ok).toBe(false);
  expect(validateCardTitle("x".repeat(200)).ok).toBe(true);
  expect(validateCardTitle("x".repeat(201)).ok).toBe(false);
  expect(validateCardTitle("bad\u0007bell").ok).toBe(false);
  expect(validateCardTitle("rtl‮trick").ok).toBe(false);
  expect(cardCountLabel(1)).toBe("1 card");
  expect(cardCountLabel(0)).toBe("0 cards");
  expect(sharingLabel("all_users")).toBe("Everyone here");
});
