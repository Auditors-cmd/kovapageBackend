const express = require('express');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const User = require('../models/User');
const { sequelize } = require('../config/database');
const { uploadRiskData, deleteFromCloudinary } = require('../middleware/upload');
const cloudinary = require('../config/cloudinary');

const router = express.Router();

// All QA routes require authentication and quality_assurance role or higher
router.use(protect);
router.use(hasRoleLevel('quality_assurance'));

// =======================
// EXCEL TEMPLATE GENERATOR
// =======================

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

// Helper function to group data
const groupBy = (data, key) => {
  return data.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
};

// =======================
// TEMPLATE DOWNLOAD ENDPOINT
// =======================

// @desc    Download Operational Risk Template
// @route   GET /api/qa/download-risk-template
// @access  Quality Assurance and above
router.get('/download-risk-template', (req, res) => {
  try {
    // Generate template
    const wb = generateRiskTemplate();
    
    // Write to buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Set headers for file download
    res.setHeader('Content-Disposition', 'attachment; filename=Operational_Risk_Template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    
    // Send file
    res.send(buffer);

  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating template'
    });
  }
});

// =======================
// EXCEL UPLOAD AND VALIDATION ENDPOINT
// =======================

// @desc    Upload and validate Excel risk data
// @route   POST /api/qa/upload-risk-excel
// @access  Quality Assurance and above
router.post('/upload-risk-excel', uploadRiskData.single('riskFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an Excel file'
      });
    }

    const { title, description, department } = req.body;
    
    // Get file path from Cloudinary
    const filePath = req.file.path;
    
    // Read and parse Excel file
    const response = await fetch(filePath);
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const firstSheet = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);

    // Filter out instruction rows (rows with 'INSTRUCTIONS' in Unit field)
    const riskData = data.filter(row => 
      row.Unit && !row.Unit.toString().includes('INSTRUCTIONS') && 
      !row.Unit.toString().includes('NOTES')
    );

    // Validate data structure
    const requiredColumns = [
      'Unit', 'Risk Category', 'Risk Description', 
      'Risk Score (1-5)', 'Likelihood (1-5)', 'Impact (1-5)',
      'Mitigation Strategy', 'Control Owner', 'Target Date', 'Status'
    ];

    const validationErrors = [];
    const validData = [];

    riskData.forEach((row, index) => {
      const rowErrors = [];
      
      // Skip empty rows
      if (!row.Unit && !row['Risk Category']) return;

      // Check required fields
      requiredColumns.forEach(col => {
        if (row[col] === undefined || row[col] === null || row[col] === '') {
          rowErrors.push(`Missing ${col}`);
        }
      });

      // Validate risk scores (1-5)
      const riskScore = parseFloat(row['Risk Score (1-5)']);
      if (row['Risk Score (1-5)'] && (isNaN(riskScore) || riskScore < 1 || riskScore > 5)) {
        rowErrors.push('Risk Score must be between 1 and 5');
      }

      // Validate likelihood (1-5)
      const likelihood = parseFloat(row['Likelihood (1-5)']);
      if (row['Likelihood (1-5)'] && (isNaN(likelihood) || likelihood < 1 || likelihood > 5)) {
        rowErrors.push('Likelihood must be between 1 and 5');
      }

      // Validate impact (1-5)
      const impact = parseFloat(row['Impact (1-5)']);
      if (row['Impact (1-5)'] && (isNaN(impact) || impact < 1 || impact > 5)) {
        rowErrors.push('Impact must be between 1 and 5');
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (row['Target Date'] && !dateRegex.test(row['Target Date'])) {
        rowErrors.push('Target Date must be in YYYY-MM-DD format');
      }

      // Validate status
      const validStatuses = ['Pending', 'In Progress', 'Completed'];
      if (row['Status'] && !validStatuses.includes(row['Status'])) {
        rowErrors.push('Status must be one of: Pending, In Progress, Completed');
      }

      if (rowErrors.length === 0) {
        // Calculate risk level
        const riskScore = parseFloat(row['Risk Score (1-5)']) || 0;
        const likelihood = parseFloat(row['Likelihood (1-5)']) || 0;
        const impact = parseFloat(row['Impact (1-5)']) || 0;
        const calculatedRisk = likelihood * impact;

        validData.push({
          ...row,
          rowNumber: index + 2,
          calculatedRiskScore: calculatedRisk,
          riskLevel: calculatedRisk >= 15 ? 'High' : calculatedRisk >= 8 ? 'Medium' : 'Low',
          createdAt: new Date(),
          createdBy: req.user.id
        });
      } else {
        validationErrors.push({
          row: index + 2,
          errors: rowErrors
        });
      }
    });

    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        summary: {
          totalRows: riskData.length,
          validRows: validData.length,
          errorRows: validationErrors.length
        }
      });
    }

    // Calculate summary statistics
    const highRisk = validData.filter(d => d.riskLevel === 'High').length;
    const mediumRisk = validData.filter(d => d.riskLevel === 'Medium').length;
    const lowRisk = validData.filter(d => d.riskLevel === 'Low').length;

    // Store in database
    const riskAssessment = await RiskAssessment.create({
      title: title || 'Excel Risk Upload',
      description: description || 'Uploaded via Excel template',
      status: 'pending',
      riskData: {
        rows: validData,
        summary: {
          totalRisks: validData.length,
          highRisk,
          mediumRisk,
          lowRisk,
          byUnit: groupBy(validData, 'Unit'),
          byCategory: groupBy(validData, 'Risk Category'),
          byStatus: groupBy(validData, 'Status')
        }
      },
      originalFileName: req.file.originalname,
      fileUrl: req.file.path,
      fileSize: req.file.size,
      cloudinaryPublicId: req.file.filename,
      totalRisks: validData.length,
      highRiskCount: highRisk,
      mediumRiskCount: mediumRisk,
      lowRiskCount: lowRisk,
      progressPercentage: 0,
      assessmentDate: new Date(),
      department: department || 'General',
      createdBy: req.user.id,
      metadata: {
        uploadedBy: req.user.name,
        uploadDate: new Date(),
        fileType: req.file.mimetype,
        rowCount: validData.length,
        cloudinaryUrl: req.file.path
      }
    });

    // Update dashboard metrics
    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: 'Risk data uploaded and validated successfully',
      data: {
        id: riskAssessment.id,
        title: riskAssessment.title,
        summary: riskAssessment.riskData.summary,
        fileUrl: riskAssessment.fileUrl,
        rowCount: validData.length,
        createdAt: riskAssessment.createdAt
      }
    });

  } catch (error) {
    console.error('Upload Excel error:', error);
    
    if (req.file) {
      await deleteFromCloudinary(req.file.filename).catch(console.warn);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error processing Excel file',
      error: error.message
    });
  }
});

