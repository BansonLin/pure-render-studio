# 交接文件 — 璞石 Render Studio

> 更新：2026-10-10｜用途：在新的 Claude Code 對話（只選 `BansonLin/pure-render-studio`）接續開發時，先讀本檔與 `CLAUDE.md`。

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
| 2026-10-09 | 確認平板／手機使用方式；跨裝置「匯入備份」可覆蓋、申請瀏覽器長期保存、登入信與登入頁加註「同一台裝置、用 Safari／Chrome 開」（PR #2 合併） | 見第 7 節與 `docs/DEVICE-GUIDE.md` |
| 2026-10-09 | Banson 要求「設定頁可填 OpenAI、Claude 金鑰」與「表單盡量用選單」 | Claude 用於看圖驗收建議；見第 8 節 |
| 2026-10-10 | Banson 要求「金鑰輸入一次、記錄在後台」、空間名稱用選單並預設常用空間、圖號有預設且留空自動編 | 建立 Vercel Blob 私有儲存 `render-studio-settings`（`store_o3K4XvEjOxrKjUaY`，iad1）；金鑰 AES-GCM 加密存後台、伺服器代呼叫；管理者才能改；全公司月上限伺服器把關；空間與圖號預設存後台可編；見第 8 節與 `docs/SETTINGS-GUIDE.md` |

其他已定案：
- **生成供應商**：V1 以「ChatGPT 任務包（手動）」為主；OpenAI API 路由已寫好但**預設關閉**，未用真金鑰實測。是否開 API，等 P0 試跑數據（每張工時、修正輪數、單張費用）再決定。
- **金鑰放哪裡**（2026-10-10 改定）：後台集中保管。Vercel Blob（private）存 `settings/company.json`，金鑰以 `AUTH_SECRET` 衍生的 AES-256-GCM 加密；只有伺服器解密，瀏覽器只拿到末四碼。出圖、驗收都由伺服器路由呼叫（`maxDuration = 300`）。管理者＝`ADMIN_EMAILS`，未設定時為白名單第一位。原本「裝置 localStorage＋瀏覽器直連」的做法（PR #3 第一版）已移除，舊的 localStorage 金鑰在使用者下次記住核准者時被清掉。換 `AUTH_SECRET` 需重新輸入金鑰。
- **預算上限**：全公司每月張數／次數上限存在後台、伺服器在呼叫供應商前檢查（`usage/YYYY-MM.json`，含每人用量）。供應商後台硬上限仍建議設定。
- **Claude 的角色**：看圖驗收建議（對照底圖與結果、逐項給建議與問題清單），不改寫使用者原文、不自動核准。
- **出圖的 AI 是誰**（Banson 2026-10-09 問）：真正畫圖的是 OpenAI 的影像模型——手動模式用設計師自己的 ChatGPT 訂閱；API 模式用 OpenAI API 帳戶按張計費（模型由 `OPENAI_IMAGE_MODEL` 指定）。**不是** Claude／Claude Code 訂閱：Claude 只輸出文字、不產生圖片，Claude Code 是開發這套工具用的；訂閱也不能當網站後端，網站要用 Claude 得另開 Anthropic API 帳戶計費。放大、對位、回貼、水波紋、360 縫合都是瀏覽器內的演算法，不是 AI、不收費。
- **儲存**：專案資料仍在使用者瀏覽器（IndexedDB）；後台 Blob 目前只放公司設定與用量。專案改存伺服器（多人共用）列 P1，可沿用同一個 Blob store。
- **360 路線**：先支援既有 4 張圖縫合（頂／底為補色、非真實）；長期應在 3D 端直接輸出 6 面或全景圖。

## 4. 環境與帳號（只記名稱，不記秘密值）

