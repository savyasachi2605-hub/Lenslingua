
import { auth } from './firebase';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Eye, EyeOff, Sun, Moon, User } from 'lucide-react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { AppStatus, ExtractedItem, SUPPORTED_LANGUAGES, HistoryItem } from './types';
import { extractAndTranslate, translateAudio } from './services/geminiService';
import { databaseService } from './services/databaseService';
import { PermissionModal } from './PermissionModal';

function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || (!stored && isSystemDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (!isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  return { isDark, toggleTheme };
}

// --- Constants ---
const MAX_DIMENSION = 800;
const MAX_FILE_SIZE_MB = 10;

// --- Helper Functions ---

declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

async function normalizeImage(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<{base64: string, mimeType: string}> {
  const canvas = document.createElement('canvas');
  let width = 0;
  let height = 0;

  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth;
    height = source.videoHeight;
  } else if (source instanceof HTMLCanvasElement) {
    width = source.width;
    height = source.height;
  } else {
    width = source.width;
    height = source.height;
  }

  if (width === 0 || height === 0) {
    throw new Error("We couldn't detect the size of your image. Please try another file or retake the photo.");
  }

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width > height) {
      height = Math.round((height / width) * MAX_DIMENSION);
      width = MAX_DIMENSION;
    } else {
      width = Math.round((width / height) * MAX_DIMENSION);
      height = MAX_DIMENSION;
    }
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error("Our image processor hit a snag. Please refresh the page and try again.");
  
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } catch (e) {
    throw new Error("Failed to process image data. The file might be corrupted.");
  }
  
  // Use WebP for better compression efficiency (lower latency)
  const dataUrl = canvas.toDataURL('image/webp', 0.80);
  const base64Data = dataUrl.split(',')[1];
  
  if (!base64Data) {
    throw new Error("Failed to encode image. Please try a different format.");
  }

  return {
    base64: base64Data,
    mimeType: 'image/webp'
  };
}

function getCroppedImg(image: HTMLImageElement, crop: PixelCrop): string {
  const canvas = document.createElement('canvas');
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (ctx) {
    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );
  }
  return canvas.toDataURL('image/webp', 0.85);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- Components ---

