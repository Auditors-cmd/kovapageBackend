const express = require('express');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const puppeteer = require('puppeteer');
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


// EXCEL TEMPLATE GENERATOR

const generateRiskTemplate = () => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create template data
  const templateData = [
    ['Unit', 'Risk Category', 'Risk Description', 'Risk Score (1-5)', 'Likelihood (1-5)', 'Impact (1-5)', 'Mitigation Strategy', 'Control Owner', 'Target Date', 'Status'],
    ['Finance Department', 'Operational Risk', 'Example: Inadequate financial controls', 3, 2, 4, 'Implement dual authorization for transactions', 'CFO', '2024-12-31', 'Pending'],
    ['IT Department', 'Cyber Security', 'Example: Data breach risk', 4, 3, 5, 'Implement MFA and monitoring', 'CTO', '2024-11-30', 'In Progress'],
    ['HR Department', 'Compliance', 'Example: Policy violation', 2, 2, 3, 'Update employee handbook', 'HR Director', '2024-10-15', 'Completed']
  ];

  // Convert to worksheet
  const ws = XLSX.utils.aoa_to_sheet(templateData);

  // Add column widths
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

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Risk Assessment Template');

  // Add instructions sheet
  const instructionsData = [
    ['RISK ASSESSMENT TEMPLATE INSTRUCTIONS'],
    [],
    ['Column', 'Description', 'Valid Values / Format'],
    ['Unit', 'Department or business unit name', 'Text (e.g., Finance, IT, HR)'],
    ['Risk Category', 'Category of risk', 'Operational, Financial, Compliance, Strategic, Cyber Security'],
    ['Risk Description', 'Detailed description of the risk', 'Text - be specific'],
    ['Risk Score (1-5)', 'Overall risk score', '1 (Very Low) to 5 (Very High)'],
    ['Likelihood (1-5)', 'Probability of occurrence', '1 (Rare) to 5 (Almost Certain)'],
    ['Impact (1-5)', 'Potential impact if occurs', '1 (Insignificant) to 5 (Catastrophic)'],
    ['Mitigation Strategy', 'Controls or actions to mitigate risk', 'Text - describe controls'],
    ['Control Owner', 'Person responsible', 'Name or role title'],
    ['Target Date', 'Date for completion', 'YYYY-MM-DD format (e.g., 2024-12-31)'],
    ['Status', 'Current status', 'Pending, In Progress, Completed'],
    [],
    ['NOTES:'],
    ['• All fields are required'],
    ['• Risk Score = Likelihood × Impact (calculated automatically)'],
    ['• Save file as .xlsx or .xls format before uploading'],
    ['• Maximum file size: 10MB']
  ];

  const instructionsWs = XLSX.utils.aoa_to_sheet(instructionsData);
  instructionsWs['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, instructionsWs, 'Instructions');

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

const QA_PLAN_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

const getQaPlanInclude = () => ([
  {
    model: User,
    as: 'creator',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: User,
    as: 'teamLead',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: User,
    as: 'approver',
    attributes: ['id', 'name', 'email', 'profilePhotoUrl']
  },
  {
    model: RiskAssessment,
    as: 'riskAssessment',
    attributes: [
      'id', 'title', 'status', 'fileUrl', 'cloudinaryPublicId',
      'totalRisks', 'highRiskCount', 'mediumRiskCount', 'lowRiskCount'
    ]
  }
]);

const getQuarterFromDate = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
};

const detectQuarter = (plan) => {
  if (plan.auditPeriod) {
    const quarterMatch = plan.auditPeriod.toString().toUpperCase().match(/Q[1-4]/);
    if (quarterMatch) return quarterMatch[0];
  }
  return getQuarterFromDate(plan.startDate) || getQuarterFromDate(plan.createdAt);
};

const detectFrequency = (plan) => {
  const periodText = (plan.auditPeriod || '').toString().toLowerCase();
  if (periodText.includes('annual') || periodText.includes('fy')) return 'Annual';
  if (periodText.includes('quarter') || periodText.includes('q')) return 'Quarterly';
  return 'Annual';
};

const estimateResources = (plan, auditorCapacityHours) => {
  const teamSize = Array.isArray(plan.teamMemberIds) ? plan.teamMemberIds.length : 0;
  if (teamSize > 0) return teamSize;

  const hours = parseInt(plan.resourceHours || 0, 10);
  if (hours > 0 && auditorCapacityHours > 0) {
    return Math.max(1, Math.ceil(hours / auditorCapacityHours));
  }
  return 0;
};

