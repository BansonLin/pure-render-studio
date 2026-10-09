# 設定說明：OpenAI／Claude 金鑰 — 璞石 Render Studio

> 更新：2026-10-09｜對象：Banson、設計主管

## 1. 結論

右上角齒輪「設定」→ 貼上金鑰 → 按「測試並儲存」→ 從下拉選單挑模型。之後：

| 功能 | 需要 | 在哪裡用 |
|---|---|---|
| AI 直接出圖 | OpenAI 金鑰 | 版本頁「2 生成」→「OpenAI API」→ 勾同意 →「送出生成」，結果自動匯入、對位、回貼 |
| 看圖驗收建議 | Claude 金鑰 | 版本頁「3 驗收」→「請 Claude 檢查」→ 逐項建議，按「採用」或「把建議填進尚未判定的檢查項」 |
| ChatGPT 手動模式 | 不用金鑰 | 跟以前一樣，仍可隨時切回 |

## 2. 金鑰存在哪裡（安全）

- **只存在這台裝置的瀏覽器**。電腦、iPad 各輸入一次；清除網站資料會一起清掉。
- 不上傳璞石伺服器、不進「專案備份」與「交付包」（已實測備份檔不含金鑰）。
- 出圖與驗收時，瀏覽器**直接**連到 OpenAI／Anthropic，費用記在金鑰所屬帳戶。
- 共用電腦用完請在設定頁按「清除」。
- 不要把金鑰貼進任何對話（包括給 Claude Code 的開發對話）。

## 3. 取得 OpenAI 金鑰（出圖）

1. 到 https://platform.openai.com 登入公司帳號。
2. 左側 **Billing**：儲值或綁卡。
3. **Settings → Limits**：設定每月預算上限（例如 US$50）。這是**真正擋得住**的上限。
4. **API keys → Create new secret key**：名稱填 `render-studio`，複製。
5. 回工作台「設定」貼上 → 測試並儲存。
6. 若出圖時出現「組織驗證」錯誤：OpenAI 後台 **Settings → Organization → Verify**，完成後再試。

## 4. 取得 Claude 金鑰（驗收）

1. 到 https://console.anthropic.com 登入（用公司 Email 註冊）。
2. **Billing**：儲值。
3. **Limits**：設定每月花費上限（例如 US$20）。
4. **API Keys → Create Key**：名稱填 `render-studio`，複製。
5. 回工作台「設定」貼上 → 測試並儲存 → 模型選 `Claude Opus 5.5`（預設，看圖最仔細）。

注意：**Claude Pro／Max 訂閱不能用在這裡**。網站要用 API 金鑰，費用另計。

## 5. 費用參考

| 項目 | 單次費用 | 依據 |
|---|---|---|
| OpenAI 出圖（高品質） | 約 US$0.13–0.21／張 | 【示意】第三方整理的 1024×1024 價格；附參考圖、較大尺寸更高 |
| OpenAI 出圖（標準） | 約 US$0.03–0.05／張 | 同上 |
| Claude 驗收（Opus 5.5） | 約 US$0.05–0.15／次 | 【示意】2 張 2048 寬圖，輸入約 8 千 token、輸出 2–5 千 token；模擬回應實測估算 US$0.079 |
| Claude 驗收（Sonnet 5.5） | 約為 Opus 的一半 | Anthropic 官方單價 US$2／US$10 每百萬 token |

每次驗收後，結果下方會顯示實際用量換算的費用。

## 6. 本裝置每月上限

設定頁「本裝置每月上限」可選 10／20／50／100／200 張或不限。達上限時「送出生成」會停用。

- 這是**這台裝置的軟性上限**，換裝置、清資料就重新計算。
- 公司層級的硬上限請設在 OpenAI、Anthropic 後台（第 3、4 節）。

## 7. 公司共用金鑰（選用，給所有設計師共用）

裝置沒填金鑰時，出圖會改用伺服器上的共用金鑰（若有設定）。設定方式：

1. Vercel → `pure-render-studio` → **Settings → Environment Variables**。
2. 新增 `OPENAI_API_KEY`，類型選 **Secret**，值貼金鑰，環境勾 Production。
3. 新增 `OPENAI_IMAGE_MODEL`，值填設定頁看到的模型名稱（例如 `gpt-image-2`）。
4. 新增 `RENDER_LIVE`，值填 `1`。
5. **Deployments → 最新一筆 → Redeploy**。

限制：伺服器路由單次最長 60 秒、請求 4 MB，高品質大圖可能逾時（會標「結果未知」）。建議優先用裝置金鑰。

## 8. 合約提醒

開啟後，圖面會送到 OpenAI（出圖）與 Anthropic（驗收）。建商合約若限制第三方 AI 處理，請先確認（需專業人士最終確認）。
