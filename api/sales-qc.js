import { handleSalesQuickCheckRequest } from './lib/sales-qc-service.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res.status(204).end()
  }

  const { status, json } = await handleSalesQuickCheckRequest(req)
  res.status(status).json(json)
}
