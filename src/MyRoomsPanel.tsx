import type { Lang } from "../i18n";
import type { MyRoom, TFn } from "../types";
import React from "react";
import { formatDate } from "../utils";

// "내가 참여한 방" 목록 (이 기기에 저장된 방들)
export default function MyRoomsPanel({
  myRooms,
  roomId,
  lang,
  t,
  onOpen,
  onRemove
}: {
  myRooms: MyRoom[];
  roomId: string | null;
  lang: Lang;
  t: TFn;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (myRooms.length === 0) return null;
  return (
    <details className="my-rooms">
      <summary>{t("myRoomsSummary", { n: myRooms.length })}</summary>
      <ul>
        {myRooms.map((r) => (
          <li key={r.id} className={r.id === roomId ? "current" : ""}>
            <button
              type="button"
              className="room-link"
              onClick={() => onOpen(r.id)}
              disabled={r.id === roomId}
            >
              <span className="room-title">{r.roomName || t("unnamedRoom")}</span>
              <span className="room-nick">{r.nickname}</span>
              <span className="room-date">{formatDate(r.lastAt, lang)}</span>
              <span className="room-code">{r.id.slice(0, 6)}…</span>
              {r.id === roomId && <span className="room-now">{t("currentRoom")}</span>}
            </button>
            <button
              type="button"
              className="room-remove"
              aria-label={t("removeFromList")}
              onClick={() => onRemove(r.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="hint-inline">{t("myRoomsHint")}</p>
    </details>
  );
}
