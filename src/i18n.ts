// 화면 문구 번역 + 언어 선택 도우미
// - 문구를 고치려면 아래 ko / en / ja 객체에서 같은 키의 값을 수정하세요.
// - 새 문구를 추가할 때는 ko에 먼저 키를 만들면 en / ja에도 같은 키가 없을 때 빌드가 막혀서 빠뜨리지 않습니다.
// - {name}, {n} 같은 자리표시자는 translate()가 값으로 바꿔 줍니다.

export type Lang = "ko" | "en" | "ja";

export const LANGS: Lang[] = ["ko", "en", "ja"];
export const LANG_LABEL: Record<Lang, string> = { ko: "한국어", en: "English", ja: "日本語" };
export const LOCALE: Record<Lang, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };
export const LANG_KEY = "es_lang";

// "ko-KR", "en_US", "ja", "jp" 같은 값을 지원하는 언어 코드로 바꿈. 지원하지 않으면 null
export function normalizeLang(v: string | null | undefined): Lang | null {
  const base = (v || "").toLowerCase().split(/[-_]/)[0];
  if (base === "ko" || base === "en") return base;
  if (base === "ja" || base === "jp") return "ja";
  return null;
}

// 처음 접속했을 때의 언어
// 1) 주소에 ?lang=ja 가 있으면 그 언어 (앱 안 브라우저 → 기본 브라우저로 넘어온 경우)
// 2) 이 기기에서 직접 골라 저장해 둔 언어
// 3) 기기(브라우저)의 기본 언어가 한국어·영어·일본어 중 하나면 그 언어
// 4) 그 외에는 한국어
export function detectInitialLang(): Lang {
  try {
    const fromUrl = normalizeLang(new URLSearchParams(window.location.search).get("lang"));
    if (fromUrl) return fromUrl;
  } catch {
    /* 무시 */
  }
  try {
    const saved = normalizeLang(window.localStorage.getItem(LANG_KEY));
    if (saved) return saved;
  } catch {
    /* 저장소를 못 쓰는 환경이면 건너뜀 */
  }
  const nav =
    typeof navigator !== "undefined" ? (navigator.languages && navigator.languages[0]) || navigator.language : "";
  return normalizeLang(nav) ?? "ko";
}

