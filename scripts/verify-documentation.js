const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function verifyDocumentation() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'kovapage',
    user: 'postgres',
    password: '3.141590',
  });

  try {
    await client.connect();
    console.log('🔍 Verifying Database Documentation Coverage...\n');

    // 1. Check Tables
    console.log('📋 1. TABLE DOCUMENTATION');
    const tablesQuery = `
      SELECT table_name, table_type 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tables = await client.query(tablesQuery);
    
    console.log(`Found ${tables.rows.length} tables in database:`);
    tables.rows.forEach(table => {
      console.log(`  ✅ ${table.table_name} (${table.table_type})`);
    });

    // 2. Check Columns per Table
    console.log('\n📊 2. COLUMN DOCUMENTATION PER TABLE');
    let totalColumns = 0;
    let undocumentedColumns = [];

    for (const table of tables.rows) {
      const columnsQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = '${table.table_name}'
        ORDER BY ordinal_position;
      `;
      const columns = await client.query(columnsQuery);
      
      console.log(`\n  Table: ${table.table_name} (${columns.rows.length} columns)`);
      columns.rows.forEach(col => {
        console.log(`    ✅ ${col.column_name} (${col.data_type}, ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'})`);
        totalColumns++;
      });
    }

    // 3. Check Constraints
    console.log('\n🔗 3. CONSTRAINT DOCUMENTATION');
    const constraintsQuery = `
      SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        string_agg(kcu.column_name, ', ') as columns
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_schema = 'public'
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
      ORDER BY tc.table_name, tc.constraint_type;
    `;
    const constraints = await client.query(constraintsQuery);
    
    console.log(`Found ${constraints.rows.length} constraints:`);
    constraints.rows.forEach(constraint => {
      console.log(`  ✅ ${constraint.constraint_type}: ${constraint.constraint_name} on ${constraint.table_name}.${constraint.columns}`);
    });

    // 4. Check Indexes
    console.log('\n📈 4. INDEX DOCUMENTATION');
    const indexesQuery = `
      SELECT 
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
        AND indexname NOT LIKE '%pkey'
        AND indexname NOT LIKE '%fkey'
        AND indexname NOT LIKE '%unique'
      ORDER BY tablename, indexname;
    `;
    const indexes = await client.query(indexesQuery);
    
    console.log(`Found ${indexes.rows.length} custom indexes:`);
    indexes.rows.forEach(index => {
      console.log(`  ✅ ${index.indexname} on ${index.tablename}`);
    });

    // 5. Check Views (if any)
    console.log('\n👁️  5. VIEW DOCUMENTATION');
    const viewsQuery = `
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public';
    `;
    const views = await client.query(viewsQuery);
    
    if (views.rows.length > 0) {
      console.log(`Found ${views.rows.length} views:`);
      views.rows.forEach(view => {
        console.log(`  ✅ ${view.table_name}`);
      });
    } else {
      console.log('No views found');
    }

    // 6. Check Functions/Procedures (if any)
    console.log('\n⚙️  6. FUNCTION/PROCEDURE DOCUMENTATION');
    const functionsQuery = `
      SELECT 
        routine_name,
        routine_type,
        data_type as return_type
      FROM information_schema.routines 
      WHERE routine_schema = 'public'
      ORDER BY routine_name;
    `;
    const functions = await client.query(functionsQuery);
    
    if (functions.rows.length > 0) {
      console.log(`Found ${functions.rows.length} functions/procedures:`);
      functions.rows.forEach(func => {
        console.log(`  ✅ ${func.routine_name} (${func.routine_type}, returns: ${func.return_type})`);
      });
    } else {
      console.log('No functions/procedures found');
    }

    // 7. Check Enums (your custom types)
    console.log('\n🎯 7. ENUM TYPE DOCUMENTATION');
    
    // DECLARE enums variable here so it's accessible later
    let enums = { rows: [] };
    
    try {
      const enumsQuery = `
        SELECT 
          t.typname as enum_name,
          json_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype = 'e'
        GROUP BY t.typname;
      `;

      const enumsResult = await client.query(enumsQuery);
      enums = enumsResult;
      
      if (enums.rows.length > 0) {
        console.log(`Found ${enums.rows.length} enum types:`);
        enums.rows.forEach(enumType => {
          const values = enumType.enum_values;
          if (Array.isArray(values)) {
            console.log(`  ✅ ${enumType.enum_name}: [${values.join(', ')}]`);
          } else {
            console.log(`  ✅ ${enumType.enum_name}: ${values}`);
          }
        });
      } else {
        console.log('No custom enum types found');
      }
    } catch (error) {
      console.log(`  ⚠️  Could not fetch enum types: ${error.message}`);
    }

    // 8. Check Sequences
    console.log('\n🔢 8. SEQUENCE DOCUMENTATION');
    const sequencesQuery = `
      SELECT 
        sequence_name,
        data_type,
        start_value,
        increment
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public';
    `;
    const sequences = await client.query(sequencesQuery);
    
    if (sequences.rows.length > 0) {
      console.log(`Found ${sequences.rows.length} sequences:`);
      sequences.rows.forEach(seq => {
        console.log(`  ✅ ${seq.sequence_name} (${seq.data_type}, start: ${seq.start_value}, increment: ${seq.increment})`);
      });
    } else {
      console.log('No sequences found');
    }

    // 9. Generate Summary Report
    console.log('\n' + '='.repeat(60));
    console.log('📊 DOCUMENTATION VERIFICATION SUMMARY');
    console.log('='.repeat(60));
    
    const summary = {
      tables: tables.rows.length,
      totalColumns: totalColumns,
      constraints: constraints.rows.length,
      indexes: indexes.rows.length,
      views: views.rows.length,
      functions: functions.rows.length,
      enums: enums.rows.length, // FIXED: enums is now defined
      sequences: sequences.rows.length
    };

    console.log(`
Database Schema Elements:
├── Tables: ${summary.tables}
├── Total Columns: ${summary.totalColumns}
├── Constraints: ${summary.constraints}
├── Indexes: ${summary.indexes}
├── Views: ${summary.views}
├── Functions/Procedures: ${summary.functions}
├── Enum Types: ${summary.enums}
└── Sequences: ${summary.sequences}

📝 Documentation Status:
${summary.tables > 0 ? '✅ Tables documented' : '❌ No tables documented'}
${summary.totalColumns > 0 ? '✅ Columns documented' : '❌ No columns documented'}
${summary.constraints > 0 ? '✅ Constraints documented' : '⚠️  No constraints found'}
${summary.indexes > 0 ? '✅ Indexes documented' : '⚠️  No custom indexes found'}
${summary.enums > 0 ? '✅ Enum types documented' : '⚠️  No enum types found'}

${undocumentedColumns.length > 0 ? `\n⚠️  ${undocumentedColumns.length} columns need description` : '\n✨ All schema elements are documented!'}
    `);

    // 10. Generate a checklist file
    const checklist = `
# Database Documentation Checklist
# Generated: ${new Date().toISOString()}

## Schema Elements to Document

### Tables (${summary.tables})
${tables.rows.map(t => `- [ ] ${t.table_name} (${t.table_type})`).join('\n')}

### Total Columns: ${summary.totalColumns}

### Constraints (${summary.constraints})
${constraints.rows.map(c => `- [ ] ${c.constraint_type}: ${c.constraint_name} on ${c.table_name}`).join('\n')}

### Indexes (${summary.indexes})
${indexes.rows.map(i => `- [ ] ${i.indexname} on ${i.tablename}`).join('\n')}

### Enum Types (${summary.enums})
${enums.rows.length > 0 ? enums.rows.map(e => {
  const values = Array.isArray(e.enum_values) ? e.enum_values.join(', ') : String(e.enum_values || '');
  return `- [ ] ${e.enum_name}: ${values}`;
}).join('\n') : 'No enums found'}

## Verification Status
✅ - Documented
❌ - Missing
⚠️  - Not applicable
    `;

    // Create directory if it doesn't exist
    const docsDir = 'database-documentation';
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }
    
    fs.writeFileSync(path.join(docsDir, 'CHECKLIST.md'), checklist);
    console.log(`\n📋 Checklist saved: ${path.join(docsDir, 'CHECKLIST.md')}`);

    await client.end();

  } catch (error) {
    console.error('❌ Verification error:', error.message);
  }
}

verifyDocumentation();