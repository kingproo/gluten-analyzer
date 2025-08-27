// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // ✅ 1. استقبال اللغة من الطلب
  const { ingredientsText, language } = req.body;

  if (!ingredientsText) {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  // ✅ 2. تحديد لغة الرد بناءً على المدخلات
  const responseLanguage = language === 'ar' ? 'Arabic' : 'English';

  try {
    // ✅ 3. تحديث البرومبت ليكون ديناميكيًا
    const prompt = `You are an expert in gluten allergies and celiac disease. Analyze the following ingredients list accurately. Look for any explicit gluten source, an ingredient that might be derived from a gluten source, or any cross-contamination warnings.
    
    Respond ONLY with a JSON object in the following format. The explanation must be in ${responseLanguage}.
    {
      "verdict": "one of these values: 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
      "criticalIngredient": "the most critical ingredient you based your decision on, or 'N/A' if it is safe",
      "explanation": "Explain the reason clearly and simply in ${responseLanguage}"
    }
    
    Ingredients list:
    "${ingredientsText}"`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
    });

    const aiResult = JSON.parse(response.choices[0].message.content);
    return res.status(200).json(aiResult);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error analyzing ingredients' });
  }
}