// =======================
// RISK ASSESSMENT ENDPOINTS
// =======================

// @desc    Upload risk data (JSON/CSV)
// @route   POST /api/qa/upload-risk-data
// @access  Quality Assurance and above
router.post('/upload-risk-data', uploadRiskData.single('riskFile'), async (req, res) => {
  try {
    const { title, description, department, assessmentDate, riskData } = req.body;
    const riskFile = req.file;
    
    let parsedRiskData = {};
    if (riskData) {
      try {
        parsedRiskData = JSON.parse(riskData);
      } catch (e) {
        parsedRiskData = { raw: riskData };
      }
    }

    if (riskFile) {
      parsedRiskData.fileInfo = {
        filename: riskFile.filename,
        originalName: riskFile.originalname,
        url: riskFile.path,
        size: riskFile.size,
        format: riskFile.format,
        resourceType: riskFile.resource_type
      };
    }

    const totalRisks = parsedRiskData.risks?.length || 0;
    const highRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'high').length || 0;
    const mediumRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'medium').length || 0;
    const lowRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'low').length || 0;

    const riskAssessment = await RiskAssessment.create({
      title: title || 'Risk Assessment Upload',
      description,
      status: 'pending',
      riskData: parsedRiskData,
      originalFileName: riskFile?.originalname,
      fileUrl: riskFile?.path,
      fileSize: riskFile?.size,
      cloudinaryPublicId: riskFile?.filename,
      totalRisks,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      progressPercentage: 0,
      assessmentDate: assessmentDate || new Date(),
      department,
      createdBy: req.user.id,
      metadata: {
        uploadedBy: req.user.name,
        uploadDate: new Date(),
        fileType: riskFile?.mimetype,
        cloudinaryUrl: riskFile?.path
      }
    });

    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: 'Risk data uploaded successfully to Cloudinary',
      data: {
        id: riskAssessment.id,
        title: riskAssessment.title,
        fileUrl: riskAssessment.fileUrl,
        cloudinaryPublicId: riskAssessment.cloudinaryPublicId
      }
    });

  } catch (error) {
    console.error('Upload risk data error:', error);
    
    if (req.file) {
      await deleteFromCloudinary(req.file.filename).catch(console.warn);
    }
    
    res.status(500).json({
      success: false,
      message: 'Error uploading risk data',
      error: error.message
    });
  }
});

