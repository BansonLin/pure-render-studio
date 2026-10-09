# 交接文件 — 璞石 Render Studio

> 更新：2026-10-09｜用途：在新的 Claude Code 對話（只選 `BansonLin/pure-render-studio`）接續開發時，先讀本檔與 `CLAUDE.md`。

## 1. 一句話現況

V1 已上線（https://pure-render-studio.vercel.app），Banson 可登入、可在手機與桌機操作畫布；尚未用真實專案跑完一次完整流程（P0）。

## 2. 起源與要解決的問題

Banson 原本用 GPT（ChatGPT 對話＋內建 image_gen）優化 3D 渲染圖，遇到三個問題，另有一個新需求：

| # | 問題 | 根因（已實測） | 工具中的對策 |
|---|---|---|---|
| 1 | 第 2、3 次修改後出現水波紋、看錯圖 | 多輪**全圖重生成**疊加＋解析度流失（2048×1152 → 1672×941）【實際】 | 單跳原則（每版都從 3D 原圖出發）、匯入時放大回原尺寸、選區外回貼原圖像素、世代深度警示、水波紋篩查 |
| 2 | 不同視角的道具、比例不一致 | 物件只用文字描述，每個視角各自重新想像 | 物件聖經（規格、數量、空間錨點、各視角可見性、參考裁切）；主圖核准後衍生視角自動帶入主圖當參考；主圖改版 → 衍生版本「需重驗」 |
| 3 | AI 偷偷改構圖 | 視角 34 被放大約 5%、位移約 29, 54 px（2048 寬）【實際】 | 匯入時自動鏡位對位（縮放＋位移搜尋）並提示偏移量 |
| 4 | 4 張圖拼成 360 環景 | — | 同點位 4 張／6 面／N 張縫合、校色、接縫報告、WebGL 檢視器、客戶用單檔 HTML |

參考來源：Banson 上傳的 V2.2 工作台 HTML，以及「中道森活一樓」四輪協作報告、「中道二樓／三樓／宜蘭游公館」三案比較報告（2026-10-09 快照）。**這些原始檔與客戶圖面不在 repo 內**，也不應放進來；評估結論已整理在 `docs/RENDER-STUDIO-EVALUATION.md`。

## 3. 時間線與決策紀錄

| 日期 | 事件 | 決策／理由 |
|---|---|---|
| 2026-10-09 | 在 `Pure-Dashboard` 內做出渲染工作台 V1（PR #1 合併） | 先求可試用 |
| 2026-10-09 | Banson 決定獨立成 `pure-render-studio`（方案 B） | 設計師用工作台不該看到營運財務資料；部署、白名單、程式碼互不影響 |
| 2026-10-09 | `Pure-Dashboard` PR #2 移除渲染模組（squash `675d531`，正式環境已部署 READY） | 避免兩邊重複維護 |
| 2026-10-09 | 本 repo 初始提交 `b50de68`、Vercel 專案建立、5 個環境變數設定完成、Banson 登入成功 | — |
| 2026-10-09 | 修正手機雙指收合當機（Application error）＋ 360 檢視器雙指縮放亂轉 | 見第 6 節；Banson 實機確認不再閃退 |
| 2026-10-09 | 確認平板／手機使用方式；跨裝置「匯入備份」可覆蓋、申請瀏覽器長期保存、登入信與登入頁加註「同一台裝置、用 Safari／Chrome 開」 | 見第 7 節與 `docs/DEVICE-GUIDE.md` |

其他已定案：
- **生成供應商**：V1 以「ChatGPT 任務包（手動）」為主；OpenAI API 路由已寫好但**預設關閉**，未用真金鑰實測。是否開 API，等 P0 試跑數據（每張工時、修正輪數、單張費用）再決定。
- **出圖的 AI 是誰**（Banson 2026-10-09 問）：真正畫圖的是 OpenAI 的影像模型——手動模式用設計師自己的 ChatGPT 訂閱；API 模式用 OpenAI API 帳戶按張計費（模型由 `OPENAI_IMAGE_MODEL` 指定）。**不是** Claude／Claude Code 訂閱：Claude 只輸出文字、不產生圖片，Claude Code 是開發這套工具用的；訂閱也不能當網站後端，網站要用 Claude 得另開 Anthropic API 帳戶計費。放大、對位、回貼、水波紋、360 縫合都是瀏覽器內的演算法，不是 AI、不收費。
- **儲存**：V1 存在使用者瀏覽器（IndexedDB）。多人共用與伺服器儲存列 P1。
- **360 路線**：先支援既有 4 張圖縫合（頂／底為補色、非真實）；長期應在 3D 端直接輸出 6 面或全景圖。

## 4. 環境與帳號（只記名稱，不記秘密值）

