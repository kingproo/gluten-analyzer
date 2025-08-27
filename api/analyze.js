// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SUPPORTED = new Set(['ar', 'en']);

function detectArabic(text = '') {
  return /[\u0600-\u06FF]/.test(text);
}

function isEnglishOnly(str = '') {
  return /^[\x00-\x7F\s]+$/.test(str);
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
          'أنت خبير في مسببات الحساسية الغذائية. تحلل قوائم المكونات لاكتشاف الغلوتين. ' +
          'أعد استجابة JSON فقط. أسماء المفاتيح بالإنجليزية (verdict, criticalIngredient, explanation). ' +
          'كل القيم النصية يجب أن تكون بالعربية حصراً.'
      },
      {
        role: 'user',
        content:
`حلّل قائمة المكوّنات التالية، وأعد **JSON فقط** بالقالب التالي (المفاتيح إنجليزية، والقيم بالعربية):

Ingredients: "${ingredientsText}"

Return exactly:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "أهم مكوّن أثّر على الحكم، أو 'N/A' إذا آمن.",
  "explanation": "جملة واحدة قصيرة بالعربية تبرّر الحكم."
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
        'Return JSON only. Keep keys in English (verdict, criticalIngredient, explanation). ' +
        'All string values MUST be strictly in English only.'
    },
    {
      role: 'user',
      content:
`Analyze the ingredients and return **JSON only** with the exact shape below (keys in English; string values in English).

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

// يلقط أول كائن JSON صالح من النص (حتى لو كان داخل ``` أو فيه أسطر زائدة)
function extractJsonObject(str = '') {
  // أسرع محاولة مباشرة:
  try { return JSON.parse(str); } catch (_) {}

  // التقط أول {...} كبير
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

// توليد جملة محلية (بدون اتصال خارجي) تضمن اللغة المطلوبة
function normalizeExplanation(verdict, critical, lang) {
  const crit = (typeof critical === 'string' && critical.trim() && critical !== 'N/A')
    ? critical.trim()
    : null;

  if (lang === 'en') {
    switch (verdict) {
      case 'contains_gluten':
        return `This product contains ${crit || 'gluten'}.`;
      case 'may_contain_gluten':
        return `This product may contain traces of gluten due to potential cross-contamination.`;
      default:
        return `No gluten ingredients were found in the list.`;
    }
  }

  // ar
  switch (verdict) {
    case 'contains_gluten':
      return `هذا المنتج يحتوي على ${crit || 'الغلوتين'}.`;
    case 'may_contain_gluten':
      return `قد يحتوي هذا المنتج على آثار من الغلوتين بسبب احتمال التلوث الخلطي.`;
    default:
      return `لم تُرصد مكوّنات تحتوي على الغلوتين في القائمة.`;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

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
      // ملاحظة: بعض إصدارات chat.completions قد تتجاهل response_format.
      // لذلك نعتمد على extractJsonObject + الحارس لاحقًا.
      // response_format: { type: 'json_object' },
    });

    const raw = response.choices?.[0]?.message?.content ?? '';
    let ai = extractJsonObject(raw) || {};

    const allowed = new Set(['contains_gluten', 'may_contain_gluten', 'appears_gluten_free']);
    const verdict = allowed.has(ai.verdict) ? ai.verdict : 'appears_gluten_free';
    const criticalIngredient =
      typeof ai.criticalIngredient === 'string' && ai.criticalIngredient.trim()
        ? ai.criticalIngredient.trim()
        : 'N/A';
    let explanation =
      typeof ai.explanation === 'string' && ai.explanation.trim()
        ? ai.explanation.trim()
        : '';

    // حارس اللغة النهائي (بدون نداء API ثانٍ):
    if (lang === 'en') {
      if (!isEnglishOnly(explanation)) {
        explanation = normalizeExplanation(verdict, criticalIngredient, 'en');
      }
    } else { // ar
      if (!detectArabic(explanation)) {
        explanation = normalizeExplanation(verdict, criticalIngredient, 'ar');
      }
    }

    return res.status(200).json({
      verdict,
      criticalIngredient,
      explanation,
      lang,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error analyzing ingredients' });
  }
}