| 項目 | 值 |
|---|---|
| GitHub | `BansonLin/pure-render-studio`，預設分支 `main` |
| Vercel 專案 | `pure-render-studio`（`prj_la73i3dTJexYMp0tEmLYznqVJ7KL`），team `bansonlins-projects`（`team_CTsWcuDLbXYaWj0t2CLzKd7A`） |
| 正式網址 | https://pure-render-studio.vercel.app |
| 部署方式 | Git 連動：`main` push → 正式部署；PR 分支 → 預覽部署 |
| 環境變數 | `AUTH_SECRET`（Secret）、`RESEND_API_KEY`（Secret，2026-10-09 新產生）、`ALLOWED_EMAILS`（目前只有 Banson）、`EMAIL_FROM=onboarding@resend.dev`、`APP_URL` |
| 後台儲存 | Vercel Blob `render-studio-settings`（private，iad1，`store_o3K4XvEjOxrKjUaY`），已連到專案三個環境，自動加入 `BLOB_READ_WRITE_TOKEN` |
| 選用（未設定） | `ADMIN_EMAILS`、`RENDER_LIVE`、`OPENAI_API_KEY`、`OPENAI_IMAGE_MODEL`（後三者為舊做法，建議改用設定頁） |
| 姊妹專案 | `BansonLin/Pure-Dashboard`（營運儀表板，https://pure-dashboard.vercel.app）：**不同 repo、不同白名單、不同 cookie，勿交叉修改** |

## 5. 已知限制與風險

| 優先 | 項目 | 影響 | 建議處理 |
|---|---|---|---|
| 財務 | 全公司月上限以「張／次」計，不是金額 | 高品質大圖單價較高時，同樣張數花費不同 | 供應商後台設金額硬上限；P0 試跑後依實際單價調整張數上限 |
| 法律 | 建商圖面上傳 OpenAI／ChatGPT 是否違反保密條款 | 合約風險 | Banson／法務確認合約（需專業人士最終確認） |
| 單點故障 | 資料只在單一瀏覽器 | 換電腦、清快取即消失 | 每案結束在「交付」頁匯出專案備份；P1 做伺服器儲存 |
| 同事登入 | `onboarding@resend.dev` 只能寄給 Resend 帳號本人 | 設計師收不到登入信 | Resend 驗證公司網域 → 改 `EMAIL_FROM` → `ALLOWED_EMAILS` 加入同事 |
| 存取 | Vercel 專案開著 Deployment Protection（`all_except_custom_domains`） | 預覽網址可能要求 Vercel 登入；正式網址不受影響 | 需要分享預覽網址時再調整 |
| 隱私 | Vercel「Improve models with this project's data」預設開啟 | 專案資料可能被用於改進模型 | 建議 Banson 在 Vercel 設定關閉 |
| 品質 | 水波紋篩查有誤報（百葉陰影、薄紗窗簾褶） | 需人工判讀 | 篩查只當輔助，驗收仍以人工 100% 檢視為準 |
| 單點故障 | iPad／iPhone Safari：連續 7 天用 Safari 但沒開本站，可能清掉本站資料（WebKit 追蹤防護） | 停工一週的專案在 iPad 上消失 | 停工前匯出備份；已呼叫 `navigator.storage.persist()`，但 Safari 分頁多半不給；根治靠 P1 伺服器儲存 |
| 存取 | iOS 26 起「加入主畫面」預設開成獨立網頁 App，登入與資料跟 Safari 分開，magic link 卻開在 Safari | 主畫面圖示一直要求登入、看不到專案 | 使用說明要求關掉「以網頁 App 開啟」；**不要加 `display: standalone` 的 manifest**，除非登入改成驗證碼 |
| 財務 | 若開 API：`gpt-image-1` 據第三方資料將於 2026-10-23 退役 | 設成舊模型會出錯 | 設定頁模型清單即時從 OpenAI 載入，舊模型標「即將退役」 |
| 資安 | 後台金鑰的安全取決於 `AUTH_SECRET` 與 `BLOB_READ_WRITE_TOKEN` | 兩者同時外流才可能解出金鑰 | 兩者皆為 Vercel 加密環境變數；不要在對話或文件貼出；懷疑外流時到供應商後台撤銷金鑰並重新輸入 |
| 資安 | 白名單內任何人都能用公司金鑰出圖 | 設計師可能大量使用 | 全公司月上限＋每人用量表；只有管理者能改上限與金鑰 |
| 法律 | 新增 Anthropic 為圖面接收方（驗收） | 合約保密條款 | 與 P0 合約確認一併處理（需專業人士最終確認） |
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

