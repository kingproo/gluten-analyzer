export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    method: req.method,
    now: new Date().toISOString()
  });
}
