// api/analyze.js
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // مفتاح API يُقرأ من متغيرات البيئة
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { ingredientsText } = req.body;

  if (!ingredientsText) {
    return res.status(400).json({ message: 'Ingredients text is required' });
  }

  try {
    const prompt = `أنت خبير في حساسية الغلوتين ومرض السيلياك. حلل قائمة المكونات التالية بدقة. ابحث عن أي مصدر صريح للغلوتين، أو مكون قد يكون مشتقًا من مصدر يحتوي على غلوتين، أو أي تحذير من التلوث الخلطي.
    
    أجب بصيغة JSON فقط، وبالشكل التالي:
    {
      "verdict": "ضع هنا إحدى هذه القيم: 'contains_gluten', 'may_contain_gluten', 'appears_gluten_free'",
      "criticalIngredient": "ضع هنا اسم المكون الأخطر الذي بنيت عليه قرارك، أو 'N/A' إذا كان آمنًا",
      "explanation": "اشرح هنا السبب بوضوح وبجملة بسيطة باللغة العربية"
    }
    
    قائمة المكونات:
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