const ko = {
  appTitle: "앙스타 유닛별 취향표",
  subtitle: "유닛마다 한 명씩, 총 {total}명을 골라주세요",
  reset: "초기화",
  confirmReset: "고른 선택을 모두 지우고 처음부터 다시 할까요?",
  langLabel: "언어",
  loadingData: "데이터 불러오는 중...",

  myRoomsSummary: "내가 참여한 방 ({n})",
  unnamedRoom: "이름 없는 방",
  currentRoom: "현재 방",
  removeFromList: "목록에서 삭제",
  myRoomsHint: "이 기기에만 저장돼요. 목록에서 지워도 방 자체는 사라지지 않아요.",

  roomLoadError: "방 정보를 불러오지 못했습니다. 링크가 틀렸거나 현재 서버가 혼잡할 수 있어요. 잠시 후 다시 시도해주세요.",
  roomBannerLegacy: "이전 서버의 방(보기 전용)",
  roomBannerJoined: "공유된 방에 참여 중",
  participantsCount: "참여자 {n}명",
  roomLoading: "방 정보를 불러오는 중...",
  viewOthers: "다른 사람 결과 보기",
  newRoom: "새 방 만들기",

  myPicksTitle: "내 선택",
  personalTitleNamed: "{name}의 취향표",
  personalTitleDefault: "나의 취향표",
  nickname: "닉네임",
  nicknamePlaceholder: "예: 보리",
  nicknameHint:
    "닉네임을 쓰면 이미지에 “닉네임의 취향표”로 들어가요. 이미지 저장은 비워둬도 되고, 공유 링크를 만들 때는 꼭 필요해요.",
  roomNameLabel: "방 이름",
  roomNamePlaceholder: "예: 우리 모임 취향표 (선택)",
  roomNameHint:
    "공유 링크를 만들 때만 정할 수 있어요. 결과표 이미지에 “방이름의 결과”로 표시되고, 방을 만든 사람만 나중에 바꿀 수 있어요.",
  saveMyImage: "내 선택 이미지 저장",
  makingImage: "이미지 만드는 중...",
  saving: "저장 중...",
  submitToRoom: "이 방에 제출하기",
  createShareLink: "공유 링크 만들기",
  statsNoticePre: "완성한 선택은 닉네임·방 정보 없이 ",
  statsNoticeBold: "익명 통계",
  statsNoticePost: "에 반영될 수 있어요.",
  serverBusyNote: "현재 서버가 혼잡하여 공유 링크 만들기·제출이 어려워요. 내 선택 이미지 저장은 가능해요.",
  authErrorNote: "서버 연결에 실패해 공유 기능을 쓸 수 없어요. 이미지 저장은 가능합니다.",

  copyLink: "공유 링크 복사",
  editMyPicks: "내 픽 수정하기",
  choosePicks: "내 픽 고르기",
  saveBoardImage: "결과표 이미지 저장",
  renameRoomBtn: "방 이름 수정",
  loadedAt: "{time}에 불러온 결과",
  refresh: "새로고침",
  refreshing: "불러오는 중...",
  legacyViewOnly: "이전 서버의 방이라 보기만 가능해요",
  staleNote: "서버에서 새로 읽지 못해 이 기기에 저장된 결과를 보여주고 있어요",
  roomFullNote: "참여자가 많아 먼저 제출한 {max}명까지만 보여요",
  showMatch: "일치율 표시",
  baseLabel: "기준",
  meSuffix: " (나)",
  needTwo: "참여자가 2명 이상이면 사용할 수 있어요",
  resultTitleRoom: "{name}의 결과",
  resultTitleDefault: "참여자별 취향표",
  matchSubtitle: "{name}님 기준 일치율 · 같은 픽은 빨간 테두리",
  matchHead: "일치율",
  matchBase: "기준",

  previewGuideA: "이 브라우저에서는 이미지를 바로 저장할 수 없어요.",
  previewGuideB: "아래 방법 중 하나를 사용해 주세요.",
  previewShare: "이미지 저장·공유",
  previewOpenExternal: "기본 브라우저로 열기",
  previewCopyUrl: "주소 복사",
  previewImgAlt: "저장할 이미지",
  previewSub: "이미지를 길게 눌러 저장 메뉴가 나오면 그대로 저장해도 돼요.",
  close: "닫기",

  alertCsvPath: "CSV 파일 경로를 찾지 못해 데이터를 불러올 수 없습니다.",
  alertCsvError: "CSV 파일을 읽는 중 오류가 발생했습니다.",
  alertRefreshCooldown: "방금 불러온 결과예요. 1분 뒤에 다시 새로고침할 수 있어요.",
  alertExternalBrowser:
    "화면 모서리의 ⋯ 메뉴에서 '다른 브라우저로 열기'(또는 'Safari로 열기')를 눌러주세요.\n안 보이면 '주소 복사'를 눌러 Chrome·Safari에 붙여 넣으세요.",
  alertTransferCopied: "주소를 복사했어요. Chrome·Safari 주소창에 붙여 넣으면 지금 고른 선택이 그대로 이어져요.",
  alertCopyFailed: "복사에 실패했습니다.",
  alertShareFailed: "공유 창을 열지 못했어요. 다른 방법을 사용해 주세요.",
  alertPickAll: "{total}명을 모두 골라주세요. (현재 {picked}명)",
  alertImageFail:
    "이미지 저장에 실패했습니다. 잠시 후 다시 시도하거나 Chrome·Safari 같은 기본 브라우저에서 열어주세요.",
  alertNeedNickname: "공유하려면 닉네임을 입력해주세요.",
  serverBusyMsg: "현재 서버가 혼잡하여 저장이 안 돼요. 다음에 시도해주세요.\n(내 선택 이미지 저장은 계속 가능해요)",
  alertConnecting: "서버에 연결 중입니다. 잠시 후 다시 시도해주세요.",
  alertRoomLoading: "방 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.",
  alertLegacyReadOnly: "이전 서버에서 만든 방이라 보기만 가능해요. 새로 제출하려면 '새 방 만들기'를 눌러주세요.",
  alertLegacyOwn:
    "이 방은 이전 버전에서 만들어져 내 기록을 수정할 수 없어요. 결과는 볼 수 있고, 수정하려면 '새 방 만들기'로 새로 제출해주세요.",
  alertSubmitCooldown: "방금 제출했어요. 잠시 후 다시 눌러주세요.",
  alertSaveError: "저장 중 오류가 발생했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.",
  alertLinkCopied: "공유 링크가 복사되었습니다!",
  alertLinkCopyFailed: "복사에 실패했습니다. 주소창의 링크를 직접 복사해주세요.",
  confirmNewRoom:
    "새 방을 만들까요?\n지금 고른 픽과 닉네임은 그대로 두고, 공유 링크만 새로 만들 수 있어요.\n(지금 방에 낸 내 기록은 그대로 남아요)",
  confirmSwitchRoom: "다른 방으로 이동하면 지금 고르던 픽은 사라져요. 이동할까요?",
  promptRename: "새 방 이름 (최대 {max}자)",
  alertRenameFail: "방 이름을 바꾸지 못했습니다. 방을 만든 사람만 바꿀 수 있어요."
};

