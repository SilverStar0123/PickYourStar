import React from "react";
import type { TFn } from "../types";

// 이미지 직접 저장이 막힌 환경(앱 안 브라우저 등)에서 띄우는 안내 창
export default function ImagePreviewModal({
  preview,
  t,
  onClose,
  onShare,
  onOpenExternal,
  onCopyUrl
}: {
  preview: { src: string; blob: Blob; name: string };
  t: TFn;
  onClose: () => void;
  onShare: () => void;
  onOpenExternal?: () => void; // 없으면 버튼을 숨김
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
          {onOpenExternal && (
            <button type="button" className="download-btn" onClick={onOpenExternal}>
              {t("previewOpenExternal")}
            </button>
          )}
          <button type="button" className="download-btn" onClick={onCopyUrl}>
            {t("previewCopyUrl")}
          </button>
        </div>
        <img src={preview.src} alt={t("previewImgAlt")} />
        <p className="preview-sub">{t("previewSub")}</p>
        <button type="button" className="download-btn" onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
