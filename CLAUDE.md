# CLAUDE.md — 璞石 Render Studio

給 Claude Code 的專案說明。完整背景、決策紀錄與待辦見 [`docs/HANDOFF.md`](docs/HANDOFF.md)；設計依據與實測數據見 [`docs/RENDER-STUDIO-EVALUATION.md`](docs/RENDER-STUDIO-EVALUATION.md)；平板／手機操作見 [`docs/DEVICE-GUIDE.md`](docs/DEVICE-GUIDE.md)；金鑰設定見 [`docs/SETTINGS-GUIDE.md`](docs/SETTINGS-GUIDE.md)。

## 使用者與溝通

- 使用者：Banson（璞石集團 CEO，非工程背景）。回覆以「Banson，」開頭，繁體中文（台灣用語），結論先行、比較用表格。
- 數字標【實際】（實測／已確認）或【示意】（假設，需附條件）。法律、稅務結論標「需專業人士最終確認」。
- 需要他在 Vercel／GitHub 介面操作時，給逐步、可照做的指示；**不要請他把金鑰貼進對話**。

## 專案是什麼

3D 渲染圖 AI 優化工作台。以「專案」為單位，把每個視角的 3D 原圖、AI 版本、參考圖放在同一張無限畫布上；用區域指令修改，匯入結果時自動放大回原尺寸、鏡位對位、選區外回貼原圖、水波紋篩查；另有物件聖經（跨視角一致）、360 環景縫合與交付包。

- 正式網址：https://pure-render-studio.vercel.app（Vercel，`main` push 即部署）
- 與營運儀表板 `BansonLin/Pure-Dashboard` **完全分開**（不同 repo、不同登入白名單、不同 cookie）。不要把兩邊程式碼混在一起。

## 指令

```bash
npm install
npm run dev            # 本機開發；無 RESEND_API_KEY 時登入連結印在終端機
npx tsc --noEmit -p .  # 型別檢查
npm run lint
npm run build          # 推送前必跑
```

推送前最少跑 `tsc`、`lint`、`build` 三項；改到畫布／手勢要用手機模擬（見下方「測試」）。

## 技術棧

Next.js 14.2（App Router）＋ TypeScript ＋ Tailwind（CSS 變數色票，支援深色）＋ zustand ＋ IndexedDB。登入：Email magic link（Resend）＋ jose JWT，`middleware.ts` fail-closed（未登入一律擋）。畫布、ZIP、WebGL 環景檢視器皆自寫，無第三方繪圖套件。

## 目錄

| 路徑 | 內容 |
|---|---|
| `app/(studio)/page.tsx` | 專案列表（首頁） |
| `app/(studio)/p/[projectId]/page.tsx` | 專案工作區：畫布／物件聖經／360 環景／交付 |
| `app/login`、`app/api/auth/*` | 登入頁、寄信、回呼、登出；cookie 名 `render_session` |
| `app/api/render/generate`、`status` | OpenAI 出圖（伺服器呼叫，金鑰取自後台，其次 Vercel 環境變數） |
| `app/api/review` | Claude 看圖驗收（伺服器呼叫） |
| `app/api/settings`、`settings/key` | 公司設定讀寫（管理者才能改）、金鑰設定／測試／清除 |
| `app/(studio)/settings`、`components/settings/` | 設定頁：金鑰、模型、全公司月上限、用量、空間與圖號預設 |
| `lib/server/` | 只在伺服器執行：`store`（Vercel Blob 私有／本機檔案）、`crypto`（AES-GCM）、`company`（設定、用量、上限）、`openai`、`claude`、`session` |
| `components/render/` | `Workspace`、`CanvasBoard`（畫布＋手勢）、`VersionEditor`、`AnnotationStage`（框選／筆刷／比較）、`ScenePanel`、`PanoPanel`、`DeliveryPanel` |
| `lib/render/types.ts` | 領域型別：視角、版本、區域、場景物件、全景、專案 |
| `lib/render/workflow.ts` | 版本狀態機；主圖改版 → 衍生版本「需重驗」 |
| `lib/render/prompt-blocks.ts`、`compiler.ts` | 提示詞積木與分段編譯 |
| `lib/render/composite.ts`、`qa/align.ts` | 回原尺寸、鏡位對位、選區回貼 |
| `lib/render/qa/ripple.ts` | 水波紋篩查（純函式，可在 Node 跑） |
| `lib/render/pano/` | 360 縫合、WebGL 檢視器、客戶單檔 HTML、全景切 6 面 |
| `lib/render/db.ts`、`store/render-store.ts` | IndexedDB 儲存、zustand 狀態 |
| `lib/render/company-types.ts`、`company.ts` | 公司設定共用型別、預設空間與圖號、圖號建議；瀏覽器端讀寫 hook |
| `lib/render/settings.ts` | 本裝置小偏好（只有核准者姓名） |
| `lib/render/provider.ts` | 出圖供應商：手動任務包、伺服器路由 |
| `lib/render/claude.ts` | Claude 驗收的瀏覽器端：準備圖片與說明、呼叫 `/api/review` |
| `components/render/ViewDialog.tsx` | 新增／編輯視角：插入圖片、空間選單、圖號自動、主圖關係 |
| `lib/render/options.ts` | 表單選項（樓層、景別、錨點、風格…） |
| `lib/render/seed.ts` | 「中道森活一樓」範本專案（不含客戶圖片） |

