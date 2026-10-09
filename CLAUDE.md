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
| `app/api/render/generate`、`status` | OpenAI 影像 API 伺服器路由（公司共用金鑰，**預設關閉**） |
| `app/(studio)/settings`、`components/settings/` | 裝置設定頁：OpenAI／Claude 金鑰、模型下拉、每月上限 |
| `components/render/` | `Workspace`、`CanvasBoard`（畫布＋手勢）、`VersionEditor`、`AnnotationStage`（框選／筆刷／比較）、`ScenePanel`、`PanoPanel`、`DeliveryPanel` |
| `lib/render/types.ts` | 領域型別：視角、版本、區域、場景物件、全景、專案 |
| `lib/render/workflow.ts` | 版本狀態機；主圖改版 → 衍生版本「需重驗」 |
| `lib/render/prompt-blocks.ts`、`compiler.ts` | 提示詞積木與分段編譯 |
| `lib/render/composite.ts`、`qa/align.ts` | 回原尺寸、鏡位對位、選區回貼 |
| `lib/render/qa/ripple.ts` | 水波紋篩查（純函式，可在 Node 跑） |
| `lib/render/pano/` | 360 縫合、WebGL 檢視器、客戶單檔 HTML、全景切 6 面 |
| `lib/render/db.ts`、`store/render-store.ts` | IndexedDB 儲存、zustand 狀態 |
| `lib/render/settings.ts` | 裝置設定（localStorage）：金鑰、模型、用量、核准者 |
| `lib/render/provider.ts` | 出圖供應商：手動、伺服器路由、瀏覽器直連 OpenAI |
| `lib/render/claude.ts` | Claude 看圖驗收（`@anthropic-ai/sdk`，瀏覽器直連、結構化輸出） |
| `lib/render/options.ts` | 表單選項（樓層、空間、景別、錨點、風格…） |
| `lib/render/seed.ts` | 「中道森活一樓」範本專案（不含客戶圖片） |

## 必守規則

1. **客戶圖面不進 git**：渲染圖、平面圖、建商資料一律不 commit（含測試素材）。範本只放文字設定。
2. **不讀、不產生、不印出秘密值**：`AUTH_SECRET`、`RESEND_API_KEY`、`OPENAI_API_KEY` 由 Banson 在 Vercel 以 Secret 類型自行輸入；OpenAI／Claude 金鑰也可由使用者在工作台「設定」頁自行輸入（只存該裝置 localStorage）。不要在對話索取金鑰，測試一律 mock 供應商回應。
3. **付費 API 預設關閉**：裝置沒填金鑰、伺服器也沒開 `RENDER_LIVE=1`＋`OPENAI_API_KEY`＋`OPENAI_IMAGE_MODEL` 時不可呼叫；不要自行開啟或預填金鑰。每次 1 張、每次勾同意、不自動重試（SDK `maxRetries: 0`）、結果未知不重送；裝置每月上限只是軟性提醒，硬上限在供應商後台。
7. **金鑰不得進入專案資料**：不可寫進 IndexedDB、專案備份、交付包、提示詞或事件紀錄；也不要送到璞石自己的 API 路由（瀏覽器直連供應商）。
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
- **裝置設定**（`settings.ts`）：金鑰與模型存在 `localStorage`（`prs.device-settings.v1`），用量在 `prs.device-usage.v1`。模型清單由「測試並儲存」呼叫供應商 `/v1/models` 動態載入，不寫死模型名稱。出圖：有裝置金鑰就瀏覽器直連 `api.openai.com`，否則走伺服器路由。Claude：只在按下檢查時動態載入 SDK 與 zod；Opus 5.5／Sonnet 5.5 等加 `fallbacks: "default"`；結果寫在選填欄位 `qa.aiReview`，只是建議，判定與核准仍由人按。
- **表單用選的**：有限選項用 `select`、常見但開放的用 `datalist`、需要兩者時用 `ChoiceInput`（選單＋「其他（自行輸入）」）；選項放 `options.ts`。使用者原文欄位（本輪需求、區域說明）維持自由文字。
- **跨裝置**：資料不同步，靠「專案備份」JSON 搬移；`importBackup(parsed, { replace })` 先寫新資料、最後才刪舊圖。**不要加 `display: standalone` 的 web manifest**：iOS 主畫面網頁 App 與 Safari 分開存登入與資料，magic link 會開在 Safari，使用者會卡在登入頁（登入改驗證碼後再評估）。
- **畫布手勢**（`CanvasBoard.tsx`）：以 pointerId 追蹤，單指平移、雙指縮放；新鏡頭一律由「手勢開始時的快照」計算，**不要在 setState updater 裡讀 ref**（曾造成手機雙指收合當機）。觸控時卡片標頭交給畫布平移，拖曳排列只限滑鼠。

## 測試

沒有單元測試框架；以 Playwright（`playwright-core`，Chromium 在 `/opt/pw-browsers`）對 `next start` 跑端對端腳本：

- 桌機：載入範本 → 上傳原圖 → 開版本／框選 → 匯入 AI 結果（驗證放大、對位、回貼、水波紋）→ 核准 → 360 縫合 → 交付 ZIP。
- 手機：`isMobile + hasTouch`，用 CDP `Input.dispatchTouchEvent` 模擬單指滑、雙指放大／收合、雙指中途放開一指、快速連續縮放；檢查無 `Application error`、無 pageerror。
- 測試用 cookie：本機用測試 `AUTH_SECRET` 簽一個 `render_session` JWT，**不要用正式金鑰**。
- 測試素材放 scratchpad（ASCII 檔名，Playwright `setFiles` 不吃中文路徑），不進 repo。

## 部署

- Vercel 專案 `pure-render-studio`（`prj_la73i3dTJexYMp0tEmLYznqVJ7KL`），team `team_CTsWcuDLbXYaWj0t2CLzKd7A`。Vercel MCP 呼叫時**不要帶 teamId**（帶了會 403），預設 team 即可。
- 環境變數（名稱）：`AUTH_SECRET`、`ALLOWED_EMAILS`、`RESEND_API_KEY`、`EMAIL_FROM`、`APP_URL`；選用 `RENDER_LIVE`、`OPENAI_API_KEY`、`OPENAI_IMAGE_MODEL`。範例見 `.env.example`。
- `EMAIL_FROM=onboarding@resend.dev` 只能寄給 Resend 帳號本人；要讓同事登入，需先在 Resend 驗證公司網域並改 `EMAIL_FROM`。
