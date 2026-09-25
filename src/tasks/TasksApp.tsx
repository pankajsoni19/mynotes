import { useCallback, useEffect, useRef, useState } from "react";
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
  flash: (message: string) => void;
  onHome: () => void;
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
export function TasksApp({ userId, displayName, navigate, flash, onHome, onSettings, onSignOut }: TasksAppProps) {
  const [route, setRoute] = useState<TasksRoute>(currentTasksRoute);
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
    flash("Board not found");
    go(tasksRoute(), true);
  }, [flash, go]);

  return <main className={`app-page tasks-app${route.boardId ? " tasks-board-open" : ""}`}>
    <header className="app-page-header">
      <button className="app-home-button" onClick={onHome}><House />Home</button>
      <span className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><strong>Tasks</strong></span></span>
      <AccountActions displayName={displayName} onSettings={onSettings} onSignOut={onSignOut} />
    </header>
    {route.boardId
      ? <BoardView key={route.boardId} userId={userId} boardId={route.boardId} openCardId={route.cardId} onOpenCard={openCard} onCloseCard={closeCard} onBack={back} onMissing={onMissing} notify={flash} />
      : <BoardList onOpen={(board) => go(tasksRoute(board.id))} notify={flash} />}
  </main>;
}
