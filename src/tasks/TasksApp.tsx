import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskNotify } from "./taskActions";
import { House, Sparkles } from "lucide-react";
import { AccountActions } from "../AppShell";
import { readHistoryDepth } from "../appShellNavigation";
import { popStateClosedDialog } from "../historyDialogs";
import { formatRoute, parseRoute, type Route } from "../router";
import { tasksBackAction, tasksRoute, type TasksRoute } from "../tasksRoute";
import { BoardList } from "./BoardList";
import { BoardView } from "./BoardView";
import "../bin/bin.css";
import "../files/files.css";
import "./tasks.css";

export type TasksNavigate = (route: Route, options?: { replace?: boolean }) => void;

type TasksAppProps = {
  userId: string;
  displayName: string;
  navigate: TasksNavigate;
  /** The app toast; Tasks shows its own so a message can carry Undo. */
  flash: (message: string) => void;
  onHome: () => void;
  /** Opens the Bin from the header, as on Home; hidden when the host does not wire it. */
  onBin?: () => void;
  onSettings: () => void;
  onSignOut: () => void;
};

const currentTasksRoute = (): TasksRoute => {
  const route = parseRoute(window.location.pathname);
  return route.app === "tasks" ? route : tasksRoute();
};

/**
 * Tasks: the board list (/tasks) and one board (/tasks/:boardId). Every view is a history entry;
 * dialogs and sheets push none (D18). Back steps card → board → list → Home.
 */
export function TasksApp({ userId, displayName, navigate, onHome, onBin, onSettings, onSignOut }: TasksAppProps) {
  const [route, setRoute] = useState<TasksRoute>(currentTasksRoute);
  // Tasks keeps its own toast so a message can carry an action (Undo after moving to the Bin).
  const [toast, setToast] = useState<{ id: number; message: string; action?: { label: string; run: () => void } } | null>(null);
  const toastIdRef = useRef(0);
  const notify = useCallback<TaskNotify>((message, action) => setToast({ id: ++toastIdRef.current, message, action }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), toast.action ? 8000 : 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const routeRef = useRef(route);
  routeRef.current = route;
  // App's navigate is recreated on every render; read it through a ref so effects run once.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (popStateClosedDialog(event)) return;
      const next = parseRoute(window.location.pathname);
      if (next.app === "tasks") setRoute(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);


  const go = useCallback((next: TasksRoute, replace = false) => {
    setRoute(next);
    if (formatRoute(next) !== window.location.pathname || replace) navigateRef.current(next, { replace });
  }, []);

  const back = useCallback(() => {
    const action = tasksBackAction(routeRef.current, readHistoryDepth(window.history.state));
    if (action.kind === "history") window.history.back();
    else if (action.kind === "replace") go(action.route, true);
    else onHome();
  }, [go, onHome]);

  // A card is a view with its own entry: opening pushes it, and closing steps back to the board
  // (or replaces a deep-linked card entry with its board).
  const openCard = useCallback((cardId: string) => {
    const boardId = routeRef.current.boardId;
    if (boardId) go(tasksRoute(boardId, cardId));
  }, [go]);
  const closeCard = useCallback(() => {
    const current = routeRef.current;
    if (!current.cardId) return;
    if (readHistoryDepth(window.history.state) > 0) window.history.back();
    else go(tasksRoute(current.boardId), true);
  }, [go]);

  const onMissing = useCallback(() => {
    notify("Board not found");
    go(tasksRoute(), true);
  }, [notify, go]);

  return <main className={`app-page tasks-app${route.boardId ? " tasks-board-open" : ""}`}>
    <header className="app-page-header">
      <button className="app-home-button" onClick={onHome}><House />Home</button>
      <span className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><strong>Tasks</strong></span></span>
      <AccountActions displayName={displayName} onSettings={onSettings} onSignOut={onSignOut} onBin={onBin} />
    </header>
    {route.boardId
      ? <BoardView key={route.boardId} userId={userId} boardId={route.boardId} openCardId={route.cardId} onOpenCard={openCard} onCloseCard={closeCard} onBack={back} onMissing={onMissing} notify={notify} onBoardDeleted={() => go(tasksRoute(), true)} onOpenBoard={(boardId) => go(tasksRoute(boardId))} />
      : <BoardList onOpen={(board) => go(tasksRoute(board.id))} onOpenBoard={(boardId) => go(tasksRoute(boardId))} notify={notify} />}
    {toast && <div className="toast file-toast" role="status">
      <span>{toast.message}</span>
      {toast.action && <button className="file-toast-action" onClick={() => { const run = toast.action!.run; setToast(null); run(); }}>{toast.action.label}</button>}
    </div>}
  </main>;
}
