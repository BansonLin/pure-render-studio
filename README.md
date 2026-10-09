# 璞石 Render Studio

璞石集團 3D 渲染 AI 優化工作台。以「專案」為單位，把每個視角的 3D 原圖、AI 版本、參考圖放在同一張畫布上，用區域指令修改，並自動做鏡位校正、選區外回貼、水波紋篩查與 360 環景縫合。

評估與設計依據：[`docs/RENDER-STUDIO-EVALUATION.md`](docs/RENDER-STUDIO-EVALUATION.md)
交接與待辦：[`docs/HANDOFF.md`](docs/HANDOFF.md)｜給 Claude Code 的開發說明：[`CLAUDE.md`](CLAUDE.md)

## 功能

- **專案畫布**：每個視角一條泳道（3D 原圖唯讀 → v1 → v2…），主圖 → 衍生依賴線、設計參考圖板
- **版本編輯**：修改區／筆刷／物件／鎖定區標註，每區獨立指令＋提示詞積木，自動編譯分段提示詞
- **防水波紋**：預設從 3D 原圖單跳；匯入 AI 結果時放大回原尺寸、自動對位回原鏡位、選區外回貼底圖像素
- **驗收**：水波紋疑似區偵測（對照 3D 原圖）、人工檢查清單、核准紀錄（核准者／時間）
- **跨視角一致**：場景物件聖經（規格、數量、空間錨點、各視角可見性、參考裁切）；主圖改版 → 衍生版本自動「需重驗」
- **360 環景**：同點位 4 張／6 面／N 張縫合、校色、接縫檢查、WebGL 檢視器、客戶用單檔 HTML
- **交付**：只收已核准版本的 ZIP（成品＋原圖對照＋提示詞＋manifest）、專案備份／匯入

## 開發

```bash
npm install
cp .env.example .env.local   # 填 AUTH_SECRET 與 ALLOWED_EMAILS
npm run dev
```

本機沒有 `RESEND_API_KEY` 時，登入連結會印在終端機（僅開發模式）。

## 部署

Vercel，`main` push 即部署。環境變數見 `.env.example`；`AUTH_SECRET`、`RESEND_API_KEY` 請以 Secret 類型設定。

## 資料

V1 專案資料存在使用者瀏覽器（IndexedDB），與網址綁定；換電腦或清除網站資料前請在「交付」頁匯出專案備份。
