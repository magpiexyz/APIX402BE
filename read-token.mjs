import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();
const tokenAddress = process.argv[2] || '0xbe65dfc2b92acc8aff879609384b75cd87c95005';

try {
  const doc = await firestore.collection('iao-tokens').doc(tokenAddress).get();
  if (doc.exists) {
    const data = doc.data();
    console.log('Token data:', JSON.stringify({
      slug: data.slug,
      distributionModel: data.distributionModel,
      virtualTokensDistributed: data.virtualTokensDistributed,
      graduated: data.graduated,
      chainId: data.chainId
    }, null, 2));
  } else {
    console.log('Document not found');
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
