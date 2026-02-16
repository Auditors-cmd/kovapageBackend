const { Client } = require('pg');
const fs = require('fs');

async function compareDocumentation() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'kovapage',
    user: 'postgres',
    password: '3.141590',
  });

  try {
    await client.connect();
    
    // Read generated documentation
    const docsContent = fs.readFileSync('database-documentation/index.html', 'utf8');
    
    // Get all tables from database
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `;
    const dbTables = await client.query(tablesQuery);
    
    console.log('🔍 Comparing Documentation vs Database...\n');
    
    const missingInDocs = [];
    const extraInDocs = [];
    
    // Check each database table exists in docs
    for (const table of dbTables.rows) {
      if (!docsContent.includes(`>${table.table_name}<`) && 
          !docsContent.includes(`"${table.table_name}"`)) {
        missingInDocs.push(table.table_name);
      }
    }
    
    // Report findings
    if (missingInDocs.length === 0) {
      console.log('✅ All database tables are documented!');
    } else {
      console.log('❌ Missing documentation for:');
      missingInDocs.forEach(table => console.log(`   - ${table}`));
    }
    
    await client.end();
    
  } catch (error) {
    console.error('Comparison error:', error);
  }
}

compareDocumentation();