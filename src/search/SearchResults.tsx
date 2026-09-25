import { Users } from "lucide-react";
import type { Folder } from "../types";
import type { NoteSearchHit, SearchSegment } from "./searchApi";
import "./search.css";

export const searchListId = "note-search-results";
export const searchOptionId = (noteId: string) => `note-search-option-${noteId}`;

// Hits are plain text segments; React escapes them, and only `hit` segments get a <mark>.
function Marked({ segments, fallback }: { segments: SearchSegment[]; fallback?: string }) {
  if (!segments.length) return <>{fallback ?? ""}</>;
  return <>{segments.map((segment, index) => segment.hit ? <mark key={index}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</>;
}

type Props = {
  results: NoteSearchHit[];
  truncated: boolean;
  activeIndex: number;
  selectedNoteId: string | null;
  folders: Folder[];
  relativeTime: (value: string) => string;
  onOpen: (hit: NoteSearchHit) => void;
  onHover: (index: number) => void;
};

export function SearchResults({ results, truncated, activeIndex, selectedNoteId, folders, relativeTime, onOpen, onHover }: Props) {
  const folderName = (hit: NoteSearchHit) => hit.folder_id ? folders.find((folder) => folder.id === hit.folder_id)?.name ?? null : null;
  return <ul className="search-results" id={searchListId} role="listbox" aria-label="Search results">
    {results.map((hit, index) => {
      const folder = folderName(hit);
      return <li
        key={hit.id}
        id={searchOptionId(hit.id)}
        role="option"
        aria-selected={index === activeIndex}
        className={`search-result${index === activeIndex ? " active" : ""}${selectedNoteId === hit.id ? " selected" : ""}`}
        onClick={() => onOpen(hit)}
        onMouseMove={() => { if (index !== activeIndex) onHover(index); }}
      >
        <span className="search-result-title"><Marked segments={hit.title} fallback="Untitled" /></span>
        {hit.snippet.length > 0 && <span className="search-result-snippet"><Marked segments={hit.snippet} /></span>}
        <span className="search-result-meta">
          {hit.source === "draft" && <em className="search-draft-badge">Draft</em>}
          {folder && <span className="search-result-folder">{folder}</span>}
          {hit.is_owner === 0 && <span className="search-result-owner"><Users aria-hidden="true" />{hit.owner_name}</span>}
          <time dateTime={hit.updated_at}>{relativeTime(hit.updated_at)}</time>
        </span>
      </li>;
    })}
    {truncated && <li className="search-results-more" role="presentation">Showing the top {results.length} matches. Add words to narrow the search.</li>}
  </ul>;
}
