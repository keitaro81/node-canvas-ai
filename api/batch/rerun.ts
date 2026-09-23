export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchRerunItems } from './_batchLogic'

// 認証必須。NG のみ再実行（仕様 5 章）: 対象アイテムの切り抜きタスクを新しい設定で未投入へ戻す。投入はクライアントが batch-submit で続ける
export default withSentry(authedPost((admin, userId, opts, body) => batchRerunItems(admin, userId, opts, body as never)))
