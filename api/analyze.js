// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { ingredientsText, language } = req.body;

  if (!ingredientsText) {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  const responseLanguage = language === 'ar' ? 'Arabic' : 'English';

  try {
    // ✅ 1. استخدام مصفوفة الرسائل (System & User) للتحكم الدقيق
    const messages = [
      {
        role: "system",
        content: `You are a food allergen expert. Your primary function is to analyze ingredient lists for gluten. You must respond ONLY in a specific JSON format. Your response language MUST strictly be the one specified by the user and should NOT be influenced by the language of the ingredients list.`
      },
      {
        role: "user",
        content: `Analyze the following ingredients list. Your entire JSON response, especially the 'explanation' field, MUST be in ${responseLanguage}.

Ingredients: "${ingredientsText}"

Respond with a JSON object following this exact structure:
{
  "verdict": "one of 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
  "criticalIngredient": "The most critical ingredient that determined the verdict, or 'N/A' if safe.",
  "explanation": "A simple, one-sentence explanation written in ${responseLanguage}."
}`
      }
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      // ✅ 2. تمرير مصفوفة الرسائل الجديدة
      messages: messages,
      response_format: { type: "json_object" },
    });

    const aiResult = JSON.parse(response.choices[0].message.content);
    return res.status(200).json(aiResult);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error analyzing ingredients' });
  }
}