const deriveRiskScore = (plan) => {
  const manualScore = parseFloat(plan?.metadata?.manualOperationalRiskScore);
  if (!Number.isNaN(manualScore)) {
    return Math.max(0, Math.min(100, Math.round(manualScore)));
  }

  const high = parseInt(plan?.riskAssessment?.highRiskCount || 0, 10);
  const medium = parseInt(plan?.riskAssessment?.mediumRiskCount || 0, 10);
  const low = parseInt(plan?.riskAssessment?.lowRiskCount || 0, 10);
  const total = parseInt(plan?.riskAssessment?.totalRisks || 0, 10);

  if (!total) return 0;
  const weightedScore = (high * 3) + (medium * 2) + low;
  const normalized = (weightedScore / (total * 3)) * 100;
  return Math.round(normalized);
};

const deriveRiskRating = (score, plan = null) => {
  const manualRating = plan?.metadata?.manualRiskRating;
  if (manualRating && ['High', 'Medium', 'Low'].includes(manualRating)) return manualRating;
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
};

const calculatePercentChange = (priorValue, currentValue) => {
  if (!priorValue) return currentValue > 0 ? 100 : 0;
  return Number((((currentValue - priorValue) / priorValue) * 100).toFixed(1));
};

const escapeHtml = (value) => {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const getAvailableAuditorsCount = async () => {
  const configuredAuditorCapacity = parseInt(process.env.AVAILABLE_AUDITORS || '', 10);
  if (!Number.isNaN(configuredAuditorCapacity) && configuredAuditorCapacity >= 0) {
    return configuredAuditorCapacity;
  }

  return (await User.count({
    where: {
      isActive: true,
      role: {
        [Op.in]: ['team_member', 'team_lead', 'quality_assurance']
      }
    }
  })) || 0;
};

const buildPlanDashboardData = (plans, availableAuditors, auditorCapacityHours) => {
  const quarterlyDistributionMap = QA_PLAN_QUARTERS.reduce((acc, quarter) => {
    acc[quarter] = {
      quarter,
      auditsScheduled: 0,
      resources: 0,
      availableAuditors,
      capacityPercent: 0
    };
    return acc;
  }, {});

  const consolidatedRows = plans.map(plan => {
    const quarter = detectQuarter(plan);
    const resources = estimateResources(plan, auditorCapacityHours);
    const score = deriveRiskScore(plan);
    const budget = Number((parseFloat(plan.budget) || 0).toFixed(2));

    if (quarter && quarterlyDistributionMap[quarter]) {
      quarterlyDistributionMap[quarter].auditsScheduled += 1;
      quarterlyDistributionMap[quarter].resources += resources;
    }

    return {
      id: plan.id,
      planNumber: plan.planNumber,
      title: plan.title,
      unitName: plan.department || 'Unassigned',
      operationalRiskScore: score,
      riskRating: deriveRiskRating(score, plan),
      frequency: detectFrequency(plan),
      quarter: quarter || 'N/A',
      resources,
      budget,
      status: plan.status
    };
  });

  const quarterlyDistribution = QA_PLAN_QUARTERS.map(quarter => {
    const card = quarterlyDistributionMap[quarter];
    const capacityPercent = availableAuditors > 0
      ? Number(((card.resources / availableAuditors) * 100).toFixed(1))
      : 0;

    return {
      ...card,
      capacityPercent
    };
  });

  const consolidatedTotals = consolidatedRows.reduce((acc, row) => {
    acc.resources += row.resources;
    acc.budget = Number((acc.budget + row.budget).toFixed(2));
    return acc;
  }, { resources: 0, budget: 0 });

  return {
    quarterlyDistribution,
    consolidatedAuditPlan: {
      unitsReadyForCaeReview: plans.filter(p => p.status === 'approved').length,
      rows: consolidatedRows,
      totals: consolidatedTotals
    }
  };
};

const buildAuditPlansWhere = ({ status, department, ids }) => {
  const where = {};
  if (status) where.status = status;
  if (department) where.department = department;
  if (Array.isArray(ids) && ids.length > 0) where.id = ids;
  return where;
};

const fetchAuditPlans = async ({ status, department, ids }) => {
  const where = buildAuditPlansWhere({ status, department, ids });
  return AuditPlan.findAll({
    where,
    order: [['createdAt', 'DESC']],
    include: getQaPlanInclude()
  });
};


// TEMPLATE DOWNLOAD ENDPOINT (UPDATED)


// @desc    Download Operational Risk Template (Excel)
// @route   GET /api/qa/download-risk-template
// @access  Quality Assurance and above
router.get('/download-risk-template', (req, res) => {
  try {
    // Generate template
    const wb = generateRiskTemplate();
    
    // Write to buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Set headers for Excel file download
    res.setHeader('Content-Disposition', 'attachment; filename=Operational_Risk_Template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send the file
    res.send(buffer);

  } catch (error) {
    console.error('Download template error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating template'
    });
  }
});


// EXCEL UPLOAD AND VALIDATION ENDPOINT


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
// ENHANCED DASHBOARD WITH CHARTS - FIXED VERSION
// =======================

router.get('/dashboard-data', async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const priorYear = currentYear - 1;
    const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4'];

    // Initialize with default values
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

    // Safely get current year audits
    try {
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

      currentYearAudits.forEach(item => {
        const quarterNum = Math.floor(parseFloat(item.quarter));
        if (quarterNum >= 1 && quarterNum <= 4) {
          const quarterKey = `Q${quarterNum}`;
          auditPerformance.currentYear.quarters[quarterKey] = parseInt(item.count) || 0;
        }
      });
    } catch (err) {
      console.log('Error fetching current year audits:', err.message);
    }

    // Safely get prior year audits
    try {
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

      priorYearAudits.forEach(item => {
        const quarterNum = Math.floor(parseFloat(item.quarter));
        if (quarterNum >= 1 && quarterNum <= 4) {
          const quarterKey = `Q${quarterNum}`;
          auditPerformance.priorYear.quarters[quarterKey] = parseInt(item.count) || 0;
        }
      });
    } catch (err) {
      console.log('Error fetching prior year audits:', err.message);
    }

    // Calculate quarterly variance safely
    const quarterlyVariance = {
      quarters: quarterOrder,
      variance: [],
      percentChange: []
    };

    quarterOrder.forEach(quarter => {
      const current = auditPerformance.currentYear.quarters[quarter] || 0;
      const prior = auditPerformance.priorYear.quarters[quarter] || 0;
      const variance = current - prior;
      
      quarterlyVariance.variance.push(variance);
      
      // Safe percent change calculation
      quarterlyVariance.percentChange.push(calculatePercentChange(prior, current));
    });

    // Get metrics with error handling
    let pendingPlansCount = 0;
    let readyForConsolidation = 0;
    let pendingApprovals = 0;
    let reportsToReview = 0;
    let totalAudits = 0;
    const historySummary = {};

    try {
      pendingPlansCount = await AuditPlan.count({ where: { status: 'under_review' } }) || 0;
    } catch (err) {
      console.log('Error counting pending plans:', err.message);
    }

    try {
      readyForConsolidation = await AuditPlan.count({ where: { status: 'approved' } }) || 0;
    } catch (err) {
      console.log('Error counting ready plans:', err.message);
    }

    try {
      pendingApprovals = await AuditPlan.count({
        where: sequelize.where(
          sequelize.literal(`COALESCE(("metadata"->'caeSubmission'->>'submitted')::boolean, false)`),
          true
        )
      }) || 0;
    } catch (err) {
      console.log('Error counting pending approvals:', err.message);
    }

    try {
      reportsToReview = await AuditPlan.count({ where: { status: 'ready_for_review' } }) || 0;
    } catch (err) {
      console.log('Error counting reports to review:', err.message);
    }

    try {
      const auditHistory = await AuditPlan.findAll({
        attributes: [
          'status',
          [sequelize.fn('COUNT', sequelize.col('status')), 'count']
        ],
        group: ['status']
      });

      auditHistory.forEach(item => {
        const count = parseInt(item.dataValues.count) || 0;
        historySummary[item.status] = count;
        totalAudits += count;
      });
    } catch (err) {
      console.log('Error fetching audit history:', err.message);
    }

    let recentRiskAssessments = 0;
    let totalRiskFiles = 0;
    let resourceHoursRequired = 0;
    let resourcesRequired = 0;
    let availableAuditors = 0;
    let budgetRequired = 0;
    let budgetAllocated = 0;
    let unitYtdRows = [];
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);

    try {
      recentRiskAssessments = await RiskAssessment.count({
        where: {
          createdAt: {
            [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      }) || 0;
    } catch (err) {
      console.log('Error counting recent risk assessments:', err.message);
    }

    try {
      totalRiskFiles = await RiskAssessment.count({
        where: {
          cloudinaryPublicId: { [Op.ne]: null }
        }
      }) || 0;
    } catch (err) {
      console.log('Error counting cloudinary files:', err.message);
    }

    try {
      const yearlyResourceHours = await AuditPlan.sum('resourceHours', {
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          currentYear
        )
      });

      resourceHoursRequired = Math.round(parseFloat(yearlyResourceHours) || 0);
      resourcesRequired = auditorCapacityHours > 0
        ? Math.ceil(resourceHoursRequired / auditorCapacityHours)
        : 0;
    } catch (err) {
      console.log('Error calculating resource requirements:', err.message);
    }

    try {
      const configuredAuditorCapacity = parseInt(process.env.AVAILABLE_AUDITORS || '', 10);
      if (!Number.isNaN(configuredAuditorCapacity) && configuredAuditorCapacity >= 0) {
        availableAuditors = configuredAuditorCapacity;
      } else {
        availableAuditors = await User.count({
          where: {
            isActive: true,
            role: {
              [Op.in]: ['team_member', 'team_lead', 'quality_assurance']
            }
          }
        }) || 0;
      }
    } catch (err) {
      console.log('Error calculating available auditors:', err.message);
    }

    try {
      const requiredBudget = await AuditPlan.sum('budget', {
        where: sequelize.where(
          sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
          currentYear
        )
      });

      const allocatedBudget = await AuditPlan.sum('budget', {
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
              currentYear
            ),
            {
              status: {
                [Op.in]: ['approved', 'consolidated', 'implemented']
              }
            }
          ]
        }
      });

      budgetRequired = Number((parseFloat(requiredBudget) || 0).toFixed(2));
      budgetAllocated = Number((parseFloat(allocatedBudget) || 0).toFixed(2));
    } catch (err) {
      console.log('Error calculating budget requirements:', err.message);
    }

    try {
      const [currentYearUnits, priorYearUnits] = await Promise.all([
        AuditPlan.findAll({
          where: sequelize.where(
            sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
            currentYear
          ),
          attributes: ['department'],
          raw: true
        }),
        AuditPlan.findAll({
          where: sequelize.where(
            sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM "createdAt"')),
            priorYear
          ),
          attributes: ['department'],
          raw: true
        })
      ]);

      const normalizeUnit = (value) => {
        if (!value) return 'Unassigned';
        const unitName = value.toString().trim();
        return unitName || 'Unassigned';
      };

      const currentUnitCounts = {};
      const priorUnitCounts = {};

      currentYearUnits.forEach(plan => {
        const unit = normalizeUnit(plan.department);
        currentUnitCounts[unit] = (currentUnitCounts[unit] || 0) + 1;
      });

      priorYearUnits.forEach(plan => {
        const unit = normalizeUnit(plan.department);
        priorUnitCounts[unit] = (priorUnitCounts[unit] || 0) + 1;
      });

      const allUnits = Array.from(
        new Set([...Object.keys(currentUnitCounts), ...Object.keys(priorUnitCounts)])
      ).sort((a, b) => a.localeCompare(b));

      unitYtdRows = allUnits.map(unit => {
        const priorYtd = priorUnitCounts[unit] || 0;
        const currentYtd = currentUnitCounts[unit] || 0;
        const variance = currentYtd - priorYtd;
        return {
          businessUnit: unit,
          priorYtd,
          currentYtd,
          variance,
          percentChange: calculatePercentChange(priorYtd, currentYtd)
        };
      });
    } catch (err) {
      console.log('Error calculating unit YTD comparison:', err.message);
    }

    const completedThisYear = Object.values(auditPerformance.currentYear.quarters).reduce((a, b) => a + b, 0);
    const quarterComparisonRows = quarterOrder.map(quarter => {
      const prior = auditPerformance.priorYear.quarters[quarter] || 0;
      const current = auditPerformance.currentYear.quarters[quarter] || 0;
      const variance = current - prior;
      return {
        quarter,
        priorYear: prior,
        currentYear: current,
        variance,
        percentChange: calculatePercentChange(prior, current)
      };
    });

    const quarterTotals = quarterComparisonRows.reduce((acc, row) => {
      acc.priorYear += row.priorYear;
      acc.currentYear += row.currentYear;
      return acc;
    }, { priorYear: 0, currentYear: 0 });
    quarterTotals.variance = quarterTotals.currentYear - quarterTotals.priorYear;
    quarterTotals.percentChange = calculatePercentChange(quarterTotals.priorYear, quarterTotals.currentYear);

    const unitTotals = unitYtdRows.reduce((acc, row) => {
      acc.priorYtd += row.priorYtd;
      acc.currentYtd += row.currentYtd;
      return acc;
    }, { priorYtd: 0, currentYtd: 0 });
    unitTotals.variance = unitTotals.currentYtd - unitTotals.priorYtd;
    unitTotals.percentChange = calculatePercentChange(unitTotals.priorYtd, unitTotals.currentYtd);

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
        },
        resourcesRequired: {
          label: 'Resources Required',
          count: resourcesRequired,
          hours: resourceHoursRequired,
          icon: 'team'
        },
        budgetRequired: {
          label: 'Budget Required',
          amount: budgetRequired,
          allocated: budgetAllocated,
          currency: budgetCurrency,
          icon: 'currency'
        },
        availableAuditors: {
          label: 'Available Auditors',
          count: availableAuditors,
          icon: 'users'
        }
      },
      comparisonTables: {
        quarterAnalysis: {
          title: 'Comparative Analysis: Audit Performance',
          subtitle: 'Prior Year vs Current Year audit counts by quarter',
          priorYear,
          currentYear,
          rows: quarterComparisonRows,
          totals: {
            label: 'Total',
            ...quarterTotals
          }
        },
        unitYtdAnalysis: {
          title: 'Audit Counts by Unit (Year-to-Date)',
          subtitle: 'Prior year vs current year by business unit',
          priorYear,
          currentYear,
          rows: unitYtdRows,
          totals: {
            label: 'Total',
            ...unitTotals
          }
        }
      },
      executiveSummary: {
        totalAudits,
        resourcesRequired,
        resourceHoursRequired,
        availableAuditors,
        budgetRequired,
        budgetAllocated,
        budgetCurrency
      },
      summary: {
        totalAudits,
        pendingReviews: pendingPlansCount,
        completedThisYear,
        totalCloudinaryFiles: totalRiskFiles,
        resourcesRequired,
        resourceHoursRequired,
        availableAuditors,
        budgetRequired,
        budgetAllocated,
        budgetCurrency
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
      message: 'Error fetching enhanced dashboard data',
      error: error.message
    });
  }
});


