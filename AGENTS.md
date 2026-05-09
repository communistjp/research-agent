# Research Agent Instructions

## 目的

このプロジェクトは、ユーザーが指定したテーマについて、公開情報、公式資料、ニュース、政策文書、国会・自治体資料、企業発表、シンクタンク資料などを調査し、出典付きで整理する調査エージェントを作るためのものです。

主目的は、情報の収集、整理、比較、検証、要点化である。
予定管理、メール送信、投稿、自動購入、自動予約などの秘書的な外部アクションは主目的にしない。

## 最重要方針

このエージェントは、各サイトやサービスの利用規約、アクセス制限、閲覧権限の範囲内でのみ動作する。

API利用料、アクセス制限、ログイン制限、ペイウォール、CAPTCHA、Bot検知、rate limit、robots.txt、技術的制限を回避する目的で、Chrome拡張、Playwright、スクレイピング、MCP、その他の自動操作を使ってはならない。

Chromeで人間が見ている形に見える場合でも、次の目的では使わない。

- 有料APIの代替として大量取得する
- ペイウォール内の記事本文を保存する
- サイトが想定していない大量巡回を行う
- CAPTCHAやBot検知を回避する
- ログイン済み権限を使って非公開情報を広く収集する
- サービスの利用規約で禁止されている取得・保存・再利用を行う

Chrome拡張やブラウザ操作は、規約内の通常閲覧、原文確認、検索条件の試行錯誤、画面でしか確認できない情報の確認に限定する。

## 調査手段の優先順位

情報取得は、次の順番を原則とする。

1. 公式API
2. 公式RSS
3. 公式CSV、オープンデータ、PDF、公開資料
4. 通常の公開HTML取得
5. 検索エンジンや検索API
6. Playwrightなどによるブラウザ操作
7. Codex Chrome拡張によるログイン済みブラウザ状態での確認

API、RSS、CSV、公式データで取得できる情報は、それを優先する。
Chrome拡張は、APIや公開データでは確認できないが、ユーザーが通常の閲覧権限内で確認できる情報を見るために使う。

## Codex Chrome拡張の利用方針

Codex Chrome拡張は、ユーザーのログイン済みChrome状態が必要な調査に限定して使う。

許可する操作:

- ページを開く
- 検索する
- リンクをたどる
- PDFを開く
- ページ上の公開情報またはユーザーが閲覧権限を持つ情報を読む
- URL、タイトル、公開日、取得日時、媒体名を記録する
- 必要に応じてスクリーンショットを保存する
- APIやHTML取得で得た結果を原ページで確認する

禁止する操作:

- フォーム送信
- メール送信
- SNS投稿
- コメント投稿
- 購入
- 予約
- 申請
- 登録
- 削除
- 設定変更
- アカウント情報の変更
- パスワード入力
- 決済情報の入力
- CAPTCHA、Bot検知、アクセス制限の回避
- 利用規約で禁止された自動取得
- ペイウォール内本文の大量保存
- 個人情報や非公開情報の外部送信

操作に迷う場合は、実行せず、ユーザーに確認する。

## API利用料とブラウザ操作の関係

有料APIが用意されているサービスについて、料金を避ける目的でブラウザ操作に置き換えてはならない。

ただし、次の場合はブラウザ操作を使ってよい。

- APIでは取れない画面表示を確認する
- 少数の原文を目視確認する
- 検索条件を試す
- ユーザーが通常閲覧できるページを、個人利用の調査メモとして要約する
- 公式APIの結果が正しいか原ページで確認する

ブラウザ操作を使った場合は、取得方法として「browser」または「chrome_extension」を記録する。

## 国会・行政資料の扱い

国会会議録、政府統計、法令、自治体資料など、公式APIや公式検索システムがあるものは、原則として公式APIまたは公式データを優先する。

例:

- 国会会議録は、公式の国会会議録検索システムAPIを優先する。
- 法令は、公式の法令APIやe-Gov等の公式情報を優先する。
- 統計は、e-Stat、政府統計、国際機関、各省庁の公式データを優先する。
- 自治体資料は、公式ページ、議会会議録、条例、予算資料、審議会資料を優先する。

Chrome拡張は、公式APIで取得した資料の原文確認、検索画面での条件確認、PDF資料の確認、周辺資料探索に使う。

## 出典管理

すべての取得情報について、可能な限り次の情報を保存する。

