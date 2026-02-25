import * as admin from 'firebase-admin';

// Use default credentials from gcloud auth
admin.initializeApp({
  projectId: 'apix-dev-447917'
});

const db = admin.firestore();

const tokenAddress = '0xcbb0de160cdcd9cfc56f1b032188f94106c3311b';

db.collection('iao-tokens').doc(tokenAddress).delete().then(() => {
  console.log('Deleted terstt server (0xcbb0de160cdcd9cfc56f1b032188f94106c3311b)');
  process.exit(0);
}).catch((err: any) => {
  console.error(err);
  process.exit(1);
});