## 8. 設定頁、AI 直連出圖、Claude 驗收、表單選單（2026-10-09）

> 本節是第一版。金鑰存放與呼叫方式已在 8.1 改為後台集中保管、伺服器代呼叫；其餘（Claude 驗收內容、表單選單）沿用。

- **設定頁** `/settings`（表頭齒輪）：OpenAI、Claude 各一張卡：貼金鑰 →「測試並儲存」（呼叫 `/v1/models`，失敗不儲存）→ 模型下拉（OpenAI 只列 `gpt-image*`，預設最新；Claude 列可看圖的模型，預設 Opus 5.5）→ 品質／細心程度／每月上限下拉 → 本月用量。顯示遮罩後的金鑰（前 3 碼＋末 4 碼），可重新測試、更換、清除。
- **出圖**：版本頁「2 生成」在有裝置金鑰時預設選「OpenAI API」，顯示模型與本月剩餘張數；達上限按鈕停用。用量只在成功或結果未知時計入（明確被拒不算）。
- **Claude 驗收**：「3 驗收」新增「Claude 看圖驗收」區塊；2 張 2048 寬 JPEG＋區域指令＋場景物件＋檢查清單，結構化輸出（摘要、是否照指令、逐項建議、問題清單含位置與嚴重度）。檢查清單每項顯示建議與「採用」，另有「把建議填進尚未判定的檢查項」（不覆蓋已判定的）。結果下方顯示模型、時間、估算費用。
- **表單選單**：新專案樓層、新增視角（空間＋景別自動命名、編號自動接續）、物件數量、修正上限、360 水平視角與角度改下拉；錨點、風格基準、核准者（記住用過的名字）、問題描述改「可選或輸入」；檢查清單備註改「位置＋問題」。
- **實測【實際】**（mock 供應商回應，未用真金鑰）：桌機與 iPad 橫放各跑一次：設定兩把金鑰 → 模型預設正確（gpt-image-2、claude-opus-5-5）→ 範本、上傳、框選 → API 出圖（送出 model、quality、遮罩、Bearer 金鑰皆正確）→ 自動匯入對位 → Claude 驗收（直連標頭、`fallbacks: "default"`、effort、json_schema、2 張圖、7 項清單）→ 採用建議 → 核准 → 匯出備份不含金鑰。錯誤情境：錯誤金鑰不儲存、連線中斷 → 結果未知、403 組織驗證提示、Claude 拒絕提示，皆無 pageerror。
- **尚未驗證**：真實 OpenAI／Anthropic 呼叫（需 Banson 填真金鑰後各跑 1 次）；OpenAI API 的瀏覽器 CORS 未能在開發環境實測（Anthropic 已確認允許）。

### 8.1 金鑰改存後台、空間與圖號預設、編輯視角（2026-10-10）