// @desc    Get all risk assessments with status counts
// @route   GET /api/qa/risk-assessments
// @access  Quality Assurance and above
router.get('/risk-assessments', async (req, res) => {
  try {
    const { status, department, fromDate, toDate } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (department) where.department = department;
    if (fromDate || toDate) {
      where.assessmentDate = {};
      if (fromDate) where.assessmentDate[Op.gte] = new Date(fromDate);
      if (toDate) where.assessmentDate[Op.lte] = new Date(toDate);
    }

    const riskAssessments = await RiskAssessment.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'email', 'role', 'profilePhotoUrl']
      }]
    });

    const statusCounts = await RiskAssessment.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const counts = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      reviewed: 0
    };
    
    statusCounts.forEach(item => {
      counts[item.status] = parseInt(item.dataValues.count);
    });

    res.json({
      success: true,
      data: riskAssessments.map(ra => ({
        ...ra.toJSON(),
        fileUrl: ra.fileUrl,
        cloudinaryPublicId: ra.cloudinaryPublicId
      })),
      summary: {
        total: riskAssessments.length,
        counts,
        pending: counts.pending,
        inProgress: counts.in_progress,
        completed: counts.completed
      }
    });

  } catch (error) {
    console.error('Get risk assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching risk assessments'
    });
  }
});

// @desc    Update risk assessment status
// @route   PUT /api/qa/risk-assessments/:id/status
// @access  Quality Assurance and above
router.put('/risk-assessments/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    const riskAssessment = await RiskAssessment.findByPk(id);
    if (!riskAssessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found'
      });
    }

    riskAssessment.status = status;
    riskAssessment.updatedBy = req.user.id;

    if (status === 'completed') {
      riskAssessment.completedAt = new Date();
      riskAssessment.progressPercentage = 100;
    } else if (status === 'in_progress') {
      riskAssessment.progressPercentage = 50;
    } else if (status === 'pending') {
      riskAssessment.progressPercentage = 0;
    }

    await riskAssessment.save();
    await updateDashboardMetrics(req.user.id);

    res.json({
      success: true,
      message: `Risk assessment status updated to ${status}`,
      data: riskAssessment
    });

  } catch (error) {
    console.error('Update risk status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating risk assessment status'
    });
  }
});

// @desc    Delete risk assessment and its file from Cloudinary
// @route   DELETE /api/qa/risk-assessments/:id
// @access  Quality Assurance and above
router.delete('/risk-assessments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const riskAssessment = await RiskAssessment.findByPk(id);
    if (!riskAssessment) {
      return res.status(404).json({
        success: false,
        message: 'Risk assessment not found'
      });
    }

    if (riskAssessment.cloudinaryPublicId) {
      await deleteFromCloudinary(riskAssessment.cloudinaryPublicId);
    }

    await riskAssessment.destroy();
    await updateDashboardMetrics(req.user.id);

    res.json({
      success: true,
      message: 'Risk assessment deleted successfully'
    });

  } catch (error) {
    console.error('Delete risk assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting risk assessment'
    });
  }
});

