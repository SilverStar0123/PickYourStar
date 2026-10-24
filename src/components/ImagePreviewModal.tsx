import React from "react";
import type { TFn } from "../types";

// 이미지 직접 저장이 막힌 환경(앱 안 브라우저 등)에서 띄우는 안내 창
export default function ImagePreviewModal({
  preview,
  t,
  onClose,
  onShare,
  onOpenExternal,
  onOpenTweet,
  onSaveImage,
  onCopyUrl
}: {
  preview: { src: string; blob: Blob; name: string };
  t: TFn;
  onClose: () => void;
  onShare: () => void;
  onOpenExternal?: () => void; // 없으면 버튼을 숨김
  onOpenTweet?: () => void; // 브라우저가 PNG 자동 첨부를 지원하지 않을 때 X 글쓰기
  onSaveImage?: () => void;
  onCopyUrl: () => void;
}) {
  return (
    <div className="img-preview-overlay" onClick={onClose}>
      <div className="img-preview-box" onClick={(e) => e.stopPropagation()}>
        <p className="preview-guide">
          {t("previewGuideA")}
          <br />
          {t("previewGuideB")}
        </p>
        <div className="preview-actions">
          {typeof navigator.canShare === "function" &&
            navigator.canShare({ files: [new File([preview.blob], preview.name, { type: "image/png" })] }) && (
              <button type="button" className="download-btn" onClick={onShare}>
                {t("previewShare")}
              </button>
            )}
          {onSaveImage && (
            <button type="button" className="download-btn" onClick={onSaveImage}>
              {t("quizShareSaveImage")}
            </button>
          )}
          {onOpenTweet && (
            <button type="button" className="download-btn" onClick={onOpenTweet}>
              {t("quizShareOpenX")}
            </button>
          )}
          {onOpenExternal && (
            <button type="button" className="download-btn" onClick={onOpenExternal}>
              {t("previewOpenExternal")}
            </button>
          )}
          <button type="button" className="download-btn" onClick={onCopyUrl}>
            {t("previewCopyUrl")}
          </button>
        </div>
        {onOpenTweet && <p className="preview-guide">{t("quizShareManualAttach")}</p>}
        <img src={preview.src} alt={t("previewImgAlt")} />
        <p className="preview-sub">{t("previewSub")}</p>
        <button type="button" className="download-btn" onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
