// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { ingredientsText, language } = req.body || {};

  if (!ingredientsText || typeof ingredientsText !== 'string') {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  // لغة الرد (ar أو en)
  const lang = language === 'ar' ? 'ar' : 'en';
  const langDirective = lang === 'ar'
    ? 'أجب باللغة العربية فقط.'
    : 'Answer in English only.';
  const responseLanguage = lang === 'ar' ? 'Arabic' : 'English';

  // 🔹 برومبت واحدة (Single Prompt)
  const prompt = `
You are a food allergen expert. Analyze the ingredients list for gluten.

${langDirective}

Return ONLY a JSON object (no prose, no markdown). Keys must be exactly: verdict, criticalIngredient, explanation. Values must be written in ${responseLanguage}.

Ingredients: "${ingredientsText}"

Rules:
- verdict must be one of: contains_gluten, may_contain_gluten, appears_gluten_free
- criticalIngredient must be the single most important ingredient that decided the verdict, or "N/A" if safe.
- explanation must be one short sentence in ${responseLanguage} that justifies the verdict.

Respond with this exact shape:
{
  "verdict": "contains_gluten | may_contain_gluten | appears_gluten_free",
  "criticalIngredient": "string (or N/A)",
  "explanation": "string in ${responseLanguage}"
}
`.trim();

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices?.[0]?.message?.content ?? '{}';
    const aiResult = JSON.parse(content);

    return res.status(200).json(aiResult);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error analyzing ingredients' });
  }
}
