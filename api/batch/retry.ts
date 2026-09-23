export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchRetryFailed } from './_batchLogic'

// 認証必須。失敗分の再実行（仕様 4-11 の行操作）: 失敗タスクを未投入に戻す。投入はクライアントが batch-submit で続ける
export default withSentry(authedPost((admin, userId, opts, body) => batchRetryFailed(admin, userId, opts, body as never)))
