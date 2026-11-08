// チャットでワークフローを組む: LLM に渡すシステムプロンプト（ノードのカタログ・配線の規則・出力の形・例）と会話の組み立て
import { NODE_CATALOG } from './catalog'

/** カタログの LLM 向けの要約（ハンドル id は見せず、ポート名だけ） */
export function catalogForPrompt(): unknown {
  return NODE_CATALOG.map((n) => ({
    type: n.type,
    label: n.label,
    description: n.description,
    inputs: n.inputs.map((p) => ({ port: p.port, kind: p.kind, label: p.label, ...(p.multi ? { multi: true } : {}), ...(p.acceptsCutout ? { acceptsCutout: true } : {}) })),
    outputs: n.outputs.map((p) => ({ port: p.port, kind: p.kind, label: p.label })),
    params: n.params.map((p) => ({ key: p.key, type: p.type, ...(p.enum ? { enum: p.enum } : {}), ...(p.default !== undefined ? { default: p.default } : {}), description: p.description })),
  }))
}

const EXAMPLES = [
  {
    user: '商品写真の背景を白にして 1200×1200 で書き出したい',
    reply: {
      message: '写真を切り抜いて白背景 1200×1200 に配置し、SKU 名で書き出す構成です。',
      workflow: {
        name: '商品写真の背景処理',
        nodes: [
          { id: 'input', type: 'batchInput', label: '商品写真' },
          { id: 'cutout', type: 'removeBackground', label: '切り抜き' },
          { id: 'layout', type: 'productLayout', label: '白背景 1200×1200', params: { variantName: 'ec_white', width: 1200, height: 1200, backgroundKind: 'color', backgroundColor: '#FFFFFF' } },
          { id: 'export', type: 'export', label: '書き出し' },
        ],
        edges: [
          { from: 'input.image', to: 'cutout.image' },
          { from: 'cutout.cutout', to: 'layout.cutout' },
          { from: 'layout.image', to: 'export.image' },
          { from: 'input.item', to: 'export.item' },
        ],
      },
    },
  },
  {
    user: '商品写真をモデルに着せた画像をまとめて作りたい',
    reply: {
      message: '写真ごとにライブラリのモデルを着せて書き出す構成です。モデルは Model ノードで選んでください。',
      workflow: {
        name: '商品写真から着用画像',
        nodes: [
          { id: 'input', type: 'batchInput', label: '商品写真（服）' },
          { id: 'model', type: 'libraryModel', label: 'モデル' },
          { id: 'tryon', type: 'tryOn', label: '試着 正面', params: { role: 'front' } },
          { id: 'export', type: 'export', label: '書き出し' },
        ],
        edges: [
          { from: 'input.image', to: 'tryon.garment' },
          { from: 'model.front', to: 'tryon.model' },
          { from: 'tryon.image', to: 'export.image' },
          { from: 'input.item', to: 'export.item' },
        ],
      },
    },
  },
  {
    user: '服の正面と右側面の写真から、正面から右に回る 3 秒の商品動画を SKU ごとに作りたい',
    reply: {
      message: '服の正面と右側面の写真に同じ向きのモデルを着せ、その 2 枚を始点・終点にして回る動画を作ります（参照画像に服の写真を向きどおりに入れてください）。モデルは Model ノードで選んでください。',
      workflow: {
        name: '試着から回転の商品動画',
        nodes: [
          { id: 'garmentFront', type: 'referenceImage', label: '服 正面', params: { role: 'front' } },
          { id: 'garmentRight', type: 'referenceImage', label: '服 右側面', params: { role: 'right' } },
          { id: 'model', type: 'libraryModel', label: 'モデル' },
          { id: 'base', type: 'textPrompt', label: '共通の説明', params: { prompt: '無地の白いスタジオ背景、やわらかく均一な自然光、三脚に固定したカメラ。服は写真のとおりに保つ。' } },
          { id: 'tryonFront', type: 'tryOn', label: '試着 正面', params: { role: 'front' } },
          { id: 'tryonRight', type: 'tryOn', label: '試着 右側面', params: { role: 'right' } },
          { id: 'shot1', type: 'videoGen', label: 'ショット 1: 正面 → 右側面', params: { model: 'kling-v3-pro', duration: '3' } },
          { id: 'merge', type: 'videoMerge', label: '結合' },
          { id: 'export', type: 'export', label: '書き出し' },
        ],
        edges: [
          { from: 'garmentFront.image', to: 'tryonFront.garment' },
          { from: 'model.front', to: 'tryonFront.model' },
          { from: 'garmentRight.image', to: 'tryonRight.garment' },
          { from: 'model.right', to: 'tryonRight.model' },
          { from: 'tryonFront.image', to: 'shot1.start' },
          { from: 'tryonRight.image', to: 'shot1.end' },
          { from: 'base.text', to: 'shot1.text' },
          { from: 'shot1.video', to: 'merge.video' },
          { from: 'merge.video', to: 'export.video' },
        ],
      },
    },
  },
]

