import React from 'react';

interface PermissionModalProps {
  type: 'camera' | 'microphone';
  status: 'request' | 'blocked';
  onConfirm?: () => void;
  onClose: () => void;
}

export function PermissionModal({ type, status, onConfirm, onClose }: PermissionModalProps) {
  const isRequest = status === 'request';
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-[2rem] p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${isRequest ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
            {type === 'camera' ? (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            ) : (
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            )}
          </div>
          
          <h2 className="text-xl font-bold text-slate-900 dark:text-white capitalize">
            {isRequest ? `${type} Access Required` : `${type} Access Blocked`}
          </h2>
          
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isRequest 
              ? `LensLingua needs access to your ${type} to capture and translate. Please allow access when prompted by your browser.`
              : `Your browser has blocked access to the ${type}. Please allow access to use this feature.`}
          </p>

          {!isRequest && (
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 text-xs text-left w-full border border-slate-100 dark:border-slate-700/50 mt-2">
              <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1">How to unblock:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-500 dark:text-slate-400">
                <li>Click the lock or settings icon in your browser's URL bar at the top of the screen.</li>
                <li>Set the <strong>{type}</strong> permission to "Allow".</li>
                <li>Refresh the page and try again.</li>
              </ul>
            </div>
          )}

          <div className="flex w-full space-x-3 mt-6">
            <button
              onClick={onClose}
              className={`py-3.5 rounded-xl font-bold text-sm transition-all flex-1 ${isRequest ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200' : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90'}`}
            >
              {isRequest ? 'Cancel' : 'Close'}
            </button>
            {isRequest && (
              <button
                onClick={onConfirm}
                className="py-3.5 rounded-xl font-bold text-sm transition-all flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 active:scale-95"
              >
                Continue
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
