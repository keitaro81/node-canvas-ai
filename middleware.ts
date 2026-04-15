import { next } from '@vercel/edge'

export const config = {
  matcher: '/((?!api/).*)',
}

export default function middleware(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Basic ')) {
    const [user, pass] = atob(authHeader.slice(6)).split(':')
    if (user === process.env.BASIC_AUTH_USER && pass === process.env.BASIC_AUTH_PASS) {
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