// =======================
// MONITORING DASHBOARD ENDPOINTS
// =======================

// @desc    Get monitoring dashboard data
// @route   GET /api/qa/dashboard
// @access  Quality Assurance and above
router.get('/dashboard', async (req, res) => {
  try {
    let dashboard = await MonitoringDashboard.findOne({
      where: { createdBy: req.user.id, dashboardType: 'qa' }
    });

    const riskStats = await RiskAssessment.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const planStats = await AuditPlan.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const riskCounts = {
      pending: 0,
      in_progress: 0,
      completed: 0
    };
    riskStats.forEach(item => {
      if (item.status === 'pending') riskCounts.pending = parseInt(item.dataValues.count);
      if (item.status === 'in_progress') riskCounts.in_progress = parseInt(item.dataValues.count);
      if (item.status === 'completed') riskCounts.completed = parseInt(item.dataValues.count);
    });

    const recentRisks = await RiskAssessment.findAll({
      limit: 5,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'profilePhotoUrl']
      }]
    });

    const pendingPlans = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    const dashboardData = {
      riskAssessment: {
        total: riskCounts.pending + riskCounts.in_progress + riskCounts.completed,
        pending: riskCounts.pending,
        inProgress: riskCounts.in_progress,
        completed: riskCounts.completed,
        progress: riskCounts.completed > 0 
          ? Math.round((riskCounts.completed / (riskCounts.pending + riskCounts.in_progress + riskCounts.completed)) * 100)
          : 0
      },
      auditPlans: {
        total: planStats.reduce((sum, item) => sum + parseInt(item.dataValues.count), 0),
        pending: planStats.find(s => s.status === 'under_review')?.dataValues.count || 0,
        toReview: pendingPlans
      },
      recentActivities: recentRisks.map(r => ({
        id: r.id,
        title: r.title,
        status: r.status,
        date: r.createdAt,
        user: r.creator?.name,
        userPhoto: r.creator?.profilePhotoUrl,
        fileUrl: r.fileUrl
      })),
      charts: {
        riskDistribution: {
          labels: ['Pending', 'In Progress', 'Completed'],
          values: [riskCounts.pending, riskCounts.in_progress, riskCounts.completed]
        }
      },
      availableActions: [
        {
          name: 'Upload Risk Data',
          description: 'Upload operational risk template',
          endpoint: '/api/qa/upload-risk-data',
          icon: 'upload'
        },
        {
          name: 'Upload Excel Risk Data',
          description: 'Upload Excel template with validation',
          endpoint: '/api/qa/upload-risk-excel',
          icon: 'table'
        },
        {
          name: 'Download Template',
          description: 'Download Excel risk template',
          endpoint: '/api/qa/download-risk-template',
          icon: 'download'
        },
        {
          name: 'Monitoring Dashboard',
          description: 'Track status & generate reports',
          endpoint: '/api/qa/dashboard',
          icon: 'dashboard'
        },
        {
          name: 'Consolidate Plans',
          description: `${pendingPlans} unit plan${pendingPlans !== 1 ? 's' : ''} to review`,
          endpoint: '/api/qa/consolidate-plans',
          icon: 'merge'
        }
      ]
    };

    if (dashboard) {
      await dashboard.update({
        metrics: dashboardData,
        riskSummary: riskCounts,
        planSummary: {
          total: dashboardData.auditPlans.total,
          pending: dashboardData.auditPlans.pending
        },
        recentActivities: dashboardData.recentActivities,
        chartsData: dashboardData.charts,
        updatedAt: new Date()
      });
    } else {
      dashboard = await MonitoringDashboard.create({
        name: 'QA Dashboard',
        dashboardType: 'qa',
        metrics: dashboardData,
        riskSummary: riskCounts,
        planSummary: {
          total: dashboardData.auditPlans.total,
          pending: dashboardData.auditPlans.pending
        },
        recentActivities: dashboardData.recentActivities,
        chartsData: dashboardData.charts,
        createdBy: req.user.id
      });
    }

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching dashboard data'
    });
  }
});