const AuthPage: React.FC<{ 
  isDark: boolean;
  toggleTheme: () => void;
}> = ({ isDark, toggleTheme }) => {
  const [error, setError] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Phone auth state
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError(err.message || "Failed to sign in with Google.");
    }
  };

  const setupRecaptcha = async () => {
    if (!window.recaptchaVerifier) {
      const { RecaptchaVerifier } = await import('firebase/auth');
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        'size': 'invisible',
      });
    }
  };

  const handlePhoneAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!isOtpSent) {
        await setupRecaptcha();
        const { signInWithPhoneNumber } = await import('firebase/auth');
        const confirmation = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
        setConfirmationResult(confirmation);
        setIsOtpSent(true);
      } else {
        if (confirmationResult) {
          await confirmationResult.confirm(otp);
        }
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed.");
      if (window.recaptchaVerifier) {
        // We're ignoring grecaptcha global to avoid typing issues, just clearing the widget if possible
        try {
          window.recaptchaVerifier.render().then((widgetId: any) => {
            (window as any).grecaptcha.reset(widgetId);
          });
        } catch (e) {}
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (isSignUp) {
        const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: username });
        // In a full implementation, you would also save the phone number to Firestore
      } else {
        const { signInWithEmailAndPassword } = await import('firebase/auth');
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError("Email/Password authentication is not enabled. Please enable it in the Firebase Console.");
      } else {
        setError(err.message || "Authentication failed.");
      }
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center px-4 py-12 overflow-hidden transition-colors duration-500 bg-slate-50 dark:bg-slate-950">
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-indigo-300/40 dark:bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-purple-300/40 dark:bg-purple-600/20 rounded-full blur-[100px] pointer-events-none" />
      
      <button onClick={toggleTheme} className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 p-2 sm:p-3 rounded-full bg-white/50 dark:bg-slate-800/50 backdrop-blur-md border border-white/50 dark:border-white/10 shadow-lg text-slate-800 dark:text-slate-200 transition-all hover:scale-105">
        {isDark ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
      </button>

      <div className="relative z-10 w-full max-w-md bg-white/80 dark:bg-slate-900/40 backdrop-blur-3xl backdrop-saturate-150 rounded-3xl shadow-2xl p-6 sm:p-8 border border-white/60 dark:border-white/10 shadow-indigo-500/10 dark:shadow-none animate-in fade-in zoom-in duration-500">
        <div className="flex flex-col items-center mb-6 sm:mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-indigo-200 dark:shadow-indigo-900/50 shadow-2xl mb-4">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">LensLingua</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-center">
            {isSignUp ? "Create your account" : "Sign in to your account"}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center space-x-3 animate-in slide-in-from-top-2">
            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-semibold text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2 mb-6">
          <button 
            type="button"
            onClick={() => {setAuthMethod('email'); setIsOtpSent(false); setError(null);}} 
            className={`flex-1 py-2.5 font-bold rounded-xl transition-all text-sm ${authMethod === 'email' ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          >
            Email
          </button>
          <button 
            type="button"
            onClick={() => {setAuthMethod('phone'); setIsOtpSent(false); setError(null); setIsSignUp(false);}} 
            className={`flex-1 py-2.5 font-bold rounded-xl transition-all text-sm ${authMethod === 'phone' ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
          >
            Phone
          </button>
        </div>

        {authMethod === 'email' ? (
          <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Username</label>
                  <input 
                    type="text" 
                    required={isSignUp}
                    placeholder="Username" 
                    className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-500 text-slate-900 dark:text-white font-semibold"
                    value={username} 
                    onChange={(e) => setUsername(e.target.value)} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    placeholder="+1 234 567 8900" 
                    className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-500 text-slate-900 dark:text-white font-semibold"
                    value={phoneNumber} 
                    onChange={(e) => setPhoneNumber(e.target.value)} 
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Email</label>
              <input 
                type="email" 
                required 
                placeholder="name@example.com" 
                className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-500 text-slate-900 dark:text-white font-semibold"
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
              />
            </div>

            <div className="relative">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Password</label>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                placeholder="••••••••" 
                className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all pr-12 text-slate-900 dark:text-white font-semibold"
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute bottom-3 right-4 text-slate-400 hover:text-indigo-600 transition-colors">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <button type="submit" className="w-full mt-2 bg-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all">
              {isSignUp ? "Sign Up" : "Sign In"}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePhoneAuth} className="space-y-4 mb-6">
            {!isOtpSent ? (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Phone Number</label>
                <input 
                  type="tel" 
                  required 
                  placeholder="+1 234 567 8900" 
                  className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-500 text-slate-900 dark:text-white font-semibold"
                  value={phoneNumber} 
                  onChange={(e) => setPhoneNumber(e.target.value)} 
                />
                <button type="submit" className="w-full mt-6 bg-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all">
                  Send Code
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">Verification Code</label>
                <input 
                  type="text" 
                  required 
                  placeholder="123456" 
                  className="w-full px-4 py-3 bg-white/60 dark:bg-slate-800/60 backdrop-blur-md border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-500 text-slate-900 dark:text-white font-semibold tracking-widest text-center text-lg"
                  value={otp} 
                  onChange={(e) => setOtp(e.target.value)} 
                />
                <button type="submit" className="w-full mt-6 bg-indigo-600 text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all">
                  Verify Code
                </button>
                <button type="button" onClick={() => setIsOtpSent(false)} className="w-full mt-3 text-indigo-600 dark:text-indigo-400 font-bold text-sm py-2 hover:underline">
                  Change Phone Number
                </button>
              </div>
            )}
          </form>
        )}

        <div id="recaptcha-container"></div>
        
        <div className="relative flex items-center py-4">
          <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
          <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-medium">Or</span>
          <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
        </div>

        <button onClick={handleGoogleSignIn} className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl shadow-sm transition-all flex items-center justify-center space-x-3 mb-6">
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          <span>Continue with Google</span>
        </button>

        <div className="text-center text-sm text-slate-500 dark:text-slate-400">
          {isSignUp ? (
            <>
              Already have an account? <span onClick={() => setIsSignUp(false)} className="text-indigo-600 dark:text-indigo-400 font-bold cursor-pointer hover:underline">Sign In</span>
            </>
          ) : (
            <>
              Don't have an account? <span onClick={() => setIsSignUp(true)} className="text-indigo-600 dark:text-indigo-400 font-bold cursor-pointer hover:underline">Sign Up</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Header: React.FC<{ 
  targetLang: string; 
  onLangChange: (lang: string) => void; 
  onSignOut: () => void;
  onShowHistory: () => void;
  onShowProfile: () => void;
  userEmail: string;
  isDark: boolean;
  toggleTheme: () => void;
}> = ({ targetLang, onLangChange, onSignOut, onShowHistory, onShowProfile, userEmail, isDark, toggleTheme }) => (
  <header className="bg-white/80 dark:bg-slate-900/40 backdrop-blur-3xl backdrop-saturate-150 border-b border-slate-200/50 dark:border-white/10 sticky top-0 z-10 transition-colors shadow-sm shadow-slate-100/50 dark:shadow-none">
    <div className="max-w-4xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
      <div className="flex items-center space-x-2 w-full sm:w-auto justify-center sm:justify-start">
        <div className="w-7 h-7 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-indigo-200 dark:shadow-indigo-900/40 shadow-lg shrink-0">
          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="flex flex-col">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tracking-tight leading-tight">LensLingua</h1>
          <span className="text-[9px] sm:text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider truncate max-w-[180px] sm:max-w-[120px]" title={userEmail}>
            {userEmail}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-2 sm:gap-3">
        <div className="flex items-center gap-1 sm:gap-3">
          <button onClick={toggleTheme} className="p-1.5 sm:p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Toggle Theme">
            {isDark ? <Sun className="w-4 h-4 sm:w-5 sm:h-5" /> : <Moon className="w-4 h-4 sm:w-5 sm:h-5" />}
          </button>
          <button onClick={onShowProfile} className="p-1.5 sm:p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="Profile">
            <User className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button onClick={onShowHistory} className="p-1.5 sm:p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" title="View History">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
        <div className="flex items-center gap-1 sm:gap-3 min-w-0">
          <div className="flex items-center space-x-1 sm:space-x-2 bg-slate-50 dark:bg-slate-800/80 p-0.5 sm:p-1 rounded-xl border border-slate-200 dark:border-slate-700 min-w-0 w-full">
            <select value={targetLang} onChange={(e) => onLangChange(e.target.value)} className="bg-transparent border-none text-[10px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer w-full text-ellipsis">
              {SUPPORTED_LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.name} className="dark:bg-slate-800">{lang.name}</option>
              ))}
            </select>
          </div>
          <button onClick={onSignOut} className="p-1.5 sm:p-2 text-slate-400 hover:text-red-500 transition-colors shrink-0" title="Sign Out">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
      </div>
    </div>
  </header>
);

