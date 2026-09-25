import { File as FileIcon, FileAudio, FileImage, FileText, FileType, FileVideo } from "lucide-react";
import type { PreviewKind, Visibility } from "../types";

export function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const kindIcons: Record<PreviewKind, typeof FileIcon> = {
  image: FileImage,
  pdf: FileType,
  text: FileText,
  audio: FileAudio,
  video: FileVideo,
  none: FileIcon
};

export const kindLabels: Record<PreviewKind, string> = {
  image: "Image",
  pdf: "PDF",
  text: "Text",
  audio: "Audio",
  video: "Video",
  none: "File"
};

export const visibilityLabels: Record<Visibility, string> = {
  private: "Private",
  selected: "Shared with selected people",
  all_users: "Shared with everyone"
};
