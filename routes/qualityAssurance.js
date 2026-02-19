const express = require('express');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const RiskAssessment = require('../models/RiskAssessment');
const AuditPlan = require('../models/AuditPlan');
const MonitoringDashboard = require('../models/MonitoringDashboard');
const User = require('../models/User');
const { sequelize } = require('../config/database');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/risk-data';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'risk-data-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'text/csv'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel, JSON, and CSV files are allowed.'));
    }
  }
});

// All QA routes require authentication and quality_assurance role or higher
router.use(protect);
router.use(hasRoleLevel('quality_assurance'));

// =======================
// RISK ASSESSMENT ENDPOINTS
// =======================

// @desc    Upload risk data
// @route   POST /api/qa/upload-risk-data
// @access  Quality Assurance and above
router.post('/upload-risk-data', upload.single('riskFile'), async (req, res) => {
  try {
    const { title, description, department, assessmentDate, riskData } = req.body;
    
    // Parse risk data if provided as JSON string
    let parsedRiskData = {};
    if (riskData) {
      try {
        parsedRiskData = JSON.parse(riskData);
      } catch (e) {
        parsedRiskData = { raw: riskData };
      }
    }

    // If file was uploaded, process it
    if (req.file) {
      parsedRiskData.fileInfo = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
        mimetype: req.file.mimetype
      };
    }

    // Calculate risk metrics (simplified - you'd parse actual file content)
    const totalRisks = parsedRiskData.risks?.length || 0;
    const highRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'high').length || 0;
    const mediumRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'medium').length || 0;
    const lowRiskCount = parsedRiskData.risks?.filter(r => r.severity === 'low').length || 0;

    // Create risk assessment
    const riskAssessment = await RiskAssessment.create({
      title: title || 'Risk Assessment Upload',
      description,
      status: 'pending',
      riskData: parsedRiskData,
      originalFileName: req.file?.originalname,
      fileUrl: req.file?.path,
      fileSize: req.file?.size,
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
        fileType: req.file?.mimetype
      }
    });

    // Update or create dashboard with new metrics
    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: 'Risk data uploaded successfully',
      data: riskAssessment
    });

  } catch (error) {
    console.error('Upload risk data error:', error);
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
    
    // Build filter
    const where = {};
    if (status) where.status = status;
    if (department) where.department = department;
    if (fromDate || toDate) {
      where.assessmentDate = {};
      if (fromDate) where.assessmentDate.$gte = new Date(fromDate);
      if (toDate) where.assessmentDate.$lte = new Date(toDate);
    }

    // Get all risk assessments
    const riskAssessments = await RiskAssessment.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name', 'email', 'role']
      }]
    });

    // Get status counts for dashboard
    const statusCounts = await RiskAssessment.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('status')), 'count']
      ],
      group: ['status']
    });

    // Format counts
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
      data: riskAssessments,
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

    // Update status
    riskAssessment.status = status;
    riskAssessment.updatedBy = req.user.id;

    // If completed, set completedAt
    if (status === 'completed') {
      riskAssessment.completedAt = new Date();
      riskAssessment.progressPercentage = 100;
    } else if (status === 'in_progress') {
      riskAssessment.progressPercentage = 50;
    } else if (status === 'pending') {
      riskAssessment.progressPercentage = 0;
    }

    await riskAssessment.save();

    // Update dashboard metrics
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

// =======================
// MONITORING DASHBOARD ENDPOINTS
// =======================

// @desc    Get monitoring dashboard data
// @route   GET /api/qa/dashboard
// @access  Quality Assurance and above
router.get('/dashboard', async (req, res) => {
  try {
    // Get or create dashboard for user
    let dashboard = await MonitoringDashboard.findOne({
      where: { createdBy: req.user.id, dashboardType: 'qa' }
    });

    // Get real-time metrics
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

    // Format risk counts
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

    // Get recent risk assessments
    const recentRisks = await RiskAssessment.findAll({
      limit: 5,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'name']
      }]
    });

    // Get pending plans to review
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
        user: r.creator?.name
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
          name: 'Monitoring Dashboard',
          description: 'Track status & generate reports',
          endpoint: '/api/qa/dashboard',
          icon: 'dashboard'
        },
        {
          name: 'Consolidate Plans',
          description: `${pendingPlans} unit plans to review`,
          endpoint: '/api/qa/consolidate-plans',
          icon: 'merge'
        }
      ]
    };

    // Update or create dashboard record
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
          as: 'teamLead',
          attributes: ['id', 'name', 'email']
        },
        {
          model: RiskAssessment,
          as: 'riskAssessment',
          attributes: ['id', 'title', 'status']
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
      message: 'Error fetching audit plans'
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

    // Get all plans to consolidate
    const plans = await AuditPlan.findAll({
      where: {
        id: planIds
      }
    });

    if (plans.length !== planIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more plans not found'
      });
    }

    // Generate consolidated plan number
    const planNumber = 'CON-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    // Combine audit areas from all plans
    const allAuditAreas = [];
    plans.forEach(plan => {
      if (plan.auditAreas && Array.isArray(plan.auditAreas)) {
        allAuditAreas.push(...plan.auditAreas);
      }
    });

    // Create consolidated plan
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
          planNumber: p.planNumber
        }))
      }
    });

    // Update original plans to mark as consolidated
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

    // Update dashboard metrics
    await updateDashboardMetrics(req.user.id);

    res.status(201).json({
      success: true,
      message: `Successfully consolidated ${plans.length} plans`,
      data: consolidatedPlan
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
    // Create a simple template structure
    const template = {
      version: '1.0',
      templateType: 'operational_risk_data',
      instructions: 'Fill in your risk data following this structure',
      example: {
        risks: [
          {
            id: 'RISK-001',
            title: 'Example Risk',
            description: 'Risk description',
            severity: 'high', // high, medium, low
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

      await dashboard.update({
        riskSummary: counts,
        updatedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Update dashboard metrics error:', error);
  }
}

module.exports = router;