// =======================
// ENHANCED DASHBOARD WITH CHARTS
// =======================

router.get('/dashboard-data', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const priorYear = currentYear - 1;

    const currentYearAudits = await AuditPlan.findAll({
      where: sequelize.where(
        sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
        currentYear
      ),
      attributes: [
        [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"')), 'quarter'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"'))],
      raw: true
    });

    const priorYearAudits = await AuditPlan.findAll({
      where: sequelize.where(
        sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
        priorYear
      ),
      attributes: [
        [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"')), 'quarter'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [sequelize.fn('EXTRACT', sequelize.literal('QUARTER FROM "createdAt"'))],
      raw: true
    });

    const auditPerformance = {
      currentYear: {
        year: currentYear,
        quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      },
      priorYear: {
        year: priorYear,
        quarters: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
      }
    };

    currentYearAudits.forEach(item => {
      const quarterNum = Math.floor(parseFloat(item.quarter));
      const quarterKey = `Q${quarterNum}`;
      auditPerformance.currentYear.quarters[quarterKey] = parseInt(item.count) || 0;
    });

    priorYearAudits.forEach(item => {
      const quarterNum = Math.floor(parseFloat(item.quarter));
      const quarterKey = `Q${quarterNum}`;
      auditPerformance.priorYear.quarters[quarterKey] = parseInt(item.count) || 0;
    });

    const quarterlyVariance = {
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
      variance: [],
      percentChange: []
    };

    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(quarter => {
      const current = auditPerformance.currentYear.quarters[quarter];
      const prior = auditPerformance.priorYear.quarters[quarter];
      const variance = current - prior;
      quarterlyVariance.variance.push(variance);
      
      const percentChange = prior === 0 ? (variance * 100) : Math.round((variance / prior) * 100);
      quarterlyVariance.percentChange.push(percentChange);
    });

    const pendingPlansCount = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    const readyForConsolidation = await AuditPlan.count({
      where: { status: 'approved' }
    });

    const pendingApprovals = await AuditPlan.count({
      where: { status: 'pending_approval' }
    });

    const reportsToReview = await AuditPlan.count({
      where: { status: 'ready_for_review' }
    });

    const auditHistory = await AuditPlan.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    const historySummary = {};
    let totalAudits = 0;
    auditHistory.forEach(item => {
      const count = parseInt(item.dataValues.count);
      historySummary[item.status] = count;
      totalAudits += count;
    });

    const recentRiskAssessments = await RiskAssessment.count({
      where: {
        createdAt: {
          [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    });

    const totalRiskFiles = await RiskAssessment.count({
      where: {
        cloudinaryPublicId: { [Op.ne]: null }
      }
    });

    const dashboardData = {
      charts: {
        auditPerformance: {
          title: 'Audit Performance Comparison',
          description: 'Prior Year vs Current Year by Quarter',
          data: auditPerformance,
          chartType: 'bar'
        },
        quarterlyVariance: {
          title: 'Quarterly Variance Trend',
          description: 'Change in audit performance',
          data: quarterlyVariance,
          chartType: 'line'
        }
      },
      actions: {
        downloadTemplate: {
          name: 'Download Excel Template',
          description: 'Download operational risk template',
          icon: 'download',
          route: '/api/qa/download-risk-template'
        },
        uploadExcel: {
          name: 'Upload Excel Risk Data',
          description: 'Upload and validate Excel file',
          icon: 'upload',
          count: recentRiskAssessments,
          route: '/api/qa/upload-risk-excel'
        },
        uploadRiskData: {
          name: 'Upload Risk Data',
          description: 'Upload JSON/CSV risk data',
          icon: 'code',
          route: '/api/qa/upload-risk-data'
        },
        monitoringDashboard: {
          name: 'Monitoring Dashboard',
          description: 'Track status & generate reports',
          icon: 'dashboard',
          route: '/api/qa/dashboard'
        },
        consolidatePlans: {
          name: 'Consolidate Plans',
          description: `${pendingPlansCount} unit plan${pendingPlansCount !== 1 ? 's' : ''} to review`,
          icon: 'merge',
          count: pendingPlansCount,
          route: '/api/qa/consolidate-plans'
        }
      },
      metrics: {
        pendingApprovals: {
          label: 'APM Approvals',
          count: pendingApprovals,
          icon: 'approval'
        },
        reportsToReview: {
          label: 'Report Review',
          count: reportsToReview,
          icon: 'report'
        },
        readyForConsolidation: {
          label: 'Ready for Consolidation',
          count: readyForConsolidation,
          icon: 'consolidate'
        },
        auditHistory: {
          label: 'Audit History',
          total: totalAudits,
          byStatus: historySummary,
          icon: 'history'
        },
        cloudinaryStorage: {
          label: 'Files in Cloudinary',
          count: totalRiskFiles,
          icon: 'cloud'
        }
      },
      summary: {
        totalAudits,
        pendingReviews: pendingPlansCount,
        completedThisYear: Object.values(auditPerformance.currentYear.quarters).reduce((a, b) => a + b, 0),
        totalCloudinaryFiles: totalRiskFiles
      }
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Enhanced dashboard data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching enhanced dashboard data'
    });
  }
});

// =======================
// AUDIT PLAN CONSOLIDATION
// =======================

// @desc    Get all audit plans for consolidation
// @route   GET /api/qa/audit-plans
// @access  Quality Assurance and above
router.get('/audit-plans', async (req, res) => {
  try {
    const { status, department } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (department) where.department = department;

    const plans = await AuditPlan.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          as: 'creator',           // This matches 'createdAuditPlans' in User model
          attributes: ['id', 'name', 'email', 'profilePhotoUrl']
        },
        {
          model: User,
          as: 'teamLead',           // This matches 'ledAuditPlans' in User model
          attributes: ['id', 'name', 'email', 'profilePhotoUrl']
        },
        {
          model: User,
          as: 'approver',           // This matches 'approvedAuditPlans' in User model
          attributes: ['id', 'name', 'email', 'profilePhotoUrl']
        },
        {
          model: RiskAssessment,
          as: 'riskAssessment',
          attributes: ['id', 'title', 'status', 'fileUrl', 'cloudinaryPublicId']
        }
      ]
    });

    // Count plans pending review
    const pendingCount = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    res.json({
      success: true,
      data: plans,
      summary: {
        total: plans.length,
        pendingReview: pendingCount,
        readyForConsolidation: plans.filter(p => p.status === 'approved').length
      }
    });

  } catch (error) {
    console.error('Get audit plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching audit plans',
      error: error.message
    });
  }
});