const ResultCard: React.FC<{ item: ExtractedItem; targetLang: string }> = ({ item, targetLang }) => (
  <div className="bg-white/80 dark:bg-slate-900/50 backdrop-blur-2xl backdrop-saturate-150 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-white/80 dark:border-white/10 p-6 transition-all hover:shadow-2xl hover:shadow-slate-200/50 animate-in slide-in-from-bottom-2">
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1.5 block">Original Transcription</span>
        <p className="text-lg font-medium text-slate-800 dark:text-slate-200 leading-relaxed">{item.originalText}</p>
      </div>
      <div className="h-px bg-slate-200/50 dark:bg-slate-700/50 w-full" />
      <div>
        <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-1.5 block">Interpretation ({targetLang})</span>
        <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300 italic leading-snug">"{item.translatedText}"</p>
      </div>
      
      {item.allergens && item.allergens.trim().length > 0 && (
        <div className="bg-orange-50/80 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800/50 rounded-xl p-4 flex items-start space-x-3">
           <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
           <div>
             <span className="text-[10px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-widest block">Allergen Alert</span>
             <p className="text-xs text-orange-800 dark:text-orange-200 font-bold mt-0.5">{item.allergens}</p>
           </div>
        </div>
      )}

      <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50 backdrop-blur-sm">
        <div className="flex items-start space-x-3">
          <svg className="w-5 h-5 text-indigo-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <div>
            <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest block">Cultural Insight</span>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-1 font-medium">{item.context}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const HistoryPanel: React.FC<{ 
  email: string; 
  activeHistoryId: string | null;
  onClose: () => void;
  onSelect: (item: HistoryItem) => void;
}> = ({ email, activeHistoryId, onClose, onSelect }) => {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLang, setFilterLang] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');

  const loadHistory = async () => {
    try {
      const dbHistory = await databaseService.getUserHistory();
      setHistory(dbHistory);
    } catch (error) {
      console.error("Error loading history:", error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [email]);

  const languages = Array.from(new Set(history.map(item => item.targetLanguage)));

  const filteredHistory = history
    .filter(item => filterType === 'all' || item.type === filterType)
    .filter(item => filterLang === 'all' || item.targetLanguage === filterLang)
    .sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return sortBy === 'newest' ? dateB - dateA : dateA - dateB;
    });

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-[4px]" onClick={onClose} />
      <div className="relative w-full max-sm:max-w-full max-w-sm bg-white/90 dark:bg-slate-900/50 backdrop-blur-3xl backdrop-saturate-200 h-full shadow-2xl shadow-indigo-900/10 border-l border-white/60 dark:border-white/10 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="px-6 py-4 border-b border-white/50 dark:border-slate-700/50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">History</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/50 dark:hover:bg-slate-800/50 rounded-full transition-colors">
              <svg className="w-6 h-6 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="flex-1 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md border border-white/50 dark:border-slate-700/50 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg px-2 py-2 outline-none">
                <option value="all" className="dark:bg-slate-800">All Types</option>
                <option value="scan" className="dark:bg-slate-800">Image Scan</option>
                <option value="audio" className="dark:bg-slate-800">Audio</option>
              </select>
              <select value={filterLang} onChange={e => setFilterLang(e.target.value)} className="flex-1 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md border border-white/50 dark:border-slate-700/50 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg px-2 py-2 outline-none">
                <option value="all" className="dark:bg-slate-800">All Languages</option>
                {languages.map(lang => (
                  <option key={lang} value={lang} className="dark:bg-slate-800">{lang}</option>
                ))}
              </select>
            </div>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as 'newest'|'oldest')} className="w-full bg-white/40 dark:bg-slate-800/40 backdrop-blur-md border border-white/50 dark:border-slate-700/50 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-lg px-2 py-2 outline-none">
              <option value="newest" className="dark:bg-slate-800">Newest First</option>
              <option value="oldest" className="dark:bg-slate-800">Oldest First</option>
            </select>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-40">
              <svg className="w-16 h-16 mb-4 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="font-medium italic dark:text-white">No matching translations found.</p>
            </div>
          ) : (
            filteredHistory.map((item) => (
              <div 
                key={item.id} 
                className={`group relative rounded-2xl border transition-all backdrop-blur-md backdrop-saturate-150 ${item.id === activeHistoryId ? 'border-indigo-400/50 bg-indigo-100/50 dark:bg-indigo-900/30' : 'border-slate-200/50 dark:border-white/10 bg-white/70 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800/60 hover:shadow-md dark:hover:shadow-none'}`}
              >
                <button 
                  onClick={() => onSelect(item)}
                  className="w-full text-left p-4 relative z-0"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${item.type === 'audio' ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-300' : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300'}`}>
                      {item.type}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                      {new Date(item.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate pr-4">
                    {item.items && item.items[0]?.translatedText || "Untitled"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                    {item.targetLanguage} Translation
                  </p>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

const ProfilePanel: React.FC<{
  email: string;
  onClose: () => void;
  onSignOut: () => void;
}> = ({ email, onClose, onSignOut }) => {

  const displayName = auth.currentUser?.displayName || email.split('@')[0];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 dark:bg-slate-950/60 backdrop-blur-[4px]" onClick={onClose} />
      <div className="relative w-full max-sm:max-w-full max-w-sm bg-white/90 dark:bg-slate-900/50 backdrop-blur-3xl backdrop-saturate-200 h-full shadow-2xl shadow-indigo-900/10 border-l border-white/60 dark:border-white/10 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="px-6 py-4 border-b border-white/50 dark:border-slate-700/50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">Your Profile</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/50 dark:hover:bg-slate-800/50 rounded-full transition-colors">
              <svg className="w-6 h-6 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col items-center mb-6">
             <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center font-bold text-3xl mb-3 border-4 border-white dark:border-slate-800 shadow-xl overflow-hidden">
               {auth.currentUser?.photoURL ? (
                 <img src={auth.currentUser.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
               ) : (
                 displayName.charAt(0).toUpperCase()
               )}
             </div>
             <p className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-full">
               {email}
             </p>
             <p className="text-xs text-slate-500 mt-1">
               {displayName}
             </p>
          </div>
          
          <div className="pt-6 border-t border-slate-200 dark:border-white/10 mt-6">
            <button onClick={onSignOut} className="w-full flex items-center justify-center space-x-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold py-3.5 rounded-xl border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-[0.98] transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [targetLanguage, setTargetLanguage] = useState<string>('English');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [results, setResults] = useState<ExtractedItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isShutterFlashing, setIsShutterFlashing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [permissionModalState, setPermissionModalState] = useState<{
    type: 'camera' | 'microphone';
    status: 'request' | 'blocked';
    onConfirm?: () => void;
  } | null>(null);
  
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const resultsEndRef = useRef<HTMLDivElement>(null);

  // Audio specific states
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setIsAuthenticated(true);
        setUserEmail(user.email || '');
      } else {
        setIsAuthenticated(false);
        setUserEmail('');
      }
      setIsAuthChecking(false);
    });
    return () => unsubscribe();
  }, []);

  const copyResultsAsJson = () => {
    const jsonStr = JSON.stringify(results, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    });
  };

  const stopCamera = useCallback(() => {
    isInitializingRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsCameraReady(false);
  }, []);

  const onVideoReady = useCallback(() => {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setIsCameraReady(true);
    }
  }, []);

  const startCamera = async () => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;
    setError(null);
    setCapturedImage(null);
    setImagePreview(null);
    setResults([]);
    setIsCameraReady(false);
    setIsCameraActive(true);
    const constraints = {
      video: { facingMode: { ideal: 'environment' } as any, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    };
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (!isInitializingRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try { await videoRef.current.play(); } catch (e: any) { if (e.name !== 'AbortError') console.error("Video play failed:", e); }
      }
    } catch (err: any) {
      setIsCameraActive(false);
      setPermissionModalState({ type: 'camera', status: 'blocked' });
    } finally {
      isInitializingRef.current = false;
    }
  };

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isCameraReady) return;
    setIsShutterFlashing(true);
    setTimeout(() => setIsShutterFlashing(false), 150);
    try {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const ctx = captureCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error("Could not initialize capture context.");
      ctx.drawImage(video, 0, 0);
      const dataUrl = captureCanvas.toDataURL('image/webp', 0.8);
      setCapturedImage(dataUrl);
      setCrop(undefined);
      setCompletedCrop(undefined);
      stopCamera();
    } catch (e) {
      setError("Failed to capture image.");
    }
  }, [stopCamera, isCameraReady]);

  const retakePhoto = useCallback(() => {
    setCapturedImage(null);
    setResults([]);
    setActiveHistoryId(null);
    startCamera();
  }, [startCamera]);

  const processAndTranslate = async (source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement) => {
    setStatus(AppStatus.PROCESSING);
    setError(null);
    setActiveHistoryId(null);
    try {
      const { base64, mimeType } = await normalizeImage(source);
      const data = await extractAndTranslate(base64, mimeType, targetLanguage);
      if (!data.items || data.items.length === 0) throw new Error("We couldn't find any clear text.");
      
      setResults(data.items);
      if (data.detectedLanguage) {
        setDetectedLanguage(data.detectedLanguage);
      } else {
        setDetectedLanguage('Unknown');
        setTargetLanguage('English');
      }
      const newId = await databaseService.saveHistory('scan', targetLanguage, data.items);
      setActiveHistoryId(newId);
      setStatus(AppStatus.SUCCESS);
    } catch (err: any) {
      setError(err.message || 'Failed to analyze the image.');
      setStatus(AppStatus.ERROR);
    }
  };

  const confirmProcess = useCallback(async () => {
    const currentImgUrl = capturedImage || imagePreview;
    if (!currentImgUrl) return;

    const img = new Image();
    img.onload = async () => {
      if (completedCrop && completedCrop.width > 0 && completedCrop.height > 0 && imgRef.current) {
        const croppedDataUrl = getCroppedImg(imgRef.current, completedCrop);
        const croppedImg = new Image();
        croppedImg.onload = async () => {
          await processAndTranslate(croppedImg);
        };
        croppedImg.src = croppedDataUrl;
      } else {
        await processAndTranslate(img);
      }
    };
    img.src = currentImgUrl;
  }, [capturedImage, imagePreview, completedCrop, targetLanguage]);

  const startRecording = async () => {
    setError(null);
    setResults([]);
    setActiveHistoryId(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setStatus(AppStatus.PROCESSING);
        try {
          const base64Audio = await blobToBase64(audioBlob);
          const data = await translateAudio(base64Audio, 'audio/webm', targetLanguage);
          setResults(data.items);
          if (data.detectedLanguage) {
            setDetectedLanguage(data.detectedLanguage);
          } else {
            setDetectedLanguage('Unknown');
            setTargetLanguage('English');
          }
          const newId = await databaseService.saveHistory('audio', targetLanguage, data.items);
          setActiveHistoryId(newId);
          setStatus(AppStatus.SUCCESS);
        } catch (err: any) {
          setError(err.message || "Failed to translate audio.");
          setStatus(AppStatus.ERROR);
        } finally {
          stream.getTracks().forEach(t => t.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setPermissionModalState({ type: 'microphone', status: 'blocked' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResults([]);
    setDetectedLanguage(null);
    setActiveHistoryId(null);
    setStatus(AppStatus.IDLE);

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Audio file is too large. Max size is ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    
    setStatus(AppStatus.PROCESSING);
    try {
      const base64Audio = await blobToBase64(file);
      const data = await translateAudio(base64Audio, file.type || 'audio/webm', targetLanguage);
      setResults(data.items);
      if (data.detectedLanguage) {
        setDetectedLanguage(data.detectedLanguage);
      } else {
        setDetectedLanguage('Unknown');
        setTargetLanguage('English');
      }
      const newId = await databaseService.saveHistory('audio', targetLanguage, data.items);
      setActiveHistoryId(newId);
      setStatus(AppStatus.SUCCESS);
    } catch (err: any) {
      setError(err.message || "Failed to translate audio.");
      setStatus(AppStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResults([]);
    setDetectedLanguage(null);
    setActiveHistoryId(null);
    setStatus(AppStatus.IDLE);

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File is too large. Max size is ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setImagePreview(dataUrl);
      setCrop(undefined);
      setCompletedCrop(undefined);
    };
    reader.readAsDataURL(file);
  };

  const reset = () => {
    stopCamera();
    setImagePreview(null);
    setCapturedImage(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
    setDetectedLanguage(null);
    setResults([]);
    setActiveHistoryId(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    if (isRecording) stopRecording();
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setResults(item.items);
    setTargetLanguage(item.targetLanguage);
    setActiveHistoryId(item.id);
    setImagePreview(null);
    setCapturedImage(null);
    setStatus(AppStatus.SUCCESS);
    setShowHistory(false);
  };

  useEffect(() => {
    if (status === AppStatus.SUCCESS && results.length > 0) {
      resultsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [status, results]);

  useEffect(() => {
    let interval: number;
    if (isCameraActive && !isCameraReady) {
      interval = window.setInterval(() => {
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          setIsCameraReady(true);
          clearInterval(interval);
        }
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isCameraActive, isCameraReady]);

  if (isAuthChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthPage isDark={isDark} toggleTheme={toggleTheme} />
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 dark:bg-slate-950 relative overflow-x-hidden font-inter transition-colors duration-500">
      <div className="absolute top-0 left-1/4 w-[50vw] h-[50vw] bg-indigo-300/40 dark:bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[40vw] h-[40vw] bg-purple-300/40 dark:bg-purple-600/20 rounded-full blur-[100px] pointer-events-none" />

      <Header 
        targetLang={targetLanguage} 
        onLangChange={setTargetLanguage} 
        onSignOut={() => signOut(auth)} 
        onShowHistory={() => setShowHistory(true)}
        onShowProfile={() => setShowProfile(true)}
        userEmail={userEmail} 
        isDark={isDark}
        toggleTheme={toggleTheme}
      />

      <main className="flex-grow max-w-4xl mx-auto w-full px-4 py-8 sm:py-12 relative z-10">
        {!imagePreview && !isCameraActive && !capturedImage && !isRecording && (
          <div className="text-center py-6 sm:py-12">
            <div className="max-w-md mx-auto">
              <div className="mb-6 sm:mb-8">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-indigo-50 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">LensLingua Interpreter</h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2 px-4 font-medium italic text-sm sm:text-base">Ready to translate to <span className="text-indigo-600 dark:text-indigo-400 font-bold">{targetLanguage}</span></p>
              </div>

              <div className="flex flex-col gap-4 px-4">
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setPermissionModalState({ type: 'microphone', status: 'request', onConfirm: () => { setPermissionModalState(null); startRecording(); } })} className="bg-violet-600/80 dark:bg-violet-600/60 backdrop-blur-2xl backdrop-saturate-150 text-white font-bold py-5 rounded-[1.5rem] shadow-[0_8px_30px_rgb(124,58,237,0.15)] dark:shadow-none hover:bg-violet-600 active:scale-[0.98] transition-all flex flex-col items-center justify-center space-y-2 border border-white/30 dark:border-white/10">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    <span className="text-sm">Record Audio</span>
                  </button>

                  <button 
                    onClick={() => audioFileInputRef.current?.click()} 
                    className="bg-white/90 dark:bg-slate-800/50 backdrop-blur-2xl backdrop-saturate-150 text-slate-800 dark:text-white font-bold py-5 rounded-[1.5rem] shadow-xl shadow-slate-200/50 dark:shadow-none hover:bg-white dark:hover:bg-slate-700/60 active:scale-[0.98] transition-all flex flex-col items-center justify-center space-y-2 border border-white hover:border-slate-100 dark:border-white/10"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                    <span className="text-sm">Upload Audio</span>
                  </button>
                  <input ref={audioFileInputRef} type="file" accept="audio/*" onChange={handleAudioFileChange} className="hidden" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setPermissionModalState({ type: 'camera', status: 'request', onConfirm: () => { setPermissionModalState(null); startCamera(); } })} 
                    className="bg-indigo-600/80 dark:bg-indigo-600/60 backdrop-blur-2xl backdrop-saturate-150 text-white font-bold py-5 rounded-[1.5rem] shadow-[0_8px_30px_rgb(79,70,229,0.15)] dark:shadow-none hover:bg-indigo-600 active:scale-[0.98] transition-all flex flex-col items-center justify-center space-y-2 border border-white/30 dark:border-white/10"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    <span className="text-sm">Lens (Camera)</span>
                  </button>

                  <button 
                    onClick={() => fileInputRef.current?.click()} 
                    className="bg-white/90 dark:bg-slate-800/50 backdrop-blur-2xl backdrop-saturate-150 text-slate-800 dark:text-white font-bold py-5 rounded-[1.5rem] shadow-xl shadow-slate-200/50 dark:shadow-none hover:bg-white dark:hover:bg-slate-700/60 active:scale-[0.98] transition-all flex flex-col items-center justify-center space-y-2 border border-white hover:border-slate-100 dark:border-white/10"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span className="text-sm">Upload Image</span>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                </div>

                {results.length > 0 && status === AppStatus.SUCCESS && (
                  <div className="mt-12 space-y-6 text-left animate-in fade-in slide-in-from-bottom-6 duration-700">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div className="flex flex-col">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Analysis Results</h3>
                        {detectedLanguage && (
                          <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-1">
                            Detected: {detectedLanguage}
                          </span>
                        )}
                      </div>
                      <button 
                        onClick={copyResultsAsJson} 
                        className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-all shadow-sm ${copiedJson ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-200'}`}
                      >
                        {copiedJson ? '✓ Copied' : 'Copy JSON'}
                      </button>
                    </div>
                    <div className="grid gap-4">
                      {results.map((item, idx) => (
                        <ResultCard key={idx} item={item} targetLang={targetLanguage} />
                      ))}
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
                      <button 
                        onClick={reset} 
                        className="text-xs font-bold text-slate-400 hover:text-indigo-600 transition-colors uppercase tracking-widest px-6 py-3"
                      >
                        Clear Current View
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl text-left mt-8 animate-in shake duration-300">
                    <p className="font-bold">Interpretation Error</p>
                    <p className="text-sm mt-1">{error}</p>
                  </div>
                )}
              </div>


            </div>
          </div>
        )}

        {isRecording && (
          <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/80 backdrop-blur-md z-[70] flex items-center justify-center p-4">
            <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-3xl border border-white/50 dark:border-white/10 w-full max-w-sm rounded-[3rem] p-10 text-center shadow-2xl animate-in zoom-in duration-300">
              <div className="mb-8 relative flex justify-center">
                <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping"></div>
                <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center relative z-10 shadow-lg shadow-red-200 dark:shadow-red-900/50">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                </div>
              </div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Listening Closely...</h2>
              <p className="text-slate-500 dark:text-slate-400 mb-10 font-medium">Translate the surrounding audio into <span className="text-indigo-600 dark:text-indigo-400 font-bold">{targetLanguage}</span>.</p>
              <button onClick={stopRecording} className="w-full bg-slate-900 dark:bg-slate-800 text-white font-bold py-5 rounded-[1.5rem] hover:bg-slate-800 dark:hover:bg-slate-700 transition-all active:scale-[0.98] shadow-xl border border-white/10">End & Translate</button>
            </div>
          </div>
        )}

        {status === AppStatus.PROCESSING && !isRecording && (
          <div className="flex flex-col items-center justify-center py-20 space-y-6 animate-pulse">
            <div className="w-16 h-16 border-4 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Interpreting Media</h3>
              <p className="text-slate-500 dark:text-slate-400 font-medium italic">LensLingua is analyzing tone and context...</p>
            </div>
          </div>
        )}

        {(isCameraActive || capturedImage || imagePreview) && (
          <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Visual Header */}
            <div className="flex items-center justify-between px-2">
              <h3 className="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                {isCameraActive && !capturedImage ? 'Lens Active' : 'Image Analysis'}
              </h3>
              <div className="h-px flex-1 bg-indigo-200/50 mx-4" />
              <button onClick={reset} className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 hover:text-red-500 transition-colors">
                Exit Mode
              </button>
            </div>

            {/* The Image View Section */}
            <div className="relative aspect-[3/4] sm:aspect-video bg-slate-900 rounded-[2.5rem] overflow-hidden shadow-2xl border-4 border-white/50 dark:border-slate-800 flex items-center justify-center">
              {capturedImage || imagePreview ? (
                <div className="w-full h-full flex items-center justify-center relative touch-none">
                  {status === AppStatus.IDLE || status === AppStatus.ERROR ? (
                    <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} className="max-w-full max-h-full">
                      <img ref={imgRef} src={(capturedImage || imagePreview)!} alt="Preview" className="max-h-[60vh] object-contain" />
                    </ReactCrop>
                  ) : (
                    <img src={(capturedImage || imagePreview)!} alt="Preview" className="w-full h-full object-contain" />
                  )}
                </div>
              ) : (
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  onLoadedMetadata={onVideoReady} 
                  className={`w-full h-full object-cover transition-opacity duration-700 ${isCameraReady ? 'opacity-100' : 'opacity-0'}`} 
                />
              )}

              {/* Status Overlay */}
              {status === AppStatus.PROCESSING && (
                <div className="absolute inset-0 bg-indigo-900/40 backdrop-blur-sm z-40 flex flex-col items-center justify-center text-white space-y-4 animate-in fade-in duration-300">
                  <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-center px-6">
                    <p className="text-lg font-black tracking-tight uppercase italic">Scanning...</p>
                    <p className="text-xs text-white/70 font-medium">LensLingua is extracting nuances and text</p>
                  </div>
                </div>
              )}
              
              {/* Shutter Flash */}
              {isShutterFlashing && <div className="absolute inset-0 bg-white z-[60] animate-in fade-out duration-200" />}
              
              {/* Controls Overlay */}
              <div className="absolute inset-x-0 bottom-8 flex justify-center items-center px-4 z-30">
                {isCameraActive && !capturedImage ? (
                  <div className="flex items-center space-x-12">
                    <button onClick={stopCamera} className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-md border border-white/30 flex items-center justify-center text-white hover:bg-black/60 transition-all">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <button 
                      onClick={capturePhoto} 
                      disabled={!isCameraReady} 
                      className="w-20 h-20 rounded-full bg-white border-8 border-indigo-500/20 flex items-center justify-center shadow-2xl active:scale-90 transition-all"
                    >
                      <div className="w-12 h-12 rounded-full bg-indigo-600 shadow-inner"></div>
                    </button>
                    <div className="w-12"></div>
                  </div>
                ) : (
                  <div className="flex w-full max-w-sm space-x-4">
                    {results.length > 0 ? (
                      <button onClick={reset} className="flex-1 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg border border-white/50 dark:border-white/10 text-slate-800 dark:text-slate-200 font-bold py-4 rounded-2xl hover:bg-white/80 transition-all active:scale-95">
                        Finish
                      </button>
                    ) : (
                      <button onClick={reset} className="flex-1 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg border border-white/50 dark:border-white/10 text-slate-800 dark:text-slate-200 font-bold py-4 rounded-2xl hover:bg-white/80 transition-all active:scale-95">
                        Back
                      </button>
                    )}
                    
                    {(!results.length || status === AppStatus.ERROR) && (
                      <button 
                        onClick={confirmProcess} 
                        disabled={status === AppStatus.PROCESSING || (!capturedImage && !imagePreview)}
                        className="flex-[2] bg-indigo-600/90 backdrop-blur-xl border border-white/20 text-white font-bold py-4 rounded-2xl disabled:opacity-50 shadow-xl shadow-indigo-300/40 hover:bg-indigo-600 transition-all active:scale-95"
                      >
                        {status === AppStatus.PROCESSING ? 'Extracting...' : 'Extract & Translate'}
                      </button>
                    )}
                    
                    {results.length > 0 && (capturedImage || imagePreview) && (
                       <button onClick={retakePhoto} className="flex-[2] bg-indigo-600/90 backdrop-blur-xl border border-white/20 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-300/40 hover:bg-indigo-600 transition-all active:scale-95">
                        Scan Another
                       </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Results Section - DIRECTLY BELOW THE IMAGE */}
            {results.length > 0 && status === AppStatus.SUCCESS && (
              <div className="space-y-6 text-left animate-in slide-in-from-top-6 duration-700 pb-20">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 px-2">
                  <div className="flex flex-col">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Findings</h3>
                    <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-tight">Analysis Complete • {targetLanguage}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={copyResultsAsJson} 
                      className={`text-[10px] font-black uppercase tracking-widest px-5 py-2.5 rounded-2xl transition-all shadow-sm border ${copiedJson ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700'}`}
                    >
                      {copiedJson ? '✓ JSON Copied' : 'Export JSON'}
                    </button>
                  </div>
                </div>
                
                <div className="grid gap-5">
                  {results.map((item, idx) => (
                    <ResultCard key={idx} item={item} targetLang={targetLanguage} />
                  ))}
                </div>

                <div ref={resultsEndRef} className="pt-8 flex flex-col items-center">
                  <button 
                    onClick={reset} 
                    className="bg-slate-900 dark:bg-slate-800 text-white font-bold px-12 py-5 rounded-[1.5rem] shadow-2xl shadow-slate-300 dark:shadow-none hover:bg-slate-800 dark:hover:bg-slate-700 transition-all active:scale-[0.98] w-full sm:w-auto border border-white/10"
                  >
                    Close & Finish
                  </button>
                  <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-6">Interpretation powered by Gemini Flash</p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50/80 dark:bg-red-900/20 backdrop-blur-md border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-8 py-5 rounded-[2rem] text-left animate-in shake duration-300">
                <p className="font-black text-lg flex items-center gap-3">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Extraction Failed
                </p>
                <p className="text-sm mt-2 font-medium">{error}</p>
                 <button onClick={reset} className="mt-4 text-xs font-bold uppercase tracking-widest text-red-600 dark:text-red-400 hover:underline">Try again with new photo</button>
              </div>
            )}
          </div>
        )}
      </main>

      {showProfile && (
        <ProfilePanel 
          email={userEmail} 
          onClose={() => setShowProfile(false)} 
          onSignOut={() => signOut(auth)}
        />
      )}

      {showHistory && (
        <HistoryPanel 
          email={userEmail} 
          activeHistoryId={activeHistoryId}
          onClose={() => setShowHistory(false)} 
          onSelect={loadHistoryItem}
        />
      )}

      {permissionModalState && (
        <PermissionModal 
          type={permissionModalState.type}
          status={permissionModalState.status}
          onConfirm={permissionModalState.onConfirm}
          onClose={() => setPermissionModalState(null)} 
        />
      )}

      <footer className="w-full py-10 border-t border-slate-200/50 dark:border-white/10 bg-white/70 dark:bg-slate-900/30 backdrop-blur-3xl backdrop-saturate-150 mt-auto z-10 transition-colors">
        <div className="max-w-4xl mx-auto px-4 flex flex-col items-center gap-3">
          <div className="flex items-center space-x-2 opacity-30 dark:opacity-40">
            <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />
            <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />
            <div className="w-2 h-2 rounded-full bg-slate-400 dark:bg-slate-500" />
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase tracking-[0.2em]">LensLingua</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
