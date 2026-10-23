import { handleLoginRequest } from './lib/login-service.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }

  const { status, json } = await handleLoginRequest(req)
  res.status(status).json(json)
}