// @desc    Consolidate multiple audit plans
// @route   POST /api/qa/consolidate-plans
// @access  Quality Assurance and above
router.post('/consolidate-plans', async (req, res) => {
  try {
    const { planIds, consolidatedTitle, description } = req.body;

    if (!planIds || !Array.isArray(planIds) || planIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least 2 plan IDs to consolidate'
      });
    }

    const plans = await AuditPlan.findAll({
      where: {
        id: planIds
      },
      include: [{
        model: RiskAssessment,
        as: 'riskAssessment',
        attributes: ['fileUrl', 'cloudinaryPublicId']
      }]
    });

    if (plans.length !== planIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more plans not found'
      });
    }

    const planNumber = 'CON-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    const allAuditAreas = [];
    const attachedFiles = [];
    
    plans.forEach(plan => {
      if (plan.auditAreas && Array.isArray(plan.auditAreas)) {
        allAuditAreas.push(...plan.auditAreas);
      }
      if (plan.riskAssessment?.fileUrl) {
        attachedFiles.push({
          planId: plan.id,
          planTitle: plan.title,
          fileUrl: plan.riskAssessment.fileUrl,
          cloudinaryPublicId: plan.riskAssessment.cloudinaryPublicId
        });
      }
    });

    const consolidatedPlan = await AuditPlan.create({
      planNumber,
      title: consolidatedTitle || `Consolidated Audit Plan - ${new Date().toLocaleDateString()}`,
      description: description || 'Consolidated from multiple unit plans',
      status: 'consolidated',
      isConsolidated: true,
      consolidatedFrom: planIds,
      auditAreas: allAuditAreas,
      createdBy: req.user.id,
      metadata: {
        consolidatedBy: req.user.name,
        consolidationDate: new Date(),
        sourcePlans: plans.map(p => ({
          id: p.id,
          title: p.title,
          planNumber: p.planNumber,
          riskFileUrl: p.riskAssessment?.fileUrl
        })),
        attachedFiles
      }
    });

    await AuditPlan.update(
      { 
        status: 'consolidated',
        metadata: sequelize.fn('jsonb_set', 
          sequelize.col('metadata'), 
          '{consolidatedInto}', 
          sequelize.cast(JSON.stringify(consolidatedPlan.id), 'jsonb')
        )
      },
      { where: { id: planIds } }
    );

    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: `Successfully consolidated ${plans.length} plans`,
      data: {
        ...consolidatedPlan.toJSON(),
        attachedFiles
      }
    });

  } catch (error) {
    console.error('Consolidate plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Error consolidating plans'
    });
  }
});

