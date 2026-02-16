const puppeteer = require('puppeteer');
const fs = require('fs');

async function generatePDF() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Read your HTML file
  const html = fs.readFileSync('database-documentation/index.html', 'utf8');
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  // Generate PDF
  await page.pdf({
    path: 'KovaPage-Database-Documentation.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
  });
  
  await browser.close();
  console.log('✅ PDF generated: KovaPage-Database-Documentation.pdf');
}

generatePDF();