## 必守規則

1. **客戶圖面不進 git**：渲染圖、平面圖、建商資料一律不 commit（含測試素材）。範本只放文字設定。
2. **不讀、不產生、不印出秘密值**：`AUTH_SECRET`、`RESEND_API_KEY`、`BLOB_READ_WRITE_TOKEN` 等在 Vercel；OpenAI／Claude 金鑰由管理者在工作台「設定」頁輸入，加密存後台。不要在對話索取金鑰、不要用 Vercel MCP 解密環境變數或讀後台設定檔；測試一律用本機模擬供應商（`OPENAI_BASE_URL`、`ANTHROPIC_BASE_URL`）＋`SETTINGS_STORE_DIR`。
3. **付費 API 預設關閉**：後台沒金鑰、Vercel 也沒開 `RENDER_LIVE=1`＋`OPENAI_API_KEY`＋`OPENAI_IMAGE_MODEL` 時不可呼叫；不要自行開啟或預填金鑰。每次 1 張、每次勾同意、不自動重試（SDK `maxRetries: 0`）、結果未知不重送；全公司月上限由伺服器把關（`assertUnderCap`），供應商後台另設硬上限。
7. **金鑰只在伺服器解密使用**：回應、log、錯誤訊息、IndexedDB、專案備份、交付包、提示詞、事件紀錄一律不可含金鑰（只給末四碼）；寫入設定一律檢查管理者（`isAdminEmail`）。
4. **不 force-push、不改寫 `main` 歷史**。功能用分支＋PR。
5. **資料在使用者瀏覽器**（IndexedDB，綁網域）。目前 `db.ts` 讀取時**沒有**資料遷移，改 `types.ts` 結構（新增必填欄位、改名）會讓使用者既有專案壞掉：新欄位一律設為選填並在使用處給預設值，或先在 `getProject` 加遷移函式。換網域等於資料歸零，必須先提醒匯出備份。
6. 介面文字一律繁體中文；註解說明「為什麼」，不寫「做了什麼」。

## 核心慣例（改動前先讀）

