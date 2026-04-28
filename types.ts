
export interface ExtractedItem {
  originalText: string;
  translatedText: string;
  context: string;
  allergens?: string;
}

export interface GeminiResponse {
  items: ExtractedItem[];
  detectedLanguage?: string;
}

export interface HistoryItem {
  id: string;
  email: string;
  type: 'scan' | 'audio';
  timestamp: string;
  targetLanguage: string;
  items: ExtractedItem[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' }
];
