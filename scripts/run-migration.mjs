/**
 * Run SQL migrations against Supabase using the service role key.
 * Uses the Supabase Management API's SQL endpoint.
 *
 * Usage: node scripts/run-migration.mjs <migration-file.sql>
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/run-migration.mjs <migration-file.sql>');
  process.exit(1);
}

const sql = readFileSync(resolve(filePath), 'utf-8');

// Split SQL into individual statements, handling functions with $$ delimiters
function splitStatements(sqlText) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  const lines = sqlText.split('\n');
  for (const line of lines) {
    // Skip comments-only lines
    const trimmed = line.trim();
    if (trimmed.startsWith('--') && !inDollarQuote) {
      continue;
    }

    current += line + '\n';

    // Track $$ delimiters
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }

    // If we hit a semicolon and we're not inside a $$ block
    if (trimmed.endsWith(';') && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

// Execute SQL via Supabase's pg endpoint
async function executeSQL(sqlStatement) {
  // Use the /rest/v1/ RPC or the direct pg endpoint
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ query: sqlStatement }),
  });

  return response;
}

// Use the Supabase pg-meta endpoint for DDL
async function executeDDL(sqlStatement) {
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sqlStatement }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

console.log(`Running migration: ${filePath}`);
console.log(`Against: ${SUPABASE_URL}`);

const statements = splitStatements(sql);
console.log(`Found ${statements.length} SQL statements\n`);

let success = 0;
let errors = 0;

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.substring(0, 80).replace(/\n/g, ' ');

  try {
    const result = await executeDDL(stmt);
    console.log(`✓ [${i + 1}/${statements.length}] ${preview}...`);
    success++;
  } catch (err) {
    console.error(`✗ [${i + 1}/${statements.length}] ${preview}...`);
    console.error(`  Error: ${err.message}\n`);
    errors++;
  }
}

console.log(`\nDone: ${success} succeeded, ${errors} failed out of ${statements.length} statements`);
if (errors > 0) process.exit(1);