// @desc    Download risk data template
// @route   GET /api/qa/download-template
// @access  Quality Assurance and above
router.get('/download-template', (req, res) => {
  try {
    const template = {
      version: '1.0',
      templateType: 'operational_risk_data',
      instructions: 'Fill in your risk data following this structure',
      storage: 'Files will be uploaded to Cloudinary',
      example: {
        risks: [
          {
            id: 'RISK-001',
            title: 'Example Risk',
            description: 'Risk description',
            severity: 'high',
            likelihood: 'probable',
            impact: 'major',
            department: 'Finance',
            identifiedBy: 'John Doe',
            identifiedDate: '2024-01-15',
            mitigation: 'Mitigation plan here'
          }
        ]
      },
      fields: [
        'id',
        'title',
        'description',
        'severity',
        'likelihood',
        'impact',
        'department',
        'identifiedBy',
        'identifiedDate',
        'mitigation'
      ]
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=risk-data-template.json');
    res.send(JSON.stringify(template, null, 2));

  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading template'
    });
  }
});

// Helper function to update dashboard metrics
async function updateDashboardMetrics(userId) {
  try {
    const dashboard = await MonitoringDashboard.findOne({
      where: { createdBy: userId, dashboardType: 'qa' }
    });

    if (dashboard) {
      const riskCounts = await RiskAssessment.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('status')), 'count']
        ],
        group: ['status']
      });

      const counts = {
        pending: 0,
        in_progress: 0,
        completed: 0
      };
      
      riskCounts.forEach(item => {
        if (item.status === 'pending') counts.pending = parseInt(item.dataValues.count);
        if (item.status === 'in_progress') counts.in_progress = parseInt(item.dataValues.count);
        if (item.status === 'completed') counts.completed = parseInt(item.dataValues.count);
      });

      const cloudinaryFiles = await RiskAssessment.count({
        where: {
          cloudinaryPublicId: { [Op.ne]: null }
        }
      });

      await dashboard.update({
        riskSummary: counts,
        metadata: {
          ...dashboard.metadata,
          cloudinaryFiles
        },
        updatedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Update dashboard metrics error:', error);
  }
}

module.exports = router;