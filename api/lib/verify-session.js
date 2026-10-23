import { jwtVerify } from 'jose'

function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    const error = new Error('Missing server environment variable on the host: AUTH_SECRET')
    error.code = 'AUTH_SECRET_MISSING'
    throw error
  }
  return new TextEncoder().encode(secret)
}

export async function verifySessionToken(token) {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ['HS256'],
  })
  return payload
}