- **單跳原則**：新版本預設以 3D 原圖為底（`BaseStrategy = "original"`），避免多輪全圖重生成累積水波紋；`generationDepth` 追蹤世代（G0/G1…），鏈式重生成會警示。
- **鏡位對位**：`qa/align.ts` 在梯度圖上做粗到細的縮放＋位移搜尋。座標約定：底圖像素 x ↔ 結果位置 `u = (x − cx − dx) / s + cx`。
- **選區回貼**：選區外一律還原底圖像素（羽化邊緣）；選區內是重採樣，非原生細節（會提示使用者）。
- **水波紋篩查**：DoG 帶通（σ 0.8／2.6）＋排除邊緣＋逐格能量對照原圖＋結構張量一致性加權。這是「篩查輔助」，已知誤報：百葉陰影、薄紗窗簾褶。
- **提示詞分段**：IMAGE ROLES / PRESERVE / CHANGES / SCENE CONTRACT / SURFACE / LIGHTING / CONSISTENCY / STYLE / REJECT；有編輯區時場景契約自動關閉。
- **360 縫合**：投影到 equirect → 用接縫樣本（優先重疊區）做對數域增益校色，增益夾在 0.74–1.35 → 羽化 → 極區補色並標記為「非真實」→ 接縫報告。
- **公司設定（後台）**：`settings/company.json`（金鑰以 `v1.` 開頭的 AES-GCM 密文＋末四碼、模型、上限、空間預設）與 `usage/YYYY-MM.json`（全公司與每人用量），存在 Vercel Blob（private，`useCache: false` 讀、ETag 樂觀鎖寫）。模型清單由「測試並儲存」呼叫供應商 `/v1/models` 動態載入，不寫死。管理者＝`ADMIN_EMAILS`，未設定時是 `ALLOWED_EMAILS` 第一位。出圖與驗收路由 `maxDuration = 300`。Claude 在伺服器用 `@anthropic-ai/sdk`；Opus 5.5／Sonnet 5.5 等加 `fallbacks: "default"`；結果寫在選填欄位 `qa.aiReview`，只是建議，判定與核准仍由人按。
- **空間與圖號**：新增視角的空間清單來自後台 `rooms`（`DEFAULT_ROOMS` 為預設）；圖號留空時 `suggestViewNumbers` 依起始號找空號，沒起始號接最大號。視角圖號建立後不可改（版本、物件聖經、釘選都以圖號串接）；其他欄位用 `updateView` 改。
- **表單用選的**：有限選項用 `select`、常見但開放的用 `datalist`、需要兩者時用 `ChoiceInput`（選單＋「其他（自行輸入）」）；選項放 `options.ts`。使用者原文欄位（本輪需求、區域說明）維持自由文字。
- **跨裝置**：資料不同步，靠「專案備份」JSON 搬移；`importBackup(parsed, { replace })` 先寫新資料、最後才刪舊圖。**不要加 `display: standalone` 的 web manifest**：iOS 主畫面網頁 App 與 Safari 分開存登入與資料，magic link 會開在 Safari，使用者會卡在登入頁（登入改驗證碼後再評估）。
- **畫布手勢**（`CanvasBoard.tsx`）：以 pointerId 追蹤，單指平移、雙指縮放；新鏡頭一律由「手勢開始時的快照」計算，**不要在 setState updater 裡讀 ref**（曾造成手機雙指收合當機）。觸控時卡片標頭交給畫布平移，拖曳排列只限滑鼠。

## 測試

沒有單元測試框架；以 Playwright（`playwright-core`，Chromium 在 `/opt/pw-browsers`）對 `next start` 跑端對端腳本：

- 桌機：載入範本 → 上傳原圖 → 開版本／框選 → 匯入 AI 結果（驗證放大、對位、回貼、水波紋）→ 核准 → 360 縫合 → 交付 ZIP。
- 手機：`isMobile + hasTouch`，用 CDP `Input.dispatchTouchEvent` 模擬單指滑、雙指放大／收合、雙指中途放開一指、快速連續縮放；檢查無 `Application error`、無 pageerror。
- 測試用 cookie：本機用測試 `AUTH_SECRET` 簽一個 `render_session` JWT，**不要用正式金鑰**。
- 後台與供應商：`SETTINGS_STORE_DIR=<scratchpad 資料夾>` 讓設定存本機檔案；自寫模擬伺服器回應 `/v1/models`、`/v1/images/edits`、`/v1/messages`，以 `OPENAI_BASE_URL`、`ANTHROPIC_BASE_URL` 指過去（記得 `NO_PROXY=localhost`）。驗證：金鑰不出現在 API 回應與 localStorage、非管理者 PATCH 回 403、月上限回 429。
- 測試素材放 scratchpad（ASCII 檔名，Playwright `setFiles` 不吃中文路徑），不進 repo。

## 部署

- Vercel 專案 `pure-render-studio`（`prj_la73i3dTJexYMp0tEmLYznqVJ7KL`），team `team_CTsWcuDLbXYaWj0t2CLzKd7A`。Vercel MCP 呼叫時**不要帶 teamId**（帶了會 403），預設 team 即可。
- 環境變數（名稱）：`AUTH_SECRET`、`ALLOWED_EMAILS`、`RESEND_API_KEY`、`EMAIL_FROM`、`APP_URL`、`BLOB_READ_WRITE_TOKEN`（Blob store `render-studio-settings` 連線時自動加入）；選用 `ADMIN_EMAILS`、`RENDER_LIVE`、`OPENAI_API_KEY`、`OPENAI_IMAGE_MODEL`。範例見 `.env.example`。
- 注意：`AUTH_SECRET` 只設在 Production，預覽部署無法登入（fail-closed），測試請在本機跑。
- `EMAIL_FROM=onboarding@resend.dev` 只能寄給 Resend 帳號本人；要讓同事登入，需先在 Resend 驗證公司網域並改 `EMAIL_FROM`。