| 項目 | 值 |
|---|---|
| GitHub | `BansonLin/pure-render-studio`，預設分支 `main` |
| Vercel 專案 | `pure-render-studio`（`prj_la73i3dTJexYMp0tEmLYznqVJ7KL`），team `bansonlins-projects`（`team_CTsWcuDLbXYaWj0t2CLzKd7A`） |
| 正式網址 | https://pure-render-studio.vercel.app |
| 部署方式 | Git 連動：`main` push → 正式部署；PR 分支 → 預覽部署 |
| 環境變數 | `AUTH_SECRET`（Secret）、`RESEND_API_KEY`（Secret，2026-10-09 新產生）、`ALLOWED_EMAILS`（目前只有 Banson）、`EMAIL_FROM=onboarding@resend.dev`、`APP_URL` |
| 選用（未設定） | `RENDER_LIVE`、`OPENAI_API_KEY`、`OPENAI_IMAGE_MODEL` |
| 姊妹專案 | `BansonLin/Pure-Dashboard`（營運儀表板，https://pure-dashboard.vercel.app）：**不同 repo、不同白名單、不同 cookie，勿交叉修改** |

## 5. 已知限制與風險

| 優先 | 項目 | 影響 | 建議處理 |
|---|---|---|---|
| 財務 | API 尚無伺服器端月預算上限 | 若開 API 可能超支 | 開 API 前先做預算上限（需資料庫） |
| 法律 | 建商圖面上傳 OpenAI／ChatGPT 是否違反保密條款 | 合約風險 | Banson／法務確認合約（需專業人士最終確認） |
| 單點故障 | 資料只在單一瀏覽器 | 換電腦、清快取即消失 | 每案結束在「交付」頁匯出專案備份；P1 做伺服器儲存 |
| 同事登入 | `onboarding@resend.dev` 只能寄給 Resend 帳號本人 | 設計師收不到登入信 | Resend 驗證公司網域 → 改 `EMAIL_FROM` → `ALLOWED_EMAILS` 加入同事 |
| 存取 | Vercel 專案開著 Deployment Protection（`all_except_custom_domains`） | 預覽網址可能要求 Vercel 登入；正式網址不受影響 | 需要分享預覽網址時再調整 |
| 隱私 | Vercel「Improve models with this project's data」預設開啟 | 專案資料可能被用於改進模型 | 建議 Banson 在 Vercel 設定關閉 |
| 品質 | 水波紋篩查有誤報（百葉陰影、薄紗窗簾褶） | 需人工判讀 | 篩查只當輔助，驗收仍以人工 100% 檢視為準 |
| 單點故障 | iPad／iPhone Safari：連續 7 天用 Safari 但沒開本站，可能清掉本站資料（WebKit 追蹤防護） | 停工一週的專案在 iPad 上消失 | 停工前匯出備份；已呼叫 `navigator.storage.persist()`，但 Safari 分頁多半不給；根治靠 P1 伺服器儲存 |
| 存取 | iOS 26 起「加入主畫面」預設開成獨立網頁 App，登入與資料跟 Safari 分開，magic link 卻開在 Safari | 主畫面圖示一直要求登入、看不到專案 | 使用說明要求關掉「以網頁 App 開啟」；**不要加 `display: standalone` 的 manifest**，除非登入改成驗證碼 |
| 財務 | 若開 API：`gpt-image-1` 據第三方資料將於 2026-10-23 退役 | 設成舊模型會出錯 | 開 API 時依 OpenAI 當期文件選模型（需確認） |
| 品牌 | AI 優化圖是示意，非施工依據 | 客戶誤解 | 對外圖面標「AI 優化示意」（交付 manifest 已註明） |

## 6. 最近一次修正：手機畫布當機

- **現象**：手機進入專案頁，稍微滑動（尤其雙指縮放）就出現「Application error: a client-side exception has occurred」。
- **根因**：畫布平移狀態放在單一 ref，`setCam` 的 updater 延後讀取 `pan.current`；雙指時另一根手指放開先把 ref 設為 `null`，updater 執行時讀到 `null` → `TypeError: Cannot read properties of null (reading 'cx')` → 整頁崩潰。第二根手指也會覆蓋第一根的起點。
- **修正**（`components/render/CanvasBoard.tsx`）：以 pointerId 追蹤每根手指；單指平移、雙指縮放（以雙指中點為縮放中心）；新鏡頭由手勢開始時的快照計算；手指增減時重新起算避免跳動；畫布設 `touch-action: none`；觸控時卡片區也能拖動畫布，卡片排列改為只限滑鼠；`setPointerCapture` 加防護。
- **順帶修正**（`lib/render/pano/viewer.ts` 與客戶 HTML）：360 檢視器雙指縮放時停止旋轉，不再亂跳。
- **驗證**【實際】：手機模擬 7 種手勢（單指滑、從卡片標頭滑、雙指放大、雙指收合、雙指中途放開一指、錯開落指、連續 5 次快速縮放）全部無錯誤；桌機滑鼠平移、拖曳卡片（位置有保存）、Ctrl＋滾輪縮放正常；完整流程（匯入、對位、核准、縫合、交付）無錯誤。

