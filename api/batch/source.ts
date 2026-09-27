export const config = { runtime: 'edge' }

import { withSentry } from '../_sentry'
import { authedPost } from './_common'
import { batchSource } from './_batchLogic'

// 認証必須。ジョブの元ワークフローの列（Product Layout ノード）を、ジョブが見える人に返す（0016 の閲覧ルール）。
// private なワークフローを RLS で読めないチーム owner が、最新の列で確認するため。閲覧専用
export default withSentry(authedPost((admin, userId, opts, body) => batchSource(admin, userId, opts, body as never)))