- **後台**：`lib/server/`（`store` Blob／本機檔案、`crypto` AES-GCM、`company` 設定＋用量＋上限、`openai`、`claude`、`session`）。API：`GET/PATCH /api/settings`、`POST/DELETE /api/settings/key`、`POST /api/review`；`/api/render/generate` 改用後台金鑰並檢查上限。
- **設定頁**：管理者輸入金鑰一次（先向供應商查模型清單，成功才加密存檔）；之後顯示「••••末四碼、誰、何時設定」，可重新測試、更換、清除。模型、品質、細心程度、全公司月上限用下拉；本月每人用量表；「空間與圖號預設」表（名稱、起始圖號、上下移、刪除、新增、恢復預設）。非管理者唯讀。
- **新增視角／插入圖片**（`ViewDialog`）：可直接選 3D 原圖；空間下拉來自後台；景別下拉；名稱自動＝空間＋景別；圖號留空自動（有起始號找空號，否則接最大號），也有下拉建議；重複提示。
- **編輯視角**：視角標頭鉛筆按鈕，可改名稱、空間、角色、依賴主圖（圖號不可改）。
- **實測【實際】**（本機檔案儲存＋模擬供應商，未用真金鑰）：錯誤金鑰不存；存檔為密文、不含原始金鑰；`/api/settings` 不含金鑰；管理者換到 iPad 不用重填；設計師 PATCH／設定金鑰皆 403；客廳（起始 200）→ 200、視聽室（新增 300）→ 300、主臥 → 50，名稱自動；插入圖片同時建立視角＋原圖；編輯 34 只依賴 20 後連線剩 3 條；伺服器出圖用後台金鑰與 gpt-image-2；Claude 驗收用後台金鑰、`fallbacks: "default"`、2 張圖；用量 1／1 且記到使用者；用量達 10 時回 429；無 pageerror。
- **連續新增視角殘留上一次景別**：測試發現後已修（表單放進 Modal 內，關閉即重置）。

## 9. 待辦（建議順序）

| 優先 | 事項 | 驗收標準 | 負責 |
|---|---|---|---|
| P0 | 用一樓 20／33／29／34 跑完整流程一次，**記錄數據** | 每視角生成次數、耗時、水波紋％、是否一次核准 | 設計主管＋1 位設計師 |
| P0 | 確認建商合約對圖面上傳第三方 AI 的限制 | 書面結論 | Banson／法務 |
| P0 | Resend 驗證網域、開放同事登入 | 設計師可自行收信登入 | Banson（DNS）＋開發 |
| P0 | iPad 實機 Safari 走一次完整流程（依 `docs/DEVICE-GUIDE.md`） | 下載任務包、匯入結果、匯出／匯入備份皆正常 | Banson 或設計主管 |
| P0 | 在設定頁填真金鑰各試 1 次：OpenAI 出圖、Claude 驗收（依 `docs/SETTINGS-GUIDE.md`），並在兩家後台設每月硬上限 | 出圖自動匯入成功；驗收建議合理；記錄單次費用 | Banson |
| P0 | 把「空間與圖號預設」改成公司慣用編號 | 新增視角時圖號自動帶出正確號碼 | Banson |
| P1 | 專案改存伺服器＋多人共用（可沿用 Vercel Blob） | 換電腦、平板、手機可續作 | 開發 |
| P1 | 登入改 Email 驗證碼（需伺服器端記錄嘗試次數） | 在 iPad 輸入碼即登入，不受信件開在哪個瀏覽器影響；可安全加 PWA | 開發 |
| P1 | IndexedDB 資料遷移機制（`db.ts`） | 改資料結構不會弄壞既有專案 | 開發 |
| P1 | 「不確定／假設事項」欄位、玻璃／鏡面語意積木 | 宜蘭案「室內門被畫成戶外」類錯誤不再發生 | 開發 |
| P2 | 3D 端輸出 Material ID／物件 ID 通道 → 自動產生精準選區 | 選區從手框變自動 | 開發＋3D 設計師 |
| P2 | 360 輸出規範寫進 3D 出圖 SOP（同點位、6 面或直出全景） | 每案可直接縫合、無補色區 | 設計主管 |

## 10. 新對話怎麼開始

1. 在 Claude Code 開新工作階段，**只選 `BansonLin/pure-render-studio` 這個 repo**（不要同時選 `Pure-Dashboard`）。
2. 第一句可以這樣說：「讀 `CLAUDE.md` 和 `docs/HANDOFF.md`，接續 Render Studio 開發。這次要做：＿＿＿」。
3. 要附客戶圖面測試時，直接在對話中上傳；Claude 只會放在暫存區，不會提交到 GitHub。
4. 需要改 Vercel 設定時，Claude 可透過 Vercel 連接器操作；秘密值仍由 Banson 自己在 Vercel 介面輸入。