export type MsgKey = keyof typeof ko;

const en: Record<MsgKey, string> = {
  appTitle: "Ensemble Stars! Favorites by Unit",
  subtitle: "Pick one member from each unit — {total} in total",
  reset: "Reset",
  confirmReset: "Clear all your picks and start over?",
  langLabel: "Language",
  loadingData: "Loading data...",

  myRoomsSummary: "My rooms ({n})",
  unnamedRoom: "Untitled room",
  currentRoom: "Current",
  removeFromList: "Remove from list",
  myRoomsHint: "Saved on this device only. Removing a room from this list does not delete the room itself.",

  roomLoadError:
    "Couldn't load the room. The link may be wrong, or the server may be busy. Please try again later.",
  roomBannerLegacy: "Room on the previous server (view only)",
  roomBannerJoined: "Joined a shared room",
  participantsCount: "{n} participants",
  roomLoading: "Loading room...",
  viewOthers: "See everyone's results",
  newRoom: "Create a new room",

  myPicksTitle: "My picks",
  personalTitleNamed: "{name}'s Picks",
  personalTitleDefault: "My Picks",
  nickname: "Nickname",
  nicknamePlaceholder: "e.g. Bori",
  nicknameHint:
    "If you enter a nickname, the image will be titled “[Nickname]'s Picks”. You can leave it empty when saving an image, but it's required to create a share link.",
  roomNameLabel: "Room name",
  roomNamePlaceholder: "e.g. Our group's picks (optional)",
  roomNameHint:
    "You can only set this when creating a share link. It appears on the results image as “[Room name] results”, and only the room creator can change it later.",
  saveMyImage: "Save my picks as image",
  makingImage: "Creating image...",
  saving: "Saving...",
  submitToRoom: "Submit to this room",
  createShareLink: "Create share link",
  statsNoticePre: "Your completed picks may be included in ",
  statsNoticeBold: "anonymous statistics",
  statsNoticePost: " without your nickname or room information.",
  serverBusyNote:
    "The server is busy right now, so creating share links and submitting may not work. Saving your picks as an image still works.",
  authErrorNote: "Couldn't connect to the server, so sharing is unavailable. Saving as an image still works.",

  copyLink: "Copy share link",
  editMyPicks: "Edit my picks",
  choosePicks: "Choose my picks",
  saveBoardImage: "Save results as image",
  renameRoomBtn: "Rename room",
  loadedAt: "Loaded at {time}",
  refresh: "Refresh",
  refreshing: "Loading...",
  legacyViewOnly: "This room is on the previous server (view only)",
  staleNote: "Couldn't reach the server, so showing results saved on this device",
  roomFullNote: "Too many participants — showing only the first {max} who submitted",
  showMatch: "Show match rate",
  baseLabel: "Base",
  meSuffix: " (me)",
  needTwo: "Available when there are 2 or more participants",
  resultTitleRoom: "{name} — Results",
  resultTitleDefault: "Picks by participant",
  matchSubtitle: "Match rate based on {name} · Same picks have a red border",
  matchHead: "Match",
  matchBase: "Base",

  previewGuideA: "This browser can't save the image directly.",
  previewGuideB: "Please use one of the options below.",
  previewShare: "Save / share image",
  previewOpenExternal: "Open in default browser",
  previewCopyUrl: "Copy address",
  previewImgAlt: "Image to save",
  previewSub: "You can also long-press the image and save it from the menu.",
  close: "Close",

  alertCsvPath: "Couldn't find the CSV file, so the data can't be loaded.",
  alertCsvError: "An error occurred while reading the CSV file.",
  alertRefreshCooldown: "These results were just loaded. You can refresh again in 1 minute.",
  alertExternalBrowser:
    "Tap the ⋯ menu in the corner of the screen and choose “Open in another browser” (or “Open in Safari”).\nIf you can't find it, tap “Copy address” and paste it into Chrome or Safari.",
  alertTransferCopied:
    "Address copied. Paste it into the address bar of Chrome or Safari to continue with your current picks.",
  alertCopyFailed: "Copy failed.",
  alertShareFailed: "Couldn't open the share sheet. Please try another way.",
  alertPickAll: "Please pick all {total}. (Currently {picked})",
  alertImageFail:
    "Couldn't save the image. Please try again in a moment, or open this page in a standard browser such as Chrome or Safari.",
  alertNeedNickname: "Please enter a nickname to share.",
  serverBusyMsg:
    "The server is busy right now, so your picks can't be saved. Please try again later.\n(Saving your picks as an image still works.)",
  alertConnecting: "Connecting to the server. Please try again in a moment.",
  alertRoomLoading: "Loading room information. Please try again in a moment.",
  alertLegacyReadOnly:
    "This room was created on the previous server, so it's view only. To submit, tap “Create a new room”.",
  alertLegacyOwn:
    "This room was created with an earlier version, so you can't edit your entry. You can still view the results; to change your picks, submit again in a new room via “Create a new room”.",
  alertSubmitCooldown: "You just submitted. Please wait a moment and try again.",
  alertSaveError: "An error occurred while saving. Check your network connection and try again.",
  alertLinkCopied: "Share link copied!",
  alertLinkCopyFailed: "Copy failed. Please copy the link from the address bar.",
  confirmNewRoom:
    "Create a new room?\nYour current picks and nickname stay as they are — only the share link is new.\n(Your entry in the current room remains.)",
  confirmSwitchRoom: "If you switch to another room, the picks you're choosing now will be lost. Switch anyway?",
  promptRename: "New room name (max {max} characters)",
  alertRenameFail: "Couldn't rename the room. Only the room creator can rename it."
};

