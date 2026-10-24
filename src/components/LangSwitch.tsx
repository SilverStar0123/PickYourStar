import { LANGS, LANG_LABEL } from "../i18n";
import type { Lang } from "../i18n";
import React from "react";
import type { TFn } from "../types";

// 화면 위쪽 오른쪽의 언어 선택 버튼 (스타일: lang.css)
export default function LangSwitch({
  lang,
  onChange,
  t
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  t: TFn;
}) {
  return (
    <div className="lang-switch" role="group" aria-label={t("langLabel")}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={l === lang ? "active" : ""}
          aria-pressed={l === lang}
          onClick={() => onChange(l)}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
