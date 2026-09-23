export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchDelete } from './_batchLogic'

// 認証必須。仕様 4-5 の batch-delete（共有コア _batchLogic.ts）
export default withSentry(authedPost((admin, userId, opts, body) => batchDelete(admin, userId, opts, body as never)))
