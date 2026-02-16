const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function generateDatabaseDocs() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'kovapage',
    user: 'postgres',
    password: '3.141590',
  });

  try {
    await client.connect();
    console.log('🔗 Connected to PostgreSQL');

    // Create docs directory
    const docsDir = path.join(process.cwd(), 'database-documentation');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Get all tables
    const tablesQuery = `
      SELECT 
        t.table_name,
        obj_description(c.oid) as description,
        c.reltuples as estimated_rows
      FROM information_schema.tables t
      JOIN pg_class c ON c.relname = t.table_name
      WHERE t.table_schema = 'public'
      ORDER BY t.table_name;
    `;

    const tables = await client.query(tablesQuery);

    let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KovaPage Database Documentation</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6; 
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 2rem; 
        }
        .header {
            background: white;
            padding: 2rem;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-bottom: 2rem;
        }
        .title {
            color: #2563eb;
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }
        .subtitle {
            color: #6b7280;
            font-size: 1.1rem;
        }
        .table-grid {
            display: grid;
            gap: 1.5rem;
        }
        .table-card {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            transition: transform 0.2s;
        }
        .table-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 30px rgba(0,0,0,0.15);
        }
        .table-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid #e5e7eb;
        }
        .table-name {
            font-size: 1.5rem;
            color: #1f2937;
            font-weight: 600;
        }
        .table-stats {
            background: #f3f4f6;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            color: #6b7280;
        }
        .schema-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
        }
        .schema-table th {
            background: #f8fafc;
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            color: #4b5563;
            border-bottom: 2px solid #e5e7eb;
        }
        .schema-table td {
            padding: 1rem;
            border-bottom: 1px solid #e5e7eb;
        }
        .schema-table tr:hover {
            background: #f9fafb;
        }
        .pk { 
            background: #dcfce7 !important;
            color: #166534;
            font-weight: 600;
        }
        .fk { 
            background: #fef3c7 !important;
            color: #92400e;
        }
        .nullable { color: #ef4444; }
        .not-null { color: #10b981; }
        .footer {
            text-align: center;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 0.9rem;
        }
        .diagram {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            margin: 2rem 0;
            text-align: center;
        }
        .mermaid {
            background: #f8fafc;
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.0.0/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({ startOnLoad: true, theme: 'default' });
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">📊 KovaPage Database Documentation</h1>
            <p class="subtitle">PostgreSQL Schema Documentation • Generated on ${new Date().toLocaleString()}</p>
        </div>
    `;

    // Generate Mermaid diagram
    html += `
        <div class="diagram">
            <h2 style="color: #1f2937; margin-bottom: 1rem;">Database Schema Diagram</h2>
            <div class="mermaid">
                erDiagram
    `;

    for (const table of tables.rows) {
      const columnsQuery = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          ordinal_position
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = '${table.table_name}'
        ORDER BY ordinal_position;
      `;

      const columns = await client.query(columnsQuery);
      
      // Add to Mermaid diagram
      html += `\n    ${table.table_name} {\n`;
      columns.rows.forEach(col => {
        const type = col.data_type.toUpperCase();
        const nullable = col.is_nullable === 'YES' ? ' NULL' : '';
        html += `        ${type} ${col.column_name}${nullable}\n`;
      });
      html += `    }`;
    }

    html += `
                \n    users ||--o{ otps : "email"}
            </div>
        </div>
        <div class="table-grid">
    `;

    // Generate detailed table documentation
    for (const table of tables.rows) {
      const columnsQuery = `
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          is_nullable,
          column_default,
          ordinal_position
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = '${table.table_name}'
        ORDER BY ordinal_position;
      `;

      const columns = await client.query(columnsQuery);
      
      // Get primary keys
      const pkQuery = `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = '${table.table_name}'
          AND tc.constraint_type = 'PRIMARY KEY';
      `;
      
      const primaryKeys = await client.query(pkQuery);
      const pkColumns = primaryKeys.rows.map(r => r.column_name);

      html += `
            <div class="table-card">
                <div class="table-header">
                    <h2 class="table-name">${table.table_name}</h2>
                    <div class="table-stats">
                        ${columns.rows.length} columns • ${table.estimated_rows || 0} rows
                    </div>
                </div>
                ${table.description ? `<p style="color: #6b7280; margin-bottom: 1rem;">${table.description}</p>` : ''}
                <table class="schema-table">
                    <thead>
                        <tr>
                            <th>Column</th>
                            <th>Type</th>
                            <th>Nullable</th>
                            <th>Default</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
      `;

      for (const col of columns.rows) {
        const isPK = pkColumns.includes(col.column_name);
        const rowClass = isPK ? 'pk' : '';
        const nullableClass = col.is_nullable === 'YES' ? 'nullable' : 'not-null';
        const nullableText = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        
        let description = '';
        if (isPK) description = 'Primary Key';
        if (col.column_name === 'email') description = 'Unique user email';
        if (col.column_name === 'password') description = 'Bcrypt hashed password';
        if (col.column_name === 'otp') description = '6-digit verification code';
        if (col.column_name.includes('At')) description = 'Timestamp';
        if (col.column_name.includes('is')) description = 'Boolean flag';

        html += `
                        <tr class="${rowClass}">
                            <td><strong>${col.column_name}</strong></td>
                            <td>${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}</td>
                            <td class="${nullableClass}">${nullableText}</td>
                            <td><code>${col.column_default || '—'}</code></td>
                            <td>${description}</td>
                        </tr>
        `;
      }

      html += `
                    </tbody>
                </table>
            </div>
      `;
    }

    html += `
        </div>
        <div class="footer">
            <p>KovaPage Audit App • Database Documentation • Generated automatically</p>
            <p style="margin-top: 0.5rem;">🔗 Connected to PostgreSQL • Schema: public • Database: kovapage</p>
        </div>
    </div>
</body>
</html>
    `;

    // Save HTML file
    const htmlPath = path.join(docsDir, 'index.html');
    fs.writeFileSync(htmlPath, html);

    // Also save as Markdown
    let markdown = `# KovaPage Database Documentation\n\n`;
    markdown += `**Generated**: ${new Date().toLocaleString()}\n`;
    markdown += `**Database**: kovapage\n`;
    markdown += `**Schema**: public\n\n`;

    for (const table of tables.rows) {
      markdown += `## 📋 ${table.table_name}\n\n`;
      markdown += `**Description**: ${table.description || 'No description'}\n\n`;
      markdown += `| Column | Type | Nullable | Default | Description |\n`;
      markdown += `|--------|------|----------|---------|-------------|\n`;

      const columnsQuery = `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = '${table.table_name}'
        ORDER BY ordinal_position;
      `;
      
      const columns = await client.query(columnsQuery);
      
      for (const col of columns.rows) {
        let description = '';
        if (col.column_name === 'email') description = 'Unique user email';
        if (col.column_name === 'password') description = 'Bcrypt hashed password';
        if (col.column_name === 'otp') description = '6-digit verification code';
        
        markdown += `| ${col.column_name} | ${col.data_type} | ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} | ${col.column_default || '—'} | ${description} |\n`;
      }
      
      markdown += `\n`;
    }

    fs.writeFileSync(path.join(docsDir, 'DATABASE.md'), markdown);

    await client.end();
    
    console.log('✨ Documentation generated successfully!');
    console.log(`📁 HTML: file://${htmlPath}`);
    console.log(`📄 Markdown: ${path.join(docsDir, 'DATABASE.md')}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the generator
generateDatabaseDocs();