// AUDIT PLAN CONSOLIDATION


// @desc    Get all audit plans for consolidation
// @route   GET /api/qa/audit-plans
// @access  Quality Assurance and above
router.get('/audit-plans', async (req, res) => {
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });

    // Count plans pending review
    const pendingCount = await AuditPlan.count({
      where: { status: 'under_review' }
    });

    let availableAuditors = 0;
    try {
      availableAuditors = await getAvailableAuditorsCount();
    } catch (err) {
      console.log('Error calculating available auditors for plan dashboard:', err.message);
    }

    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const submittedToCae = plans.filter(p => p?.metadata?.caeSubmission?.submitted === true).length;

    res.json({
      success: true,
      data: plans,
      summary: {
        total: plans.length,
        pendingReview: pendingCount,
        readyForConsolidation: plans.filter(p => p.status === 'approved').length,
        submittedToCae
      },
      planDashboard
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

// @desc    Update consolidated plan risk score (Edit Score action)
// @route   PUT /api/qa/audit-plans/:id/score
// @access  Quality Assurance and above
router.put('/audit-plans/:id/score', async (req, res) => {
  try {
    const { id } = req.params;
    const { operationalRiskScore, riskRating } = req.body;
    const parsedScore = Number(operationalRiskScore);
    const allowedRatings = ['High', 'Medium', 'Low'];

    if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      return res.status(400).json({
        success: false,
        message: 'operationalRiskScore must be a number between 0 and 100'
      });
    }

    if (riskRating && !allowedRatings.includes(riskRating)) {
      return res.status(400).json({
        success: false,
        message: 'riskRating must be one of: High, Medium, Low'
      });
    }

    const plan = await AuditPlan.findByPk(id, { include: getQaPlanInclude() });
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Audit plan not found'
      });
    }

    const resolvedRating = riskRating || deriveRiskRating(parsedScore);
    await plan.update({
      metadata: {
        ...(plan.metadata || {}),
        manualOperationalRiskScore: parsedScore,
        manualRiskRating: resolvedRating,
        scoreUpdatedAt: new Date(),
        scoreUpdatedBy: req.user.id,
        scoreUpdatedByName: req.user.name
      }
    });

    const dashboardRow = buildPlanDashboardData(
      [plan],
      0,
      parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10)
    ).consolidatedAuditPlan.rows[0];

    return res.json({
      success: true,
      message: 'Risk score updated successfully',
      data: {
        id: plan.id,
        operationalRiskScore: dashboardRow.operationalRiskScore,
        riskRating: dashboardRow.riskRating,
        metadata: plan.metadata
      }
    });
  } catch (error) {
    console.error('Update plan score error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating plan score',
      error: error.message
    });
  }
});

