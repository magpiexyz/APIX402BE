const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'apix-dev-447917'
});

const db = admin.firestore();

const tokenAddress = '0xcbb0de160cdcd9cfc56f1b032188f94106c3311b';

db.collection('iao-tokens').doc(tokenAddress).delete().then(() => {
  console.log('Deleted terstt server');
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
