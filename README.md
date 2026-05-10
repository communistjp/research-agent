# research-agent

規約内で動く調査エージェントの最小実装です。公式API、RSS、公式CSV、公式PDF、公開HTMLを優先し、ブラウザ操作は自動取得ではなく少量の手動確認タスクとして記録します。

## Commands

```sh
npm run build
npm run sample
npm run schedule
npm run topic:add -- --name "AI, disability welfare, and accessibility" --keywords "AI,disability,welfare,accessibility"
npm run source:add -- --name "Source Name" --url "https://example.org/feed.xml" --method rss --source-type official_government --topic ai-disability-welfare --terms-status allowed --enable
npm run source:list
```

PowerShell の実行ポリシーで `npm.ps1` が止まる環境では、次を使います。

```sh
cmd /c npm run build
cmd /c npm run sample
```

## PDF and OCR

`official_pdf` ソースはローカルでPDF解析します。外部OCRサービスには送信しません。

高精度な本文抽出・レイアウト解析には次のローカルコマンドがあると有効です。

- `pdfinfo`: ページ数、メタデータ抽出
- `pdftotext`: `-layout` と `-bbox-layout` による本文・座標抽出
- `pdftoppm`: OCR用画像化
- `tesseract`: OCR。日本語行政文書では `jpn+eng` を推奨
- `tesseract.js`: 管理者権限なしで使うWASM版OCRフォールバック

これらがない場合もPDFは保存され、軽量な埋め込み文字列ヒントを抽出します。ただしスキャンPDFのOCRや正確な座標レイアウトは未確認点として記録されます。

このリポジトリでは `tools/poppler-*` と `tools/tessdata-js` も自動探索します。`tesseract.exe` がない環境では、`pdftoppm` で画像化したページを `tesseract.js` でOCRします。

PDFソース例:

```json
{
  "id": "city-budget-pdf",
  "name": "City Budget PDF",
  "source_type": "official_local_government",
  "url": "https://example.lg.jp/budget.pdf",
  "terms_status": "allowed",
  "method": "official_pdf",
  "access_scope": "public",
  "enable_ocr": true,
  "ocr_lang": "jpn+eng",
  "ocr_max_pages": 10,
  "ocr_dpi": 300,
  "ocr_min_chars": 200,
  "enabled": true
}
```

## Growing Sources

調査しながらソースを育てる場合は、候補を見つけた時点で `source:add` に通します。

```sh
cmd /c npm run source:add -- --name "Example Ministry RSS" --url "https://example.go.jp/rss.xml" --method rss --source-type official_government --topic international-politics --terms-status allowed --enable
```

安全確認だけを行う場合:

```sh
cmd /c npm run source:add -- --name "Candidate" --url "https://example.org/" --source-type unknown --dry-run
```

`--enable` を付けても、規約または robots.txt がブロックする場合、あるいは確認不能な場合は無効状態で追加されます。後から人間が確認して `sources.json` の `enabled` と `terms_status` を更新します。
