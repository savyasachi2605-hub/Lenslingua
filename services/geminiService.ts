
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { GeminiResponse } from "../types";

export const extractAndTranslate = async (
  base64Image: string, 
  mimeType: string, 
  targetLanguage: string = 'English'
): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("GEMINI_API_KEY is not set. Please create a .env file locally and add your API key.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `
    Act as a professional bilingual interpreter, cultural guide, and food safety assistant.
    Analyze the provided image. It may contain text (like a menu) or just objects (like food/dishes).
    
    1. If the image contains text: Provide the original language in 'detectedLanguage'. Extract each text element, provide its verbatim transcription in 'originalText', and a natural translation into ${targetLanguage} in 'translatedText'.
    2. If the image contains food but no text: Identify the food item, describe what it is in 'originalText' (in the likely language of origin or English), and provide the translation/description into ${targetLanguage} in 'translatedText'. Provide 'Unknown' for 'detectedLanguage' if no language is identified.
    
    For ALL items (text or food):
    - 'context': Provide cultural nuances, slang explanations, or details about the food/items.
    - 'allergens': If the item is food-related or a menu item, explicitly list any identified or potential allergens (e.g., peanuts, dairy, soy, gluten, shellfish). If none or not food, leave as an empty string.
  `;

  let response: GenerateContentResponse;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
          { text: "Analyze this image. Extract text if present, describe food/objects if no text is present, translate to the target language, provide cultural context, and critically - identify any potential allergens." },
        ],
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING, description: "The detected original language" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  originalText: { type: Type.STRING, description: "Verbatim transcription" },
                  translatedText: { type: Type.STRING, description: "Translation into target language" },
                  context: { type: Type.STRING, description: "Cultural context and intent" },
                  allergens: { type: Type.STRING, description: "Allergen warnings if applicable" },
                },
                required: ["originalText", "translatedText", "context", "allergens"],
              },
            },
          },
          required: ["items"],
        },
      },
    });
  } catch (error: any) {
    console.error("Gemini API Error (extractAndTranslate):", error);
    if (error?.message?.includes("API key") || error?.status === 401 || error?.status === 403) {
      throw new Error("Authentication failed: Invalid API key or missing permissions.");
    } else if (error?.status === 429 || error?.message?.includes("quota") || error?.message?.includes("429") || error?.message?.includes("exhausted")) {
      throw new Error("Service rate limit exceeded. You have exhausted your Gemini quota. Please wait or check your limits.");
    } else if (error?.status >= 500) {
      throw new Error(`The translation service is currently experiencing issues. (${error?.message || ''})`);
    } else {
      throw new Error(`Failed to communicate with the AI service. (${error?.message || ''})`);
    }
  }

  const text = response.text;
  if (!text) {
    throw new Error("No text received from Gemini API");
  }

  try {
    return JSON.parse(text) as GeminiResponse;
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON:", text);
    throw new Error("Received malformed data from AI. Please try a clearer photo.");
  }
};

export const translateAudio = async (
  base64Audio: string,
  mimeType: string,
  targetLanguage: string = 'English'
): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("GEMINI_API_KEY is not set. Please create a .env file locally and add your API key.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `
    Act as a professional bilingual interpreter and food safety assistant for a traveler. 
    Listen to this audio.
    First, identify the original language explicitly and provide it in 'detectedLanguage'. Use the language name in English (e.g. 'Spanish', 'Japanese').
    Provide:
    1. verbatim transcription in 'originalText'.
    2. idiomatic translation into ${targetLanguage} in 'translatedText'.
    3. 'context': Tone, slang, or cultural nuances.
    4. 'allergens': CRITICAL: If food items are mentioned, explicitly list any allergens discussed or inferable from the dish (e.g., peanuts, dairy, gluten). If no food/allergens are discussed, leave as an empty string.
  `;

  let response: GenerateContentResponse;
  try {
    response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          { text: "Listen to this audio and provide the translation, context, and explicitly identify and list any mentioned or potential allergens." },
        ],
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING, description: "The detected original language" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  originalText: { type: Type.STRING, description: "Verbatim transcription" },
                  translatedText: { type: Type.STRING, description: "Translation into target language" },
                  context: { type: Type.STRING, description: "Cultural Insight" },
                  allergens: { type: Type.STRING, description: "Mentioned allergen info" },
                },
                required: ["originalText", "translatedText", "context", "allergens"],
              },
            },
          },
          required: ["items"],
        },
      },
    });
  } catch (error: any) {
    console.error("Gemini API Error (translateAudio):", error);
    if (error?.message?.includes("API key") || error?.status === 401 || error?.status === 403) {
      throw new Error("Authentication failed: Invalid API key or missing permissions.");
    } else if (error?.status === 429 || error?.message?.includes("quota") || error?.message?.includes("429") || error?.message?.includes("exhausted")) {
      throw new Error("Service rate limit exceeded. You have exhausted your Gemini quota. Please wait or check your limits.");
    } else if (error?.status >= 500) {
      throw new Error(`The translation service is currently experiencing issues. (${error?.message || ''})`);
    } else {
      throw new Error(`Failed to communicate with the AI service. (${error?.message || ''})`);
    }
  }

  const text = response.text;
  if (!text) {
    throw new Error("No translation received from Gemini API");
  }

  try {
    return JSON.parse(text) as GeminiResponse;
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON:", text);
    throw new Error("Failed to interpret audio. Please speak more clearly or try again.");
  }
};
