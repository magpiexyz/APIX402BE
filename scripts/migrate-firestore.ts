/**
 * Firestore Cross-Project Migration Script
 *
 * Migrates collections from a source GCP project to a destination project
 * using the Firestore REST API with gcloud auth tokens.
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore.ts
 *
 * Prerequisites:
 *   - gcloud auth login (with access to both projects)
 *   - Both projects must have Firestore enabled
 */

import { execSync } from 'child_process';

const SOURCE_PROJECT = 'trim-dahlia-485008-u2';
const DEST_PROJECT = 'essential-rig-484808-g5';

const COLLECTIONS_TO_MIGRATE = [
  'iao-tokens',
  'token-earnings',
  'user-requests',
  'request-queue',
  'merkle-trees',
  'agents',
  'chat-sessions',
  'chat-messages',
  'agent-payments',
];

function getAccessToken(): string {
  return execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim();
}

function firestoreUrl(project: string, collection: string, docId?: string): string {
  const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}`;
  return docId ? `${base}/${encodeURIComponent(docId)}` : base;
}

async function listAllDocuments(project: string, collection: string, token: string): Promise<any[]> {
  const docs: any[] = [];
  let nextPageToken: string | undefined;

  while (true) {
    const url = new URL(firestoreUrl(project, collection));
    url.searchParams.set('pageSize', '300');
    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to list ${collection}: ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (data.documents) {
      docs.push(...data.documents);
    }

    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
  }

  return docs;
}

async function writeDocument(project: string, collection: string, docId: string, fields: any, token: string): Promise<void> {
  // Use PATCH to create or overwrite a document with a specific ID
  const url = `${firestoreUrl(project, collection, docId)}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to write ${collection}/${docId}: ${res.status} ${errText}`);
  }
}

async function migrateCollection(collection: string, token: string): Promise<number> {
  console.log(`\n📦 Migrating collection: ${collection}`);

  // Read all documents from source
  const docs = await listAllDocuments(SOURCE_PROJECT, collection, token);
  console.log(`   Found ${docs.length} documents in source`);

  if (docs.length === 0) return 0;

  // Check what already exists in destination
  let existingDocs: any[] = [];
  try {
    existingDocs = await listAllDocuments(DEST_PROJECT, collection, token);
  } catch {
    // Collection might not exist yet
  }
  const existingIds = new Set(existingDocs.map((d: any) => d.name.split('/').pop()));

  let migrated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const docId = doc.name.split('/').pop()!;

    if (existingIds.has(docId)) {
      skipped++;
      continue;
    }

    try {
      await writeDocument(DEST_PROJECT, collection, docId, doc.fields, token);
      migrated++;
      process.stdout.write(`   ✅ ${migrated}/${docs.length - skipped} migrated (${skipped} skipped)\r`);
    } catch (err: any) {
      console.error(`\n   ❌ Failed to write ${docId}: ${err.message}`);
    }
  }

  console.log(`   ✅ Done: ${migrated} migrated, ${skipped} skipped (already existed)`);
  return migrated;
}

async function main() {
  console.log('🔄 Firestore Cross-Project Migration');
  console.log(`   Source:      ${SOURCE_PROJECT}`);
  console.log(`   Destination: ${DEST_PROJECT}`);
  console.log(`   Collections: ${COLLECTIONS_TO_MIGRATE.join(', ')}`);
  console.log('');

  const token = getAccessToken();
  console.log('🔑 Access token obtained');

  let totalMigrated = 0;

  for (const collection of COLLECTIONS_TO_MIGRATE) {
    try {
      const count = await migrateCollection(collection, token);
      totalMigrated += count;
    } catch (err: any) {
      console.error(`   ❌ Failed to migrate ${collection}: ${err.message}`);
    }
  }

  console.log(`\n✅ Migration complete! Total documents migrated: ${totalMigrated}`);
}

main().catch(console.error);
