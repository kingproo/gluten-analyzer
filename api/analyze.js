export default async function handler(req, res) {
  res.setHeader('x-api-version', 'analyze@2025-08-27T12:00'); // بصمة فريدة
  res.setHeader('Cache-Control', 'no-store, max-age=0');      // منع أي كاش
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }
  return res.status(200).json({ ok: true, version: 'analyze@2025-08-27T12:00' });
}
