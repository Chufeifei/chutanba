const fs = require('node:fs');
const path = require('node:path');
const { loadMigrations } = require('../backend/src/database/migration-runner');

const ROOT = path.resolve(__dirname, '..');
const VNEXT_DIR = path.join(ROOT, 'docs', 'db', 'vnext');
const DDL_PATH = path.join(VNEXT_DIR, 'mysql_schema.sql');
const MANIFEST_PATH = path.join(VNEXT_DIR, 'schema-manifest.json');
const RELATIONS_PATH = path.join(VNEXT_DIR, 'logical-relations.json');

function splitSqlStatements(sql) {
  return sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean);
}

function tableNames(sql) {
  return [...sql.matchAll(/^CREATE TABLE\s+([a-z0-9_]+)/gmi)].map((match) => match[1]);
}

function foreignKeyNames(sql) {
  return [...sql.matchAll(/\bCONSTRAINT\s+(fk_vnext_[a-z0-9_]+)\s+FOREIGN KEY\b/gi)].map((match) => match[1]);
}

function sameMembers(actual, expected) {
  return actual.length === expected.length
    && actual.every((item) => expected.includes(item))
    && new Set(actual).size === actual.length;
}

function validateVNextSchema() {
  const ddl = fs.readFileSync(DDL_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const relationsDocument = JSON.parse(fs.readFileSync(RELATIONS_PATH, 'utf8'));
  const relations = relationsDocument.relations;
  const migrations = loadMigrations();
  const failures = [];
  const tables = tableNames(ddl);
  const foreignKeys = foreignKeyNames(ddl);
  const statements = splitSqlStatements(ddl);
  const bundledDdl = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'database', 'migrations', 'vnext_schema.sql'), 'utf8');

  if (manifest.version !== 'VNEXT_1') failures.push('VNext manifest version must be VNEXT_1');
  if (!sameMembers(tables, manifest.tables)) failures.push('DDL table inventory differs from manifest');
  if (ddl !== bundledDdl) failures.push('container migration DDL differs from canonical DDL');
  if (foreignKeys.length || manifest.foreignKeys.length || /\b(?:FOREIGN KEY|REFERENCES)\b/i.test(ddl)) {
    failures.push('physical foreign keys are not allowed');
  }
  if (!Array.isArray(relations)
      || !sameMembers(relations.map((item) => item.name), manifest.logicalRelations.map((item) => item.name))) {
    failures.push('logical relation inventory differs from manifest');
  }
  if (!/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci/i.test(ddl)) failures.push('DDL lacks MySQL 8 storage contract');
  if (/\b(FLOAT|DOUBLE|CURRENT_DATE|NOW\s*\()/i.test(ddl)) failures.push('DDL contains forbidden float or calendar authority');
  for (const relation of relations || []) {
    const declared = manifest.logicalRelations.find((item) => item.name === relation.name);
    if (!declared || declared.table !== relation.table
        || JSON.stringify(declared.columns) !== JSON.stringify(relation.columns)
        || (declared.references || null) !== (relation.references || null)
        || declared.rule !== relation.validationRule) {
      failures.push(`logical relation definition differs from manifest: ${relation.name}`);
    }
    if (relation.table === 'cross_entity') continue;
    const tableBlock = statements.find((statement) => statement.startsWith(`CREATE TABLE ${relation.table} (`));
    if (!tableBlock) {
      failures.push(`logical relation table missing: ${relation.name}`);
    } else {
      const index = new RegExp(`\\bKEY\\s+${relation.sourceIndex}\\s*\\(([^)]*)\\)`, 'i').exec(tableBlock);
      const indexedColumns = index?.[1].split(',').map((column) => column.trim().replace(/`/g, '')) || [];
      if (!relation.columns.every((column, offset) => indexedColumns[offset] === column)) {
        failures.push(`logical relation left-prefix index missing: ${relation.name}`);
      }
    }
    if (!relation.validationRule) failures.push(`logical relation validation rule missing: ${relation.name}`);
  }
  if (migrations.length !== 1 || migrations[0].file !== '0001_vnext_schema.js') failures.push('migration inventory is not VNext-only');
  if (JSON.stringify(migrations[0]?.statements || []) !== JSON.stringify(statements)) failures.push('migration statements differ from VNext DDL');
  for (const [requirement, entries] of Object.entries(manifest.requirements)) {
    if (!entries.length) failures.push('requirement has no mapping: ' + requirement);
    for (const entry of entries) {
      if (!entry.priority || !entry.transaction || !entry.test || !Array.isArray(entry.tables)) {
        failures.push('requirement mapping incomplete: ' + requirement);
      }
      for (const table of entry.tables || []) {
        if (!manifest.tables.includes(table)) failures.push('requirement references unknown table: ' + requirement + '.' + table);
      }
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      tables: tables.length,
      businessTables: tables.filter((item) => item !== 'cb_schema_migrations').length,
      foreignKeys: foreignKeys.length,
      logicalRelations: relations.length,
      requirements: Object.keys(manifest.requirements).length,
      migrations: migrations.length,
    },
  };
}

if (require.main === module) {
  const result = validateVNextSchema();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

module.exports = { DDL_PATH, MANIFEST_PATH, RELATIONS_PATH, splitSqlStatements, validateVNextSchema };