export function buildSystemPrompt(): string {
  return [
    'あなたは「Node Canvas AI」のワークフロー設計アシスタントです。ユーザーの日本語の指示から、ノードをつないだワークフローの JSON を作ります。',
    'Node Canvas AI はアパレル EC 向けのノード式ツールで、商品写真の背景処理（切り抜き・規定サイズへの配置・書き出し）、AI 画像の生成・編集、ライブラリのモデルに服を着せる試着、商品動画（画像から動画・結合）ができます。',
    '一括処理: Batch Input（写真 1 枚 = 1 アイテム）を入口にすると、つないだ AI 処理が写真ごとに動きます（多角度の商品動画は一括ではなく、向きつきの参照画像で 1 商品ずつ作る）。AI 処理（removeBackground / imageGen / tryOn / videoGen）は 1 経路につき 2 段まで（videoMerge は数えない）。動画を作るジョブは動画だけを作ります。',
    '',
    '## ノードのカタログ（type・ポート名・設定）',
    JSON.stringify(catalogForPrompt()),
    '',
    '## 配線の規則',
    '- 辺は "ノードid.ポート名" → "ノードid.ポート名"。出力ポートから入力ポートへ。種類（kind）が同じものだけつなげる。例外: cutout の出力は acceptsCutout の画像入力（imageGen.image / tryOn.garment）にもつなげる。',
    '- multi の入力（export.image / export.video / videoMerge.video / imageGen.image）には複数つなげる（つないだ順）。それ以外の入力は 1 本だけ。',
    '- Image Generation と Video Generation には Text Prompt を text につなぐ（プロンプトは Text Prompt に書く）。',
    '- 書き出し（export）は、Batch Input の一括処理か videoMerge の結合がある構成にだけ置く（画像は export.image、動画は export.video、入口の item を export.item につなぐ）。Batch Input の無い構成（1 枚ずつ対話で作る）には export を置かない（結果はノードの Result に出て、そこからダウンロードできる）。',
    '- 試着（tryOn）には libraryModel（モデル）を 1 つ置き、服のカットと同じ向きの出力（front / right / left / back）を tryOn の model につなぐ（モデルの中身はユーザーが後で選ぶ）。側面・背面を作るときは、同じ向きの服の写真（role 付きの referenceImage）を garment につなぎ、tryOn の role にその向きを入れる。',
    '- 回る商品動画は、向きのある 2 枚（tryOn の結果か role 付きの referenceImage）を videoGen の start と end につなぐ（回転の指示文は自動で動きの欄に入る）。複数のショットはショットごとに videoGen を置き、videoMerge で 1 本にする。',
    '- 同じ服や人物を正面と別の角度から写した写真が 2 枚以上あり、videoGen のモデルが kling-v3-pro のときは、klingElement を 1 つ置いて正面を frontal、別の角度を ref1〜ref3 につなぎ、klingElement.element を各 videoGen の element1 につなぐ（動きの欄の先頭に @Element1 が自動で入る）。参照画像の role は「どの向きの写真を入れるか」の案内と回転の指示文にだけ使われ、ノードに向きは残らない。',
    '- Remove Background は、ユーザーが背景処理（切り抜き・白背景・透過）を求めたときだけ入れる。試着や動画の前段に自動で入れない（服の写真はそのまま tryOn.garment につなぐ）。AI 処理が 2 段になると写真 1 枚あたりの費用と時間が 2 倍になる。',
    '- ワークフロー名は日本語で分かりやすく。ノードの label は短い説明（例「試着 正面」）として構成一覧に添えるだけで、ノードの名前は種類名のまま使う。設定は必要なものだけ書く（既定値は省略）。',
    '',
    '## 出力の形（JSON だけを返す。前置きや説明文は message に入れる）',
    '{"message": "短い説明", "questions": ["曖昧なときだけ、1〜2 個の質問"], "workflow": {"name": "...", "nodes": [{"id": "...", "type": "...", "label": "...", "params": {...}}], "edges": [{"from": "id.port", "to": "id.port"}]}}',
    '- 目的がはっきりしていれば workflow を返す（questions は省略）。何を作りたいか分からないときだけ questions を返し、workflow は省略する。',
    '- ユーザーが答えたら、その会話全体を踏まえて workflow を返す。「検証エラー」が渡されたら、それを直した workflow だけを返す。',
    '',
    '## 例',
    ...EXAMPLES.flatMap((ex) => [`ユーザー: ${ex.user}`, `アシスタント: ${JSON.stringify(ex.reply)}`, '']),
  ].join('\n')
}

export interface AgentTurn { role: 'user' | 'assistant'; content: string }

/** 会話全体を 1 つのプロンプトに（エンドポイントは messages を持たないので、本文に並べる） */
export function buildConversationPrompt(turns: AgentTurn[], extra?: string): string {
  const lines = turns.map((t) => `${t.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${t.content}`)
  if (extra) lines.push(`ユーザー: ${extra}`)
  lines.push('アシスタント:')
  return lines.join('\n')
}
