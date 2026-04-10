export const config = { runtime: 'edge' }

const FAL_TARGET_URL_HEADER = 'x-fal-target-url'
const ALLOWED_FAL_HOSTS = ['fal.run', 'queue.fal.run', 'rest.fal.run']

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  const falKey = process.env.FAL_KEY
  if (!falKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const targetUrl = req.headers.get(FAL_TARGET_URL_HEADER)
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing x-fal-target-url header' }, 400)
  }

  // SSRF対策：fal.aiのドメインのみ許可
  let parsedTarget: URL
  try {
    parsedTarget = new URL(targetUrl)
  } catch {
    return jsonResponse({ error: 'Invalid target URL' }, 400)
  }
  if (!ALLOWED_FAL_HOSTS.includes(parsedTarget.hostname)) {
    return jsonResponse({ error: 'Target URL not allowed' }, 400)
  }

  const forwardHeaders = new Headers()
  forwardHeaders.set('Authorization', `Key ${falKey}`)
  const contentType = req.headers.get('content-type')
  if (contentType) forwardHeaders.set('Content-Type', contentType)
  const accept = req.headers.get('accept')
  if (accept) forwardHeaders.set('Accept', accept)

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined

  const falRes = await fetch(targetUrl, {
    method: req.method,
    headers: forwardHeaders,
    body,
  })

  const responseHeaders = new Headers()
  const resContentType = falRes.headers.get('content-type')
  if (resContentType) responseHeaders.set('Content-Type', resContentType)

  return new Response(falRes.body, {
    status: falRes.status,
    headers: responseHeaders,
  })
}