## 7. 平板／手機（2026-10-09）

- **怎麼用**：Safari／Chrome 開正式網址即可，不用裝 App。完整操作說明（給設計師）：`docs/DEVICE-GUIDE.md`。
- **實測【實際】**（Chromium 模擬，非實機 Safari）：iPad 直放 834×1194、橫放 1194×834、iPhone 390×844，各跑一次「載入範本 → 上傳原圖 → 開版本 → 觸控框選 → 下載任務包 → 匯入 AI 結果（放大、對位 3.6%／19,16 px、回貼、水波紋）」全數成功、無 pageerror。iPad 橫放為左圖右面板並排（`lg` 斷點 1024px），直放與手機改上下排列。
- **本次改動**：
  - `importBackup` 拆成 `readBackup`＋`importBackup(parsed, { replace })`：裝置上已有同一專案時，顯示兩邊最後修改時間、備份較舊時加警告，確認後覆蓋。寫入順序是先寫新圖與專案、最後才刪備份裡沒有的舊圖（`db.deleteAssets`），中途失敗不會只剩半個專案。實測：桌機 → iPad → 桌機來回、取消不變、確定後名稱更新且多餘圖片被清掉、舊備份會警告。
  - `RenderBoot` 啟動時呼叫 `navigator.storage.persist()`（瀏覽器可拒絕）。
  - 登入信與登入頁加註：連結在哪個瀏覽器打開就登入在哪個瀏覽器；Gmail／LINE 內建瀏覽器要改「在瀏覽器中開啟」。
- **尚未做**：iPad 實機 Safari 走一次（下載 ZIP／JSON、檔案挑選）；登入改驗證碼（可解決跨裝置與主畫面 App 問題，但沒有資料庫時無法限制猜碼次數，建議與 P1 伺服器儲存一起做）。

## 8. 待辦（建議順序）

| 優先 | 事項 | 驗收標準 | 負責 |
|---|---|---|---|
| P0 | 用一樓 20／33／29／34 跑完整流程一次，**記錄數據** | 每視角生成次數、耗時、水波紋％、是否一次核准 | 設計主管＋1 位設計師 |
| P0 | 確認建商合約對圖面上傳第三方 AI 的限制 | 書面結論 | Banson／法務 |
| P0 | Resend 驗證網域、開放同事登入 | 設計師可自行收信登入 | Banson（DNS）＋開發 |
| P0 | iPad 實機 Safari 走一次完整流程（依 `docs/DEVICE-GUIDE.md`） | 下載任務包、匯入結果、匯出／匯入備份皆正常 | Banson 或設計主管 |
| P1 | 伺服器儲存＋多人共用（R2／Supabase 擇一）、API 月預算上限 | 換電腦、平板、手機可續作；預算不超支 | 開發 |
| P1 | 登入改 Email 驗證碼（需伺服器端記錄嘗試次數） | 在 iPad 輸入碼即登入，不受信件開在哪個瀏覽器影響；可安全加 PWA | 開發 |
| P1 | IndexedDB 資料遷移機制（`db.ts`） | 改資料結構不會弄壞既有專案 | 開發 |
| P1 | 「不確定／假設事項」欄位、玻璃／鏡面語意積木 | 宜蘭案「室內門被畫成戶外」類錯誤不再發生 | 開發 |
| P2 | 3D 端輸出 Material ID／物件 ID 通道 → 自動產生精準選區 | 選區從手框變自動 | 開發＋3D 設計師 |
| P2 | 360 輸出規範寫進 3D 出圖 SOP（同點位、6 面或直出全景） | 每案可直接縫合、無補色區 | 設計主管 |

## 9. 新對話怎麼開始

1. 在 Claude Code 開新工作階段，**只選 `BansonLin/pure-render-studio` 這個 repo**（不要同時選 `Pure-Dashboard`）。
2. 第一句可以這樣說：「讀 `CLAUDE.md` 和 `docs/HANDOFF.md`，接續 Render Studio 開發。這次要做：＿＿＿」。
3. 要附客戶圖面測試時，直接在對話中上傳；Claude 只會放在暫存區，不會提交到 GitHub。
4. 需要改 Vercel 設定時，Claude 可透過 Vercel 連接器操作；秘密值仍由 Banson 自己在 Vercel 介面輸入。
