const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const generateRiskTemplate = () => {
  // Define template columns
  const templateData = [
    {
      'Unit': 'Finance Department',
      'Risk Category': 'Operational Risk',
      'Risk Description': 'Example: Inadequate financial controls',
      'Risk Score (1-5)': 3,
      'Likelihood (1-5)': 2,
      'Impact (1-5)': 4,
      'Mitigation Strategy': 'Implement dual authorization for transactions',
      'Control Owner': 'CFO',
      'Target Date': '2024-12-31',
      'Status': 'Pending'
    }
  ];

  // Add instruction row
  const instructions = [
    {
      'Unit': 'INSTRUCTIONS:',
      'Risk Category': 'Fill in your data below',
      'Risk Description': 'Delete this row before upload',
      'Risk Score (1-5)': '1 = Very Low, 5 = Very High',
      'Likelihood (1-5)': '1 = Rare, 5 = Almost Certain',
      'Impact (1-5)': '1 = Insignificant, 5 = Catastrophic',
      'Mitigation Strategy': 'Describe controls',
      'Control Owner': 'Person responsible',
      'Target Date': 'YYYY-MM-DD format',
      'Status': 'Pending/In Progress/Completed'
    },
    {}, // Empty row for separation
    ...templateData
  ];

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(instructions, { header: [
    'Unit',
    'Risk Category',
    'Risk Description',
    'Risk Score (1-5)',
    'Likelihood (1-5)',
    'Impact (1-5)',
    'Mitigation Strategy',
    'Control Owner',
    'Target Date',
    'Status'
  ]});

  // Add column widths for better readability
  ws['!cols'] = [
    { wch: 20 }, // Unit
    { wch: 20 }, // Risk Category
    { wch: 40 }, // Risk Description
    { wch: 15 }, // Risk Score
    { wch: 15 }, // Likelihood
    { wch: 15 }, // Impact
    { wch: 30 }, // Mitigation Strategy
    { wch: 20 }, // Control Owner
    { wch: 15 }, // Target Date
    { wch: 15 }  // Status
  ];

  // Add the worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Assessment Template');

  // Add a second sheet with instructions
  const instructionSheet = XLSX.utils.aoa_to_sheet([
    ['RISK ASSESSMENT TEMPLATE INSTRUCTIONS'],
    [],
    ['Column', 'Description', 'Valid Values'],
    ['Unit', 'Department or business unit name', 'Text'],
    ['Risk Category', 'Category of risk', 'Operational, Financial, Compliance, Strategic'],
    ['Risk Description', 'Detailed description of the risk', 'Text'],
    ['Risk Score (1-5)', 'Overall risk score', '1-5 (1=Very Low, 5=Very High)'],
    ['Likelihood (1-5)', 'Probability of occurrence', '1-5 (1=Rare, 5=Almost Certain)'],
    ['Impact (1-5)', 'Potential impact if occurs', '1-5 (1=Insignificant, 5=Catastrophic)'],
    ['Mitigation Strategy', 'Controls or actions to mitigate risk', 'Text'],
    ['Control Owner', 'Person responsible', 'Name or role'],
    ['Target Date', 'Date for completion', 'YYYY-MM-DD'],
    ['Status', 'Current status', 'Pending, In Progress, Completed'],
    [],
    ['NOTES:'],
    ['- Delete the instruction row before uploading'],
    ['- All fields are required'],
    ['- Risk Score = Likelihood × Impact (calculated automatically)'],
    ['- Save file as .xlsx or .xls format']
  ]);

  XLSX.utils.book_append_sheet(wb, instructionSheet, 'Instructions');

  return wb;
};

module.exports = generateRiskTemplate;