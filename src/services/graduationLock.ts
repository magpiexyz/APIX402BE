/**
 * Graduation Lock Service
 *
 * Prevents duplicate graduation execution using Firestore documents with a 5-minute TTL.
 * Layer 3 of race condition protection.
 */

import { getFirestoreClient, Collections } from '../db/firestoreClient.js';

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Attempt to acquire a graduation lock for a token.
 * Returns true if the lock was acquired, false if another process holds it.
 */
export async function acquireGraduationLock(tokenAddress: string): Promise<boolean> {
  const firestore = getFirestoreClient();
  const docId = tokenAddress.toLowerCase();
  const docRef = firestore.collection(Collections.GRADUATION_LOCKS).doc(docId);

  try {
    const acquired = await firestore.runTransaction(async (txn) => {
      const doc = await txn.get(docRef);

      if (doc.exists) {
        const data = doc.data()!;
        const lockedAt = new Date(data.lockedAt).getTime();
        const now = Date.now();

        // Lock exists and has NOT expired — someone else is processing
        if (now - lockedAt < LOCK_TTL_MS) {
          return false;
        }
        // Lock expired — overwrite it
      }

      txn.set(docRef, {
        tokenAddress: docId,
        lockedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
      });

      return true;
    });

    if (acquired) {
      console.log(`✅ Graduation lock acquired for ${tokenAddress}`);
    } else {
      console.log(`⏳ Graduation lock already held for ${tokenAddress}`);
    }
    return acquired;
  } catch (err) {
    console.error(`❌ Failed to acquire graduation lock for ${tokenAddress}:`, err);
    throw err;
  }
}

/**
 * Release the graduation lock for a token.
 */
export async function releaseGraduationLock(tokenAddress: string): Promise<void> {
  const firestore = getFirestoreClient();
  const docId = tokenAddress.toLowerCase();

  try {
    await firestore.collection(Collections.GRADUATION_LOCKS).doc(docId).delete();
    console.log(`✅ Graduation lock released for ${tokenAddress}`);
  } catch (err) {
    console.error(`❌ Failed to release graduation lock for ${tokenAddress}:`, err);
    // Don't throw — lock will expire via TTL anyway
  }
}