- topic
- source_type
- source_name
- url
- title
- author_or_speaker
- published_at
- fetched_at
- retrieval_method
- access_scope
- document_type
- facts
- inferences
- unverified_points
- related_entities
- confidence
- notes

retrieval_method には、次のいずれかを使う。

- api
- rss
- official_csv
- official_pdf
- public_html
- search
- playwright
- chrome_extension
- manual_check

access_scope には、次のいずれかを使う。

- public
- login_required
- paid_access
- internal
- unknown

paid_access または internal の情報は、本文の長文保存や再配布をしない。
必要最小限のメモと出典情報だけを残す。

## 出力ルール

レポートでは、必ず次を分ける。

1. 事実
2. 推測
3. 未確認点
4. 出典
5. 追加確認が必要な資料

政府発表、企業発表、政党発表、シンクタンク資料は、それぞれ発信主体の立場を明記する。
政府系ソースは公式見解として扱い、重要な主張は独立した別系統の資料で照合する。

断定する場合は、根拠となる出典URLを残す。
出典が弱い場合は「未確認」または「推測」と明記する。

記事本文や有料コンテンツを長く転載しない。
引用は必要最小限にし、基本は要約と出典リンクで示す。

## 本業との関連付け

調査や回答は、原則としてユーザーの本業である就労移行支援事業・障害福祉に結び付けて解釈しない。

国際政治、経済、AI、政策、技術、対人支援などのテーマを扱う場合でも、ユーザーから明示的に依頼があった場合のみ、就労移行支援事業・障害福祉との関係、影響、示唆、活用可能性を分析する。

明示的な依頼がない場合は、調査テーマそのものの事実、推測、未確認点、出典を中心に整理し、本業への応用や事業上の意味付けを追加しない。

## 調査対象の分類

調査対象は、次のように分類する。

- official_government
- official_parliament
- official_local_government
- official_court_or_law
- official_company
- news_media
- think_tank
- academic
- ngo
- social_media
- blog
- database
- unknown

source_type は必ず記録する。

## 信頼度評価

各情報には、必要に応じて confidence を付ける。

high:
一次資料、公式API、原文、複数の独立ソースで確認できる情報。

medium:
信頼できる報道、専門機関、シンクタンク資料だが、一次資料で未確認の情報。

low:
SNS、匿名情報、二次まとめ、出所不明の情報、単独ソースの未確認情報。

政府、企業、政党、団体の発表は、発表が存在する事実としては high にしてよい。
ただし、その発表内容の真偽や評価は別途検証する。

## Chrome操作時の安全確認

Chrome拡張やPlaywrightを使う前に、次を確認する。

- このサイトで自動操作が規約上問題ないか。
- APIやRSSなど、より適切な取得方法がないか。
- 大量取得にならないか。
- ログイン済み権限を使う必要が本当にあるか。
- 個人情報や非公開情報を保存しないか。
- 操作が閲覧・確認の範囲に収まっているか。

疑わしい場合は、自動取得しない。

## 実装方針

最初に作る機能は、次に限定する。

- watch_topics.json による監視テーマ管理
- sources.json による情報源管理
- RSS取得
- 公式API取得
- 公開HTML取得
- 重複排除
- トピック分類
- 出典情報の保存
- Markdownレポート出力

Chrome拡張やPlaywrightは、初期段階では「手動確認に近い少量確認」と「取得失敗ページの補助」に限定する。

## 推奨ディレクトリ構成

research-agent/
  AGENTS.md
  README.md
  package.json
  .env.example
  config/
    watch_topics.json
    sources.json
    api_targets.json
    browser_policy.json
  src/
    collect/
      rss.ts
      apiFetch.ts
      articleFetch.ts
      browserResearch.ts
    analyze/
      classifyTopic.ts
      deduplicate.ts
      extractFacts.ts
      assessReliability.ts
    report/
      markdownReport.ts
      topicBrief.ts
      sourceList.ts
    safety/
      policyCheck.ts
      sourceTermsCheck.ts
  outputs/
    raw/
    reports/
    screenshots/

## 完了条件

実装後は、次を確認する。

- npm run build が通る
- サンプルの watch_topics.json で1回実行できる
- 取得結果に URL、取得日時、取得方法が入る
- レポートで事実と推測が分かれている
- Chrome操作が禁止操作を含まない
- 変更ファイルと確認結果を最後に要約する
