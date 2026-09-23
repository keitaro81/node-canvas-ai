export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchReconcile } from './_batchLogic'

// 認証必須。仕様 4-5 の batch-reconcile（共有コア _batchLogic.ts）
export default withSentry(authedPost((admin, userId, opts, body) => batchReconcile(admin, userId, opts, body as never)))
