export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchCreate } from './_batchLogic'

// 認証必須。仕様 4-5 の batch-create（共有コア _batchLogic.ts）
export default withSentry(authedPost((admin, userId, _opts, body) => batchCreate(admin, userId, body as never)))