const ja: Record<MsgKey, string> = {
  appTitle: "あんスタ ユニット別 推し表",
  subtitle: "ユニットごとに1人ずつ、合計{total}人を選んでください",
  reset: "リセット",
  confirmReset: "選んだ内容をすべて消して最初からやり直しますか？",
  langLabel: "言語",
  loadingData: "データを読み込み中...",

  myRoomsSummary: "参加したルーム ({n})",
  unnamedRoom: "名前なしのルーム",
  currentRoom: "現在のルーム",
  removeFromList: "リストから削除",
  myRoomsHint: "この端末にのみ保存されます。リストから削除してもルーム自体は消えません。",

  roomLoadError:
    "ルーム情報を読み込めませんでした。リンクが間違っているか、サーバーが混雑している可能性があります。しばらくしてからもう一度お試しください。",
  roomBannerLegacy: "旧サーバーのルーム（閲覧のみ）",
  roomBannerJoined: "共有ルームに参加中",
  participantsCount: "参加者{n}人",
  roomLoading: "ルーム情報を読み込み中...",
  viewOthers: "みんなの結果を見る",
  newRoom: "新しいルームを作る",

  myPicksTitle: "わたしの選択",
  personalTitleNamed: "{name}の推し表",
  personalTitleDefault: "わたしの推し表",
  nickname: "ニックネーム",
  nicknamePlaceholder: "例：ボリ",
  nicknameHint:
    "ニックネームを入力すると、画像に「ニックネームの推し表」と入ります。画像保存だけなら空欄でもかまいませんが、共有リンクを作るときは必須です。",
  roomNameLabel: "ルーム名",
  roomNamePlaceholder: "例：みんなの推し表（任意）",
  roomNameHint:
    "共有リンクを作るときだけ設定できます。結果表の画像に「ルーム名の結果」と表示され、あとから変更できるのはルームを作った人だけです。",
  saveMyImage: "選択を画像で保存",
  makingImage: "画像を作成中...",
  saving: "保存中...",
  submitToRoom: "このルームに提出",
  createShareLink: "共有リンクを作る",
  statsNoticePre: "完成した選択は、ニックネームやルーム情報なしで",
  statsNoticeBold: "匿名統計",
  statsNoticePost: "に反映されることがあります。",
  serverBusyNote:
    "現在サーバーが混雑しているため、共有リンクの作成や提出が難しい状態です。画像の保存は利用できます。",
  authErrorNote: "サーバーに接続できず、共有機能を使えません。画像の保存は可能です。",

  copyLink: "共有リンクをコピー",
  editMyPicks: "自分の選択を編集",
  choosePicks: "自分の選択をする",
  saveBoardImage: "結果表を画像で保存",
  renameRoomBtn: "ルーム名を変更",
  loadedAt: "{time}に読み込んだ結果",
  refresh: "更新",
  refreshing: "読み込み中...",
  legacyViewOnly: "旧サーバーのルームのため、閲覧のみ可能です",
  staleNote: "サーバーから読み込めなかったため、この端末に保存された結果を表示しています",
  roomFullNote: "参加者が多いため、先に提出した{max}人までを表示しています",
  showMatch: "一致率を表示",
  baseLabel: "基準",
  meSuffix: "（自分）",
  needTwo: "参加者が2人以上のときに使えます",
  resultTitleRoom: "{name}の結果",
  resultTitleDefault: "参加者別の推し表",
  matchSubtitle: "{name}さん基準の一致率・同じ選択は赤い枠",
  matchHead: "一致率",
  matchBase: "基準",

  previewGuideA: "このブラウザでは画像を直接保存できません。",
  previewGuideB: "下のいずれかの方法をお試しください。",
  previewShare: "画像を保存・共有",
  previewOpenExternal: "標準ブラウザで開く",
  previewCopyUrl: "アドレスをコピー",
  previewImgAlt: "保存する画像",
  previewSub: "画像を長押しして、表示されるメニューから保存することもできます。",
  close: "閉じる",

  alertCsvPath: "CSVファイルが見つからず、データを読み込めません。",
  alertCsvError: "CSVファイルの読み込み中にエラーが発生しました。",
  alertRefreshCooldown: "いま読み込んだ結果です。1分後にもう一度更新できます。",
  alertExternalBrowser:
    "画面の隅にある「⋯」メニューから「他のブラウザで開く」（または「Safariで開く」）を押してください。\n見つからない場合は「アドレスをコピー」を押して、ChromeやSafariに貼り付けてください。",
  alertTransferCopied:
    "アドレスをコピーしました。ChromeやSafariのアドレスバーに貼り付けると、いまの選択がそのまま引き継がれます。",
  alertCopyFailed: "コピーに失敗しました。",
  alertShareFailed: "共有画面を開けませんでした。ほかの方法をお試しください。",
  alertPickAll: "{total}人すべてを選んでください。（現在{picked}人）",
  alertImageFail:
    "画像の保存に失敗しました。しばらくしてからもう一度お試しいただくか、ChromeやSafariなどの標準ブラウザで開いてください。",
  alertNeedNickname: "共有するにはニックネームを入力してください。",
  serverBusyMsg:
    "現在サーバーが混雑しているため保存できません。しばらくしてからもう一度お試しください。\n（画像の保存は引き続き利用できます）",
  alertConnecting: "サーバーに接続中です。しばらくしてからもう一度お試しください。",
  alertRoomLoading: "ルーム情報を読み込み中です。しばらくしてからもう一度お試しください。",
  alertLegacyReadOnly:
    "旧サーバーで作られたルームのため、閲覧のみ可能です。新しく提出するには「新しいルームを作る」を押してください。",
  alertLegacyOwn:
    "このルームは以前のバージョンで作られたため、自分の記録は編集できません。結果は閲覧できます。編集するには「新しいルームを作る」から新しく提出してください。",
  alertSubmitCooldown: "いま提出したばかりです。少し待ってからもう一度押してください。",
  alertSaveError: "保存中にエラーが発生しました。ネットワーク状態を確認してから、もう一度お試しください。",
  alertLinkCopied: "共有リンクをコピーしました！",
  alertLinkCopyFailed: "コピーに失敗しました。アドレスバーのリンクを直接コピーしてください。",
  confirmNewRoom:
    "新しいルームを作りますか？\nいま選んでいる内容とニックネームはそのままで、共有リンクだけ新しくなります。\n（現在のルームに提出した記録は残ります）",
  confirmSwitchRoom: "別のルームに移動すると、いま選んでいる内容は消えます。移動しますか？",
  promptRename: "新しいルーム名（最大{max}文字）",
  alertRenameFail: "ルーム名を変更できませんでした。変更できるのはルームを作った人だけです。"
};

const MESSAGES: Record<Lang, Record<MsgKey, string>> = { ko, en, ja };

export function translate(lang: Lang, key: MsgKey, params?: Record<string, string | number>): string {
  let s = MESSAGES[lang][key] ?? MESSAGES.ko[key];
  if (params) {
    Object.keys(params).forEach((k) => {
      s = s.split(`{${k}}`).join(String(params[k]));
    });
  }
  return s;
}
