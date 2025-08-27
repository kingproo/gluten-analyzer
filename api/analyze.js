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
          'أنت خبير في مسببات الحساسية الغذائية. تُحلّل قوائم المكوّنات بحثًا عن الغلوتين. ' +
          'أعد استجابة JSON فقط، وأبقِ أسماء المفاتيح بالإنجليزية (verdict, criticalIngredient, explanation). ' +
          'كل القيم النصّية يجب أن تكون بالعربية لا غير.'
      },
      {
        role: 'user',
        content:
`حلّل قائمة المكوّنات التالية، وأعد **JSON فقط** بالقالب التالي (المفاتيح إنجليزية، القيم نصية بالعربية):

Ingredients: "${ingredientsText}"

Return exactly:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "أهم مكوّن أثّر على الحكم، أو 'N/A' إذا آمن.",
  "explanation": "جملة واحدة بسيطة بالعربية تبرّر الحكم."
}`
      }
    ];
  }

  // en
  return [
    {
      role: 'system',
      content:
        'You are a food allergen expert. Analyze ingredient lists for gluten. ' +
        'Return JSON only, keep keys in English (verdict, criticalIngredient, explanation). ' +
        'All string values MUST be in English only.'
    },
    {
      role: 'user',
      content:
`Analyze the ingredients and return **JSON only** (keys in English, string values in English).

Ingredients: "${ingredientsText}"

Return exactly:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "The single most critical ingredient, or 'N/A' if safe.",
  "explanation": "One short sentence in English that justifies the verdict."
}`
    }
  ];
}

/**
 * خيار A: JSON Schema مع قيد لغوي
 * - en: نطلب explanation ASCII فقط.
 * - ar: نتحقق لاحقًا بحارس الخادم إن حبيت (أقل حاجة).
 */
function buildResponseFormat(lang) {
  if (lang === 'en') {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'gluten_analysis',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict', 'criticalIngredient', 'explanation'],
          properties: {
            verdict: { type: 'string', enum: ['contains_gluten', 'may_contain_gluten', 'appears_gluten_free'] },
            criticalIngredient: { type: 'string' },
            // ASCII-only to deter Arabic letters when English is requested
            explanation: { type: 'string', pattern: '^[\\x00-\\x7F\\s]+$' }
          }
        },
        strict: true
      }
    };
  }

  // للعربية نترك الـ schema بدون pattern،
  // ونعتمد على الحارس لاحقًا إذا لزم.
  return {
    type: 'json_schema',
    json_schema: {
      name: 'gluten_analysis',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'criticalIngredient', 'explanation'],
        properties: {
          verdict: { type: 'string', enum: ['contains_gluten', 'may_contain_gluten', 'appears_gluten_free'] },
          criticalIngredient: { type: 'string' },
          explanation: { type: 'string' }
        }
      },
      strict: true
    }
  };
}

// خيار B: حارس يتحقق من اللغة بعد الاستلام
function isEnglishOnly(str = '') {
  return /^[\x00-\x7F\s]+$/.test(str);
}
function containsArabic(str = '') {
  return /[\u0600-\u06FF]/.test(str);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const { ingredientsText } = req.body || {};
  if (!ingredientsText || typeof ingredientsText !== 'string') {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  const lang = resolveLanguage(req.body, req.headers);
  const messages = buildMessages(lang, ingredientsText);
  const response_format = buildResponseFormat(lang);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      response_format, // خيار A: schema
    });

    const content = response.choices?.[0]?.message?.content?.trim() || '{}';
    let aiResult = JSON.parse(content);

    // حراسة verdict
    const allowed = new Set(['contains_gluten', 'may_contain_gluten', 'appears_gluten_free']);
    if (!allowed.has(aiResult?.verdict)) aiResult.verdict = 'appears_gluten_free';

    // خيار B: حارس لغوي إضافي (يعمل حتى لو schema تساهل أو النموذج تحايل)
    if (lang === 'en') {
      if (!isEnglishOnly(aiResult?.explanation)) {
        // إصلاح سريع: إعادة صياغة explanation للإنجليزية فقط
        const fix = await openai.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0,
          messages: [
            { role: 'system', content: 'Rewrite the user text strictly in English (ASCII only). Return only the rewritten sentence.' },
            { role: 'user', content: String(aiResult?.explanation || '') }
          ]
        });
        aiResult.explanation = fix.choices?.[0]?.message?.content?.trim() || 'Analysis in English.';
      }
    } else if (lang === 'ar') {
      // لو رجع إنجليزي بالغلط، نعيد صياغته للعربية
      if (!containsArabic(aiResult?.explanation)) {
        const fix = await openai.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0,
          messages: [
            { role: 'system', content: 'أعد صياغة النص التالي بالعربية الفصحى بجملة واحدة فقط. أعد الجملة فقط.' },
            { role: 'user', content: String(aiResult?.explanation || '') }
          ]
        });
        aiResult.explanation = fix.choices?.[0]?.message?.content?.trim() || 'تحليل بالعربية.';
      }
    }

    return res.status(200).json({ ...aiResult, lang });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error analyzing ingredients' });
  }
}
