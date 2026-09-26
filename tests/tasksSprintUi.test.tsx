import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SprintBar } from "../src/tasks/SprintBar";
import { SprintCompleteDialog } from "../src/tasks/SprintCompleteDialog";
import { CardSprintField } from "../src/tasks/SprintField";
import { SprintSettingsSection } from "../src/tasks/SprintSettingsSection";
import type { BoardColumn, CardDetail, CardSummary, SprintSummary } from "../src/tasks/tasksApi";

/** Sprint UI (17B, research §7.2, §7.3, §7.5), rendered to static markup. */

const noop = () => undefined;
const asyncNoop = async () => undefined;
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const sprint = (id: string, name: string, state: SprintSummary["state"], extra: Partial<SprintSummary> = {}): SprintSummary => ({
  id, board_id: "b", name, goal: "", start_on: null, end_on: null, state, is_active: state === "active", position: 1024, completed_at: null,
  card_count: 0, done_count: 0, created_at: "", updated_at: "", ...extra
});
const SPRINTS = [sprint(S1, "Sprint 12", "active", { start_on: "2026-09-21", end_on: "2026-10-01", card_count: 3 }), sprint(S2, "Sprint 13", "planned")];
const columns: BoardColumn[] = [
  { id: "todo", board_id: "b", name: "To do", position: 1, is_done: 0, created_at: "", updated_at: "" },
  { id: "done", board_id: "b", name: "Done", position: 2, is_done: 1, created_at: "", updated_at: "" }
];
const card = (id: string, column: string, extra: Partial<CardSummary> = {}): CardSummary => ({
  id, board_id: "b", column_id: column, position: 1, title: id, has_description: 0, revision: 1, created_by: null, creator_name: null, due_on: null,
  assignee_id: null, assignee_name: null, comment_count: 0, attachment_count: 0, created_at: "", updated_at: "", level: 0, parent_card_id: null, sprint_id: null, ...extra
});
const CARDS = [card("a", "todo", { sprint_id: S1 }), card("b", "done", { sprint_id: S1 }), card("c", "todo", { sprint_id: S1 }), card("sub", "todo", { level: 1, parent_card_id: "a", sprint_id: S1 })];
const STRUCTURE = { levels: [{ name: "Task", plural: "Tasks" }, { name: "Subtask", plural: "Subtasks" }], workLevel: 0, sprints: true };

test("the sprint bar shows the sprint, its timing, work-level progress, and the owner's Complete", () => {
  const html = renderToStaticMarkup(<SprintBar sprints={SPRINTS} selection={{ kind: "sprint", sprint: SPRINTS[0]! }} cards={CARDS} columns={columns} workLevel={0}
    name="Task" plural="Tasks" today="2026-09-27" owner onSelect={noop} onStart={noop} onComplete={noop} />);
  expect(html).toContain("Sprint 12");
  expect(html).toContain("4 days left");
  expect(html).toContain("1 of 3 done");
  expect(html).toContain("Complete…");
  expect(html).not.toContain("<select");
  // Members see the progress but not the owner actions; a planned sprint offers Start only with none active.
  const member = renderToStaticMarkup(<SprintBar sprints={SPRINTS} selection={{ kind: "sprint", sprint: SPRINTS[0]! }} cards={CARDS} columns={columns} workLevel={0}
    name="Task" plural="Tasks" today="2026-09-27" owner={false} onSelect={noop} onStart={noop} onComplete={noop} />);
  expect(member).not.toContain("Complete…");
  const planned = renderToStaticMarkup(<SprintBar sprints={[SPRINTS[1]!]} selection={{ kind: "sprint", sprint: SPRINTS[1]! }} cards={[]} columns={columns} workLevel={0}
    name="Task" plural="Tasks" today="2026-09-27" owner onSelect={noop} onStart={noop} onComplete={noop} />);
  expect(planned).toContain("Start sprint");
  expect(planned).toContain("No tasks yet");
  const backlog = renderToStaticMarkup(<SprintBar sprints={SPRINTS} selection={{ kind: "backlog" }} cards={[card("d", "todo")]} columns={columns} workLevel={0}
    name="Task" plural="Tasks" today="2026-09-27" owner onSelect={noop} onStart={noop} onComplete={noop} />);
  expect(backlog).toContain("1 task not in a sprint");
});

test("the close dialog counts done and unfinished tasks and offers the next sprint, the backlog, and a new sprint", () => {
  const html = renderToStaticMarkup(<SprintCompleteDialog sprint={SPRINTS[0]!} sprints={SPRINTS} cards={CARDS} columns={columns} workLevel={0}
    name="Task" plural="Tasks" childPlural="Subtasks" today="2026-09-27" onComplete={asyncNoop} onCancel={noop} />);
  expect(html).toContain("Complete Sprint 12");
  expect(html).toContain("1 done");
  expect(html).toContain("2 not done");
  expect(html).toContain("Move the 2 unfinished tasks to");
  expect(html).toContain("Sprint 13");
  expect(html).toContain("Subtasks follow their tasks.");
  expect(html).not.toContain("<select");
});

test("the card's Sprint field: a select on the work level, read-only below it, hidden on boards without sprints", () => {
  const task = { ...card("a", "todo", { sprint_id: S1 }), description: "" } as CardDetail;
  const editable = renderToStaticMarkup(<CardSprintField card={task} structure={STRUCTURE} cards={CARDS} sprints={SPRINTS} idPrefix="x" saving={false} onSave={async () => true} />);
  expect(editable).toContain("Sprint");
  expect(editable).toContain("Sprint 12");
  expect(editable).toContain('role="combobox"');
  const subtask = { ...CARDS[3]!, description: "" } as CardDetail;
  const inherited = renderToStaticMarkup(<CardSprintField card={subtask} structure={STRUCTURE} cards={CARDS} sprints={SPRINTS} idPrefix="x" saving={false} onSave={async () => true} />);
  expect(inherited).toContain("Sprint 12");
  expect(inherited).toContain("(from its task)");
  expect(inherited).not.toContain('role="combobox"');
  expect(renderToStaticMarkup(<CardSprintField card={task} structure={{ ...STRUCTURE, sprints: false }} cards={CARDS} sprints={SPRINTS} idPrefix="x" saving={false} onSave={async () => true} />)).toBe("");
});

test("Board settings → Sprints lists sprints for everyone and gives the owner New, Start, Complete, Edit, and Delete", () => {
  const props = { boardId: "b", sprints: SPRINTS, today: "2026-09-27", plural: "Tasks", onCreate: async () => null, onUpdate: async () => true, onStart: asyncNoop, onDelete: asyncNoop, onComplete: noop };
  const owner = renderToStaticMarkup(<SprintSettingsSection {...props} owner />);
  expect(owner).toContain("New sprint");
  expect(owner).toContain("Complete…");
  expect(owner).toContain("Edit Sprint 12");
  expect(owner).toContain("Delete Sprint 13");
  // Sprint 13 cannot start while Sprint 12 is active.
  expect(owner).not.toContain(">Start<");
  const member = renderToStaticMarkup(<SprintSettingsSection {...props} owner={false} />);
  expect(member).toContain("Sprint 12");
  expect(member).not.toContain("New sprint");
  expect(member).toContain("Only the owner adds, starts, and completes sprints");
});