// @desc    Export consolidated audit plan to Excel
// @route   GET /api/qa/audit-plans/export-excel
// @access  Quality Assurance and above
const exportAuditPlansExcelHandler = async (req, res) => {
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });
    const availableAuditors = await getAvailableAuditorsCount();
    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';

    const workbook = XLSX.utils.book_new();

    const quarterlySheetData = [
      ['Quarter', 'Audits Scheduled', 'Resources', 'Available Auditors', 'Capacity %'],
      ...planDashboard.quarterlyDistribution.map(item => ([
        item.quarter,
        item.auditsScheduled,
        item.resources,
        item.availableAuditors,
        item.capacityPercent
      ]))
    ];

    const consolidatedSheetData = [
      ['Unit Name', 'Operational Risk Score', 'Risk Rating', 'Frequency', 'Quarter', 'Resources', `Budget (${budgetCurrency})`, 'Status'],
      ...planDashboard.consolidatedAuditPlan.rows.map(row => ([
        row.unitName,
        row.operationalRiskScore,
        row.riskRating,
        row.frequency,
        row.quarter,
        row.resources,
        row.budget,
        row.status
      ])),
      ['TOTAL', '', '', '', '', planDashboard.consolidatedAuditPlan.totals.resources, planDashboard.consolidatedAuditPlan.totals.budget, '']
    ];

    const quarterlySheet = XLSX.utils.aoa_to_sheet(quarterlySheetData);
    const consolidatedSheet = XLSX.utils.aoa_to_sheet(consolidatedSheetData);
    quarterlySheet['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
    consolidatedSheet['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];

    XLSX.utils.book_append_sheet(workbook, quarterlySheet, 'Quarterly Distribution');
    XLSX.utils.book_append_sheet(workbook, consolidatedSheet, 'Consolidated Audit Plan');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `QA_Consolidated_Audit_Plan_${timestamp}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    console.error('Export audit plans Excel error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error exporting audit plans to Excel',
      error: error.message
    });
  }
};

router.get('/audit-plans/export-excel', exportAuditPlansExcelHandler);
router.get('/audit-plans/export.xlsx', exportAuditPlansExcelHandler);

// @desc    Export consolidated audit plan to PDF
// @route   GET /api/qa/audit-plans/export-pdf
// @access  Quality Assurance and above
const exportAuditPlansPdfHandler = async (req, res) => {
  let browser;
  try {
    const { status, department } = req.query;
    const auditorCapacityHours = parseInt(process.env.AUDITOR_CAPACITY_HOURS || '160', 10);
    const plans = await fetchAuditPlans({ status, department });
    const availableAuditors = await getAvailableAuditorsCount();
    const planDashboard = buildPlanDashboardData(plans, availableAuditors, auditorCapacityHours);
    const budgetCurrency = process.env.BUDGET_CURRENCY || 'NGN';

    const quarterCardsHtml = planDashboard.quarterlyDistribution.map(item => `
      <tr>
        <td>${escapeHtml(item.quarter)}</td>
        <td>${item.auditsScheduled}</td>
        <td>${item.resources}</td>
        <td>${item.availableAuditors}</td>
        <td>${item.capacityPercent}%</td>
      </tr>
    `).join('');

    const consolidatedRowsHtml = planDashboard.consolidatedAuditPlan.rows.map(row => `
      <tr>
        <td>${escapeHtml(row.unitName)}</td>
        <td>${row.operationalRiskScore}</td>
        <td>${escapeHtml(row.riskRating)}</td>
        <td>${escapeHtml(row.frequency)}</td>
        <td>${escapeHtml(row.quarter)}</td>
        <td>${row.resources}</td>
        <td>${budgetCurrency} ${row.budget.toLocaleString()}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12px; color: #0f172a; padding: 24px; }
          h1 { margin: 0 0 8px; font-size: 22px; }
          h2 { margin: 24px 0 10px; font-size: 16px; }
          p.meta { margin: 0 0 16px; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
          th { background: #f1f5f9; font-weight: 700; }
          tfoot td { font-weight: 700; background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>Consolidated Audit Plan</h1>
        <p class="meta">Generated ${new Date().toLocaleString()}</p>

        <h2>Quarterly Distribution</h2>
        <table>
          <thead>
            <tr>
              <th>Quarter</th>
              <th>Audits Scheduled</th>
              <th>Resources</th>
              <th>Available Auditors</th>
              <th>Capacity %</th>
            </tr>
          </thead>
          <tbody>${quarterCardsHtml}</tbody>
        </table>

        <h2>Consolidated Audit Plan</h2>
        <table>
          <thead>
            <tr>
              <th>Unit Name</th>
              <th>Operational Risk Score</th>
              <th>Risk Rating</th>
              <th>Frequency</th>
              <th>Quarter</th>
              <th>Resources</th>
              <th>Budget</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${consolidatedRowsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="5">TOTAL</td>
              <td>${planDashboard.consolidatedAuditPlan.totals.resources}</td>
              <td>${budgetCurrency} ${planDashboard.consolidatedAuditPlan.totals.budget.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' }
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `QA_Consolidated_Audit_Plan_${timestamp}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Export audit plans PDF error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error exporting audit plans to PDF',
      error: error.message
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

router.get('/audit-plans/export-pdf', exportAuditPlansPdfHandler);
router.get('/audit-plans/export.pdf', exportAuditPlansPdfHandler);

// @desc    Submit approved plans to CAE
// @route   POST /api/qa/submit-to-cae
// @access  Quality Assurance and above
const submitToCaeHandler = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { planIds, notes, status, department } = req.body;
    const validPlanIds = Array.isArray(planIds) ? planIds.filter(Boolean) : [];

    const filters = {
      status: status || 'approved',
      department,
      ids: validPlanIds.length > 0 ? validPlanIds : undefined
    };

    const plans = await fetchAuditPlans(filters);

    if (validPlanIds.length > 0 && plans.length !== validPlanIds.length) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'One or more selected plans were not found'
      });
    }

    if (plans.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'No plans matched the submission criteria'
      });
    }

    const submissionId = `CAE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const submittedAt = new Date();

    for (const plan of plans) {
      const currentMetadata = plan.metadata || {};
      const history = Array.isArray(currentMetadata.caeSubmissionHistory)
        ? currentMetadata.caeSubmissionHistory
        : [];

      const submissionRecord = {
        submissionId,
        submitted: true,
        submittedAt,
        submittedBy: req.user.name,
        submittedById: req.user.id,
        notes: notes || null
      };

      await plan.update({
        metadata: {
          ...currentMetadata,
          caeSubmission: submissionRecord,
          caeSubmissionHistory: [...history, submissionRecord]
        }
      }, { transaction });
    }

    await transaction.commit();
    await updateDashboardMetrics(req.user.id);

    return res.status(200).json({
      success: true,
      message: `Submitted ${plans.length} plan${plans.length !== 1 ? 's' : ''} to CAE`,
      data: {
        submissionId,
        submittedCount: plans.length,
        submittedAt,
        planIds: plans.map(plan => plan.id)
      }
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Submit to CAE error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error submitting plans to CAE',
      error: error.message
    });
  }
};

router.post('/submit-to-cae', submitToCaeHandler);
router.post('/audit-plans/submit-to-cae', submitToCaeHandler);

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

// @desc    Download risk data template (JSON format) - DEPRECATED
// @route   GET /api/qa/download-template
// @access  Quality Assurance and above
router.get('/download-template', (req, res) => {
  // Redirect to the new Excel template endpoint;
  res.redirect('/api/qa/download-risk-template');
});

// Helper function to update dashboard metrics;
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
