import { next } from '@vercel/edge'

export const config = {
  matcher: '/:path*',
}

export default function middleware(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Basic ')) {
    const [user, pass] = atob(authHeader.slice(6)).split(':')
    if (user === 'keitaro' && pass === 'takahashi') {
      return next()
    }
  }

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  })
}
