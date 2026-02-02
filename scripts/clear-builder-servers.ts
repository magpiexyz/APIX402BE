/**
 * Script to delete all servers for a specific builder address
 */
import { getFirestoreClient, Collections } from '../src/db/firestoreClient.js';

const BUILDER_ADDRESS = '0x164b228887D04ae79C40Ad02Fc8333070D4f997C'.toLowerCase();

async function main() {
  const firestore = getFirestoreClient();
  
  console.log(`\nSearching for servers with builder: ${BUILDER_ADDRESS}\n`);
  
  // Query all tokens with this builder
  const snapshot = await firestore
    .collection(Collections.IAO_TOKENS)
    .where('builder', '==', BUILDER_ADDRESS)
    .get();
  
  if (snapshot.empty) {
    console.log('No servers found for this builder address.');
    return;
  }
  
  console.log(`Found ${snapshot.size} server(s) to delete:\n`);
  
  // List all found servers
  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`  - ${data.slug} (${doc.id})`);
  }
  
  console.log('\nDeleting...\n');
  
  // Delete each one
  for (const doc of snapshot.docs) {
    const data = doc.data();
    await doc.ref.delete();
    console.log(`  ✅ Deleted: ${data.slug} (${doc.id})`);
  }
  
  console.log(`\n✅ Successfully deleted ${snapshot.size} server(s)\n`);
}

main().catch(console.error);
