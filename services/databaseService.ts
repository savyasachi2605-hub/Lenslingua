import { collection, doc, setDoc, deleteDoc, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { HistoryItem, ExtractedItem } from "../types";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const databaseService = {
  /**
   * Saves a translation event for a specific user and returns the new ID.
   */
  saveHistory: async (type: 'scan' | 'audio', targetLanguage: string, items: ExtractedItem[]): Promise<string> => {
    const user = auth.currentUser;
    if (!user || !user.uid) throw new Error("User not authenticated");
    
    // Generate an ID
    const newId = crypto.randomUUID();
    const docPath = `history/${newId}`;
    const docRef = doc(db, 'history', newId);
    
    try {
      await setDoc(docRef, {
        userId: user.uid,
        email: user.email || '',
        type,
        timestamp: new Date().toISOString(),
        targetLanguage,
        items
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, docPath);
    }
    
    console.debug(`LensLingua: Record saved with ID ${newId}`);
    return newId;
  },

  /**
   * Retrieves history exclusively for the logged-in user.
   */
  getUserHistory: async (): Promise<HistoryItem[]> => {
    const user = auth.currentUser;
    if (!user || !user.uid) return [];
    
    const historyRef = collection(db, 'history');
    const q = query(
      historyRef, 
      where("userId", "==", user.uid),
      orderBy("timestamp", "desc")
    );
    
    try {
      const querySnapshot = await getDocs(q);
      const history: HistoryItem[] = [];
      
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        history.push({
          id: docSnap.id,
          email: data.email,
          type: data.type,
          timestamp: data.timestamp,
          targetLanguage: data.targetLanguage,
          items: data.items
        });
      });
      
      return history;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'history');
      return [];
    }
  },

  /**
   * Clears history only for a specific user.
   */
  clearUserHistory: async (): Promise<void> => {
    const history = await databaseService.getUserHistory();
    const deletePromises = history.map(item => 
      databaseService.deleteHistoryItem(item.id)
    );
    await Promise.all(deletePromises);
  },

  /**
   * Deletes a single item from history.
   */
  deleteHistoryItem: async (itemId: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user || !user.uid) return;
    
    const docPath = `history/${itemId}`;
    const docRef = doc(db, 'history', itemId);
    try {
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, docPath);
    }
  }
};
