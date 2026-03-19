const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Use the connection details from your VS Code extension
const client = new Client({
  host: 'dpg-d69njk0boq4c73dl4lhg-a.oregon-postgres.render.com',
  port: 5432,
  database: 'kovapage_db',
  user: 'kovapage_user',
  password: 'x0ehodR60FpG9t9ePhryIDLJJOGyDJ8U',
  ssl: {
    rejectUnauthorized: false
  }
});

async function backup() {
  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Get all tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    let backupSQL = `-- KovaPage Database Backup\n-- Generated: ${new Date().toISOString()}\n\n`;
    
    for (const table of tablesRes.rows) {
      const tableName = table.table_name;
      console.log(`Backing up table: ${tableName}`);
      
      // Get table schema
      const schemaRes = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '${tableName}'
        ORDER BY ordinal_position
      `);
      
      // Get table data
      const dataRes = await client.query(`SELECT * FROM "${tableName}"`);
      
      if (dataRes.rows.length > 0) {
        backupSQL += `-- Table: ${tableName}\n`;
        backupSQL += `TRUNCATE TABLE "${tableName}" CASCADE;\n`;
        
        // Generate INSERT statements
        const columns = schemaRes.rows.map(c => `"${c.column_name}"`).join(', ');
        
        dataRes.rows.forEach(row => {
          const values = schemaRes.rows.map(col => {
            const val = row[col.column_name];
            if (val === null) return 'NULL';
            if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
            if (val instanceof Date) return `'${val.toISOString()}'`;
            return val;
          }).join(', ');
          
          backupSQL += `INSERT INTO "${tableName}" (${columns}) VALUES (${values});\n`;
        });
        
        backupSQL += '\n';
      }
    }
    
    // Save to file
    fs.writeFileSync('kovapage_backup.sql', backupSQL);
    console.log('✅ Backup saved to kovapage_backup.sql');
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
  } finally {
    await client.end();
  }
}

backup();