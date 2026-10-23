import { handleUsersRequest } from './lib/users-service.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }

  const { status, json } = await handleUsersRequest(req)
  res.status(status).json(json)
}