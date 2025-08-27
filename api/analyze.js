// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SUPPORTED = new Set(['ar', 'en']);

function detectArabic(text = '') {
  return /[\u0600-\u06FF]/.test(text);
}

function resolveLanguage(reqBody = {}, headers = {}) {
  const lang = (reqBody.language || '').toLowerCase();

  if (SUPPORTED.has(lang)) return lang;

  if (lang === 'auto') {
    if (detectArabic(reqBody.ingredientsText)) return 'ar';
    const accept = String(headers['accept-language'] || '');
    if (accept.toLowerCase().startsWith('ar')) return 'ar';
    return 'en';
  }

  // لم يتم تحديد اللغة: جرّب من Accept-Language، وإلا EN
  const accept = String(headers['accept-language'] || '');
  if (accept.toLowerCase().startsWith('ar')) return 'ar';
  return 'en';
}

function buildMessages(lang, ingredientsText) {
  if (lang === 'ar') {
    return [
      {
        role: 'system',
        content:
          `أنت خبير في مسببات الحساسية الغذائية. وظيفتك تحليل قوائم المكوّنات لاكتشاف الغلوتين. ` +
          `أعد الاستجابة على شكل JSON فقط. **أسماء المفاتيح يجب أن تبقى بالإنجليزية** (verdict, criticalIngredient, explanation). ` +
          `القيم النصية يجب أن تكون بالعربية.`
      },
      {
        role: 'user',
        content:
`حلّل قائمة المكوّنات التالية وأعد **كائن JSON فقط** بالقالب الآتي.
المفاتيح ثابتة بالإنجليزية، لكن القيم النصية بالعربية.

Ingredients: "${ingredientsText}"

Return exactly:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "أهم مكوّن أثّر على الحكم، أو 'N/A' إذا آمن.",
  "explanation": "جملة واحدة بسيطة تبرّر الحكم بالعربية."
}`
      }
    ];
  }

  // lang === 'en'
  return [
    {
      role: 'system',
      content:
        `You are a food allergen expert. Analyze ingredient lists for gluten. ` +
        `Return JSON only. **Key names must remain in English** (verdict, criticalIngredient, explanation). ` +
        `String values should be in English.`
    },
    {
      role: 'user',
      content:
`Analyze the ingredients below and return **JSON only** with the exact shape.
Keys stay in English; string values are in English.

Ingredients: "${ingredientsText}"

Return exactly:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "The single most critical ingredient, or 'N/A' if safe.",
  "explanation": "One simple sentence in English that justifies the verdict."
}`
    }
  ];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { ingredientsText } = req.body || {};
  if (!ingredientsText || typeof ingredientsText !== 'string') {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  const lang = resolveLanguage(req.body, req.headers);
  const messages = buildMessages(lang, ingredientsText);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices?.[0]?.message?.content?.trim() || '{}';
    const aiResult = JSON.parse(content);

    // حراسة بسيطة على قيمة verdict
    const allowed = new Set(['contains_gluten', 'may_contain_gluten', 'appears_gluten_free']);
    if (!allowed.h
